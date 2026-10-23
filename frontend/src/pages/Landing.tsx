import { styled } from 'baseui';
import { useEffect, useState } from 'react';
import { Button, KIND } from 'baseui/button';
import { api } from '../api';
import { tokens } from '../theme';

const Hero = styled('main', {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: '24px',
  maxWidth: '640px',
  margin: '0 auto',
  padding: '24px',
  '@media (max-width: 639px)': { padding: '24px 14px' },
});

const Title = styled('h1', {
  fontFamily: tokens.serif,
  fontWeight: 500,
  fontSize: '40px',
  lineHeight: 1.15,
  margin: 0,
  color: tokens.fg,
});

const Lede = styled('p', {
  fontFamily: tokens.serif,
  fontSize: '17px',
  lineHeight: 1.6,
  color: tokens.fgSoft,
  margin: 0,
});

const Points = styled('ul', {
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.fgMuted,
  lineHeight: 1.9,
  margin: 0,
  paddingLeft: '16px',
});

const Notice = styled('div', {
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.negative,
  border: `1px solid ${tokens.dangerLine}`,
  backgroundColor: tokens.dangerWash,
  padding: '8px 14px',
});

export function Landing() {
  const [providers, setProviders] = useState<{ id: string; label: string }[] | null>(null);
  useEffect(() => {
    api.providers().then((r) => setProviders(r.providers), () => setProviders([]));
  }, []);
  const q = new URLSearchParams(location.search);
  const denied = q.get('error') === 'not_allowed';
  return (
    <Hero>
      <div className="panel-title">md_editor</div>
      <Title>Write your blog in markdown. Keep it in git.</Title>
      <Lede>
        A quiet editor for Zola-style sites. Every save is a commit on your own branch;
        publish pushes it to your repository when you're ready. Works on a phone.
      </Lede>
      <Points>
        <li>live-formatted markdown with +++ toml front matter</li>
        <li>full version history, diffs and one-click restore</li>
        <li>local scratchpads — connect a repo later</li>
      </Points>
      {denied && (
        <Notice>{q.get('who') ?? 'that account'} isn't on this server's allowlist — ask the admin to add it to [access] allowed_users.</Notice>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {providers?.length === 0 && <Notice>no sign-in providers configured — add [providers.github] or [providers.gitlab] to config.toml</Notice>}
        {providers?.map((p, i) => (
          <Button key={p.id} kind={i === 0 ? KIND.primary : KIND.secondary}
            onClick={() => window.location.assign(`/api/auth/${p.id}/start`)}>
            Continue with {p.label}
          </Button>
        ))}
      </div>
    </Hero>
  );
}
