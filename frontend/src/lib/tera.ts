// A small interpreter for the Tera templates Zola sites are written in. (The JS
// Jinja ports compile to `new Function`, which the CSP forbids.) It covers both
// generations: Tera v1 as used by shortcode templates (Zola < 0.23) and Tera v2
// with components, as used by Zola >= 0.23, where page content is itself a
// template. `strict` selects v2's rule that printing an undefined variable is
// an error; v1 previews stay lenient, since a shortcode shouldn't fail on what
// a full site build would have provided.

export class TeraError extends Error {}

/** A value that skips autoescaping (`| safe`). */
class Safe { constructor(public s: string) {} toString() { return this.s; } }

type Env = Record<string, unknown>;
export interface TeraHost {
  functions?: Record<string, (args: Env) => unknown>;
  filters?: Record<string, (value: unknown, args: Env) => unknown>;
  /** Tera v2 components, by name: see compileComponents */
  components?: Map<string, Component>;
  /** v2 undefined-variable errors */
  strict?: boolean;
  /** A failure inside one tag renders as this instead of failing the whole template. */
  soft?: (message: string, source: { component?: string; args?: Env; body?: string }) => string;
}

export interface ComponentParam { name: string; default?: Node; rest?: boolean }
export interface Component { name: string; params: ComponentParam[]; body: Stmt[] }

// ---------- lexing the template into text and tags ----------

type Seg =
  | { t: 'text'; v: string }
  | { t: 'expr'; v: string }
  | { t: 'tag'; v: string };

function segments(src: string): Seg[] {
  const out: Seg[] = [];
  let i = 0;
  let trimNext = false;
  const pushText = (s: string, trimEnd: boolean) => {
    let v = trimNext ? s.replace(/^\s+/, '') : s;
    if (trimEnd) v = v.replace(/\s+$/, '');
    trimNext = false;
    if (v) out.push({ t: 'text', v });
  };
  while (i < src.length) {
    const a = src.indexOf('{', i);
    if (a < 0) { pushText(src.slice(i), false); break; }
    const kind = src[a + 1];
    if (kind !== '{' && kind !== '%' && kind !== '#') { pushText(src.slice(i, a + 1), false); i = a + 1; continue; }
    const close = kind === '{' ? '}}' : kind === '%' ? '%}' : '#}';
    // find the closer, skipping string literals
    let j = a + 2;
    let quote: string | null = null;
    let depth = 0; // map literals and {expr} attributes can contain "}}"
    for (; j < src.length; j++) {
      const c = src[j];
      if (kind !== '#') {
        if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '{') { depth++; continue; }
        if (c === '}' && depth > 0) { depth--; continue; }
      }
      if (depth === 0 && src.startsWith(close, j)) break;
    }
    if (j >= src.length) throw new TeraError(`unclosed ${kind === '{' ? '{{' : '{' + kind}`);
    let inner = src.slice(a + 2, j);
    const trimL = inner.startsWith('-');
    const trimR = inner.endsWith('-');
    if (trimL) inner = inner.slice(1);
    if (trimR) inner = inner.slice(0, -1);
    pushText(src.slice(i, a), trimL);
    if (kind === '{') out.push({ t: 'expr', v: inner.trim() });
    else if (kind === '%') {
      const tag = inner.trim();
      out.push({ t: 'tag', v: tag });
      if (tag === 'raw') {
        const m = /\{%-?\s*endraw\s*-?%\}/.exec(src.slice(j + 2));
        if (!m) throw new TeraError('unclosed raw');
        out.push({ t: 'text', v: src.slice(j + 2, j + 2 + m.index) });
        out.push({ t: 'tag', v: 'endraw' });
        i = j + 2 + m.index + m[0].length;
        trimNext = false;
        continue;
      }
    }
    trimNext = trimR;
    i = j + 2;
  }
  return out;
}

// ---------- expressions ----------

type Tok = { k: 'num' | 'str' | 'id' | 'op'; v: string };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(s.slice(i))!;
      out.push({ k: 'num', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let v = '';
      for (; j < s.length && s[j] !== c; j++) {
        if (s[j] === '\\' && c === '"') { j++; v += s[j] === 'n' ? '\n' : s[j] === 't' ? '\t' : s[j]; }
        else v += s[j];
      }
      if (j >= s.length) throw new TeraError('unterminated string');
      out.push({ k: 'str', v });
      i = j + 1;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    const two = s.slice(i, i + 2);
    if (s.startsWith('...', i)) { out.push({ k: 'op', v: '...' }); i += 3; continue; }
    if (['==', '!=', '<=', '>=', '?.', '?['].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/%~|()[],.=<>:{}'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    throw new TeraError(`unexpected "${c}"`);
  }
  return out;
}

export type Node =
  | { n: 'lit'; v: unknown }
  | { n: 'var'; name: string }
  | { n: 'get'; o: Node; k: Node; optional?: boolean }
  | { n: 'slice'; o: Node; start: Node | null; stop: Node | null; step: Node | null }
  | { n: 'arr'; items: (Node | { spread: Node })[] }
  | { n: 'map'; items: ([Node, Node] | { spread: Node })[] }
  | { n: 'comp'; e: Node; v: string; iter: Node; cond: Node | null }
  | { n: 'if'; a: Node; cond: Node; b: Node }
  | { n: 'un'; op: string; a: Node }
  | { n: 'bin'; op: string; a: Node; b: Node }
  | { n: 'filter'; a: Node; name: string; args: Record<string, Node> }
  | { n: 'test'; a: Node; name: string; not: boolean; args: Node[] }
  | { n: 'call'; name: string; args: Record<string, Node> };

class Parser {
  i = 0;
  constructor(public t: Tok[]) {}
  peek(v?: string) { const x = this.t[this.i]; return x && (v === undefined || (x.k !== 'str' && x.v === v)) ? x : undefined; }
  eat(v: string) { if (this.peek(v)) { this.i++; return true; } return false; }
  need(v: string) { if (!this.eat(v)) throw new TeraError(`expected "${v}"`); }
  done() { return this.i >= this.t.length; }

  expr(): Node {
    const a = this.or();
    if (!this.eat('if')) return a;
    const cond = this.or();
    this.need('else');
    return { n: 'if', a, cond, b: this.expr() };
  }
  or(): Node { let a = this.and(); while (this.eat('or')) a = { n: 'bin', op: 'or', a, b: this.and() }; return a; }
  and(): Node { let a = this.not(); while (this.eat('and')) a = { n: 'bin', op: 'and', a, b: this.not() }; return a; }
  not(): Node { return this.eat('not') ? { n: 'un', op: 'not', a: this.not() } : this.cmp(); }
  cmp(): Node {
    let a = this.concat();
    for (;;) {
      const x = this.t[this.i];
      if (x?.k === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(x.v)) { this.i++; a = { n: 'bin', op: x.v, a, b: this.concat() }; continue; }
      if (this.eat('in')) { a = { n: 'bin', op: 'in', a, b: this.concat() }; continue; }
      if (this.peek('not') && this.t[this.i + 1]?.v === 'in') { this.i += 2; a = { n: 'un', op: 'not', a: { n: 'bin', op: 'in', a, b: this.concat() } }; continue; }
      if (this.eat('is')) {
        const not = this.eat('not');
        const name = this.t[this.i++]?.v;
        if (!name) throw new TeraError('expected a test name');
        const args: Node[] = [];
        if (this.eat('(')) {
          while (!this.eat(')')) {
            if (this.t[this.i]?.k === 'id' && this.t[this.i + 1]?.v === '=') this.i += 2; // v2: kwargs
            args.push(this.expr());
            this.eat(',');
          }
        }
        a = { n: 'test', a, name, not, args };
        continue;
      }
      return a;
    }
  }
  concat(): Node { let a = this.add(); while (this.eat('~')) a = { n: 'bin', op: '~', a, b: this.add() }; return a; }
  add(): Node {
    let a = this.mul();
    for (;;) {
      if (this.eat('+')) a = { n: 'bin', op: '+', a, b: this.mul() };
      else if (this.eat('-')) a = { n: 'bin', op: '-', a, b: this.mul() };
      else return a;
    }
  }
  mul(): Node {
    let a = this.filtered();
    for (;;) {
      if (this.eat('*')) a = { n: 'bin', op: '*', a, b: this.filtered() };
      else if (this.eat('/')) a = { n: 'bin', op: '/', a, b: this.filtered() };
      else if (this.eat('%')) a = { n: 'bin', op: '%', a, b: this.filtered() };
      else return a;
    }
  }
  kwargs(): Record<string, Node> {
    const args: Record<string, Node> = {};
    if (!this.eat('(')) return args;
    while (!this.eat(')')) {
      const key = this.t[this.i++]?.v;
      if (!key) throw new TeraError('expected an argument name');
      this.need('=');
      args[key] = this.expr();
      this.eat(',');
    }
    return args;
  }
  filtered(): Node {
    let a = this.unary();
    while (this.eat('|')) {
      const name = this.t[this.i++]?.v;
      if (!name) throw new TeraError('expected a filter name');
      a = { n: 'filter', a, name, args: this.kwargs() };
    }
    return a;
  }
  unary(): Node { return this.eat('-') ? { n: 'un', op: '-', a: this.unary() } : this.atom(); }
  atom(): Node {
    const x = this.t[this.i++];
    if (!x) throw new TeraError('unexpected end of expression');
    let node: Node;
    if (x.k === 'num') node = { n: 'lit', v: Number(x.v) };
    else if (x.k === 'str') node = { n: 'lit', v: x.v };
    else if (x.k === 'op' && x.v === '(') { node = this.expr(); this.need(')'); }
    else if (x.k === 'op' && x.v === '[') node = this.arrayRest();
    else if (x.k === 'op' && x.v === '{') node = this.mapRest();
    else if (x.k === 'id') {
      if (x.v === 'true' || x.v === 'True') return { n: 'lit', v: true };
      if (x.v === 'false' || x.v === 'False') return { n: 'lit', v: false };
      if (x.v === 'none' || x.v === 'null') return { n: 'lit', v: null };
      if (this.peek('(')) node = { n: 'call', name: x.v, args: this.kwargs() };
      else node = { n: 'var', name: x.v };
    } else throw new TeraError(`unexpected "${x.v}"`);
    return this.postfix(node);
  }
  postfix(start: Node): Node {
    let node = start;
    for (;;) {
      if (this.eat('.') || this.peek('?.')) {
        const optional = this.eat('?.');
        const k = this.t[this.i++];
        if (!k) throw new TeraError('expected a key after "."');
        node = { n: 'get', o: node, k: { n: 'lit', v: k.k === 'num' ? Number(k.v) : k.v }, optional };
      } else if (this.peek('[') || this.peek('?[')) {
        const optional = !this.eat('[');
        if (optional) this.i++;
        node = this.subscript(node, optional);
      } else return node;
    }
  }
  subscript(o: Node, optional: boolean): Node {
    const part = () => (this.peek(':') || this.peek(']') ? null : this.expr());
    const first = part();
    if (this.eat(']')) return { n: 'get', o, k: first!, optional };
    this.need(':');
    const stop = part();
    const step = this.eat(':') ? part() : null;
    this.need(']');
    return { n: 'slice', o, start: first, stop, step };
  }
  arrayRest(): Node {
    const items: (Node | { spread: Node })[] = [];
    while (!this.eat(']')) {
      if (this.eat('...')) items.push({ spread: this.expr() });
      else {
        const e = this.expr();
        if (this.eat('for')) {
          const v = this.t[this.i++]?.v ?? '';
          this.need('in');
          const iter = this.or();
          const cond = this.eat('if') ? this.or() : null;
          this.need(']');
          return { n: 'comp', e, v, iter, cond };
        }
        items.push(e);
      }
      this.eat(',');
    }
    return { n: 'arr', items };
  }
  mapRest(): Node {
    const items: ([Node, Node] | { spread: Node })[] = [];
    while (!this.eat('}')) {
      if (this.eat('...')) items.push({ spread: this.expr() });
      else {
        const k = this.t[this.i++];
        if (!k) throw new TeraError('unterminated map');
        this.need(':');
        items.push([{ n: 'lit', v: k.v }, this.expr()]);
      }
      this.eat(',');
    }
    return { n: 'map', items };
  }
  /** `<ui.card title="x" n={1} shorthand {...rest}` up to `/>` or `>` */
  componentTag(): { name: string; attrs: Attr[]; selfClosing: boolean } {
    this.need('<');
    let name = this.t[this.i++]?.v ?? '';
    while (this.eat('.')) name += `.${this.t[this.i++]?.v ?? ''}`;
    const attrs: Attr[] = [];
    for (;;) {
      if (this.eat('/')) { this.need('>'); return { name, attrs, selfClosing: true }; }
      if (this.eat('>')) return { name, attrs, selfClosing: false };
      if (this.eat('{')) {
        this.need('...');
        attrs.push({ spread: this.expr() });
        this.need('}');
        continue;
      }
      let key = this.t[this.i++]?.v;
      if (!key) throw new TeraError(`unclosed <${name}>`);
      while (this.peek('-')) { this.i++; key += `-${this.t[this.i++]?.v ?? ''}`; }
      if (!this.eat('=')) { attrs.push({ key, value: { n: 'var', name: key } }); continue; }
      if (this.eat('{')) {
        attrs.push({ key, value: this.expr() });
        this.need('}');
      } else {
        const v = this.t[this.i++];
        if (v?.k !== 'str') throw new TeraError(`attribute ${key}: non-string values go in {…}`);
        attrs.push({ key, value: { n: 'lit', v: v.v } });
      }
    }
  }
  /** `name: type = default, other, ...rest` */
  componentParams(): ComponentParam[] {
    const params: ComponentParam[] = [];
    this.need('(');
    while (!this.eat(')')) {
      if (this.eat('...')) {
        params.push({ name: this.t[this.i++]?.v ?? 'rest', rest: true });
      } else {
        const name = this.t[this.i++]?.v;
        if (!name) throw new TeraError('expected a parameter name');
        const p: ComponentParam = { name };
        if (this.eat(':')) {
          // a type: string, bool, array, map… possibly nullable
          this.i++;
          while (this.peek('[') || this.peek(']') || this.peek('|')) this.i++;
        }
        if (this.eat('=')) p.default = this.expr();
        params.push(p);
      }
      this.eat(',');
    }
    return params;
  }
}

type Attr = { key: string; value: Node } | { spread: Node };

const parseExpr = (s: string) => {
  const p = new Parser(tokenize(s));
  const e = p.expr();
  if (!p.done()) throw new TeraError(`unexpected "${p.t[p.i].v}"`);
  return e;
};

// ---------- statements ----------

export type Stmt =
  | { s: 'text'; v: string }
  | { s: 'call'; name: string; attrs: Attr[]; body: Stmt[] | null; src: string }
  | { s: 'setblock'; name: string; filters: { name: string; args: Record<string, Node> }[]; body: Stmt[] }
  | { s: 'out'; e: Node }
  | { s: 'if'; arms: { cond: Node | null; body: Stmt[] }[] }
  | { s: 'for'; k: string | null; v: string; iter: Node; body: Stmt[]; empty: Stmt[] }
  | { s: 'set'; name: string; e: Node }
  | { s: 'filter'; name: string; args: Record<string, Node>; body: Stmt[] }
  | { s: 'break' }
  | { s: 'continue' };

function parseBlocks(segs: Seg[], components?: Map<string, Component>): Stmt[] {
  let i = 0;
  const block = (...until: string[]): { body: Stmt[]; end: string } => {
    const body: Stmt[] = [];
    while (i < segs.length) {
      const seg = segs[i++];
      if (seg.t === 'text') { body.push({ s: 'text', v: seg.v }); continue; }
      if (seg.t === 'expr') {
        if (seg.v.startsWith('<')) {
          const t = new Parser(tokenize(seg.v)).componentTag();
          body.push({ s: 'call', name: t.name, attrs: t.attrs, body: null, src: seg.v });
        } else body.push({ s: 'out', e: parseExpr(seg.v) });
        continue;
      }
      const tag = seg.v;
      if (tag.startsWith('</')) {
        if (until.includes(tag.replace(/\s+/g, ''))) return { body, end: tag };
        throw new TeraError(`unexpected {% ${tag} %}`);
      }
      if (tag.startsWith('<')) {
        const t = new Parser(tokenize(tag)).componentTag();
        const inner = t.selfClosing ? null : block(`</${t.name}>`).body;
        body.push({ s: 'call', name: t.name, attrs: t.attrs, body: inner, src: tag });
        continue;
      }
      const word = /^\w+/.exec(tag)?.[0] ?? '';
      if (until.includes(word)) return { body, end: tag };
      const rest = tag.slice(word.length).trim();
      switch (word) {
        case 'if': {
          const arms: { cond: Node | null; body: Stmt[] }[] = [];
          let cond: Node | null = parseExpr(rest);
          for (;;) {
            const r = block('elif', 'else', 'endif');
            arms.push({ cond, body: r.body });
            const w = /^\w+/.exec(r.end)![0];
            if (w === 'endif') break;
            cond = w === 'elif' ? parseExpr(r.end.slice(4)) : null;
          }
          body.push({ s: 'if', arms });
          break;
        }
        case 'for': {
          const m = /^(\w+)(?:\s*,\s*(\w+))?\s+in\s+([\s\S]+)$/.exec(rest);
          if (!m) throw new TeraError(`bad for: ${tag}`);
          const r = block('else', 'endfor');
          const empty = r.end.startsWith('else') ? block('endfor').body : [];
          body.push({ s: 'for', k: m[2] ? m[1] : null, v: m[2] ?? m[1], iter: parseExpr(m[3]), body: r.body, empty });
          break;
        }
        case 'set':
        case 'set_global': {
          const m = /^(\w+)\s*=\s*([\s\S]+)$/.exec(rest);
          if (m) { body.push({ s: 'set', name: m[1], e: parseExpr(m[2]) }); break; }
          // v2: {% set hero | upper %}…{% endset %}
          const p = new Parser(tokenize(rest));
          const name = p.t[p.i++]?.v;
          if (!name) throw new TeraError(`bad set: ${tag}`);
          const filters: { name: string; args: Record<string, Node> }[] = [];
          while (p.eat('|')) { const f = p.t[p.i++]?.v ?? ''; filters.push({ name: f, args: p.kwargs() }); }
          body.push({ s: 'setblock', name, filters, body: block('endset').body });
          break;
        }
        case 'component': {
          const p = new Parser(tokenize(rest));
          let name = p.t[p.i++]?.v ?? '';
          while (p.eat('.')) name += `.${p.t[p.i++]?.v ?? ''}`;
          const params = p.componentParams();
          const inner = block('endcomponent').body;
          components?.set(name, { name, params, body: inner });
          break;
        }
        case 'filter': {
          const p = new Parser(tokenize(rest));
          const name = p.t[p.i++]?.v ?? '';
          const args = p.kwargs();
          body.push({ s: 'filter', name, args, body: block('endfilter').body });
          break;
        }
        case 'raw': body.push(...block('endraw').body); break;
        case 'break': body.push({ s: 'break' }); break;
        case 'continue': body.push({ s: 'continue' }); break;
        default: throw new TeraError(`unknown tag {% ${word} %}`);
      }
    }
    if (until.length) throw new TeraError(`missing {% ${until[until.length - 1]} %}`);
    return { body, end: '' };
  };
  return block().body;
}

// ---------- evaluation ----------

const escapeHtml = (s: string) => s.replace(/[&<>"'/]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '/': '&#x2F;' })[c]!);
const plain = (v: unknown): unknown => (v instanceof Safe ? v.s : v);
const str = (v: unknown): string => {
  const p = plain(v);
  if (p === undefined || p === null) return '';
  if (Array.isArray(p)) return `[${p.map(str).join(', ')}]`;
  if (typeof p === 'object') return p instanceof Date ? p.toISOString() : JSON.stringify(p);
  return String(p);
};
const truthy = (v: unknown): boolean => {
  const p = plain(v);
  if (Array.isArray(p)) return p.length > 0;
  if (p && typeof p === 'object') return Object.keys(p).length > 0;
  return !!p && p !== '';
};
const num = (v: unknown) => { const n = Number(plain(v)); return Number.isNaN(n) ? 0 : n; };
const list = (v: unknown): unknown[] => { const p = plain(v); return Array.isArray(p) ? p : p === undefined || p === null ? [] : [p]; };
const dig = (o: unknown, path: string) => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Env)[k] : undefined), o);
const cmpVals = (a: unknown, b: unknown) => { const x = plain(a) as never; const y = plain(b) as never; return x < y ? -1 : x > y ? 1 : 0; };

const STRFTIME: Record<string, (d: Date) => string> = {
  Y: (d) => String(d.getUTCFullYear()),
  y: (d) => String(d.getUTCFullYear()).slice(2),
  m: (d) => String(d.getUTCMonth() + 1).padStart(2, '0'),
  d: (d) => String(d.getUTCDate()).padStart(2, '0'),
  e: (d) => String(d.getUTCDate()).padStart(2, ' '),
  H: (d) => String(d.getUTCHours()).padStart(2, '0'),
  M: (d) => String(d.getUTCMinutes()).padStart(2, '0'),
  S: (d) => String(d.getUTCSeconds()).padStart(2, '0'),
  B: (d) => d.toLocaleString('en', { month: 'long', timeZone: 'UTC' }),
  b: (d) => d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }),
  A: (d) => d.toLocaleString('en', { weekday: 'long', timeZone: 'UTC' }),
  a: (d) => d.toLocaleString('en', { weekday: 'short', timeZone: 'UTC' }),
  F: (d) => d.toISOString().slice(0, 10),
  T: (d) => d.toISOString().slice(11, 19),
};
const formatDate = (v: unknown, fmt: string) => {
  const d = new Date(typeof plain(v) === 'number' ? num(v) * 1000 : str(v));
  if (Number.isNaN(d.getTime())) return str(v);
  return fmt.replace(/%-?([A-Za-z])/g, (m, c: string) => {
    const r = STRFTIME[c]?.(d);
    if (r === undefined) return m;
    return m[1] === '-' ? r.replace(/^[0 ]+/, '') : r;
  });
};

type Filter = (v: unknown, a: Env) => unknown;
const FILTERS: Record<string, Filter> = {
  safe: (v) => new Safe(str(v)),
  escape: (v) => new Safe(escapeHtml(str(v))),
  escape_html: (v) => new Safe(escapeHtml(str(v))),
  escape_xml: (v) => new Safe(str(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)),
  default: (v, a) => (plain(v) === undefined || plain(v) === null ? a.value : v),
  upper: (v) => str(v).toUpperCase(),
  lower: (v) => str(v).toLowerCase(),
  capitalize: (v) => { const s = str(v).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); },
  title: (v) => str(v).replace(/\b\w/g, (c) => c.toUpperCase()),
  trim: (v) => str(v).trim(),
  trim_start: (v, a) => {
    if (a.pat === undefined) return str(v).trimStart();
    let s = str(v); const p = str(a.pat); while (p && s.startsWith(p)) s = s.slice(p.length); return s;
  },
  trim_end: (v, a) => {
    if (a.pat === undefined) return str(v).trimEnd();
    let s = str(v); const p = str(a.pat); while (p && s.endsWith(p)) s = s.slice(0, -p.length); return s;
  },
  trim_start_matches: (v, a) => { let s = str(v); const p = str(a.pat); while (p && s.startsWith(p)) s = s.slice(p.length); return s; },
  trim_end_matches: (v, a) => { let s = str(v); const p = str(a.pat); while (p && s.endsWith(p)) s = s.slice(0, -p.length); return s; },
  replace: (v, a) => str(v).split(str(a.from)).join(str(a.to)),
  regex_replace: (v, a) => { try { return str(v).replace(new RegExp(str(a.pattern), 'g'), str(a.rep)); } catch { return v; } },
  length: (v) => { const p = plain(v); return Array.isArray(p) ? p.length : p && typeof p === 'object' ? Object.keys(p).length : str(p).length; },
  first: (v) => list(v)[0],
  last: (v) => list(v).at(-1),
  nth: (v, a) => list(v)[num(a.n)],
  join: (v, a) => list(v).map(str).join(a.sep === undefined ? '' : str(a.sep)),
  reverse: (v) => (Array.isArray(plain(v)) ? list(v).slice().reverse() : [...str(v)].reverse().join('')),
  sort: (v, a) => list(v).slice().sort((x, y) => (a.attribute ? cmpVals(dig(x, str(a.attribute)), dig(y, str(a.attribute))) : cmpVals(x, y))),
  unique: (v) => [...new Set(list(v).map(plain))],
  slice: (v, a) => list(v).slice(a.start === undefined ? 0 : num(a.start), a.end === undefined ? undefined : num(a.end)),
  concat: (v, a) => [...list(v), ...list(a.with)],
  map: (v, a) => list(v).map((x) => dig(x, str(a.attribute))),
  filter: (v, a) => list(v).filter((x) => (a.value === undefined ? truthy(dig(x, str(a.attribute))) : plain(dig(x, str(a.attribute))) === plain(a.value))),
  group_by: (v, a) => {
    const out: Env = {};
    for (const x of list(v)) { const k = str(dig(x, str(a.attribute))); ((out[k] ??= []) as unknown[]).push(x); }
    return out;
  },
  get: (v, a) => { const r = (plain(v) as Env | undefined)?.[str(a.key)]; return r === undefined ? a.default : r; },
  split: (v, a) => str(v).split(str(a.pat)),
  striptags: (v) => str(v).replace(/<[^>]*>/g, ''),
  linebreaksbr: (v) => new Safe(str(v).replace(/\r?\n/g, '<br>')),
  newlines_to_br: (v) => new Safe(str(v).replace(/\r?\n/g, '<br>')),
  spaceless: (v) => str(v).replace(/>\s+</g, '><'),
  indent: (v, a) => {
    const pad = a.prefix === undefined ? '    ' : str(a.prefix);
    return str(v).split('\n').map((l, i) => ((i > 0 || a.first) && (l || a.blank) ? pad + l : l)).join('\n');
  },
  truncate: (v, a) => {
    const s = str(v); const n = a.length === undefined ? 255 : num(a.length);
    return [...s].length <= n ? s : [...s].slice(0, n).join('') + (a.end === undefined ? '…' : str(a.end));
  },
  wordcount: (v) => (str(v).trim() ? str(v).trim().split(/\s+/).length : 0),
  addslashes: (v) => str(v).replace(/[\\'"]/g, '\\$&'),
  urlencode: (v) => encodeURI(str(v)),
  urlencode_strict: (v) => encodeURIComponent(str(v)),
  slugify: (v) => str(v).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  round: (v, a) => {
    const f = 10 ** (a.precision === undefined ? 0 : num(a.precision));
    const n = num(v) * f;
    return (a.method === 'ceil' ? Math.ceil(n) : a.method === 'floor' ? Math.floor(n) : Math.round(n)) / f;
  },
  abs: (v) => Math.abs(num(v)),
  int: (v, a) => { const n = parseInt(str(v), a.base === undefined ? 10 : num(a.base)); return Number.isNaN(n) ? (a.default ?? 0) : n; },
  float: (v, a) => { const n = parseFloat(str(v)); return Number.isNaN(n) ? (a.default ?? 0) : n; },
  as_str: (v) => str(v),
  str: (v) => str(v),
  json_encode: (v, a) => new Safe(JSON.stringify(plain(v), null, a.pretty ? 2 : 0)),
  pluralize: (v, a) => (num(v) === 1 ? (a.singular === undefined ? '' : str(a.singular)) : (a.plural === undefined ? 's' : str(a.plural))),
  date: (v, a) => formatDate(v, a.format === undefined ? '%Y-%m-%d' : str(a.format)),
  filesizeformat: (v) => { const n = num(v); return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`; },
  num_format: (v) => num(v).toLocaleString(),
};

const TESTS: Record<string, (v: unknown, a: unknown[]) => boolean> = {
  defined: (v) => plain(v) !== undefined,
  undefined: (v) => plain(v) === undefined,
  string: (v) => typeof plain(v) === 'string',
  number: (v) => typeof plain(v) === 'number',
  odd: (v) => num(v) % 2 === 1,
  even: (v) => num(v) % 2 === 0,
  divisibleby: (v, [n]) => num(v) % num(n) === 0,
  divisible_by: (v, [n]) => num(v) % num(n) === 0,
  map: (v) => typeof plain(v) === 'object' && plain(v) !== null && !Array.isArray(plain(v)),
  iterable: (v) => Array.isArray(plain(v)) || (typeof plain(v) === 'object' && plain(v) !== null),
  object: (v) => typeof plain(v) === 'object' && plain(v) !== null && !Array.isArray(plain(v)),
  starting_with: (v, [s]) => str(v).startsWith(str(s)),
  ending_with: (v, [s]) => str(v).endsWith(str(s)),
  containing: (v, [s]) => (Array.isArray(plain(v)) ? list(v).map(plain).includes(plain(s)) : str(v).includes(str(s))),
  matching: (v, [s]) => { try { return new RegExp(str(s)).test(str(v)); } catch { return false; } },
};

class Interp {
  constructor(public host: TeraHost, public autoescape: boolean) {}
  scopes: Env[] = [];
  lookup(name: string): unknown {
    for (let i = this.scopes.length - 1; i >= 0; i--) if (name in this.scopes[i]) return this.scopes[i][name];
    return undefined;
  }
  args(a: Record<string, Node>): Env {
    const out: Env = {};
    for (const k of Object.keys(a)) out[k] = plain(this.ev(a[k]));
    return out;
  }
  ev(n: Node): unknown {
    switch (n.n) {
      case 'lit': return n.v;
      case 'var': return this.lookup(n.name);
      case 'get': {
        const o = plain(this.ev(n.o)) as Env | unknown[] | undefined;
        if (o === undefined || o === null) return undefined;
        const k = plain(this.ev(n.k));
        // v2: negative indexes count from the end
        if (typeof k === 'number' && k < 0 && (Array.isArray(o) || typeof o === 'string')) return (o as unknown[])[o.length + k];
        return (o as Env)[String(k)];
      }
      case 'slice': {
        const o = plain(this.ev(n.o));
        const isStr = typeof o === 'string';
        const arr: unknown[] = isStr ? [...(o as string)] : list(o);
        const step = n.step ? num(this.ev(n.step)) || 1 : 1;
        const at = (e: Node | null, dflt: number) => {
          if (!e) return dflt;
          const x = num(this.ev(e));
          return Math.max(step < 0 ? -1 : 0, Math.min(arr.length, x < 0 ? arr.length + x : x));
        };
        const out: unknown[] = [];
        const start = at(n.start, step > 0 ? 0 : arr.length - 1);
        const stop = at(n.stop, step > 0 ? arr.length : -1);
        for (let i = start; step > 0 ? i < stop : i > stop; i += step) out.push(arr[i]);
        return isStr ? out.join('') : out;
      }
      case 'arr': return n.items.flatMap((x) => ('spread' in x ? list(this.ev(x.spread)) : [this.ev(x)]));
      case 'map': {
        const out: Env = {};
        for (const it of n.items) {
          if ('spread' in it) Object.assign(out, plain(this.ev(it.spread)) as Env);
          else out[String(this.ev(it[0]))] = this.ev(it[1]);
        }
        return out;
      }
      case 'comp': {
        const scope: Env = {};
        this.scopes.push(scope);
        try {
          const out: unknown[] = [];
          for (const v of list(this.ev(n.iter))) {
            scope[n.v] = v;
            if (!n.cond || truthy(this.ev(n.cond))) out.push(this.ev(n.e));
          }
          return out;
        } finally { this.scopes.pop(); }
      }
      case 'if': return truthy(this.ev(n.cond)) ? this.ev(n.a) : this.ev(n.b);
      case 'un': return n.op === 'not' ? !truthy(this.ev(n.a)) : -num(this.ev(n.a));
      case 'bin': return this.bin(n.op, n.a, n.b);
      case 'test': {
        const t = TESTS[n.name];
        if (!t) throw new TeraError(`unknown test "${n.name}"`);
        const r = t(this.ev(n.a), n.args.map((x) => this.ev(x)));
        return n.not ? !r : r;
      }
      case 'filter': {
        const fn = this.host.filters?.[n.name] ?? FILTERS[n.name];
        if (!fn) throw new TeraError(`unknown filter "${n.name}"`);
        const v = this.ev(n.a);
        const args = this.args(n.args);
        return n.name === 'safe' ? fn(v, args) : fn(n.name === 'default' ? v : plain(v), args);
      }
      case 'call': {
        const fn = this.host.functions?.[n.name];
        if (!fn) throw new TeraError(`${n.name}() isn't available in previews`);
        return fn(this.args(n.args));
      }
    }
  }
  bin(op: string, an: Node, bn: Node): unknown {
    // value-preserving, as in v2: {{ title or "Untitled" }}
    if (op === 'and') { const a = this.ev(an); return truthy(a) ? this.ev(bn) : a; }
    if (op === 'or') { const a = this.ev(an); return truthy(a) ? a : this.ev(bn); }
    const a = this.ev(an);
    const b = this.ev(bn);
    switch (op) {
      case '~': return str(a) + str(b);
      case '+': return num(a) + num(b);
      case '-': return num(a) - num(b);
      case '*': return num(a) * num(b);
      case '/': return num(a) / num(b);
      case '%': return num(a) % num(b);
      case '==': return plain(a) === plain(b) || (a !== undefined && b !== undefined && str(a) === str(b));
      case '!=': return !(plain(a) === plain(b) || (a !== undefined && b !== undefined && str(a) === str(b)));
      case '<': return cmpVals(a, b) < 0;
      case '>': return cmpVals(a, b) > 0;
      case '<=': return cmpVals(a, b) <= 0;
      case '>=': return cmpVals(a, b) >= 0;
      case 'in': {
        const p = plain(b);
        if (Array.isArray(p)) return p.map(plain).includes(plain(a));
        if (p && typeof p === 'object') return str(a) in (p as Env);
        return str(p).includes(str(a));
      }
    }
    throw new TeraError(`unknown operator ${op}`);
  }
  call(st: Extract<Stmt, { s: 'call' }>): string {
    const args: Env = {};
    let bodyText: string | undefined;
    try {
      for (const a of st.attrs) {
        if ('spread' in a) Object.assign(args, plain(this.ev(a.spread)) as Env);
        else args[a.key] = this.ev(a.value);
      }
      bodyText = st.body ? this.run(st.body) : undefined;
      const c = this.host.components?.get(st.name);
      if (!c) throw new TeraError(`Unknown component \`${st.name}\``);
      const scope: Env = { ...(bodyText === undefined ? {} : { body: new Safe(bodyText) }) };
      const known = new Set<string>();
      for (const p of c.params) {
        if (p.rest) continue;
        known.add(p.name);
        if (p.name in args) scope[p.name] = args[p.name];
        else if (p.default) scope[p.name] = this.ev(p.default);
        else throw new TeraError(`${st.name}: missing required argument \`${p.name}\``);
      }
      const extra = Object.keys(args).filter((k) => !known.has(k));
      const rest = c.params.find((p) => p.rest);
      if (rest) scope[rest.name] = Object.fromEntries(extra.map((k) => [k, plain(args[k])]));
      else if (extra.length) throw new TeraError(`${st.name}: unknown argument \`${extra[0]}\``);
      // hygienic: a component sees its parameters and nothing else
      const saved = this.scopes;
      this.scopes = [scope];
      try { return this.run(c.body); } finally { this.scopes = saved; }
    } catch (e) {
      if (e instanceof LoopSignal || !this.host.soft) throw e;
      const known = !!this.host.components?.has(st.name);
      return this.host.soft((e as Error).message, { component: st.name, args: known ? undefined : args, body: bodyText });
    }
  }
  run(body: Stmt[]): string {
    let out = '';
    for (const st of body) {
      switch (st.s) {
        case 'text': out += st.v; break;
        case 'out': {
          try {
            const v = this.ev(st.e);
            if (this.host.strict && v === undefined) throw new TeraError(`${describe(st.e)} is not defined`);
            out += v instanceof Safe || !this.autoescape ? str(v) : escapeHtml(str(v));
          } catch (e) {
            if (e instanceof LoopSignal || !this.host.soft) throw e;
            out += this.host.soft((e as Error).message, {});
          }
          break;
        }
        case 'call': out += this.call(st); break;
        case 'setblock': {
          let v: unknown = new Safe(this.run(st.body));
          for (const f of st.filters) {
            const fn = this.host.filters?.[f.name] ?? FILTERS[f.name];
            if (!fn) throw new TeraError(`unknown filter "${f.name}"`);
            v = fn(plain(v), this.args(f.args));
          }
          this.scopes[this.scopes.length - 1][st.name] = v;
          break;
        }
        case 'if':
          for (const arm of st.arms) {
            if (arm.cond === null || truthy(this.ev(arm.cond))) { out += this.run(arm.body); break; }
          }
          break;
        case 'for': {
          const it = plain(this.ev(st.iter));
          const pairs: [unknown, unknown][] = Array.isArray(it)
            ? it.map((v, i) => [i, v])
            : it && typeof it === 'object' ? Object.entries(it as Env) : [];
          if (!pairs.length) { out += this.run(st.empty); break; }
          const scope: Env = {};
          this.scopes.push(scope);
          try {
            for (let i = 0; i < pairs.length; i++) {
              scope[st.v] = pairs[i][1];
              if (st.k) scope[st.k] = pairs[i][0];
              scope.loop = { index: i + 1, index0: i, first: i === 0, last: i === pairs.length - 1 };
              try { out += this.run(st.body); }
              catch (e) {
                if (e instanceof LoopSignal) {
                  out += e.partial;
                  if (e.kind === 'break') break;
                } else throw e;
              }
            }
          } finally { this.scopes.pop(); }
          break;
        }
        case 'set': this.scopes[this.scopes.length - 1][st.name] = this.ev(st.e); break;
        case 'filter': {
          const fn = this.host.filters?.[st.name] ?? FILTERS[st.name];
          if (!fn) throw new TeraError(`unknown filter "${st.name}"`);
          out += str(fn(this.run(st.body), this.args(st.args)));
          break;
        }
        case 'break':
        case 'continue':
          throw new LoopSignal(st.s, out);
      }
    }
    return out;
  }
}

const describe = (n: Node): string =>
  n.n === 'var' ? `Variable \`${n.name}\`` : n.n === 'get' && n.k.n === 'lit' ? `Field \`${describe(n.o).replace(/^\w+ |`/g, '')}.${String(n.k.v)}\`` : 'Value';

class LoopSignal { constructor(public kind: string, public partial: string) {} }

/** Parse template sources for `{% component %}` definitions. */
export function compileComponents(sources: string[]): Map<string, Component> {
  const map = new Map<string, Component>();
  for (const src of sources) {
    try { parseBlocks(segments(src), map); } catch { /* one bad definition shouldn't cost the rest */ }
  }
  return map;
}

/** Render a template. `autoescape` mirrors Zola: on for .html shortcodes, off for .md and for v2 content. */
export function renderTera(source: string, context: Env, host: TeraHost = {}, autoescape = true): string {
  const ast = parseBlocks(segments(source));
  const interp = new Interp(host, autoescape);
  interp.scopes.push({ ...context });
  return interp.run(ast);
}
