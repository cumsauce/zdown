import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import { type RenderCtx, renderMarkdown } from '../lib/render';
import { editUrl } from '../lib/recents';

// Colour fenced code with the same parsers and tokens as the editor. Runs
// after the HTML is in place; each language loads on first use.
async function highlight(root: HTMLElement, alive: () => boolean) {
  for (const code of root.querySelectorAll<HTMLElement>('pre code[class*="language-"]')) {
    const name = /language-([\w+#.-]+)/.exec(code.className)?.[1];
    const desc = name ? LanguageDescription.matchLanguageName(languages, name, true) : null;
    if (!desc) continue;
    const support = desc.support ?? await desc.load().catch(() => null);
    if (!support || !alive()) continue;
    const text = code.textContent ?? '';
    const out = document.createDocumentFragment();
    highlightCode(text, support.language.parser.parse(text), classHighlighter,
      (t, cls) => {
        if (!cls) { out.append(t); return; }
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = t;
        out.append(s);
      },
      () => out.append('\n'));
    code.replaceChildren(out);
  }
}

export function Preview({ body, ctx }: { body: string; ctx: RenderCtx }) {
  const html = useMemo(() => renderMarkdown(body, ctx, { embeds: 'live' }), [body, ctx]);
  const box = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    let alive = true;
    if (box.current) void highlight(box.current, () => alive);
    return () => { alive = false; };
  }, [html]);
  return (
    <article ref={box} className="prose" dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        // @/ links jump to that post in the editor
        const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a');
        const internal = a?.getAttribute('data-internal');
        if (a && internal) { e.preventDefault(); navigate(editUrl(ctx.repoId, internal)); }
      }} />
  );
}
