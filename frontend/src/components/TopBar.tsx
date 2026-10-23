import { styled } from 'baseui';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { tokens } from '../theme';

const Bar = styled('header', {
  height: '44px',
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  borderBottom: `1px solid ${tokens.border}`,
  position: 'sticky',
  top: 0,
  zIndex: 10,
  backgroundColor: tokens.bg,
  '@media (max-width: 639px)': { padding: '0 12px', gap: '12px' },
});

const Brand = styled(Link, {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontFamily: tokens.sans,
  fontWeight: 600,
  fontSize: '13px',
  color: tokens.fg,
});

const Mark = styled('span', { width: '10px', height: '10px', backgroundColor: tokens.accent, flexShrink: 0 });

const Nav = styled(NavLink, {
  fontSize: '13px',
  color: tokens.fgMuted,
  height: '44px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  borderBottom: '2px solid transparent',
  ':hover': { color: tokens.fg },
  '&.active': { color: tokens.fg, borderBottomColor: tokens.fg },
});

export const Avatar = styled('img', { width: '20px', height: '20px', borderRadius: '50%' });

const Initial = styled('span', {
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  backgroundColor: tokens.active,
  color: tokens.fgSoft,
  fontSize: '11px',
  fontWeight: 600,
  display: 'grid',
  placeItems: 'center',
  textTransform: 'uppercase',
});

export function UserMark({ login, url, size = 20 }: { login: string; url: string | null; size?: number }) {
  const s = { width: size, height: size };
  return url ? <Avatar src={url} alt="" style={s} /> : <Initial style={s}>{login.slice(0, 1)}</Initial>;
}

export function TopBar() {
  const { me } = useAuth();
  return (
    <Bar>
      <Brand to="/repos"><Mark />md_editor</Brand>
      <div style={{ flex: 1 }} />
      <Nav to="/repos" end>repositories</Nav>
      <Nav to="/settings" aria-label="settings">
        {me && <UserMark login={me.login} url={me.avatar_url} />}
      </Nav>
    </Bar>
  );
}
