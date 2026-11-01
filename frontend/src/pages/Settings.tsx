import { useEffect, useState } from 'react';
import { styled } from 'styletron-react';
import { api, providerLabel, type Repo } from '../api';
import { useAuth } from '../auth';
import { Badge, Btn, Grow, H1, H2, ListRow, Muted, Page, Row, RowList, Section } from '../components/ui';
import { UserMark } from '../components/UserMark';
import { COARSE, setThemePref, themePref, tokens, type ThemePref } from '../theme';

const Seg = styled('div', { display: 'inline-flex', backgroundColor: tokens.sunken, borderRadius: '8px', padding: '2px', gap: '2px' });
const SegBtn = styled<'button', { $on: boolean }>('button', ({ $on }) => ({
  appearance: 'none',
  height: '30px',
  padding: '0 12px',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  cursor: 'pointer',
  color: $on ? tokens.fg : tokens.fgMuted,
  backgroundColor: $on ? tokens.surface : 'transparent',
  boxShadow: $on ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
  [COARSE]: { height: '40px', padding: '0 16px' },
}));

export function Settings() {
  const { me, signOut } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tokenOk, setTokenOk] = useState<boolean | null>(null);
  const [theme, setTheme] = useState<ThemePref>(themePref);
  useEffect(() => {
    api.repos().then(setRepos, () => {});
    if (me) api.available(me.provider).then(() => setTokenOk(true), () => setTokenOk(false));
  }, [me]);
  if (!me) return null;
  const providers = [...new Set([me.provider, ...repos.map((r) => r.provider).filter((p) => p !== 'local')])];
  return (
    <Page>
      <H1>Settings</H1>

      <Section>
        <H2>Account</H2>
        <RowList>
          <ListRow style={{ cursor: 'default' }}>
            <UserMark login={me.login} url={me.avatar_url} size={32} />
            <Grow>
              <div style={{ fontSize: 15, color: tokens.fg }}>{me.name || me.login}</div>
              <Muted>{providerLabel(me.provider)} · {me.login}</Muted>
            </Grow>
            <Btn kind="ghost" onClick={() => void signOut()}>Sign out</Btn>
          </ListRow>
          {providers.map((p) => (
            <ListRow key={p} style={{ cursor: 'default' }}>
              <Grow style={{ fontSize: 15, color: tokens.fgSoft }}>{providerLabel(p)}</Grow>
              {p === me.provider ? (
                tokenOk === null ? <Muted>Checking…</Muted>
                  : tokenOk ? <Badge>Connected</Badge>
                  : <Badge $tone="negative">Sign in again</Badge>
              ) : <Muted>Sites imported</Muted>}
            </ListRow>
          ))}
        </RowList>
      </Section>

      <Section>
        <H2>Appearance</H2>
        <Row>
          <Seg role="radiogroup" aria-label="Theme">
            {(['auto', 'light', 'dark'] as const).map((t) => (
              <SegBtn key={t} type="button" role="radio" aria-checked={theme === t} $on={theme === t}
                onClick={() => { setTheme(t); setThemePref(t); }}>
                {t === 'auto' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'}
              </SegBtn>
            ))}
          </Seg>
        </Row>
      </Section>
    </Page>
  );
}
