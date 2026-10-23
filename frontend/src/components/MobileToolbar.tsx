import { useState } from 'react';
import { styled } from 'baseui';
import type { CodeMirrorHandle } from './CodeMirror';
import { tokens } from '../theme';

// Keyboard accessory bar (Bear / iA Writer / Ulysses pattern). Phone
// keyboards bury #, *, `, [ behind extra layers and have no undo — these
// insert markdown at the cursor or wrap the selection. The editor shell is
// pinned to the visual viewport, so this bar sits right above the keyboard.
const Bar = styled('div', {
  display: 'none',
  '@media (max-width: 639px), (pointer: coarse) and (max-width: 1099px)': {
    display: 'flex',
    alignItems: 'stretch',
    height: '44px',
    borderTop: `1px solid ${tokens.border}`,
    backgroundColor: tokens.codeBg,
    flexShrink: 0,
  },
});

const Scroll = styled('div', {
  display: 'flex',
  alignItems: 'center',
  flex: 1,
  minWidth: 0,
  overflowX: 'auto',
  scrollbarWidth: 'none',
  padding: '0 4px',
  '::-webkit-scrollbar': { display: 'none' },
});

// Toolbar keys: 40×44 touch targets (Apple HIG minimum), no chrome until pressed.
const Key = styled<'button', { $on?: boolean }>('button', ({ $on }) => ({
  appearance: 'none',
  border: 'none',
  margin: 0,
  padding: '0 6px',
  minWidth: '40px',
  height: '36px',
  flexShrink: 0,
  cursor: 'pointer',
  fontFamily: tokens.mono,
  fontSize: '13px',
  color: $on ? tokens.accent : tokens.fgSoft,
  backgroundColor: 'transparent',
  WebkitTapHighlightColor: 'transparent',
  ':active': { backgroundColor: tokens.active },
  ':disabled': { color: tokens.fgFaint },
}));

const Sep = styled('span', { width: '1px', height: '20px', backgroundColor: tokens.border, margin: '0 4px', flexShrink: 0 });

type Act = { label: React.ReactNode; aria: string; run(e: CodeMirrorHandle): void };

const HEADINGS: Act[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  label: `H${n}`,
  aria: `heading ${n}`,
  run: (e) => e.linePrefix(`${'#'.repeat(n)} `),
}));
const INLINE: Act[] = [
  { label: <b>B</b>, aria: 'bold', run: (e) => e.insert('**', '**') },
  { label: <i>I</i>, aria: 'italic', run: (e) => e.insert('*', '*') },
  { label: <s>S</s>, aria: 'strikethrough', run: (e) => e.insert('~~', '~~') },
  { label: '`', aria: 'inline code', run: (e) => e.insert('`', '`') },
  { label: '[ ]( )', aria: 'link', run: (e) => e.insert('[', '](https://)') },
];
const BLOCK: Act[] = [
  { label: '❝', aria: 'quote', run: (e) => e.linePrefix('> ') },
  { label: '•', aria: 'list', run: (e) => e.linePrefix('- ') },
  { label: '1.', aria: 'numbered list', run: (e) => e.linePrefix('1. ') },
  { label: '```', aria: 'code block', run: (e) => e.insert('```\n', '\n```') },
];

export function MobileToolbar({ editor }: { editor: React.RefObject<CodeMirrorHandle> }) {
  const [moreH, setMoreH] = useState(false);
  const key = (a: Act) => (
    <Key key={a.aria} aria-label={a.aria} title={a.aria}
      // keep focus (and the keyboard + selection) in the editor
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { if (editor.current) a.run(editor.current); }}>
      {a.label}
    </Key>
  );
  return (
    <Bar role="toolbar" aria-label="formatting">
      <Scroll>
        {HEADINGS.slice(0, moreH ? 6 : 3).map(key)}
        <Key $on={moreH} aria-label="more headings" aria-pressed={moreH}
          onMouseDown={(e) => e.preventDefault()} onClick={() => setMoreH(!moreH)}>{moreH ? '‹' : 'H…'}</Key>
        <Sep />
        {INLINE.map(key)}
        <Sep />
        {BLOCK.map(key)}
        <Sep />
        {key({ label: '↶', aria: 'undo', run: (e) => e.undo() })}
        {key({ label: '↷', aria: 'redo', run: (e) => e.redo() })}
      </Scroll>
      <Key aria-label="hide keyboard" title="hide keyboard" style={{ borderLeft: `1px solid ${tokens.border}`, height: '100%' }}
        onMouseDown={(e) => e.preventDefault()} onClick={() => editor.current?.blur()}>⌄</Key>
    </Bar>
  );
}
