import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { styled } from 'styletron-react';
import { COARSE, HOVER, PHONE, tokens } from '../theme';
import { Icon, type IconName } from './icons';

// Shared primitives, declared once and reused by every page. Sizes: controls
// are 36px with a pointer and 44px on touch; meta text never drops below 13px.

export { styled };

export const Page = styled('div', {
  maxWidth: '760px',
  margin: '0 auto',
  padding: '40px 32px 80px',
  display: 'flex',
  flexDirection: 'column',
  gap: '28px',
  [PHONE]: { padding: '20px 16px 32px', gap: '22px' },
});

export const Row = styled('div', { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 });
export const Grow = styled('div', { flex: 1, minWidth: 0 });

export const H1 = styled('h1', {
  margin: 0,
  fontFamily: tokens.serif,
  fontSize: '36px',
  fontWeight: 500,
  lineHeight: 1.1,
  letterSpacing: '-.01em',
  color: tokens.fg,
  overflowWrap: 'anywhere',
  [PHONE]: { fontSize: '30px' },
});

export const H2 = styled('h2', {
  margin: 0,
  fontSize: '13px',
  fontWeight: 600,
  color: tokens.fgMuted,
  letterSpacing: '.01em',
});

export const Muted = styled('span', { fontSize: '13px', color: tokens.fgMuted });

export const Path = styled('span', {
  fontFamily: tokens.mono,
  fontSize: '12px',
  color: tokens.fgMuted,
  overflowWrap: 'anywhere',
});

/** Small text link that still meets the touch target size on phones. */
export const quietLink = {
  fontSize: '14px',
  color: tokens.fgMuted,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  [HOVER]: { ':hover': { color: tokens.fg } },
  [COARSE]: { minHeight: '44px' },
} as const;
export const QuietA = styled('a', quietLink);

export const Section = styled('section', { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 });

/** Hairline-separated rows; no boxes around lists. */
export const RowList = styled('div', { display: 'flex', flexDirection: 'column', borderTop: `1px solid ${tokens.rule}` });

const rowBase = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 4px',
  minHeight: '52px',
  borderBottom: `1px solid ${tokens.rule}`,
  minWidth: 0,
  [HOVER]: { ':hover': { backgroundColor: tokens.hover } },
  ':active': { backgroundColor: tokens.active },
} as const;

export const ListRow = styled('div', rowBase);

export const Center = styled('div', { display: 'grid', placeItems: 'center', minHeight: '40vh', padding: '24px', textAlign: 'center' });

export const Field = styled('label', {
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  fontSize: '13px',
  fontWeight: 500,
  color: tokens.fgMuted,
  minWidth: 0,
});

const controlBox = {
  width: '100%',
  height: '36px',
  padding: '0 10px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '8px',
  backgroundColor: tokens.surface,
  color: tokens.fg,
  fontSize: '14px',
  outline: 'none',
  fontWeight: 400,
  ':focus': { borderColor: tokens.accent },
  '::placeholder': { color: tokens.fgFaint },
  [COARSE]: { height: '44px' },
} as const;

export const Input = styled('input', controlBox);
export const Textarea = styled('textarea', {
  ...controlBox,
  height: 'auto',
  padding: '8px 10px',
  lineHeight: 1.5,
  resize: 'vertical',
  [COARSE]: { height: 'auto' },
});
export const MonoTextarea = styled('textarea', {
  ...controlBox,
  height: 'auto',
  padding: '8px 10px',
  lineHeight: 1.5,
  resize: 'vertical',
  fontFamily: tokens.mono,
  fontSize: '13px',
  [COARSE]: { height: 'auto' },
});
export const Select = styled('select', {
  ...controlBox,
  appearance: 'none',
  paddingRight: '28px',
  backgroundImage: `linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)`,
  backgroundPosition: 'calc(100% - 14px) 50%, calc(100% - 10px) 50%',
  backgroundSize: '4px 4px, 4px 4px',
  backgroundRepeat: 'no-repeat',
  cursor: 'pointer',
});

export const Badge = styled<'span', { $tone?: 'accent' | 'warning' | 'muted' | 'negative' }>('span', ({ $tone = 'muted' }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  height: '20px',
  padding: '0 7px',
  borderRadius: '10px',
  fontSize: '12px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  color: { accent: tokens.accent, warning: tokens.warning, muted: tokens.fgMuted, negative: tokens.negative }[$tone],
  backgroundColor: { accent: tokens.accentWash, warning: tokens.warningWash, muted: tokens.sunken, negative: tokens.negativeWash }[$tone],
}));

export const Dot = styled<'span', { $on?: boolean }>('span', ({ $on }) => ({
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  flexShrink: 0,
  backgroundColor: $on ? tokens.accent : tokens.border,
}));

export const Banner = styled<'div', { $tone?: 'accent' | 'negative' | 'warning' }>('div', ({ $tone = 'accent' }) => ({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '6px 12px',
  padding: '10px 16px',
  fontSize: '14px',
  color: tokens.fgSoft,
  backgroundColor: { accent: tokens.accentWash, negative: tokens.negativeWash, warning: tokens.warningWash }[$tone],
}));

export const Spinner = ({ size = 18 }: { size?: number }) => (
  <span role="status" aria-label="loading" style={{
    display: 'inline-block', width: size, height: size, flexShrink: 0, borderRadius: '50%',
    border: `2px solid ${tokens.border}`, borderTopColor: tokens.accent, animation: 'spin .7s linear infinite',
  }} />
);

export const Loading = () => <Center><Spinner size={22} /></Center>;

// ---------- buttons ----------

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger';

const StyledBtn = styled<'button', { $kind: Kind; $small?: boolean }>('button', ({ $kind, $small }) => ({
  appearance: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  height: $small ? '32px' : '36px',
  padding: $small ? '0 10px' : '0 14px',
  borderRadius: '8px',
  border: $kind === 'secondary' ? `1px solid ${tokens.border}` : '1px solid transparent',
  backgroundColor: $kind === 'primary' ? tokens.fg : $kind === 'secondary' ? tokens.surface : 'transparent',
  color: $kind === 'primary' ? tokens.bg : $kind === 'danger' ? tokens.negative : $kind === 'ghost' ? tokens.fgSoft : tokens.fg,
  fontSize: '14px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'opacity 90ms',
  [HOVER]: { ':hover': { backgroundColor: $kind === 'primary' ? tokens.fgSoft : tokens.hover } },
  ':active': { opacity: 0.8 },
  ':disabled': { opacity: 0.45, cursor: 'default' },
  [COARSE]: { height: '44px', padding: '0 16px' },
}));

export interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: Kind;
  small?: boolean;
  icon?: IconName;
  loading?: boolean;
}

export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn({ kind = 'secondary', small, icon, loading, children, disabled, ...rest }, ref) {
  return (
    <StyledBtn ref={ref} type="button" $kind={kind} $small={small} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={17} /> : null}
      {children}
    </StyledBtn>
  );
});

const StyledIconBtn = styled<'button', { $on?: boolean }>('button', ({ $on }) => ({
  appearance: 'none',
  width: '36px',
  height: '36px',
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  border: 'none',
  borderRadius: '8px',
  backgroundColor: $on ? tokens.active : 'transparent',
  color: $on ? tokens.fg : tokens.fgMuted,
  cursor: 'pointer',
  [HOVER]: { ':hover': { color: tokens.fg, backgroundColor: tokens.hover } },
  ':active': { backgroundColor: tokens.active },
  ':disabled': { opacity: 0.4, cursor: 'default' },
  [COARSE]: { width: '44px', height: '44px' },
}));

export const IconBtn = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; on?: boolean }>(
  function IconBtn({ icon, label, on, ...rest }, ref) {
    return <StyledIconBtn ref={ref} type="button" aria-label={label} title={label} $on={on} {...rest}><Icon name={icon} /></StyledIconBtn>;
  },
);

// ---------- menu + sheet ----------

const SheetScrim = styled('div', {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  backgroundColor: 'rgba(20,16,10,.38)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  animationName: 'fade',
  animationDuration: '120ms',
  [PHONE]: { alignItems: 'flex-end', padding: 0 },
});

const SheetBox = styled('div', {
  width: '100%',
  maxWidth: '480px',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: tokens.surface,
  borderRadius: '14px',
  boxShadow: tokens.shadow,
  animationName: 'rise',
  animationDuration: '160ms',
  animationTimingFunction: 'cubic-bezier(.2,.8,.3,1)',
  [PHONE]: {
    maxWidth: 'none',
    maxHeight: '88dvh',
    borderRadius: '16px 16px 0 0',
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
});

const SheetHead = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 8px 10px 18px',
  minHeight: '52px',
  flexShrink: 0,
  fontWeight: 600,
  fontSize: '15px',
  color: tokens.fg,
});

export const SheetBody = styled('div', {
  padding: '2px 18px 18px',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  minHeight: 0,
  overscrollBehavior: 'contain',
});

export const SheetFoot = styled('div', {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  padding: '12px 18px',
  borderTop: `1px solid ${tokens.rule}`,
  flexShrink: 0,
});

/** Modal: centred with a pointer, a bottom sheet on phones. */
export function Sheet({ title, onClose, children, footer }: {
  title: React.ReactNode;
  onClose(): void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return createPortal(
    <SheetScrim onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <SheetBox role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <SheetHead><Grow>{title}</Grow><IconBtn icon="close" label="Close" onClick={onClose} /></SheetHead>
        <SheetBody>{children}</SheetBody>
        {footer && <SheetFoot>{footer}</SheetFoot>}
      </SheetBox>
    </SheetScrim>,
    document.body,
  );
}

const Pop = styled('div', {
  position: 'fixed',
  zIndex: 60,
  minWidth: '220px',
  maxWidth: 'calc(100vw - 16px)',
  maxHeight: '70vh',
  overflowY: 'auto',
  padding: '5px',
  backgroundColor: tokens.surface,
  borderRadius: '10px',
  boxShadow: tokens.shadow,
  border: `1px solid ${tokens.rule}`,
  animationName: 'fade',
  animationDuration: '90ms',
  [PHONE]: {
    left: '8px !important',
    right: '8px',
    bottom: 'calc(8px + env(safe-area-inset-bottom))',
    top: 'auto !important',
    borderRadius: '14px',
    animationName: 'rise',
    animationDuration: '160ms',
  },
});

const PopScrim = styled('div', {
  position: 'fixed',
  inset: 0,
  zIndex: 59,
  [PHONE]: { backgroundColor: 'rgba(20,16,10,.38)' },
});

const MenuBtn = styled<'button', { $danger?: boolean }>('button', ({ $danger }) => ({
  appearance: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  minHeight: '36px',
  padding: '6px 10px',
  border: 'none',
  borderRadius: '7px',
  background: 'none',
  textAlign: 'left',
  fontSize: '14px',
  color: $danger ? tokens.negative : tokens.fgSoft,
  cursor: 'pointer',
  [HOVER]: { ':hover': { backgroundColor: tokens.hover } },
  ':active': { backgroundColor: tokens.active },
  ':disabled': { color: tokens.fgFaint, cursor: 'default', backgroundColor: 'transparent' },
  [COARSE]: { minHeight: '48px', fontSize: '15px' },
}));

const MenuRule = styled('div', { height: '1px', margin: '5px 6px', backgroundColor: tokens.rule });

export interface MenuItem { label: React.ReactNode; icon?: IconName; run?: () => void; danger?: boolean; disabled?: boolean; separator?: boolean; keepOpen?: boolean }

/** Dropdown anchored to its trigger; on phones a sheet in thumb reach. */
export function Menu({ items, trigger }: {
  items: MenuItem[];
  trigger: (props: { onClick: () => void; ref: React.Ref<HTMLButtonElement>; 'aria-expanded': boolean }) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !box.current) return;
    const a = anchor.current.getBoundingClientRect();
    const b = box.current.getBoundingClientRect();
    const below = a.bottom + 6 + b.height < window.innerHeight;
    setPos({
      top: below ? a.bottom + 6 : Math.max(8, a.top - b.height - 6),
      left: Math.max(8, Math.min(a.right - b.width, window.innerWidth - b.width - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [open]);

  return (
    <>
      {trigger({ onClick: () => setOpen((o) => !o), ref: anchor, 'aria-expanded': open })}
      {open && createPortal(
        <>
          <PopScrim onMouseDown={() => setOpen(false)} />
          <Pop ref={box} role="menu" style={pos ?? { top: -9999, left: -9999 }}>
            {items.map((it, i) => it.separator ? <MenuRule key={i} /> : (
              <MenuBtn key={i} role="menuitem" $danger={it.danger} disabled={it.disabled}
                onClick={() => { if (!it.keepOpen) setOpen(false); it.run?.(); }}>
                {it.icon && <Icon name={it.icon} size={18} />}
                <span style={{ flex: 1, minWidth: 0 }}>{it.label}</span>
              </MenuBtn>
            ))}
          </Pop>
        </>,
        document.body,
      )}
    </>
  );
}

// ---------- toasts + confirm (imperative, so any code path can use them) ----------

interface ToastItem { id: number; text: string; tone: 'ok' | 'error' }
interface ConfirmReq { title: string; body?: React.ReactNode; action: string; danger?: boolean; resolve(v: boolean): void }

let pushToast: (t: ToastItem) => void = () => {};
let pushConfirm: (c: ConfirmReq) => void = () => {};
let nextToast = 1;

export const toast = (text: string, tone: 'ok' | 'error' = 'ok') => pushToast({ id: nextToast++, text, tone });
export const confirmDialog = (c: Omit<ConfirmReq, 'resolve'>) =>
  new Promise<boolean>((resolve) => pushConfirm({ ...c, resolve }));

const ToastStack = styled('div', {
  position: 'fixed',
  zIndex: 70,
  bottom: '20px',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  width: 'max-content',
  maxWidth: 'calc(100vw - 32px)',
  pointerEvents: 'none',
  [PHONE]: { bottom: 'calc(68px + env(safe-area-inset-bottom))' },
});

const ToastBox = styled<'div', { $error: boolean }>('div', ({ $error }) => ({
  padding: '9px 14px',
  borderRadius: '10px',
  fontSize: '14px',
  backgroundColor: $error ? tokens.negative : tokens.fg,
  color: tokens.bg,
  boxShadow: tokens.shadow,
  overflowWrap: 'anywhere',
  animationName: 'rise',
  animationDuration: '160ms',
  pointerEvents: 'auto',
}));

export function Overlays() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [ask, setAsk] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    pushToast = (t) => {
      setToasts((l) => [...l.filter((x) => x.text !== t.text).slice(-2), t]);
      setTimeout(() => setToasts((l) => l.filter((x) => x.id !== t.id)), t.tone === 'error' ? 7000 : 3000);
    };
    pushConfirm = setAsk;
  }, []);
  const answer = (v: boolean) => { ask?.resolve(v); setAsk(null); };
  return (
    <>
      <ToastStack aria-live="polite">{toasts.map((t) => <ToastBox key={t.id} $error={t.tone === 'error'}>{t.text}</ToastBox>)}</ToastStack>
      {ask && (
        <Sheet title={ask.title} onClose={() => answer(false)} footer={
          <>
            <Btn kind="ghost" onClick={() => answer(false)}>Cancel</Btn>
            <Btn kind={ask.danger ? 'danger' : 'primary'} autoFocus onClick={() => answer(true)}>{ask.action}</Btn>
          </>
        }>
          {ask.body && <div style={{ fontSize: 14, color: tokens.fgSoft, lineHeight: 1.5 }}>{ask.body}</div>}
        </Sheet>
      )}
    </>
  );
}
