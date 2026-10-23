import { useEffect, useState } from 'react';
import { Button, KIND, SIZE } from 'baseui/button';
import { api, providerLabel, type Repo } from '../api';
import { useAuth } from '../auth';
import { UserMark } from '../components/TopBar';
import { Card, Chip, Full, Hint, ListRow, MonoText, Page, PageHeader, Row } from '../components/ui';
import { tokens } from '../theme';

export function Settings() {
  const { me, signOut } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tokenOk, setTokenOk] = useState<boolean | null>(null);
  useEffect(() => {
    api.repos().then(setRepos, () => {});
    if (me) api.available(me.provider).then(() => setTokenOk(true), () => setTokenOk(false));
  }, [me]);
  if (!me) return null;
  const providers = [...new Set([me.provider, ...repos.map((r) => r.provider).filter((p) => p !== 'local')])];
  return (
    <Page>
      <PageHeader title="Settings" meta={<Hint>account and connections</Hint>} />
      <Card title="Signed in">
        <Row>
          <UserMark login={me.login} url={me.avatar_url} size={32} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 13, color: tokens.fg }}>{me.name || me.login}</span>
            <Hint>{me.provider}/{me.login}</Hint>
          </div>
          <Full />
          <Button size={SIZE.mini} kind={KIND.tertiary} onClick={() => void signOut()}>sign out</Button>
        </Row>
      </Card>
      <Card title="Connected providers" flush>
        {providers.map((p) => (
          <ListRow key={p}>
            <MonoText>{providerLabel(p)}</MonoText>
            <Full />
            {p === me.provider ? (
              <Chip style={{ color: tokenOk === false ? tokens.negative : tokens.accent }}>
                {tokenOk === null ? 'checking token…' : tokenOk ? 'token ok' : 'token rejected — sign in again'}
              </Chip>
            ) : (
              <Hint>repos imported</Hint>
            )}
          </ListRow>
        ))}
      </Card>
    </Page>
  );
}
