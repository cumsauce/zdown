import { parse as parseToml } from 'smol-toml';

// Zola shortcodes: `{{ name(...) }}` inline and `{% name(...) %}` block.
// Matches the whole tag; group 1 is the name (`end`/`else` are closers).
export const SHORTCODE_RE = /\{\{\s*([A-Za-z_]\w*)[\s\S]*?\}\}|\{%\s*([A-Za-z_]\w*)[\s\S]*?%\}/g;

export interface Split {
  /** raw TOML between the `+++` fences, or null when there is no front matter */
  toml: string | null;
  body: string;
}

/** Split `+++` TOML front matter from the body without touching either. */
export function splitFrontMatter(content: string): Split {
  if (!content.startsWith('+++')) return { toml: null, body: content };
  const end = content.indexOf('\n+++', 3);
  if (end < 0) return { toml: null, body: content };
  const toml = content.slice(content.indexOf('\n') + 1, end + 1);
  const rest = content.slice(end + 4);
  return { toml, body: rest.replace(/^[^\n]*\n/, '').replace(/^\n+/, '') };
}

/** Replace the TOML inside the fences, keeping the body byte-for-byte. */
export function joinFrontMatter(content: string, toml: string): string {
  const t = toml.endsWith('\n') || toml === '' ? toml : toml + '\n';
  if (!content.startsWith('+++')) return `+++\n${t}+++\n\n${content}`;
  const end = content.indexOf('\n+++', 3);
  if (end < 0) return `+++\n${t}+++\n\n${content}`;
  return `+++\n${t}${content.slice(end + 1)}`;
}

export function tryParseToml(toml: string): Record<string, unknown> | null {
  try { return parseToml(toml) as Record<string, unknown>; } catch { return null; }
}

/** TOML literal for a form value. Dates (YYYY-MM-DD…) and booleans stay bare. */
export function tomlLiteral(v: string | boolean | string[]): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
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
 * Only single-line values are handled; multi-line values are the source
 * editor's job.
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
