import { useMemo } from 'react';
import { Marked } from 'marked';
import { SHORTCODE_RE, splitFrontMatter } from '../lib/frontmatter';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Posts can come from anyone with push access to the repo, so the preview
// is hostile-input safe: raw HTML is shown as text, and link/image URLs are
// limited to http(s), mailto, and relative/anchor targets (no javascript:,
// data:, vbscript: …). The server CSP blocks inline script as a second wall.
const SAFE_URL = /^(https?:|mailto:|#|\/|\.{0,2}\/|[^:/?#]+(?:[/?#]|$))/i;
const safeUrl = (u: string) => (SAFE_URL.test(u.trim()) ? u : '#');

const md = new Marked({
  gfm: true,
  renderer: { html: ({ text }) => esc(text) },
  walkTokens(t) {
    if (t.type === 'link' || t.type === 'image') t.href = safeUrl(t.href);
  },
});

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

export function Preview({ content }: { content: string }) {
  const html = useMemo(() => {
    const { body } = splitFrontMatter(content);
    return chipShortcodes(md.parse(body, { async: false }) as string);
  }, [content]);
  return <article className="preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
