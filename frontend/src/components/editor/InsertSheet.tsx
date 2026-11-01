import { useMemo, useState } from 'react';
import { styled } from 'styletron-react';
import type { Site } from '../../api';
import { templateArgs } from '../../lib/render';
import { COARSE, HOVER, tokens } from '../../theme';
import { Icon, type IconName } from '../icons';
import { H2, Input, Sheet } from '../ui';
import type { EditorHandle } from './CodeMirror';

const Choice = styled('button', {
  appearance: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  width: '100%',
  minHeight: '44px',
  padding: '8px',
  border: 'none',
  borderRadius: '8px',
  background: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  color: tokens.fgSoft,
  fontSize: '14px',
  [HOVER]: { ':hover': { backgroundColor: tokens.hover } },
  ':active': { backgroundColor: tokens.active },
  [COARSE]: { minHeight: '52px' },
});

const Sub = styled('div', { fontFamily: tokens.mono, fontSize: '12px', color: tokens.fgMuted, overflowWrap: 'anywhere' });

/** A ready-to-fill call for a template, with the cursor in the first argument. */
function snippet(name: string, source: string): { text: string; cursor: number; select: number } {
  const args = templateArgs(source);
  const usesBody = /\bbody\b/.test(source);
  const list = args.map((a) => `${a}=""`).join(', ');
  const open = usesBody ? `{% ${name}(${list}) %}` : `{{ ${name}(${list}) }}`;
  const text = usesBody ? `${open}\n\n{% end %}` : open;
  const cursor = args.length ? open.indexOf('""') + 1 : usesBody ? open.length + 1 : text.length;
  return { text, cursor, select: 0 };
}

/** The same, for a Tera component: required parameters, block form when it takes a body. */
function componentSnippet(name: string, source: string): { text: string; cursor: number; select: number } {
  const header = /\{%-?\s*component\s+[\w.]+\s*\(([\s\S]*?)\)\s*-?%\}/.exec(source)?.[1] ?? '';
  const required = header.replace(/"[^"]*"|'[^']*'|\[[^\]]*\]|\{[^}]*\}/g, '""').split(',')
    .map((p) => p.trim()).filter((p) => p && !p.includes('=') && !p.startsWith('...'))
    .map((p) => p.split(':')[0].trim());
  const attrs = required.map((a) => ` ${a}=""`).join('');
  const usesBody = /\bbody\b/.test(source);
  const tag = usesBody ? `{% <${name}${attrs}> %}` : `{{ <${name}${attrs} /> }}`;
  const text = usesBody ? `${tag}\n\n{% </${name}> %}` : tag;
  const cursor = required.length ? tag.indexOf('""') + 1 : usesBody ? tag.length + 1 : text.length;
  return { text, cursor, select: 0 };
}

const TABLE = '| Column | Column |\n| ------ | ------ |\n| Text   | Text   |';

export function InsertSheet({ site, editor, onClose }: { site: Site | null; editor: React.RefObject<EditorHandle>; onClose(): void }) {
  const [q, setQ] = useState('');
  const available = useMemo(() => [
    ...(site?.components ?? []).map((c) => ({ name: c.name, ...componentSnippet(c.name, c.source) })),
    ...(site?.components?.length ? [] : site?.shortcodes ?? []).map((s) => ({ name: s.name, ...snippet(s.name, s.source) })),
  ].sort((a, b) => a.name.localeCompare(b.name)), [site]);
  const shortcodes = available.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const insert = (text: string, cursor?: number, select?: number) => { onClose(); editor.current?.block(text, cursor, select); };
  const basics: { icon: IconName; label: string; run(): void }[] = [
    { icon: 'code', label: 'Code block', run: () => insert('```\n\n```', 4) },
    { icon: 'table', label: 'Table', run: () => insert(TABLE, 2, 6) },
    { icon: 'rule', label: 'Divider', run: () => insert('---') },
  ];
  return (
    <Sheet title="Insert" onClose={onClose}>
      <div>{basics.map((b) => <Choice key={b.label} onClick={b.run}><Icon name={b.icon} />{b.label}</Choice>)}</div>
      {available.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <H2>Components from this site</H2>
          {available.length > 8 && <Input value={q} placeholder="Filter components" aria-label="Filter components" onChange={(e) => setQ(e.currentTarget.value)} />}
          <div>
            {shortcodes.map((s) => (
              <Choice key={s.name} onClick={() => insert(s.text, s.cursor, s.select)}>
                <Icon name="puzzle" />
                <div style={{ minWidth: 0 }}><div>{s.name}</div><Sub>{s.text.split('\n')[0]}</Sub></div>
              </Choice>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
