import { useMemo } from 'react';
import { Marked } from 'marked';
import { SHORTCODE_RE, splitFrontMatter } from '../lib/frontmatter';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Posts can come from anyone with push access to the repo, so the preview
// is hostile-input safe: raw HTML is shown as text, and link/image URLs are
// limited to http(s), mailto, and relative/anchor targets (no javascript:,
// data:, vbscript: …). The server CSP blocks inline script as a second wall.
const SAFE_URL = /^(https?:|mailto:|#|\/|\.{0,2}\/|[^:/?#]+(?:[/?#]|$))/i;
const OFF_REPO = /^(https?:|mailto:|data:|#|\/\/)/i;
const safeUrl = (u: string) => (SAFE_URL.test(u.trim()) ? u : '#');

// Resolve an in-repo image reference the way Zola would: `@/` from the
// content root, `/` from the repo root, anything else relative to the post's
// directory (page bundles). Returns a repo-internal path, or null for
// off-repo URLs the server should never be asked for.
export function repoImagePath(href: string, postPath?: string): string | null {
  const h = href.trim();
  if (OFF_REPO.test(h)) return null;
  let parts: string[];
  if (h.startsWith('@/')) {
    parts = ['content', ...h.slice(2).split('/')];
  } else if (h.startsWith('/')) {
    parts = h.slice(1).split('/');
  } else {
    const dir = postPath && postPath.includes('/') ? postPath.split('/').slice(0, -1) : [];
    parts = [...dir, ...h.split('/')];
  }
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.length ? out.join('/') : null;
}

function makeMd(resolveImage?: (href: string) => string | null) {
  return new Marked({
    gfm: true,
    renderer: { html: ({ text }) => esc(text) },
    walkTokens(t) {
      if (t.type === 'link' || t.type === 'image') t.href = safeUrl(t.href);
      // In-repo images 404 against the SPA, so point them at the raw
      // endpoint (same-origin, auth-gated by cookie).
      if (t.type === 'image' && resolveImage) {
        const inRepo = resolveImage(t.href);
        if (inRepo) t.href = inRepo;
      }
    },
  });
}

/** Wrap `{{ }}` / `{% %}` shortcodes in chips, outside <pre>/<code>. */
function chipShortcodes(html: string): string {
  return html
    .split(/(<pre[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>)/)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(SHORTCODE_RE, (m) => `<span class="shortcode">${m}</span>`);
    })
    .join('');
}

export function Preview({ content, repoId, path }: { content: string; repoId?: number; path?: string }) {
  const html = useMemo(() => {
    const { body } = splitFrontMatter(content);
    const resolveImage =
      repoId
        ? (href: string) => {
            const inRepo = repoImagePath(href, path);
            return inRepo ? `/api/repos/${repoId}/raw?path=${encodeURIComponent(inRepo)}` : null;
          }
        : undefined;
    return chipShortcodes(makeMd(resolveImage).parse(body, { async: false }) as string);
  }, [content, repoId, path]);
  return <article className="preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
