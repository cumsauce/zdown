import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { type EditorState, type Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { findShortcodes, findTemplating, isTemplated, type RenderCtx, renderCall, renderMarkdown, renderTemplated, type ShortcodeCall } from '../../lib/render';
import { resolveImage } from '../../lib/site';

// The writing surface: markdown that looks like the finished post, with the
// syntax appearing only where the cursor is. All of it is decorations over the
// real parse tree (never regexes over lines, never document edits), so nested
// lists, code inside lists, emphasis across lines etc. read the way a markdown
// renderer reads them. The document on disk is always plain markdown.

export const setRenderCtx = StateEffect.define<RenderCtx | null>();
export const setShowMarks = StateEffect.define<boolean>();
const setFocused = StateEffect.define<boolean>();

interface Options { ctx: RenderCtx | null; showMarks: boolean; focused: boolean }

const options = StateField.define<Options>({
  create: () => ({ ctx: null, showMarks: false, focused: false }),
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(setRenderCtx)) v = { ...v, ctx: e.value };
      if (e.is(setShowMarks)) v = { ...v, showMarks: e.value };
      if (e.is(setFocused)) v = { ...v, focused: e.value };
    }
    return v;
  },
});

// ---------- widgets ----------

class Marker extends WidgetType {
  constructor(readonly text: string, readonly cls: string) { super(); }
  eq(o: Marker) { return o.text === this.text && o.cls === this.cls; }
  toDOM() {
    const s = document.createElement('span');
    s.className = `md-li-marker ${this.cls}`;
    s.textContent = this.text;
    return s;
  }
  ignoreEvent() { return false; }
}

class TaskBox extends WidgetType {
  constructor(readonly checked: boolean, readonly at: number) { super(); }
  eq(o: TaskBox) { return o.checked === this.checked && o.at === this.at; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'md-li-marker';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'md-task';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? 'done' : 'to do');
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.checked ? ' ' : 'x' } });
    });
    wrap.append(box);
    return wrap;
  }
  ignoreEvent() { return true; }
}

class Empty extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.style.display = 'none'; return s; }
  ignoreEvent() { return false; }
}
const HIDE = Decoration.replace({});
const HIDE_ATOM = Decoration.replace({ widget: new Empty() });

class Rule extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'md-hr'; s.textContent = '* * *'; return s; }
  ignoreEvent() { return false; }
}

// Aspect ratios seen so far: a re-created image reserves its real height, so the
// document doesn't jump as the cursor moves past it.
const ratios = new Map<string, number>();

class ImageBlock extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly title: string, readonly ctx: RenderCtx | null) { super(); }
  eq(o: ImageBlock) { return o.src === this.src && o.alt === this.alt && o.title === this.title && o.ctx === this.ctx; }
  get estimatedHeight() {
    const r = ratios.get(this.src);
    return r ? Math.min(640, r * 640) : 240;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('figure');
    box.className = 'md-block';
    const r = this.ctx ? resolveImage(this.src, this.ctx.path, this.ctx.site, this.ctx.repoId) : null;
    if (r && !r.url) {
      const miss = document.createElement('div');
      miss.className = 'img-missing';
      miss.style.margin = '0';
      miss.textContent = `Image not found: ${this.src}`;
      const small = document.createElement('small');
      small.textContent = `Looked in ${r.tried.slice(0, 3).join(', ')}`;
      miss.append(small);
      box.append(miss);
      return box;
    }
    const img = document.createElement('img');
    img.className = 'md-img';
    img.alt = this.alt;
    img.src = r?.url ?? this.src;
    const ratio = ratios.get(this.src);
    if (ratio) img.style.aspectRatio = String(1 / ratio);
    img.addEventListener('load', () => {
      if (img.naturalWidth) {
        ratios.set(this.src, img.naturalHeight / img.naturalWidth);
        img.style.aspectRatio = '';
      }
      view.requestMeasure();
    });
    img.addEventListener('error', () => {
      const miss = document.createElement('div');
      miss.className = 'img-missing';
      miss.style.margin = '0';
      miss.textContent = `Couldn't load image: ${this.src}`;
      img.replaceWith(miss);
      view.requestMeasure();
    });
    box.append(img);
    const caption = this.title || this.alt;
    if (caption) {
      const c = document.createElement('figcaption');
      c.className = 'md-img-caption';
      c.textContent = caption;
      box.append(c);
    }
    return box;
  }
  // a click lands in the document, which reveals the source for editing
  ignoreEvent() { return false; }
}

class InlineImage extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly ctx: RenderCtx | null) { super(); }
  eq(o: InlineImage) { return o.src === this.src && o.alt === this.alt && o.ctx === this.ctx; }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'md-img-inline';
    img.alt = this.alt;
    const r = this.ctx ? resolveImage(this.src, this.ctx.path, this.ctx.site, this.ctx.repoId) : null;
    img.src = r?.url ?? this.src;
    return img;
  }
  ignoreEvent() { return false; }
}

// Rendered HTML is cached per source: selection changes rebuild decorations,
// and re-running templates and the sanitizer for each would be wasted work.
const renderCache = new Map<string, string>();
function cached(key: string, make: () => string) {
  let v = renderCache.get(key);
  if (v === undefined) {
    if (renderCache.size > 500) renderCache.clear();
    v = make();
    renderCache.set(key, v);
  }
  return v;
}

const templatedCache = new Map<string, { html: string; error: string | null }>();
function cachedTemplated(key: string, make: () => { html: string; error: string | null }) {
  let v = templatedCache.get(key);
  if (!v) {
    if (templatedCache.size > 500) templatedCache.clear();
    v = make();
    templatedCache.set(key, v);
  }
  return v;
}

const unwrapP = (html: string) => html.trim().replace(/^<p>([\s\S]*)<\/p>$/, '$1');

class HtmlBlock extends WidgetType {
  constructor(readonly key: string, readonly html: string, readonly inline = false) { super(); }
  eq(o: HtmlBlock) { return o.html === this.html; }
  get estimatedHeight() { return this.inline ? -1 : 120; }
  toDOM(view: EditorView) {
    const box = document.createElement(this.inline ? 'span' : 'div');
    box.className = this.inline ? 'sc-inline-render' : 'md-block prose';
    box.innerHTML = this.html;
    for (const img of box.querySelectorAll('img')) img.addEventListener('load', () => view.requestMeasure());
    // rendered links are for reading in preview; here a tap means "edit this"
    box.addEventListener('click', (e) => e.preventDefault());
    return box;
  }
  ignoreEvent() { return false; }
}

// ---------- building decorations ----------

interface Parsed { shortcodes: ShortcodeCall[]; code: [number, number][]; templated: boolean }

/** Code ranges from the tree, then shortcodes outside them. Doc-only: cached between selection changes. */
function parseDoc(state: EditorState): Parsed {
  const tree = ensureSyntaxTree(state, state.doc.length, 40) ?? syntaxTree(state);
  const code: [number, number][] = [];
  tree.iterate({
    enter(n) {
      if (n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'InlineCode') { code.push([n.from, n.to]); return false; }
      return undefined;
    },
  });
  const text = state.doc.toString();
  const { ctx } = state.field(options);
  if (isTemplated(text, ctx?.site ?? null)) return { shortcodes: findTemplating(text, code), code, templated: true };
  return { shortcodes: findShortcodes(text, code), code, templated: false };
}

export const parsedField = StateField.define<Parsed>({
  create: parseDoc,
  update(v, tr) {
    return tr.docChanged || tr.effects.some((e) => e.is(setRenderCtx)) || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? parseDoc(tr.state) : v;
  },
});

const INLINE_MARKS: Record<string, string> = { Emphasis: 'md-em', StrongEmphasis: 'md-strong', Strikethrough: 'md-strike', InlineCode: 'md-code' };
const MARK_NAMES = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark']);

function build(state: EditorState): { deco: DecorationSet; atomic: DecorationSet } {
  const { doc } = state;
  const { ctx, showMarks, focused } = state.field(options);
  const { shortcodes, templated } = state.field(parsedField);
  const tree = ensureSyntaxTree(state, doc.length, 40) ?? syntaxTree(state);
  const sel = focused ? state.selection.ranges : [];
  const touches = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
  const lineActive = (from: number, to: number) => {
    const a = doc.lineAt(from).from;
    const b = doc.lineAt(to).to;
    return sel.some((r) => r.from <= b && r.to >= a);
  };

  const out: Range<Decoration>[] = [];
  const atoms: Range<Decoration>[] = [];
  const add = (from: number, to: number, d: Decoration) => { if (to > from) out.push(d.range(from, to)); };
  const mark = (cls: string) => Decoration.mark({ class: cls });
  // Per-line classes and variables, merged so nested structures compose.
  const lines = new Map<number, { cls: Set<string>; vars: Record<string, number> }>();
  const lineOf = (pos: number) => {
    const n = doc.lineAt(pos).number;
    let l = lines.get(n);
    if (!l) lines.set(n, (l = { cls: new Set(), vars: {} }));
    return l;
  };
  const replaced = new Set<number>(); // line numbers swallowed by a block widget

  const hideMark = (from: number, to: number, reveal: boolean) => {
    if (to <= from) return;
    if (reveal || showMarks) add(from, to, mark('md-mark'));
    else add(from, to, HIDE);
  };

  // ---- shortcodes and other rendered blocks ----
  const blockFor = (from: number, to: number, widget: WidgetType, srcCls: string) => {
    const first = doc.lineAt(from);
    const last = doc.lineAt(to);
    const whole = doc.sliceString(first.from, from).trim() === '' && doc.sliceString(to, last.to).trim() === '';
    if (!whole) return false;
    if (lineActive(from, to) || showMarks) {
      for (let n = first.number; n <= last.number; n++) lineOf(doc.line(n).from).cls.add(srcCls);
      out.push(Decoration.widget({ widget, block: true, side: 1 }).range(last.to));
    } else {
      out.push(Decoration.replace({ widget, block: true }).range(first.from, last.to));
      for (let n = first.number; n <= last.number; n++) replaced.add(n);
    }
    return true;
  };

  const skips: [number, number][] = [];
  const seen = new Map<string, number>();
  // {% set %}s earlier in the page are visible to later tags
  const fieldsKey = ctx ? JSON.stringify(ctx.fields ?? {}) : '';
  const prelude = templated
    ? shortcodes.filter((c) => c.kind === 'tag' && /^\{%-?\s*set(_global)?\s+\w+\s*=/.test(doc.sliceString(c.from, c.to))).map((c) => doc.sliceString(c.from, c.to)).join('')
    : '';
  for (const call of shortcodes) {
    skips.push([call.from, call.to]);
    if (call.kind === 'tag' || call.kind === 'comment' || call.kind === 'raw') {
      add(call.from, call.to, mark('md-html'));
      continue;
    }
    if (call.kind) {
      const src = doc.sliceString(call.from, call.to);
      const key = `${prelude}|${src}`;
      const rendered = ctx ? cachedTemplated(`${ctx.path}|${ctx.site?.title}|${fieldsKey}|${key}`, () => renderTemplated(src, prelude, ctx, { embeds: 'facade' })) : { html: '', error: null };
      // an expression that can't resolve here (a loop variable, say) stays as source
      if (call.kind === 'expr' && (rendered.error || !ctx)) { add(call.from, call.to, mark('md-html')); continue; }
      if (blockFor(call.from, call.to, new HtmlBlock(key, rendered.html), 'md-src-sc')) continue;
      if (touches(call.from, call.to) || showMarks || !ctx) add(call.from, call.to, mark('md-src-sc md-html'));
      else out.push(Decoration.replace({ widget: new HtmlBlock(key, unwrapP(rendered.html), true) }).range(call.from, call.to));
      continue;
    }
    const nth = (seen.get(call.name) ?? 0) + 1;
    seen.set(call.name, nth);
    if (call.escaped) {
      add(call.from, call.to, mark('md-html'));
      continue;
    }
    const key = `${nth}|${doc.sliceString(call.from, call.to)}`;
    const html = ctx ? cached(`${ctx.path}|${ctx.site?.title}|${fieldsKey}|${key}`, () => renderCall(call, ctx, { embeds: 'facade' }, nth)) : '';
    if (!blockFor(call.from, call.to, new HtmlBlock(key, html), 'md-src-sc')) {
      // inside a sentence: render in place, source appears under the cursor
      if (touches(call.from, call.to) || showMarks || !ctx) add(call.from, call.to, mark('md-src-sc md-html'));
      else out.push(Decoration.replace({ widget: new HtmlBlock(key, html, true) }).range(call.from, call.to));
    }
  }
  const inSkip = (from: number, to: number) => skips.some(([a, b]) => from >= a && to <= b);

  // ---- the parse tree ----
  let liDepth = 0;
  const numbering: { next: number }[] = [];
  const liLine = new Map<number, number>(); // deepest list level per line

  tree.iterate({
    enter(n) {
      const name = n.name;
      if (inSkip(n.from, n.to)) return false;

      if (name.startsWith('ATXHeading')) {
        lineOf(n.from).cls.add('md-h').add(`md-h${name.slice(-1)}`);
        return undefined;
      }
      if (name.startsWith('SetextHeading')) {
        const lvl = name.slice(-1);
        const start = doc.lineAt(n.from).number;
        const end = doc.lineAt(n.to).number;
        for (let i = start; i < end; i++) lineOf(doc.line(i).from).cls.add('md-h').add(`md-h${lvl}`);
        return undefined;
      }
      if (name === 'HeaderMark') {
        const active = lineActive(n.from, n.to);
        // swallow the space after the #s so hidden headings aren't indented
        let to = n.to;
        while (to < doc.length && doc.sliceString(to, to + 1) === ' ') to++;
        if (doc.lineAt(n.from).from === n.from || doc.sliceString(doc.lineAt(n.from).from, n.from).trim() === '') {
          const prevBlank = doc.sliceString(n.from, n.to).startsWith('=') || doc.sliceString(n.from, n.to).startsWith('-');
          hideMark(n.from, prevBlank ? n.to : to, active);
        } else {
          let from = n.from; // closing #s: hide the space before them too
          while (from > 0 && doc.sliceString(from - 1, from) === ' ') from--;
          hideMark(from, n.to, active);
        }
        return false;
      }

      if (INLINE_MARKS[name]) { add(n.from, n.to, mark(INLINE_MARKS[name])); return undefined; }
      if (MARK_NAMES.has(name)) {
        const p = n.node.parent;
        // code fences stay visible: they're the block's edit handle
        if (p?.name !== 'FencedCode') hideMark(n.from, n.to, p ? touches(p.from, p.to) : true);
        return false;
      }
      if (name === 'Escape') { hideMark(n.from, n.from + 1, touches(n.from, n.to)); return false; }

      if (name === 'Link') {
        const reveal = touches(n.from, n.to) || showMarks;
        let textEnd = n.from;
        let textStart = n.from;
        const node = n.node;
        const marks = node.getChildren('LinkMark');
        if (marks.length >= 2) { textStart = marks[0].to; textEnd = marks[1].from; }
        add(textStart, textEnd, mark('md-link'));
        if (reveal) {
          for (const m of marks) add(m.from, m.to, mark('md-mark'));
          for (const c of [...node.getChildren('URL'), ...node.getChildren('LinkTitle'), ...node.getChildren('LinkLabel')]) add(c.from, c.to, mark('md-url'));
        } else {
          add(n.from, textStart, HIDE);
          add(textEnd, n.to, HIDE);
        }
        // the link text can hold emphasis
        return undefined;
      }
      if (name === 'LinkMark' || name === 'LinkTitle' || name === 'LinkLabel') return false;
      if (name === 'URL') {
        const parent = n.node.parent?.name;
        if (parent !== 'Link' && parent !== 'Image') add(n.from, n.to, mark('md-link'));
        return false;
      }
      if (name === 'Autolink') { add(n.from, n.to, mark('md-link')); return false; }

      if (name === 'Image') {
        const node = n.node;
        const marks = node.getChildren('LinkMark');
        const url = node.getChild('URL');
        const src = url ? doc.sliceString(url.from, url.to) : '';
        const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : '';
        const t = node.getChild('LinkTitle');
        const title = t ? doc.sliceString(t.from + 1, t.to - 1) : '';
        if (!src) { add(n.from, n.to, mark('md-html')); return false; }
        const block = new ImageBlock(src, alt, title, ctx);
        if (blockFor(n.from, n.to, block, 'md-src')) return false;
        if (touches(n.from, n.to) || showMarks) add(n.from, n.to, mark('md-html'));
        else out.push(Decoration.replace({ widget: new InlineImage(src, alt, ctx) }).range(n.from, n.to));
        return false;
      }

      if (name === 'FencedCode') {
        const first = doc.lineAt(n.from).number;
        const last = doc.lineAt(n.to).number;
        for (let i = first; i <= last; i++) {
          const l = lineOf(doc.line(i).from);
          l.cls.add('md-codeblock');
          if (i === first) l.cls.add('md-codeblock-first');
          if (i === last) l.cls.add('md-codeblock-last');
        }
        add(doc.line(first).from, doc.line(first).to, mark('md-fence'));
        if (last > first) add(doc.line(last).from, doc.line(last).to, mark('md-fence'));
        return undefined;
      }
      if (name === 'CodeText' || name === 'CodeInfo') return false;
      if (name === 'CodeBlock') {
        const first = doc.lineAt(n.from).number;
        const last = doc.lineAt(n.to).number;
        for (let i = first; i <= last; i++) {
          const l = lineOf(doc.line(i).from);
          l.cls.add('md-codeblock');
          if (i === first) l.cls.add('md-codeblock-first');
          if (i === last) l.cls.add('md-codeblock-last');
        }
        return false;
      }

      if (name === 'Blockquote') {
        const first = doc.lineAt(n.from).number;
        const last = doc.lineAt(n.to).number;
        for (let i = first; i <= last; i++) {
          const l = lineOf(doc.line(i).from);
          l.cls.add('md-q');
          l.vars.q = (l.vars.q ?? 0) + 1;
        }
        return undefined;
      }
      if (name === 'QuoteMark') {
        let to = n.to;
        if (doc.sliceString(to, to + 1) === ' ') to++;
        hideMark(n.from, to, lineActive(n.from, n.to));
        return false;
      }

      if (name === 'BulletList' || name === 'OrderedList') {
        numbering.push({ next: 0 });
        return undefined;
      }
      if (name === 'ListItem') {
        liDepth++;
        const first = doc.lineAt(n.from).number;
        const last = doc.lineAt(n.to).number;
        for (let i = first; i <= last; i++) liLine.set(i, Math.max(liLine.get(i) ?? 0, liDepth));
        return undefined;
      }
      if (name === 'ListMark') {
        const line = doc.lineAt(n.from);
        let to = n.to;
        if (to < line.to && doc.sliceString(to, to + 1) === ' ') to++;
        const task = n.node.nextSibling?.name === 'Task' || n.node.nextSibling?.firstChild?.name === 'TaskMarker';
        if (task) {
          atoms.push(HIDE_ATOM.range(n.from, to));
          add(n.from, to, HIDE_ATOM);
          return false;
        }
        const text = doc.sliceString(n.from, n.to);
        const ordered = /\d/.test(text);
        const counter = numbering[numbering.length - 1];
        if (showMarks) {
          add(n.from, to, mark('md-li-marker raw'));
        } else if (ordered) {
          const start = parseInt(text, 10);
          if (counter && counter.next === 0) counter.next = start;
          const label = `${counter ? counter.next++ : start}${text.slice(-1)}`;
          const d = Decoration.replace({ widget: new Marker(label, 'num') });
          add(n.from, to, d);
          atoms.push(d.range(n.from, to));
        } else {
          const glyph = ['•', '◦', '▪'][(liDepth - 1) % 3];
          const d = Decoration.replace({ widget: new Marker(glyph, '') });
          add(n.from, to, d);
          atoms.push(d.range(n.from, to));
        }
        return false;
      }
      if (name === 'TaskMarker') {
        const checked = /x/i.test(doc.sliceString(n.from, n.to));
        const line = doc.lineAt(n.from);
        let to = n.to;
        if (doc.sliceString(to, to + 1) === ' ') to++;
        const d = Decoration.replace({ widget: new TaskBox(checked, n.from) });
        add(n.from, to, d);
        atoms.push(d.range(n.from, to));
        if (checked && to < line.to) add(to, line.to, mark('md-task-done'));
        return false;
      }

      if (name === 'HorizontalRule') {
        if (lineActive(n.from, n.to) || showMarks) add(n.from, n.to, mark('md-mark'));
        else add(n.from, n.to, Decoration.replace({ widget: new Rule() }));
        return false;
      }

      if (name === 'Table') {
        const key = `table|${doc.sliceString(n.from, n.to)}`;
        const html = ctx ? cached(`${ctx.path}|${key}`, () => renderMarkdown(doc.sliceString(n.from, n.to), ctx, {})) : '';
        if (!ctx || !blockFor(n.from, n.to, new HtmlBlock(key, html), 'md-table-src')) {
          const first = doc.lineAt(n.from).number;
          const last = doc.lineAt(n.to).number;
          for (let i = first; i <= last; i++) lineOf(doc.line(i).from).cls.add('md-table-src');
        }
        return false;
      }
      if (name === 'HTMLBlock') {
        const src = doc.sliceString(n.from, n.to);
        const html = ctx ? cached(`${ctx.path}|html|${src}`, () => renderMarkdown(src, ctx, { embeds: 'facade' })) : '';
        if (!ctx || !html.trim() || !blockFor(n.from, n.to, new HtmlBlock(`html|${src}`, html), 'md-src')) add(n.from, n.to, mark('md-html'));
        return false;
      }
      if (name === 'HTMLTag' || name === 'Comment' || name === 'CommentBlock' || name === 'ProcessingInstruction' || name === 'ProcessingInstructionBlock') {
        add(n.from, n.to, mark('md-html'));
        return false;
      }
      return undefined;
    },
    leave(n) {
      if (n.name === 'ListItem') liDepth--;
      if (n.name === 'BulletList' || n.name === 'OrderedList') numbering.pop();
    },
  });

  // ---- lists: one visual step per real nesting level, however it's indented ----
  for (const [num, depth] of liLine) {
    if (replaced.has(num)) continue;
    const line = doc.line(num);
    const l = lineOf(line.from);
    l.cls.add('md-li');
    l.vars.li = depth;
    // the raw leading spaces are replaced by the step above
    const text = line.text;
    const ws = /^[ \t]*/.exec(text)![0].length;
    if (ws > 0 && !l.cls.has('md-q')) {
      const d = HIDE_ATOM;
      add(line.from, line.from + ws, d);
      atoms.push(d.range(line.from, line.from + ws));
    }
  }

  // ---- footnotes (not part of the GFM grammar) ----
  const codeSkip = state.field(parsedField).code;
  const text = doc.toString();
  for (const m of text.matchAll(/\[\^[^\]\s]+\](:)?/g)) {
    const from = m.index;
    const to = from + m[0].length;
    if (codeSkip.some(([a, b]) => from >= a && from < b) || inSkip(from, to)) continue;
    const line = doc.lineAt(from);
    if (m[1] && from === line.from) lineOf(line.from).cls.add('md-fn-def');
    else add(from, to, mark('md-fn'));
  }

  for (const [num, l] of lines) {
    const style = Object.entries(l.vars).map(([k, v]) => `--${k}:${v}`).join(';');
    out.push(Decoration.line({ class: [...l.cls].join(' '), ...(style ? { attributes: { style } } : {}) }).range(doc.line(num).from));
  }

  return { deco: Decoration.set(out, true), atomic: Decoration.set(atoms, true) };
}

const live = StateField.define<{ deco: DecorationSet; atomic: DecorationSet }>({
  create: build,
  update(v, tr) {
    const changed = tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setRenderCtx) || e.is(setShowMarks) || e.is(setFocused))
      || syntaxTree(tr.state) !== syntaxTree(tr.startState);
    return changed ? build(tr.state) : v;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.atomicRanges.of((view) => view.state.field(f).atomic),
  ],
});

export const livePreview = [
  options,
  parsedField,
  live,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
];
