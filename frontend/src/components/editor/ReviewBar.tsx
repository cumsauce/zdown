import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { styled } from 'styletron-react';
import { COARSE, HOVER, PHONE, tokens } from '../../theme';
import { Btn, Grow, IconBtn } from '../ui';
import type { EditorHandle } from './CodeMirror';
import type { Issue, IssueKind, ReviewSummary } from './reviewTypes';

export const KINDS: { kind: IssueKind; label: string; color: string }[] = [
  { kind: 'veryhard', label: 'Very hard', color: 'var(--rv-veryhard-dot)' },
  { kind: 'hard', label: 'Hard', color: 'var(--rv-hard-dot)' },
  { kind: 'simpler', label: 'Simpler', color: 'var(--rv-simpler)' },
  { kind: 'passive', label: 'Passive', color: 'var(--rv-passive)' },
  { kind: 'weak', label: 'Weak', color: 'var(--rv-weak)' },
];

const Bar = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  flexShrink: 0,
  minHeight: '44px',
  padding: '0 8px',
  borderTop: `1px solid ${tokens.rule}`,
  backgroundColor: tokens.bg,
  [PHONE]: { justifyContent: 'flex-start', padding: '0 0 0 12px' },
});

const Scroll = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  minWidth: 0,
  overflowX: 'auto',
  scrollbarWidth: 'none',
  '::-webkit-scrollbar': { display: 'none' },
  // the row scrolls sideways on phones; the fade says there's more
  [PHONE]: {
    flex: 1,
    paddingRight: '16px',
    maskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent)',
    WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent)',
  },
});

const Grade = styled('span', {
  fontSize: '14px',
  fontWeight: 500,
  color: tokens.fg,
  whiteSpace: 'nowrap',
  paddingRight: '8px',
  flexShrink: 0,
});

const Chip = styled<'button', { $off: boolean }>('button', ({ $off }) => ({
  appearance: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  height: '30px',
  padding: '0 9px',
  border: 'none',
  borderRadius: '15px',
  background: 'none',
  fontSize: '13px',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  cursor: 'pointer',
  color: tokens.fgSoft,
  opacity: $off ? 0.45 : 1,
  textDecoration: $off ? 'line-through' : 'none',
  [HOVER]: { ':hover': { backgroundColor: tokens.hover } },
  ':active': { backgroundColor: tokens.active },
  [COARSE]: { height: '44px' },
}));

const Swatch = styled('span', { width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0 });

const Clear = styled('span', { fontSize: '13px', color: tokens.fgMuted, whiteSpace: 'nowrap' });

export function ReviewBar({ summary, hidden, onToggle, onStep, onRestore, onClose }: {
  summary: ReviewSummary | null;
  hidden: Set<IssueKind>;
  onToggle(kind: IssueKind): void;
  onStep(delta: number): void;
  onRestore(): void;
  onClose(): void;
}) {
  const total = summary ? KINDS.reduce((n, k) => n + summary.counts[k.kind], 0) : 0;
  const reading = summary ? Math.max(1, Math.round(summary.words / 220)) : 0;
  return (
    <Bar role="toolbar" aria-label="Review">
      <Scroll>
        {!summary ? <Clear>Reading…</Clear> : summary.grade === null ? <Clear>Keep writing: review needs a few sentences</Clear> : (
          <Grade title={`Reads at about US grade ${summary.grade}. Under 10 is easy for most readers. ${reading} min read.`}>Grade {summary.grade}</Grade>
        )}
        {summary && summary.grade !== null && total === 0 && <Clear>Nothing to flag</Clear>}
        {summary && KINDS.filter((k) => summary.counts[k.kind] > 0).map((k) => (
          <Chip key={k.kind} type="button" $off={hidden.has(k.kind)} aria-pressed={!hidden.has(k.kind)}
            aria-label={`${hidden.has(k.kind) ? 'Show' : 'Hide'} ${k.label.toLowerCase()} (${summary.counts[k.kind]})`}
            title={`${hidden.has(k.kind) ? 'Show' : 'Hide'} ${k.label.toLowerCase()}`} onClick={() => onToggle(k.kind)}>
            <Swatch style={{ backgroundColor: k.color }} />{summary.counts[k.kind]} {k.label}
          </Chip>
        ))}
        {!!summary?.ignored && (
          <Chip type="button" $off={false} title="Show what you've ignored again" style={{ color: tokens.fgMuted }} onClick={onRestore}>
            {summary.ignored} ignored
          </Chip>
        )}
      </Scroll>
      {total > 0 && (
        <>
          <IconBtn icon="back" label="Previous" onClick={() => onStep(-1)} />
          <IconBtn icon="forward" label="Next" onClick={() => onStep(1)} />
        </>
      )}
      <IconBtn icon="close" label="Close review" onClick={onClose} />
    </Bar>
  );
}

const WEAK: Record<string, string> = {
  hedge: 'A hedge makes you sound unsure.',
  weasel: 'This word is vague, and usually weakens the sentence.',
  filler: 'This word adds little. The sentence may be stronger without it.',
};

const level = (grade = 0) => (grade > 16 ? 'well past college level' : `about grade ${grade}`);

// Dropping an adverb or filler leaves a sentence intact; dropping most other words doesn't.
const removable = (i: Issue) =>
  (i.kind === 'simpler' && !i.expected.length)
  || (i.kind === 'weak' && (i.weak === 'filler' || /(ly|very|quite|just|rather|somewhat|pretty)$/i.test(i.text)));

function explain(i: Issue): { title: string; body: React.ReactNode } {
  switch (i.kind) {
    case 'veryhard': return { title: 'Very hard to read', body: `${i.words} words, ${level(i.grade)}. Try splitting it in two.` };
    case 'hard': return { title: 'Hard to read', body: `${i.words} words, ${level(i.grade)}. A shorter sentence or plainer words would help.` };
    case 'simpler': return { title: 'Simpler wording', body: i.expected.length ? <>“{i.text}” has a plainer option.</> : <>“{i.text}” can probably go.</> };
    case 'passive': return { title: 'Passive voice', body: <>“{i.text}” hides who did it. Try naming them, if it matters.</> };
    case 'weak': return { title: 'Weak word', body: WEAK[i.weak ?? 'weasel'] ?? WEAK.weasel };
  }
}

const Card = styled('div', {
  position: 'fixed',
  zIndex: 40,
  width: '320px',
  maxWidth: 'calc(100vw - 16px)',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  backgroundColor: tokens.surface,
  borderRadius: '12px',
  border: `1px solid ${tokens.rule}`,
  boxShadow: tokens.shadow,
  animationName: 'fade',
  animationDuration: '90ms',
  // phones: docked just above the toolbars, where a thumb is and text isn't covered at the tap
  [PHONE]: {
    position: 'absolute',
    top: 'auto !important',
    left: '8px !important',
    right: '8px',
    bottom: '8px',
    width: 'auto',
    maxWidth: 'none',
    animationName: 'rise',
    animationDuration: '140ms',
  },
});

const Title = styled('div', { fontSize: '14px', fontWeight: 600, color: tokens.fg, display: 'flex', alignItems: 'center', gap: '7px' });
const Body = styled('div', { fontSize: '14px', lineHeight: 1.45, color: tokens.fgSoft, marginTop: '3px', overflowWrap: 'anywhere' });
const Actions = styled('div', { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px', alignItems: 'center' });

/** Explains what's under the tap. Never takes focus: the cursor and keyboard stay as they were. */
export function ReviewCard({ issues, editor, scroller, onFix, onIgnore, onClose }: {
  issues: Issue[];
  editor: React.RefObject<EditorHandle>;
  scroller: React.RefObject<HTMLElement>;
  onFix(issue: Issue, replacement: string): void;
  onIgnore(issue: Issue): void;
  onClose(): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const first = issues[0];

  useLayoutEffect(() => {
    const place = () => {
      const r = editor.current?.rectOf(first);
      const b = box.current?.getBoundingClientRect();
      if (!r || !b) return;
      // docked on phones: move the text clear of the note rather than cover it
      const docked = window.matchMedia('(max-width: 639px)').matches;
      if (docked) {
        if (r.bottom > b.top - 12) scroller.current?.scrollBy({ top: r.bottom - b.top + 40, behavior: 'smooth' });
        return;
      }
      const below = r.bottom + 8 + b.height < window.innerHeight - 52;
      setPos({
        top: below ? r.bottom + 8 : Math.max(60, r.top - b.height - 8),
        left: Math.max(8, Math.min(r.left, window.innerWidth - b.width - 8)),
      });
    };
    place();
    if (window.matchMedia('(max-width: 639px)').matches) return undefined;
    const s = scroller.current;
    s?.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => { s?.removeEventListener('scroll', place); window.removeEventListener('resize', place); };
  }, [first, editor, scroller]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  return (
    <Card ref={box} role="dialog" aria-label="Review note" style={pos ?? { top: -9999, left: -9999 }}
      // keep focus and selection in the text
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
      {issues.map((i) => {
        const { title, body } = explain(i);
        const color = KINDS.find((k) => k.kind === i.kind)!.color;
        return (
          <div key={`${i.kind}:${i.from}`}>
            <Title><Swatch style={{ backgroundColor: color }} /><Grow>{title}</Grow></Title>
            <Body>{body}</Body>
            <Actions>
              {i.expected.map((e) => <Btn key={e} small kind="primary" onMouseDown={(ev) => ev.preventDefault()} onClick={() => onFix(i, e)}>Use “{e}”</Btn>)}
              {removable(i) && <Btn small kind="secondary" onMouseDown={(ev) => ev.preventDefault()} onClick={() => onFix(i, '')}>Remove it</Btn>}
              <Btn small kind="ghost" onMouseDown={(ev) => ev.preventDefault()} onClick={() => onIgnore(i)}>Ignore</Btn>
            </Actions>
          </div>
        );
      })}
    </Card>
  );
}
