import { styled } from 'styletron-react';
import { COARSE, HOVER, PHONE, tokens } from '../../theme';
import { Icon, type IconName } from '../icons';
import type { EditorHandle } from './CodeMirror';

// One formatting bar at every size. It sits at the bottom of the editor, which
// is pinned to the visual viewport, so on phones it rides above the keyboard.
const Bar = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  height: '44px',
  borderTop: `1px solid ${tokens.rule}`,
  backgroundColor: tokens.bg,
  paddingBottom: 'env(safe-area-inset-bottom)',
  boxSizing: 'content-box',
  [PHONE]: { justifyContent: 'flex-start' },
});

const Scroll = styled('div', {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  overflowX: 'auto',
  scrollbarWidth: 'none',
  padding: '0 6px',
  '::-webkit-scrollbar': { display: 'none' },
  [PHONE]: { flex: 1 },
});

const Key = styled('button', {
  appearance: 'none',
  border: 'none',
  borderRadius: '7px',
  background: 'none',
  width: '34px',
  height: '34px',
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  fontFamily: tokens.serif,
  fontSize: '17px',
  lineHeight: 1,
  color: tokens.fgMuted,
  [HOVER]: { ':hover': { backgroundColor: tokens.hover, color: tokens.fg } },
  ':active': { backgroundColor: tokens.active, color: tokens.fg },
  [COARSE]: { width: '42px', height: '44px', borderRadius: 0 },
});

const Sep = styled('span', { width: '1px', height: '18px', backgroundColor: tokens.rule, margin: '0 5px', flexShrink: 0 });

const Stat = styled('span', {
  fontSize: '12px',
  color: tokens.fgFaint,
  whiteSpace: 'nowrap',
  position: 'absolute',
  right: '14px',
  '@media (max-width: 1099px)': { display: 'none' },
});

export function Toolbar({ editor, words, onImage, onInsert, keyboard }: {
  editor: React.RefObject<EditorHandle>;
  words: number;
  onImage(): void;
  onInsert(): void;
  /** on-screen keyboard is showing: offer to dismiss it */
  keyboard: boolean;
}) {
  const act = (fn: (e: EditorHandle) => void) => () => { if (editor.current) fn(editor.current); };
  const key = (label: string, content: IconName | React.ReactNode, run: () => void, title = label) => (
    <Key key={label} type="button" aria-label={label} title={title}
      // keep focus (and the keyboard and selection) in the text
      onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {typeof content === 'string' ? <Icon name={content} size={19} /> : content}
    </Key>
  );
  return (
    <Bar role="toolbar" aria-label="Formatting" style={{ position: 'relative' }}>
      <Scroll>
        {key('Heading', <span style={{ fontWeight: 600 }}>H</span>, act((e) => e.heading()))}
        {key('Bold', <b>B</b>, act((e) => e.toggleWrap('**')), 'Bold (⌘B)')}
        {key('Italic', <i>I</i>, act((e) => e.toggleWrap('*')), 'Italic (⌘I)')}
        {key('Link', 'link', act((e) => e.link()), 'Link (⌘K)')}
        <Sep />
        {key('Bullet list', 'list', act((e) => e.prefix('- ')))}
        {key('Numbered list', 'numbered', act((e) => e.prefix((i) => `${i + 1}. `)))}
        {key('Checklist', 'task', act((e) => e.prefix('- [ ] ')))}
        {key('Indent', 'indent', act((e) => e.nest(true)), 'Indent list item (Tab)')}
        {key('Outdent', 'outdent', act((e) => e.nest(false)), 'Outdent list item (⇧Tab)')}
        <Sep />
        {key('Quote', 'quote', act((e) => e.prefix('> ')))}
        {key('Code', 'code', act((e) => e.toggleWrap('`')), 'Inline code (⌘E)')}
        {key('Insert image', 'image', onImage)}
        {key('Insert…', 'puzzle', onInsert, 'Insert a component, table, code block…')}
        <Sep />
        {key('Undo', 'undo', act((e) => e.undo()), 'Undo (⌘Z)')}
        {key('Redo', 'redo', act((e) => e.redo()), 'Redo (⇧⌘Z)')}
      </Scroll>
      {keyboard && (
        <Key type="button" aria-label="Hide keyboard" title="Hide keyboard" style={{ borderLeft: `1px solid ${tokens.rule}` }}
          onMouseDown={(e) => e.preventDefault()} onClick={act((e) => e.blur())}>
          <Icon name="keyboard" size={19} />
        </Key>
      )}
      <Stat>{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</Stat>
    </Bar>
  );
}
