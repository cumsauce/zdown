import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { styled } from 'styletron-react';
import { api, type Repo } from '../api';
import { Icon } from '../components/icons';
import { Btn, Center, Grow, H1, H2, Loading, Muted, Page, quietLink, RowList, Section, Spinner } from '../components/ui';
import { editUrl, useRecents } from '../lib/recents';
import { repoStore, useRepos, useSite } from '../lib/store';
import { relTime } from '../lib/time';
import { notifyError } from '../notify';
import { HOVER, PHONE, tokens } from '../theme';

// Where you left off, and your sites. A place to go from, not a form: writing
// always happens in the one editor, so nothing here morphs as you type.

const DocRow = styled(Link, {
  display: 'flex',
  alignItems: 'baseline',
  gap: '12px',
  padding: '12px 4px',
  borderBottom: `1px solid ${tokens.rule}`,
  minWidth: 0,
  [HOVER]: { ':hover': { backgroundColor: tokens.hover } },
  ':active': { backgroundColor: tokens.active },
  [PHONE]: { flexDirection: 'column', gap: '2px' },
});

const DocTitle = styled('span', {
  fontFamily: tokens.serif,
  fontSize: '19px',
  lineHeight: 1.25,
  color: tokens.fg,
  flex: 1,
  minWidth: 0,
  overflowWrap: 'anywhere',
});

const SiteRow = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  borderBottom: `1px solid ${tokens.rule}`,
  minWidth: 0,
});

const SiteLink = styled(Link, {
  display: 'flex',
  flexDirection: 'column',
  gap: '1px',
  flex: 1,
  minWidth: 0,
  padding: '12px 4px',
  [HOVER]: { ':hover': { color: tokens.accent } },
});

const SiteName = styled('span', { fontSize: '15px', fontWeight: 500, color: tokens.fg, overflowWrap: 'anywhere' });

const ManageLink = styled(Link, quietLink);

const fileName = (path: string) => (path.split('/').pop() ?? path).replace(/\.(md|markdown)$/i, '');

function SiteEntry({ repo }: { repo: Repo }) {
  const { data, tree } = useSite(repo.id);
  const short = repo.full_name.split('/').pop();
  const ahead = data?.status.changed.length ?? 0;
  const count = tree?.root.total;
  const meta = [
    repo.provider === 'local' ? 'Scratchpad' : repo.full_name,
    count !== undefined ? `${count} ${count === 1 ? 'post' : 'posts'}` : null,
    ahead && repo.provider !== 'local' ? `${ahead} unpublished` : null,
  ].filter(Boolean).join(' · ');
  return (
    <SiteRow>
      <SiteLink to={`/repos/${repo.id}`}>
        <SiteName>{data?.site.title || short}</SiteName>
        <Muted>{meta}</Muted>
      </SiteLink>
      <Icon name="forward" size={16} style={{ color: tokens.fgFaint, marginRight: 4 }} />
    </SiteRow>
  );
}

export function Home() {
  const repos = useRepos();
  const recent = useRecents();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  if (repos === null) return <Loading />;

  const scratch = async () => {
    setCreating(true);
    try {
      const r = await api.createScratch('notes');
      await repoStore.reload();
      navigate(`/repos/${r.id}/edit?new=1&in=`);
    } catch (e) { notifyError(e); } finally { setCreating(false); }
  };

  if (repos.length === 0) {
    return (
      <Center style={{ minHeight: '70vh' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 440, alignItems: 'center' }}>
          <H1>Bring in your site</H1>
          <Muted style={{ fontSize: 15, lineHeight: 1.5 }}>Import a Zola site from your git provider to write and publish from anywhere, or start with a scratchpad and connect it later.</Muted>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Btn kind="primary" onClick={() => navigate('/repos')}>Import a site</Btn>
            <Btn loading={creating} onClick={() => void scratch()}>Start a scratchpad</Btn>
          </div>
        </div>
      </Center>
    );
  }

  const known = new Map(repos.map((r) => [r.id, r]));
  const shownRecent = recent.filter((r) => known.has(r.repoId)).slice(0, 6);

  return (
    <Page>
      <H1>{shownRecent.length ? 'Pick up where you left off' : 'What will you write?'}</H1>

      {shownRecent.length > 0 && (
        <Section>
          <RowList>
            {shownRecent.map((r) => (
              <DocRow key={`${r.repoId}:${r.path}`} to={editUrl(r.repoId, r.path)} title={r.path}>
                <DocTitle>{r.title || fileName(r.path)}</DocTitle>
                <Muted style={{ flexShrink: 0 }}>
                  {known.get(r.repoId)!.full_name.split('/').pop()} · {relTime(r.at / 1000)}
                </Muted>
              </DocRow>
            ))}
          </RowList>
        </Section>
      )}

      <Section>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Grow><H2>Sites</H2></Grow>
          <ManageLink to="/repos">Manage</ManageLink>
        </div>
        <RowList>{repos.map((r) => <SiteEntry key={r.id} repo={r} />)}</RowList>
        {!repos.some((r) => r.provider === 'local') && (
          <div>{creating ? <Spinner size={14} /> : <Btn kind="ghost" small style={{ marginLeft: -10 }} onClick={() => void scratch()}>Start a scratchpad for notes</Btn>}</div>
        )}
      </Section>
    </Page>
  );
}
