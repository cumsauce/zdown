import { styled } from 'baseui';
import { tokens } from '../theme';

const Avatar = styled('img', { borderRadius: '50%', flexShrink: 0 });

const Initial = styled('span', {
  borderRadius: '50%',
  backgroundColor: tokens.active,
  color: tokens.fgSoft,
  fontSize: '11px',
  fontWeight: 600,
  display: 'grid',
  placeItems: 'center',
  textTransform: 'uppercase',
  flexShrink: 0,
});

export function UserMark({ login, url, size = 20 }: { login: string; url: string | null; size?: number }) {
  const s = { width: size, height: size };
  return url ? <Avatar src={url} alt="" style={s} /> : <Initial style={s}>{login.slice(0, 1)}</Initial>;
}
