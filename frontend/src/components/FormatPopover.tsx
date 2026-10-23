import { styled } from 'baseui';
import type { CodeMirrorHandle, SelectionBox } from './CodeMirror';
import { BLOCK, HEADINGS, INLINE, type Act } from './formatActions';
import { tokens } from '../theme';

// Desktop: a small formatting bar floating over the selection (Medium /
// Notion / Google Docs pattern). Phones use the keyboard toolbar instead —
// the OS's own copy/paste callout would sit on top of a floating bar.
const H = 34;

const Bar = styled('div', {
  position: 'fixed',
  zIndex: 40,
  display: 'flex',
  alignItems: 'center',
  height: `${H}px`,
  padding: '0 2px',
  backgroundColor: tokens.codeBg,
  border: `1px solid ${tokens.borderStrong}`,
  boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
  transform: 'translateX(-50%)',
  whiteSpace: 'nowrap',
  animationName: { from: { opacity: 0 }, to: { opacity: 1 } } as unknown as string,
  animationDuration: '90ms',
});

const Btn = styled('button', {
  appearance: 'none',
  border: 'none',
  background: 'none',
  height: '28px',
  minWidth: '28px',
  padding: '0 6px',
  fontFamily: tokens.mono,
  fontSize: '13px',
  color: tokens.fgSoft,
  cursor: 'pointer',
  ':hover': { backgroundColor: tokens.active, color: tokens.fg },
});

const Sep = styled('span', { width: '1px', height: '16px', backgroundColor: tokens.border, margin: '0 3px' });

const ACTS: (Act | '|')[] = [...INLINE, '|', ...HEADINGS.slice(0, 3), '|', ...BLOCK.slice(0, 3)];

export function FormatPopover({ box, editor }: { box: SelectionBox; editor: React.RefObject<CodeMirrorHandle> }) {
  const above = box.top - H - 8 > 56; // keep clear of the header
  const top = above ? box.top - H - 8 : box.bottom + 8;
  const left = Math.min(Math.max((box.left + box.right) / 2, 200), window.innerWidth - 200);
  return (
    <Bar role="toolbar" aria-label="format selection" style={{ top, left }}
      // keep focus + selection in the editor
      onMouseDown={(e) => e.preventDefault()}>
      {ACTS.map((a, i) => a === '|' ? <Sep key={i} /> : (
        <Btn key={a.aria} aria-label={a.aria} title={a.key ? `${a.aria} (${a.key})` : a.aria}
          onClick={() => editor.current && a.run(editor.current)}>{a.label}</Btn>
      ))}
    </Bar>
  );
}
