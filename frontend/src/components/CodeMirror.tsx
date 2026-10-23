import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorSelection, EditorState, type Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';

// Raw hex mirrors theme.ts tokens (CodeMirror themes are plain style objects).
const C = {
  bg: '#000',
  fg: '#fff',
  fgSoft: '#e5e5e5',
  fgMuted: '#8a8a8a',
  fgFaint: '#5c5c5c',
  border: '#262626',
  accent: '#7dd3fc',
  accentLine: '#1f3a4a',
  accentWash: '#060d12',
  hover: '#0a0a0a',
  active: '#1f1f1f',
  codeBg: '#0d0d0d',
  serif: '"Newsreader", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
};

const editorTheme = EditorView.theme(
  {
    '&': { backgroundColor: C.bg, color: C.fgSoft, height: '100%' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: C.serif, lineHeight: '1.65', overflow: 'auto' },
    '.cm-content': {
      maxWidth: '44rem',
      width: '100%',
      margin: '0 auto',
      padding: '24px 24px 40vh',
      fontFamily: C.serif,
      fontSize: '17px',
      caretColor: C.accent,
    },
    '.cm-line': { padding: '0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: C.accent, borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
      { backgroundColor: `${C.active} !important` },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-placeholder': { color: C.fgFaint },

    // ---- live formatting (pure decorations; document text untouched) ----
    '.cm-md-fm': { fontFamily: C.mono, fontSize: '12.5px', lineHeight: '1.6', color: C.fgFaint, backgroundColor: C.codeBg },
    '.cm-md-codeblock': { fontFamily: C.mono, fontSize: '13px', lineHeight: '1.6', color: C.fgSoft, backgroundColor: C.codeBg },
    '.cm-md-fence': { color: C.fgFaint },
    '.cm-md-heading': { color: C.fg, fontWeight: '600', lineHeight: '1.35' },
    '.cm-md-h1': { fontSize: '1.45em' },
    '.cm-md-h2': { fontSize: '1.28em' },
    '.cm-md-h3': { fontSize: '1.12em' },
    '.cm-md-h4, .cm-md-h5, .cm-md-h6': { fontSize: '1em' },
    '.cm-md-marker': { color: C.fgFaint, fontWeight: '400', fontStyle: 'normal' },
    '.cm-md-strong': { color: C.fg, fontWeight: '600' },
    '.cm-md-em': { fontStyle: 'italic' },
    '.cm-md-strike': { textDecoration: 'line-through', color: C.fgMuted },
    '.cm-md-code': { fontFamily: C.mono, fontSize: '0.8em', color: C.fg, backgroundColor: C.bg, padding: '1px 0' },
    '.cm-md-link': { color: C.fg, textDecoration: 'underline', textDecorationColor: C.border, textUnderlineOffset: '3px' },
    '.cm-md-url': { color: C.fgFaint, fontFamily: C.mono, fontSize: '0.75em' },
    '.cm-md-quote': { color: C.fgMuted, fontStyle: 'italic' },
    '.cm-md-list': { color: C.accent },
    '.cm-md-shortcode': { fontFamily: C.mono, fontSize: '0.8em', color: C.accent, backgroundColor: C.accentWash },
    '.cm-md-hidden': { color: C.fgFaint, fontStyle: 'normal' },
  },
  { dark: true },
);

/** zero-width stand-in for a hidden marker in "clean" mode */
class HiddenMark extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-md-hidden';
    return s;
  }
  ignoreEvent() { return false; }
}

const line = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string) => Decoration.mark({ class: cls });
const MARKER = mark('cm-md-marker');
const HIDE = Decoration.replace({ widget: new HiddenMark() });

const INLINE: { re: RegExp; cls: string; open: number; close: number }[] = [
  { re: /\*\*(?=\S)(.+?\S?)\*\*/g, cls: 'cm-md-strong', open: 2, close: 2 },
  { re: /__(?=\S)(.+?)__/g, cls: 'cm-md-strong', open: 2, close: 2 },
  { re: /(?<![*\w])\*(?=[^\s*])([^*]+?)\*(?![*\w])/g, cls: 'cm-md-em', open: 1, close: 1 },
  { re: /(?<![_\w])_(?=[^\s_])([^_]+?)_(?![_\w])/g, cls: 'cm-md-em', open: 1, close: 1 },
  { re: /~~(?=\S)(.+?)~~/g, cls: 'cm-md-strike', open: 2, close: 2 },
];

function build(view: EditorView, showMarks: boolean): DecorationSet {
  const doc = view.state.doc;
  const out: Range<Decoration>[] = [];
  // In clean mode, markers stay visible on lines holding the selection so
  // editing them is never blind.
  const activeLines = new Set<number>();
  for (const r of view.state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) activeLines.add(n);
  }

  let inFm = false;
  let fence: string | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n);
    const text = l.text;

    // +++ TOML front matter: dimmed, never formatted.
    if (n === 1 && text.trim() === '+++') { inFm = true; out.push(line('cm-md-fm').range(l.from)); continue; }
    if (inFm) {
      out.push(line('cm-md-fm').range(l.from));
      if (text.trim() === '+++') inFm = false;
      continue;
    }

    // fenced code: decorate the fence line; interiors only get the mono line style.
    const fm = /^\s*(`{3,}|~{3,})/.exec(text);
    if (fence) {
      out.push(line('cm-md-codeblock').range(l.from));
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && text.trim() === fm[1]) {
        fence = null;
        out.push(mark('cm-md-fence').range(l.from, l.to));
      }
      continue;
    }
    if (fm) {
      fence = fm[1];
      out.push(line('cm-md-codeblock').range(l.from));
      if (l.to > l.from) out.push(mark('cm-md-fence').range(l.from, l.to));
      continue;
    }

    const hide = !showMarks && !activeLines.has(n);
    const marker = (from: number, to: number) => {
      if (to <= from) return;
      out.push((hide ? HIDE : MARKER).range(l.from + from, l.from + to));
    };

    // block-level prefixes
    let bodyStart = 0;
    const h = /^(#{1,6})(\s+)/.exec(text);
    if (h) {
      out.push(line(`cm-md-heading cm-md-h${h[1].length}`).range(l.from));
      marker(0, h[0].length);
      bodyStart = h[0].length;
    } else {
      const q = /^(\s*>\s?)+/.exec(text);
      if (q) {
        out.push(line('cm-md-quote').range(l.from));
        marker(0, q[0].length);
        bodyStart = q[0].length;
      }
      const li = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(text.slice(bodyStart));
      if (li) {
        const s = bodyStart + li[1].length;
        out.push(mark('cm-md-list').range(l.from + s, l.from + s + li[2].length));
        bodyStart += li[0].length;
      }
    }

    // inline spans; code spans are masked first so nothing formats inside them
    let masked = text;
    const maskRange = (a: number, b: number) => { masked = masked.slice(0, a) + ' '.repeat(b - a) + masked.slice(b); };
    for (const m of text.matchAll(/(`+)([^`]+?)\1(?!`)/g)) {
      const a = m.index!;
      if (a < bodyStart) continue;
      const b = a + m[0].length;
      const t = m[1].length;
      marker(a, a + t);
      out.push(mark('cm-md-code').range(l.from + a + t, l.from + b - t));
      marker(b - t, b);
      maskRange(a, b);
    }
    for (const m of masked.matchAll(/\{\{[^}]*\}\}|\{%[^%]*%\}/g)) {
      out.push(mark('cm-md-shortcode').range(l.from + m.index!, l.from + m.index! + m[0].length));
      maskRange(m.index!, m.index! + m[0].length);
    }
    for (const m of masked.matchAll(/(!?\[)([^\]\n]+)(\]\()([^)\s]+(?:\s+"[^"]*")?)(\))/g)) {
      const a = m.index!;
      const textFrom = a + m[1].length;
      const textTo = textFrom + m[2].length;
      marker(a, textFrom);
      out.push(mark('cm-md-link').range(l.from + textFrom, l.from + textTo));
      marker(textTo, textTo + m[3].length);
      const urlTo = textTo + m[3].length + m[4].length;
      if (hide) marker(textTo + m[3].length, urlTo);
      else out.push(mark('cm-md-url').range(l.from + textTo + m[3].length, l.from + urlTo));
      marker(urlTo, urlTo + 1);
      // link text still gets emphasis below; only mask the url part
      maskRange(textTo, urlTo + 1);
      maskRange(a, textFrom);
    }
    for (const { re, cls, open, close } of INLINE) {
      for (const m of masked.matchAll(re)) {
        const a = m.index!;
        const b = a + m[0].length;
        if (a < bodyStart && !h) continue;
        marker(a, a + open);
        out.push(mark(cls).range(l.from + a + open, l.from + b - close));
        marker(b - close, b);
        maskRange(a, a + open);
        maskRange(b - close, b);
      }
    }
  }
  return Decoration.set(out, true);
}

const livePlugin = (showMarks: boolean) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = build(view, showMarks); }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || (!showMarks && u.selectionSet)) this.decorations = build(u.view, showMarks);
      }
    },
    { decorations: (v) => v.decorations },
  );

export interface CodeMirrorHandle {
  /** wrap the selection in before/after, or insert at the cursor */
  insert(before: string, after?: string): void;
  /** toggle a line prefix ("## ", "> ", "- ") on every selected line */
  linePrefix(prefix: string): void;
  focus(): void;
  undo(): void;
  redo(): void;
  /** drop focus — closes the on-screen keyboard */
  blur(): void;
}

interface Props {
  value: string;
  onChange(value: string): void;
  /** live formatting layer (default on) */
  wysiwyg?: boolean;
  /** show markdown markers; false = "clean" (markers collapse off the cursor line) */
  showMarks?: boolean;
  onSave?(): void;
  placeholderText?: string;
}

export const CodeMirror = forwardRef<CodeMirrorHandle, Props>(function CodeMirror(
  { value, onChange, wysiwyg = true, showMarks = true, onSave, placeholderText },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const live = useRef(new Compartment());
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown(),
          EditorView.lineWrapping,
          editorTheme,
          placeholder(placeholderText ?? 'start writing…'),
          EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'sentences', 'aria-label': 'markdown editor' }),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { cb.current.onSave?.(); return true; } },
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          live.current.of(wysiwyg ? livePlugin(showMarks) : []),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    const mq = window.matchMedia('(max-width: 639px)');
    const sync = () => host.current?.classList.toggle('cm-md-mobile', mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => { mq.removeEventListener('change', sync); v.destroy(); view.current = null; };
    // the editor is created once; value/props flow in through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: live.current.reconfigure(wysiwyg ? livePlugin(showMarks) : []) });
  }, [wysiwyg, showMarks]);

  // external replacement (reload, restore draft, front matter apply)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur === value) return;
    const head = Math.min(v.state.selection.main.head, value.length);
    v.dispatch({ changes: { from: 0, to: cur.length, insert: value }, selection: { anchor: head } });
  }, [value]);

  useImperativeHandle(ref, () => ({
    insert(before, after = '') {
      const v = view.current;
      if (!v) return;
      v.dispatch(
        v.state.changeByRange((r) => {
          const sel = v.state.sliceDoc(r.from, r.to);
          const text = before + sel + after;
          // empty selection: cursor lands between the markers
          const anchor = r.from + before.length;
          return {
            changes: { from: r.from, to: r.to, insert: text },
            range: sel ? EditorSelection.range(anchor, anchor + sel.length) : EditorSelection.cursor(anchor),
          };
        }),
      );
      v.focus();
    },
    linePrefix(prefix) {
      const v = view.current;
      if (!v) return;
      const { state } = v;
      const changes: { from: number; to?: number; insert?: string }[] = [];
      const seen = new Set<number>();
      for (const r of state.selection.ranges) {
        for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
          if (seen.has(n)) continue;
          seen.add(n);
          const l = state.doc.line(n);
          // replace an existing heading/quote/list prefix of the same family
          const existing = /^(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/.exec(l.text)?.[0] ?? '';
          if (existing === prefix) changes.push({ from: l.from, to: l.from + existing.length });
          else changes.push({ from: l.from, to: l.from + existing.length, insert: prefix });
        }
      }
      v.dispatch({ changes });
      v.focus();
    },
    focus() { view.current?.focus(); },
    undo() { if (view.current) undo(view.current); },
    redo() { if (view.current) redo(view.current); },
    blur() { view.current?.contentDOM.blur(); },
  }), []);

  return <div ref={host} className="cm-host" />;
});
