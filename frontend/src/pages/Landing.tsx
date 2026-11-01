import { useEffect, useState } from 'react';
import { styled } from 'styletron-react';
import { api } from '../api';
import { BrandDot } from '../components/AppShell';
import { Banner, Btn } from '../components/ui';
import { PHONE, tokens } from '../theme';

const Hero = styled('main', {
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: '20px',
  maxWidth: '620px',
  margin: '0 auto',
  padding: '32px',
  [PHONE]: { padding: '24px 20px' },
});

const Wordmark = styled('div', { fontFamily: tokens.serif, fontStyle: 'italic', fontWeight: 500, fontSize: '22px', color: tokens.fg });

const Title = styled('h1', {
  fontFamily: tokens.serif,
  fontWeight: 500,
  fontSize: '52px',
  lineHeight: 1.05,
  letterSpacing: '-.015em',
  margin: 0,
  color: tokens.fg,
  [PHONE]: { fontSize: '40px' },
});

const Lede = styled('p', { fontFamily: tokens.serif, fontSize: '21px', lineHeight: 1.5, color: tokens.fgSoft, margin: 0 });

export function Landing() {
  const [providers, setProviders] = useState<{ id: string; label: string }[] | null>(null);
  useEffect(() => {
    api.providers().then((r) => setProviders(r.providers), () => setProviders([]));
  }, []);
  const q = new URLSearchParams(location.search);
  const denied = q.get('error') === 'not_allowed';
  return (
    <Hero>
      <Wordmark>zdown<BrandDot /></Wordmark>
      <Title>Write your Zola site from anywhere.</Title>
      <Lede>
        A quiet editor that shows your posts the way they'll read, components and images
        included. Every save is a commit on your own branch; nothing goes live until you publish.
      </Lede>
      {denied && <Banner $tone="negative" style={{ borderRadius: 8 }}>{q.get('who') ?? 'That account'} isn't on this server's allowlist. Ask the admin to add it to [access] allowed_users.</Banner>}
      {providers?.length === 0 && <Banner $tone="warning" style={{ borderRadius: 8 }}>No sign-in providers configured. Add [providers.github] or [providers.gitlab] to config.toml.</Banner>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {providers?.map((p, i) => (
          <Btn key={p.id} kind={i === 0 ? 'primary' : 'secondary'} onClick={() => window.location.assign(`/api/auth/${p.id}/start`)}>
            Continue with {p.label}
          </Btn>
        ))}
      </div>
    </Hero>
  );
}
