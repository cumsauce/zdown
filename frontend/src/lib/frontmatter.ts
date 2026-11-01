import { parse as parseToml } from 'smol-toml';

export type FmFormat = 'toml' | 'yaml';

export interface DocParts {
  format: FmFormat | null;
  /** raw text between the fences (ends with a newline), or null when there is none */
  raw: string | null;
  /** front matter, fences and the blank lines after it. head + body === content, always. */
  head: string;
  body: string;
}

const FENCES: [string, FmFormat][] = [['+++', 'toml'], ['---', 'yaml']];

/** Split the file without touching either part. */
export function splitDoc(content: string): DocParts {
  for (const [fence, format] of FENCES) {
    if (!content.startsWith(fence)) continue;
    const firstNl = content.indexOf('\n');
    if (firstNl < 0 || content.slice(fence.length, firstNl).trim() !== '') continue;
    const end = content.indexOf(`\n${fence}`, firstNl - 1);
    if (end < 0) continue;
    const after = /^[^\S\n]*(\r?\n)*/.exec(content.slice(end + 1 + fence.length))![0].length;
    const bodyStart = end + 1 + fence.length + after;
    const raw = content.slice(firstNl + 1, end + 1);
    return { format, raw, head: content.slice(0, bodyStart), body: content.slice(bodyStart) };
  }
  return { format: null, raw: null, head: '', body: content };
}

/** Replace the text inside the fences, keeping the body byte-for-byte. */
export function withFrontMatter(content: string, raw: string, format: FmFormat = 'toml'): string {
  const t = raw === '' || raw.endsWith('\n') ? raw : `${raw}\n`;
  const d = splitDoc(content);
  const fence = (d.format ?? format) === 'toml' ? '+++' : '---';
  const gap = d.head ? d.head.slice(d.head.indexOf('\n' + fence, 3) + 1 + fence.length) : '\n\n';
  return `${fence}\n${t}${fence}${gap || '\n\n'}${d.body}`;
}

export function tryParseToml(toml: string): Record<string, unknown> | null {
  try { return parseToml(toml) as Record<string, unknown>; } catch { return null; }
}

// Just enough YAML for Zola front matter: `key: value` and simple lists. The
// raw editor handles anything more elaborate.
function looseYaml(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let listKey: string | null = null;
  let table: Record<string, unknown> = out;
  for (const line of raw.split('\n')) {
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (item && listKey) { (table[listKey] as unknown[]).push(unq(item[1])); continue; }
    const m = /^(\s*)([\w-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (!m[1]) table = out;
    if (m[3] === '') {
      if (m[1]) { table[m[2]] = []; listKey = m[2]; }
      else { const next: Record<string, unknown> = {}; out[m[2]] = next; table = next; listKey = null; }
    } else {
      listKey = null;
      table[m[2]] = /^\[.*\]$/.test(m[3]) ? m[3].slice(1, -1).split(',').map((s) => unq(s.trim())).filter((s) => s !== '') : unq(m[3]);
    }
  }
  return out;
}
const unq = (s: string): unknown => {
  const q = /^(["'])(.*)\1$/.exec(s);
  if (q) return q[2];
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
};

/** Parsed front matter: {} when absent, null when present but unparseable. */
export function parseFields(d: DocParts): Record<string, unknown> | null {
  if (d.raw === null) return {};
  return d.format === 'toml' ? tryParseToml(d.raw) : looseYaml(d.raw);
}

const pad = (n: number) => String(n).padStart(2, '0');
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** A front matter value as the date string it was written as. */
export function dateText(v: unknown): string {
  if (v instanceof Date) {
    const s = v.toISOString();
    // smol-toml's date-only values come back at midnight
    return (v as { isDate?: () => boolean }).isDate?.() ? s.slice(0, 10) : s.endsWith('T00:00:00.000Z') ? s.slice(0, 10) : s;
  }
  return v === undefined || v === null ? '' : String(v);
}

/** TOML literal for a form value. Dates (YYYY-MM-DD…) and booleans stay bare. */
export function tomlLiteral(v: string | boolean | number | string[]): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return `[${v.map((s) => JSON.stringify(s)).join(', ')}]`;
  if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/.test(v)) return v;
  return JSON.stringify(v);
}

const KEY_LINE = (key: string) => new RegExp(`^\\s*(?:${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|"${key}")\\s*=`);
const HEADER = /^\s*\[([^\]]+)\]\s*$/;

/**
 * Line-level edit of one key: replaces its line, appends it, or removes it
 * (value null). Everything else in the TOML text is left verbatim — we never
 * re-serialize the whole document. `section` null = top level.
 * Only single-line values are handled; multi-line values are the raw editor's job.
 */
export function setTomlKey(toml: string, section: string | null, key: string, literal: string | null): string {
  const lines = toml === '' ? [] : toml.replace(/\n$/, '').split('\n');
  // find the section's line range [start, end)
  let start = 0;
  let end = lines.length;
  if (section === null) {
    const first = lines.findIndex((l) => HEADER.test(l));
    end = first < 0 ? lines.length : first;
  } else {
    const h = lines.findIndex((l) => HEADER.exec(l)?.[1].trim() === section);
    if (h < 0) {
      if (literal === null) return toml;
      const out = [...lines];
      if (out.length && out[out.length - 1].trim() !== '') out.push('');
      out.push(`[${section}]`, `${key} = ${literal}`);
      return out.join('\n') + '\n';
    }
    start = h + 1;
    const next = lines.findIndex((l, i) => i >= start && HEADER.test(l));
    end = next < 0 ? lines.length : next;
  }
  const idx = lines.findIndex((l, i) => i >= start && i < end && KEY_LINE(key).test(l));
  const out = [...lines];
  if (idx >= 0) {
    if (literal === null) out.splice(idx, 1);
    else out[idx] = `${key} = ${literal}`;
  } else if (literal !== null) {
    let at = end;
    while (at > start && out[at - 1].trim() === '') at--;
    out.splice(at, 0, `${key} = ${literal}`);
  }
  // drop a section header left with no keys
  if (section !== null) {
    const h = out.findIndex((l) => HEADER.exec(l)?.[1].trim() === section);
    const next = out.findIndex((l, i) => i > h && HEADER.test(l));
    const body = out.slice(h + 1, next < 0 ? out.length : next);
    if (h >= 0 && body.every((l) => l.trim() === '')) {
      out.splice(h, (next < 0 ? out.length : next) - h);
      while (out.length && out[out.length - 1].trim() === '') out.pop();
    }
  }
  return out.join('\n') + (out.length ? '\n' : '');
}

function setYamlKey(raw: string, key: string, value: string | boolean | number | string[] | null): string {
  const lines = raw.replace(/\n$/, '').split('\n').filter((l, _i, a) => !(a.length === 1 && l === ''));
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`);
  let i = lines.findIndex((l) => re.test(l));
  const lit = value === null ? null : Array.isArray(value) ? `[${value.map((s) => JSON.stringify(s)).join(', ')}]`
    : typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(value) ? JSON.stringify(value) : String(value);
  if (i >= 0) {
    let n = 1;
    while (i + n < lines.length && /^\s+\S|^-\s/.test(lines[i + n])) n++; // the value's continuation lines
    if (lit === null) lines.splice(i, n);
    else lines.splice(i, n, `${key}: ${lit}`);
  } else if (lit !== null) {
    i = lines.length;
    lines.push(`${key}: ${lit}`);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

/** Set one field in the file's front matter, whichever format it uses. Adds a block when there is none. */
export function setField(content: string, table: string | null, key: string, value: string | boolean | number | string[] | null): string {
  const d = splitDoc(content);
  const format = d.format ?? 'toml';
  const raw = d.raw ?? '';
  if (format === 'yaml') {
    if (table !== null) return content; // nested YAML goes through the raw editor
    return withFrontMatter(content, setYamlKey(raw, key, value), 'yaml');
  }
  return withFrontMatter(content, setTomlKey(raw, table, key, value === null ? null : tomlLiteral(value)), 'toml');
}
