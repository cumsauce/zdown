import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import markedFootnote from 'marked-footnote';
import type { ShortcodeTemplate, Site } from '../api';
import { dateText, parseFields, splitDoc } from './frontmatter';
import { resolveImage } from './site';
import { compileComponents, type Component, renderTera, type TeraHost } from './tera';

// Markdown + Zola shortcodes to safe HTML, for the preview and the blocks
// rendered inside the editor. Posts and templates can come from anyone with
// push access, so everything goes through DOMPurify; scripts are dropped and
// embeds are sandboxed. The server CSP is the second wall.

export interface RenderCtx {
  repoId: number;
  path: string | null;
  site: Site | null;
  /** front matter of the post being rendered, exposed to templates as `page` */
  fields?: Record<string, unknown>;
}

export interface RenderOpts {
  /** 'live' for the preview; 'facade' while editing, so typing doesn't load third-party frames */
  embeds?: 'live' | 'facade';
  /** a card's body is text already through the template pass */
  literalBody?: boolean;
}

// ---------- finding shortcodes ----------

export interface ShortcodeCall {
  from: number;
  to: number;
  name: string;
  args: Record<string, unknown>;
  /** block form only: the text between the tags */
  body: string | null;
  /** Zola's escaped form, which renders as the literal tag */
  escaped?: string;
  /** Zola >= 0.23: `component`/`expr` render through Tera, `tag` and `comment` are shown dimmed, `raw` holds a literal block */
  kind?: 'component' | 'expr' | 'tag' | 'comment' | 'raw';
}

function parseArgs(src: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {};
  let i = 0;
  const ws = () => { while (/\s/.test(src[i] ?? '')) i++; };
  const value = (): unknown => {
    ws();
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let v = '';
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] === '\\' && c === '"' && j + 1 < src.length) { j++; v += src[j] === 'n' ? '\n' : src[j]; }
        else v += src[j];
      }
      if (j >= src.length) throw new Error('unterminated');
      i = j + 1;
      return v;
    }
    if (c === '[') {
      i++;
      const list: unknown[] = [];
      for (;;) {
        ws();
        if (src[i] === ']') { i++; return list; }
        list.push(value());
        ws();
        if (src[i] === ',') i++;
        else if (src[i] !== ']') throw new Error('bad array');
      }
    }
    const m = /^(true|false|-?\d+(?:\.\d+)?)/.exec(src.slice(i));
    if (!m) throw new Error('bad value');
    i += m[0].length;
    return m[0] === 'true' ? true : m[0] === 'false' ? false : Number(m[0]);
  };
  try {
    for (;;) {
      ws();
      if (i >= src.length) return args;
      const k = /^[A-Za-z_]\w*/.exec(src.slice(i));
      if (!k) return null;
      i += k[0].length;
      ws();
      if (src[i] !== '=') return null;
      i++;
      args[k[0]] = value();
      ws();
      if (src[i] === ',') i++;
    }
  } catch { return null; }
}

// End of the call's closing paren, skipping strings; -1 when unbalanced.
function closeParen(s: string, open: number): number {
  let quote: string | null = null;
  for (let i = open + 1; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\' && quote === '"') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === ')') return i;
    else if (c === '\n' && s[i + 1] === '\n') return -1;
  }
  return -1;
}

const OPEN = /\{\{\s*([A-Za-z_]\w*)\s*\(|\{%\s*([A-Za-z_]\w*)\s*\(|\{\{\/\*|\{%\/\*/g;

// End of a `{{ … }}` / `{% … %}` tag, skipping strings and nested braces.
function tagEnd(s: string, from: number, close: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && depth > 0) depth--;
    else if (depth === 0 && s.startsWith(close, i)) return i + close.length;
  }
  return -1;
}

/** Zola >= 0.23 syntax: components, and content that is itself a Tera template. */
export function findTemplating(text: string, skip: [number, number][] = []): ShortcodeCall[] {
  const out: ShortcodeCall[] = [];
  const inSkip = (p: number) => skip.some(([a, b]) => p >= a && p < b);
  const push = (from: number, to: number, kind: NonNullable<ShortcodeCall['kind']>, name = '') =>
    out.push({ from, to, name, args: {}, body: null, kind });
  const open = /\{\{|\{%|\{#/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    const from = m.index;
    if (inSkip(from)) continue;
    if (m[0] === '{#') {
      const end = text.indexOf('#}', from);
      if (end < 0) continue;
      push(from, end + 2, 'comment');
      open.lastIndex = end + 2;
      continue;
    }
    const end = tagEnd(text, from + 2, m[0] === '{{' ? '}}' : '%}');
    if (end < 0) continue;
    const inner = text.slice(from + 2, end - 2).replace(/^-|-$/g, '').trim();
    open.lastIndex = end;
    if (m[0] === '{{') {
      const c = /^<([\w.]+)/.exec(inner);
      push(from, end, c ? 'component' : 'expr', c?.[1] ?? '');
      continue;
    }
    if (inner.startsWith('</')) continue;
    if (inner.startsWith('<')) {
      const name = /^<([\w.]+)/.exec(inner)?.[1] ?? '';
      if (inner.endsWith('/>')) { push(from, end, 'component', name); continue; }
      // find the matching close, counting nested uses of the same component
      const esc = name.replace(/\./g, '\\.');
      const pair = new RegExp(`\\{%-?\\s*<(/?)${esc}\\b[^%]*?%\\}`, 'g');
      pair.lastIndex = end;
      let depth = 1;
      let t: RegExpExecArray | null;
      let close = -1;
      while ((t = pair.exec(text))) {
        if (t[1]) depth--;
        else if (!/\/>\s*-?%\}$/.test(t[0])) depth++;
        if (depth === 0) { close = t.index + t[0].length; break; }
      }
      if (close < 0) { push(from, end, 'tag'); continue; }
      push(from, close, 'component', name);
      open.lastIndex = close;
      continue;
    }
    if (/^raw\b/.test(inner)) {
      const r = /\{%-?\s*endraw\s*-?%\}/g;
      r.lastIndex = end;
      const e = r.exec(text);
      if (!e) { push(from, end, 'tag'); continue; }
      push(from, e.index + e[0].length, 'raw');
      open.lastIndex = e.index + e[0].length;
      continue;
    }
    push(from, end, 'tag');
  }
  return out;
}

/** Whether `src` follows the Zola >= 0.23 model on this site. */
export function isTemplated(src: string, site: Site | null): boolean {
  if (site?.components?.length) return true;
  return /\{\{-?\s*<[\w.]+|\{%-?\s*<[\w.]+/.test(src);
}

/** Every shortcode call in `text`, skipping the given [from, to) code ranges. */
export function findShortcodes(text: string, skip: [number, number][] = []): ShortcodeCall[] {
  const out: ShortcodeCall[] = [];
  const inSkip = (p: number) => skip.some(([a, b]) => p >= a && p < b);
  OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN.exec(text))) {
    const from = m.index;
    if (m[0] === '{{/*' || m[0] === '{%/*') {
      const closer = m[0] === '{{/*' ? '*/}}' : '*/%}';
      const end = text.indexOf(closer, from);
      if (end < 0) continue;
      const inner = text.slice(from + 4, end).trim();
      out.push({ from, to: end + 4, name: '', args: {}, body: null, escaped: m[0] === '{{/*' ? `{{ ${inner} }}` : `{% ${inner} %}` });
      OPEN.lastIndex = end + 4;
      continue;
    }
    if (inSkip(from)) continue;
    const block = m[0].startsWith('{%');
    const name = m[1] ?? m[2];
    const open = from + m[0].length - 1;
    const close = closeParen(text, open);
    if (close < 0) continue;
    const tail = block ? /^\s*-?%\}/.exec(text.slice(close + 1)) : /^\s*-?\}\}/.exec(text.slice(close + 1));
    if (!tail) continue;
    const args = parseArgs(text.slice(open + 1, close));
    if (!args) continue;
    let to = close + 1 + tail[0].length;
    let body: string | null = null;
    if (block) {
      // bodies can nest other block shortcodes; find our own {% end %}
      const tag = /\{%\s*(end)\s*%\}|\{%\s*[A-Za-z_]\w*\s*\([\s\S]*?\)\s*%\}/g;
      tag.lastIndex = to;
      let depth = 1;
      let t: RegExpExecArray | null;
      let endAt = -1;
      let endTo = -1;
      while ((t = tag.exec(text))) {
        depth += t[1] ? -1 : 1;
        if (depth === 0) { endAt = t.index; endTo = t.index + t[0].length; break; }
      }
      if (endAt < 0) continue;
      body = text.slice(to, endAt).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
      to = endTo;
    }
    out.push({ from, to, name, args, body });
    OPEN.lastIndex = to;
  }
  return out;
}

/** Fenced and inline code ranges, found without a full parse. */
export function codeRanges(md: string): [number, number][] {
  const out: [number, number][] = [];
  const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*\n(?:[\s\S]*?\n)??[ ]{0,3}\2[`~]*[ \t]*(?:\n|$)/gm;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(md))) out.push([m.index, m.index + m[0].length]);
  const inline = /(`+)(?!`)[^\n]*?[^`]\1(?!`)/g;
  while ((m = inline.exec(md))) {
    if (!out.some(([a, b]) => m!.index >= a && m!.index < b)) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

// ---------- rendering one shortcode ----------

// Zola used to ship these; many sites still call them with no template of
// their own.
const BUILTIN: Record<string, ShortcodeTemplate> = {
  youtube: { name: 'youtube', path: '', kind: 'html', source: `<iframe src="https://www.youtube-nocookie.com/embed/{{ id }}{% if playlist %}?list={{ playlist }}{% endif %}" title="YouTube video" allowfullscreen></iframe>` },
  vimeo: { name: 'vimeo', path: '', kind: 'html', source: `<iframe src="https://player.vimeo.com/video/{{ id }}" title="Vimeo video" allowfullscreen></iframe>` },
  streamable: { name: 'streamable', path: '', kind: 'html', source: `<iframe src="https://streamable.com/e/{{ id }}" title="Streamable video" allowfullscreen></iframe>` },
};

function templateFor(name: string, site: Site | null): ShortcodeTemplate | null {
  return site?.shortcodes.find((s) => s.name === name) ?? BUILTIN[name] ?? null;
}

function hostFor(ctx: RenderCtx, opts: RenderOpts): TeraHost {
  const base = (ctx.site?.base_url ?? '').replace(/\/+$/, '');
  const noHost = () => null;
  return {
    filters: {
      markdown: (v, a) => {
        const html = markdownToHtml(String(v ?? ''), ctx, opts);
        return a.inline ? html.replace(/^<p>([\s\S]*)<\/p>\s*$/, '$1') : html;
      },
    },
    functions: {
      get_url: (a) => {
        const p = String(a.path ?? '');
        if (/^(https?:)?\/\//.test(p)) return p;
        if (p.startsWith('@/')) return p; // rewritten to an in-app link after sanitizing
        return `${base}/${p.replace(/^\/+/, '')}`;
      },
      // No image pipeline here: the original stands in for its resized copy.
      resize_image: (a) => ({ url: imgRef(String(a.path ?? '')), static_path: String(a.path ?? ''), width: a.width, height: a.height, orig_width: a.width, orig_height: a.height }),
      get_image_metadata: (a) => ({ width: undefined, height: undefined, format: String(a.path ?? '').split('.').pop(), mime: '' }),
      get_file_hash: () => '',
      get_hash: () => '',
      get_taxonomy_term: () => ({ name: '', slug: '', permalink: `${base}/`, pages: [] }),
      text_direction: () => 'ltr',
      get_env: (a) => a.default,
      get_page: (a) => ({ title: String(a.path ?? ''), permalink: `${base}/`, path: `/${a.path ?? ''}`, extra: {}, taxonomies: {} }),
      get_section: (a) => ({ title: String(a.path ?? ''), permalink: `${base}/`, path: `/${a.path ?? ''}`, pages: [], subsections: [], extra: {} }),
      get_taxonomy_url: (a) => `${base}/${a.kind}/${a.name}/`,
      get_taxonomy: () => ({ items: [], kind: {} }),
      load_data: noHost,
      now: () => new Date().toISOString(),
      range: (a) => {
        const out: number[] = [];
        const step = Number(a.step_by ?? 1) || 1;
        for (let i = Number(a.start ?? 0); i < Number(a.end ?? 0); i += step) out.push(i);
        return out;
      },
      trans: (a) => String(a.key ?? ''),
      throw: (a) => { throw new Error(String(a.message ?? 'template error')); },
    },
  };
}

// Zola resolves resize_image paths from the content root, static/, or next to
// the page; marking them lets the image pass find the right file.
const imgRef = (p: string) => (/^(https?:)?\/\/|^@\//.test(p) ? p : `/${p.replace(/^\/+/, '')}`);

function templateContext(call: ShortcodeCall, ctx: RenderCtx, nth: number) {
  const f = ctx.fields ?? {};
  const base = (ctx.site?.base_url ?? '').replace(/\/+$/, '');
  const dir = ctx.path && ctx.path.includes('/') ? ctx.path.slice(0, ctx.path.lastIndexOf('/') + 1) : '';
  return {
    ...call.args,
    body: call.body ?? undefined,
    nth,
    lang: 'en',
    config: {
      base_url: base,
      title: ctx.site?.title ?? undefined,
      description: ctx.site?.description ?? undefined,
      default_language: 'en',
      extra: ctx.site?.extra ?? {},
    },
    page: {
      ...f,
      title: f.title,
      description: f.description,
      date: f.date ? dateText(f.date) : undefined,
      draft: f.draft ?? false,
      extra: f.extra ?? {},
      taxonomies: f.taxonomies ?? {},
      permalink: `${base}/`,
      path: '/',
      colocated_path: dir.replace(/^(?:.*\/)?content\//, ''),
      assets: [],
      lang: 'en',
    },
  };
}

// compiled once per site snapshot
const compiled = new WeakMap<Site, Map<string, Component>>();
function componentsOf(site: Site | null): Map<string, Component> {
  if (!site) return new Map();
  let c = compiled.get(site);
  if (!c) { c = compileComponents((site.components ?? []).map((x) => x.source)); compiled.set(site, c); }
  return c;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A call we can't render still reads as what it is, and keeps its body. */
function fallbackCard(call: ShortcodeCall, ctx: RenderCtx, opts: RenderOpts, error?: string): string {
  const args = Object.entries(call.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
  const inner = opts.literalBody ? (md.parse(call.body ?? '', { async: false }) as string) : call.body ? markdownToHtml(call.body, ctx, opts) : '';
  const body = call.body ? `<div class="sc-card-body">${inner}</div>` : '';
  const note = error ? `<div class="sc-error">${escAttr(error)}</div>` : '';
  return `<div class="sc-card"><div class="sc-card-head"><b>${escAttr(call.name)}</b><span class="sc-card-args">${escAttr(args)}</span></div>${note}${body}</div>`;
}

export function renderShortcode(call: ShortcodeCall, ctx: RenderCtx, opts: RenderOpts, nth = 1): { out: string; markdown: boolean } {
  if (call.escaped) return { out: escAttr(call.escaped), markdown: false };
  const t = templateFor(call.name, ctx.site);
  if (!t) return { out: fallbackCard(call, ctx, opts), markdown: false };
  try {
    const out = renderTera(t.source, templateContext(call, ctx, nth), hostFor(ctx, opts), t.kind === 'html');
    return { out, markdown: t.kind === 'md' };
  } catch (e) {
    return { out: fallbackCard(call, ctx, opts, `Couldn't render ${t.path || call.name}: ${(e as Error).message}`), markdown: false };
  }
}

// ---------- markdown ----------

const SENTINEL = (i: number) => `${i}`;
const SENTINEL_BLOCK = /<p>\s*(\d+)\s*<\/p>/g;
const SENTINEL_INLINE = /(\d+)/g;

const md = new Marked({
  gfm: true,
  breaks: false,
  // Zola's parser doesn't link bare URLs; a preview shouldn't promise it will
  tokenizer: { url: () => undefined },
  renderer: {
    // Zola fences can carry options: ```rust,linenos,hl_lines=2
    code({ text, lang }) {
      const name = (lang ?? '').split(/[\s,]/)[0];
      const cls = name ? ` class="language-${escAttr(name)}"` : '';
      return `<pre><code${cls}>${escAttr(text)}</code></pre>\n`;
    },
  },
});
md.use(markedFootnote({ description: 'Footnotes', refMarkers: true }));

// Zola >= 0.23: the content is a Tera template, run before markdown. No
// autoescaping; what the template prints goes through the markdown parser, so
// a component's unblanked HTML passes through and its loose text doesn't.
function templateHost(ctx: RenderCtx, opts: RenderOpts): TeraHost {
  const base = hostFor(ctx, opts);
  return {
    ...base,
    strict: true,
    components: componentsOf(ctx.site),
    filters: { markdown: (v, a) => {
      const html = md.parse(String(v ?? ''), { async: false }) as string;
      return a.inline ? html.replace(/^<p>([\s\S]*)<\/p>\s*$/, '$1') : html;
    } },
    soft: (message, source) => {
      const call: ShortcodeCall = { from: 0, to: 0, name: source.component ?? 'template', args: source.args ?? {}, body: source.body ?? null };
      return `\n\n${fallbackCard(call, ctx, { ...opts, literalBody: true }, message)}\n\n`;
    },
  };
}

function templatedToHtml(src: string, ctx: RenderCtx, opts: RenderOpts): string {
  let text: string;
  try {
    text = renderTera(src, templateContext({ from: 0, to: 0, name: '', args: {}, body: null }, ctx, 1), templateHost(ctx, opts), false);
  } catch (e) {
    // syntax Tera itself would refuse: say so, and still show the text
    const card = fallbackCard({ from: 0, to: 0, name: 'template', args: {}, body: null }, ctx, opts, (e as Error).message);
    return `${card}${md.parse(src, { async: false }) as string}`;
  }
  return md.parse(text, { async: false }) as string;
}

function markdownToHtml(src: string, ctx: RenderCtx, opts: RenderOpts): string {
  if (isTemplated(src, ctx.site)) return templatedToHtml(src, ctx, opts);
  const stash: string[] = [];
  let text = '';
  let at = 0;
  const seen = new Map<string, number>();
  for (const call of findShortcodes(src, codeRanges(src))) {
    text += src.slice(at, call.from);
    at = call.to;
    const nth = (seen.get(call.name) ?? 0) + 1;
    seen.set(call.name, nth);
    const r = renderShortcode(call, ctx, opts, nth);
    if (r.markdown) text += r.out;
    else { stash.push(r.out.trim()); text += SENTINEL(stash.length - 1); }
  }
  text += src.slice(at);
  const html = md.parse(text, { async: false }) as string;
  return html
    .replace(SENTINEL_BLOCK, (_, i) => stash[Number(i)])
    .replace(SENTINEL_INLINE, (_, i) => stash[Number(i)]);
}

// ---------- sanitize + rewrite ----------

const ALLOWED_FRAME = (src: string) => {
  try {
    const u = new URL(src, location.href);
    // same-origin plus allow-scripts would defeat the sandbox entirely
    return u.protocol === 'https:' && u.host !== location.host;
  } catch { return false; }
};

/** Drop style declarations that could paint over the app's own interface. */
const safeStyle = (style: string) =>
  style.split(';').filter((d) => !/^\s*(position|z-index|inset|top|left|right|bottom|transform)\s*:|url\s*\(|expression\s*\(/i.test(d)).join(';');

function finish(html: string, ctx: RenderCtx, opts: RenderOpts): string {
  const frag = DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'loading', 'target'],
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'base', 'meta', 'link'],
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|data:image\/|#|\/|\.|@\/|[^:]*$)/i,
  }) as DocumentFragment;

  // GFM checkboxes are the one input that belongs in a post
  for (const el of frag.querySelectorAll('input')) {
    if (el.getAttribute('type') === 'checkbox') el.setAttribute('disabled', '');
    else el.remove();
  }

  for (const el of frag.querySelectorAll<HTMLElement>('[style]')) el.setAttribute('style', safeStyle(el.getAttribute('style') ?? ''));

  for (const img of frag.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    const r = resolveImage(src, ctx.path, ctx.site, ctx.repoId);
    if (r.url) {
      img.setAttribute('src', r.url);
      img.setAttribute('loading', 'lazy');
    } else {
      const miss = document.createElement('span');
      miss.className = 'img-missing';
      miss.innerHTML = `Image not found: <code>${escAttr(src)}</code><small>Looked in ${escAttr(r.tried.slice(0, 3).join(', '))}</small>`;
      img.replaceWith(miss);
    }
  }

  for (const a of frag.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('@/')) {
      a.setAttribute('data-internal', `${ctx.site?.root ?? ''}content/${href.slice(2).split('#')[0]}`);
    } else if (/^https?:/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }

  for (const f of frag.querySelectorAll('iframe')) {
    const src = f.getAttribute('src') ?? '';
    if (!ALLOWED_FRAME(src)) { f.remove(); continue; }
    if (opts.embeds === 'facade') {
      const box = document.createElement('div');
      box.className = 'embed-facade';
      let host = src;
      try { host = new URL(src).hostname.replace(/^www\./, ''); } catch { /* keep the raw src */ }
      box.textContent = `Embed from ${host}`;
      f.replaceWith(box);
      continue;
    }
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    f.setAttribute('loading', 'lazy');
  }

  for (const t of frag.querySelectorAll('table')) {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    t.replaceWith(wrap);
    wrap.append(t);
  }

  const host = document.createElement('div');
  host.append(frag);
  return host.innerHTML;
}

/** A whole post body (or any markdown fragment) to sanitized HTML. */
export function renderMarkdown(src: string, ctx: RenderCtx, opts: RenderOpts = {}): string {
  return finish(markdownToHtml(src, ctx, opts), ctx, opts);
}

/** A component call or expression (Zola >= 0.23) to sanitized HTML; `prelude` carries the page's {% set %}s. */
export function renderTemplated(source: string, prelude: string, ctx: RenderCtx, opts: RenderOpts): { html: string; error: string | null } {
  let error: string | null = null;
  const host = templateHost(ctx, opts);
  const soft = host.soft!;
  host.soft = (m, s) => { error = m; return soft(m, s); };
  try {
    const text = renderTera(prelude + source, templateContext({ from: 0, to: 0, name: '', args: {}, body: null }, ctx, 1), host, false);
    return { html: finish(md.parse(text, { async: false }) as string, ctx, opts), error };
  } catch (e) {
    return { html: '', error: (e as Error).message };
  }
}

/** One shortcode call to sanitized HTML, for a block inside the editor. */
export function renderCall(call: ShortcodeCall, ctx: RenderCtx, opts: RenderOpts, nth = 1): string {
  const r = renderShortcode(call, ctx, opts, nth);
  return finish(r.markdown ? markdownToHtml(r.out, ctx, opts) : r.out.trim(), ctx, opts);
}

export function fieldsOf(content: string): Record<string, unknown> {
  return parseFields(splitDoc(content)) ?? {};
}

// ---------- describing templates, for the insert menu ----------

/** Argument names a template reads, so the insert menu can offer a ready snippet. */
export function templateArgs(source: string): string[] {
  const ignore = new Set(['body', 'nth', 'lang', 'config', 'page', 'section', 'loop', 'true', 'false', 'and', 'or', 'not', 'in', 'is', 'if', 'else', 'elif', 'endif', 'for', 'endfor', 'set', 'safe', 'defined', 'undefined', 'default', 'value', 'get_url', 'resize_image', 'markdown']);
  const locals = new Set<string>();
  for (const m of source.matchAll(/\{%-?\s*(?:set(?:_global)?\s+(\w+)|for\s+(\w+)(?:\s*,\s*(\w+))?\s+in)/g)) {
    for (const g of m.slice(1)) if (g) locals.add(g);
  }
  const out: string[] = [];
  const noStrings = source.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');
  for (const tag of noStrings.matchAll(/\{\{-?([\s\S]*?)-?\}\}|\{%-?\s*(?:if|elif|for\s+\w+(?:\s*,\s*\w+)?\s+in|set(?:_global)?\s+\w+\s*=)\s*([\s\S]*?)-?%\}/g)) {
    const text = (tag[1] ?? tag[2] ?? '').replace(/\|\s*\w+(\([^)]*\))?/g, ' ').replace(/\w+\s*=/g, ' ');
    for (const id of text.matchAll(/(?<![.\w])[A-Za-z_]\w*/g)) {
      const name = id[0];
      if (!ignore.has(name) && !locals.has(name) && !out.includes(name) && !new RegExp(`\\b${name}\\s*\\(`).test(text)) out.push(name);
    }
  }
  return out;
}
