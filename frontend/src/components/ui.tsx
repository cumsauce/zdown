import { styled } from 'baseui';
import { Link } from 'react-router-dom';
import { Input, SIZE, type InputProps } from 'baseui/input';
import { tokens } from '../theme';

// Shared chrome primitives — declared once, reused by every page.

/** touch devices: bigger hit areas (see styles.css for baseui controls) */
export const COARSE = '@media (pointer: coarse)';
export const PHONE = '@media (max-width: 639px)';

export const Page = styled('div', {
  maxWidth: '880px',
  margin: '0 auto',
  padding: '32px 24px 48px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  '@media (max-width: 639px)': { padding: '16px 12px 32px', gap: '12px' },
});

export const Panel = styled('section', {
  border: `1px solid ${tokens.border}`,
  padding: '16px',
  minWidth: 0,
});

export const Row = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
  minWidth: 0,
});

/** flex-grow filler / full-width field wrapper */
export const Full = styled('div', { flex: 1, minWidth: 0 });

export const Hint = styled('span', {
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.fgMuted,
  lineHeight: 1.5,
});

export const MonoText = styled('span', {
  fontFamily: tokens.mono,
  fontSize: '13px',
  color: tokens.fgSoft,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

export const PanelTitle = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div className="panel-title" style={{ marginBottom: 8, ...style }}>{children}</div>
);

/** Row inside a panel: 10px 16px, rowRule separators, hover bg. */
export const ListRow = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '10px 16px',
  borderBottom: `1px solid ${tokens.rowRule}`,
  minWidth: 0,
  ':last-child': { borderBottom: 'none' },
  ':hover': { backgroundColor: tokens.hover },
});

/** Path-styled link (repo names, file paths) that brightens to accent. */
export const MonoLink = styled(Link, {
  fontFamily: tokens.mono,
  fontSize: '13px',
  color: tokens.fgSoft,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  ':hover': { color: tokens.accent },
  [COARSE]: { minHeight: '40px', display: 'flex', alignItems: 'center' },
});

/** Inline text action for status bars / forms. */
export const TextBtn = styled('button', {
  appearance: 'none',
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  cursor: 'pointer',
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.fgMuted,
  ':hover': { color: tokens.fg },
  ':disabled': { cursor: 'default', color: tokens.fgFaint },
  [COARSE]: { minHeight: '40px', padding: '0 8px' },
});

export const Chip = styled('span', {
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.accent,
  border: `1px solid ${tokens.accentLine}`,
  backgroundColor: tokens.accentWash,
  padding: '0 6px',
  lineHeight: '18px',
  whiteSpace: 'nowrap',
});

export const Banner = styled<'div', { $kind?: 'accent' | 'danger' }>('div', ({ $kind = 'accent' }) => ({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '8px',
  padding: '8px 14px',
  fontSize: '11px',
  fontFamily: tokens.mono,
  borderBottom: `1px solid ${$kind === 'danger' ? tokens.dangerLine : tokens.accentLine}`,
  backgroundColor: $kind === 'danger' ? tokens.dangerWash : tokens.accentWash,
}));

export const Center = styled('div', {
  display: 'grid',
  placeItems: 'center',
  minHeight: '40vh',
});

export const ErrorText = styled('div', {
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.negative,
});

/** Segmented control: one bordered box, 28px tall like SIZE.mini buttons. */
export const Seg = styled('div', {
  display: 'inline-flex',
  height: '28px',
  border: `1px solid ${tokens.border}`,
  flexShrink: 0,
});

export const SegBtn = styled<'button', { $active: boolean }>('button', ({ $active }) => ({
  appearance: 'none',
  border: 'none',
  margin: 0,
  padding: '0 10px',
  cursor: 'pointer',
  fontFamily: tokens.mono,
  fontSize: '12px',
  color: $active ? tokens.fg : tokens.fgMuted,
  backgroundColor: $active ? tokens.active : 'transparent',
  ':hover': { color: tokens.fg },
}));

/** The one text field: baseui Input at SIZE.mini, boxed to the 28px control height. */
export function TextInput(props: Omit<InputProps, 'size'>) {
  return (
    <Input
      size={SIZE.mini}
      overrides={{
        Root: { style: { height: '28px', boxSizing: 'border-box' } },
        Input: { style: { fontSize: '13px', paddingTop: 0, paddingBottom: 0, paddingLeft: '10px', paddingRight: '10px' } },
      }}
      {...props}
    />
  );
}

const HeaderWrap = styled('div', {
  display: 'flex',
  alignItems: 'flex-end',
  gap: '12px',
  flexWrap: 'wrap',
  paddingBottom: '8px',
});

const Title = styled('h1', {
  margin: 0,
  fontFamily: tokens.sans,
  fontSize: tokens.titleSize,
  fontWeight: 600,
  lineHeight: 1.25,
  color: tokens.fg,
  overflowWrap: 'anywhere',
});

const BackLink = styled(Link, {
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.fgMuted,
  display: 'inline-block',
  marginBottom: '4px',
  ':hover': { color: tokens.fg },
});

/** Page header: optional back link, bold title, mono meta line, actions on the right (wrap below on phones). */
export function PageHeader({ title, meta, back, actions }: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  back?: { to: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <HeaderWrap>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        {back && <BackLink to={back.to}>← {back.label}</BackLink>}
        <Title>{title}</Title>
        {meta && <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{meta}</div>}
      </div>
      {actions && <Row style={{ gap: 4 }}>{actions}</Row>}
    </HeaderWrap>
  );
}

/** Card = Panel with a titled header bar; body is flush (padding 0) for lists. */
export const CardHead = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
  padding: '12px 16px',
  borderBottom: `1px solid ${tokens.border}`,
  minHeight: '48px',
});

export const CardTitle = styled('h2', {
  margin: 0,
  fontFamily: tokens.sans,
  fontSize: '13px',
  fontWeight: 600,
  color: tokens.fg,
});

export const CardBody = styled('div', { padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' });

export function Card({ title, aside, children, flush = false }: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <Panel style={{ padding: 0 }}>
      <CardHead>
        <CardTitle>{title}</CardTitle>
        {aside}
      </CardHead>
      {flush ? children : <CardBody>{children}</CardBody>}
    </Panel>
  );
}

export const Chevron = styled('span', {
  fontFamily: tokens.mono,
  fontSize: '13px',
  color: tokens.fgFaint,
  flexShrink: 0,
});

/** two-up on desktop, stacked on phones */
export const Grid2 = styled('div', {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '16px',
  '@media (max-width: 639px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
});

export const HideMobile = styled('span', { display: 'contents', '@media (max-width: 639px)': { display: 'none' } });
export const OnlyMobile = styled('span', { display: 'none', '@media (max-width: 639px)': { display: 'contents' } });
