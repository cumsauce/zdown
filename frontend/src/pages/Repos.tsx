import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { styled } from 'styletron-react';
import { api, providerLabel, ApiError, type AvailableRepo, type Repo } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/icons';
import { Badge, Btn, confirmDialog, Field, Grow, H1, H2, IconBtn, Input, Loading, Muted, Page, Row, RowList, Section, Spinner } from '../components/ui';
import { recents } from '../lib/recents';
import { repoStore, siteStore, useRepos } from '../lib/store';
import { notifyError, notifyOk } from '../notify';
import { COARSE, HOVER, tokens } from '../theme';

const SiteRow = styled('div', { display: 'flex', alignItems: 'center', gap: '10px', borderBottom: `1px solid ${tokens.rule}`, minWidth: 0 });
const SiteLink = styled(Link, {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 4px',
  fontSize: '15px',
  color: tokens.fg,
  overflowWrap: 'anywhere',
  [HOVER]: { ':hover': { color: tokens.accent } },
});
const Pick = styled('button', {
  appearance: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  padding: '10px 4px',
  minHeight: '44px',
  border: 'none',
  borderBottom: `1px solid ${tokens.rule}`,
  background: 'none',
  textAlign: 'left',
  fontSize: '15px',
  color: tokens.fgSoft,
  cursor: 'pointer',
  [HOVER]: { ':hover': { backgroundColor: tokens.hover } },
  ':disabled': { cursor: 'default', opacity: 0.6 },
  [COARSE]: { minHeight: '52px' },
});

function RepoRow({ repo }: { repo: Repo }) {
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Remove ${repo.full_name}?`,
      body: 'The copy on this server is deleted, including anything you haven\'t published. The repository itself isn\'t touched.',
      action: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeRepo(repo.id);
      recents.dropRepo(repo.id);
      siteStore.drop(repo.id);
      await repoStore.reload();
    } catch (e) { notifyError(e); }
  };
  return (
    <SiteRow>
      <SiteLink to={`/repos/${repo.id}`}>{repo.full_name}{repo.provider === 'local' && <Badge>Scratchpad</Badge>}</SiteLink>
      <IconBtn icon="trash" label={`Remove ${repo.full_name}`} onClick={() => void remove()} />
    </SiteRow>
  );
}

export function Repos() {
  const { me } = useAuth();
  const repos = useRepos();
  const [available, setAvailable] = useState<AvailableRepo[] | null>(null);
  const [availErr, setAvailErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [scratch, setScratch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadAvailable = useCallback(() => {
    if (!me) return;
    api.available(me.provider).then(setAvailable, (e) => setAvailErr(e instanceof ApiError ? e.message : String(e)));
  }, [me]);
  useEffect(loadAvailable, [loadAvailable]);

  const matches = useMemo(() => {
    const f = q.trim().toLowerCase();
    return (available ?? []).filter((a) => !f || a.full_name.toLowerCase().includes(f)).slice(0, 30);
  }, [available, q]);
  const typedName = /^[\w.-]+\/[\w.-]+$/.test(q.trim()) && !matches.some((m) => m.full_name === q.trim()) ? q.trim() : null;

  const doImport = async (fullName: string) => {
    if (!me) return;
    setBusy(fullName);
    try {
      await api.importRepo(me.provider, fullName);
      notifyOk(`Imported ${fullName}`);
      setQ('');
      await repoStore.reload();
      loadAvailable();
    } catch (e) { notifyError(e); }
    finally { setBusy(null); }
  };
  const doCreate = async () => {
    const name = scratch.trim();
    if (!/^[\w.-]+$/.test(name)) return;
    setBusy('scratch');
    try { await api.createScratch(name); setScratch(''); await repoStore.reload(); }
    catch (e) { notifyError(e); }
    finally { setBusy(null); }
  };

  if (repos === null) return <Loading />;

  return (
    <Page>
      <H1>Sites</H1>
      {repos.length > 0 && <RowList>{repos.map((r) => <RepoRow key={r.id} repo={r} />)}</RowList>}

      <Section>
        <H2>Import from {providerLabel(me?.provider ?? 'github')}</H2>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: tokens.fgFaint, pointerEvents: 'none' }} />
          <Input value={q} placeholder="Search your repositories, or type owner/repo" aria-label="Find a repository" autoCapitalize="none" spellCheck={false} style={{ paddingLeft: 32 }}
            onChange={(e) => setQ(e.currentTarget.value)} />
        </div>
        {available === null && !availErr && <Spinner size={16} />}
        {availErr && !typedName && <Muted style={{ color: tokens.warning }}>Couldn't list repositories: {availErr}. You can still type owner/repo.</Muted>}
        {(matches.length > 0 || typedName) && (
          <div>
            {typedName && (
              <Pick disabled={!!busy} onClick={() => void doImport(typedName)}>
                <Icon name="plus" size={18} style={{ color: tokens.fgMuted }} /><Grow>{typedName}</Grow>
                {busy === typedName && <Spinner size={14} />}
              </Pick>
            )}
            {matches.map((a) => (
              <Pick key={a.full_name} disabled={!!busy} onClick={() => void doImport(a.full_name)}>
                <Icon name="plus" size={18} style={{ color: tokens.fgMuted }} />
                <Grow style={{ overflowWrap: 'anywhere' }}>{a.full_name}</Grow>
                {a.private && <Badge>Private</Badge>}
                {busy === a.full_name && <Spinner size={14} />}
              </Pick>
            ))}
          </div>
        )}
      </Section>

      <Section>
        <H2>New scratchpad</H2>
        <Muted>Markdown files on this server, no repository needed. Connect one later to publish.</Muted>
        <Field>
          <Row>
            <Grow><Input value={scratch} placeholder="my-notes" aria-label="Scratchpad name" autoCapitalize="none" spellCheck={false}
              onChange={(e) => setScratch(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doCreate(); }} /></Grow>
            <Btn disabled={!/^[\w.-]+$/.test(scratch.trim())} loading={busy === 'scratch'} onClick={() => void doCreate()}>Create</Btn>
          </Row>
        </Field>
      </Section>
    </Page>
  );
}
