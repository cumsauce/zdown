import { useCallback, useEffect, useState } from 'react';
import { Button, KIND, SIZE } from 'baseui/button';
import { Select, type Value } from 'baseui/select';
import { Spinner } from 'baseui/spinner';
import { api, providerLabel, ApiError, type AvailableRepo, type Repo } from '../api';
import { useAuth } from '../auth';
import { notifyError, notifyOk } from '../notify';
import { tokens } from '../theme';
import { Card, Chip, Full, Grid2, Hint, ListRow, MonoLink, Page, PageHeader, Row, TextInput } from '../components/ui';

function RepoRow({ repo, onRemoved }: { repo: Repo; onRemoved: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const local = repo.provider === 'local';
  const sync = async () => {
    setSyncing(true);
    try { await api.sync(repo.id); notifyOk(`synced ${repo.full_name}`); }
    catch (e) { notifyError(e); }
    finally { setSyncing(false); }
  };
  const remove = async () => {
    if (!window.confirm(`remove ${repo.full_name}?\nthe local mirror and unpublished edits are deleted.`)) return;
    try { await api.removeRepo(repo.id); onRemoved(); }
    catch (e) { notifyError(e); }
  };
  return (
    <ListRow>
      <MonoLink to={`/repos/${repo.id}`} style={{ flex: 1 }}>{repo.full_name}</MonoLink>
      <Chip>{providerLabel(repo.provider)}</Chip>
      {!local && (
        <Button size={SIZE.mini} kind={KIND.tertiary} isLoading={syncing} onClick={() => void sync()}>sync</Button>
      )}
      <Button size={SIZE.mini} kind={KIND.tertiary} onClick={() => void remove()}>remove</Button>
    </ListRow>
  );
}

export function Repos() {
  const { me } = useAuth();
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [available, setAvailable] = useState<AvailableRepo[] | null>(null);
  const [availErr, setAvailErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Value>([]);
  const [byName, setByName] = useState('');
  const [scratch, setScratch] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.repos().then(setRepos, notifyError);
  }, []);
  const loadAvailable = useCallback(() => {
    if (!me) return;
    api.available(me.provider).then(setAvailable, (e) => setAvailErr(e instanceof ApiError ? e.message : String(e)));
  }, [me]);
  useEffect(load, [load]);
  useEffect(loadAvailable, [loadAvailable]);

  const doImport = async (fullName: string) => {
    if (!me) return;
    setBusy(true);
    try {
      await api.importRepo(me.provider, fullName);
      notifyOk(`imported ${fullName}`);
      setPick([]); setByName('');
      load(); loadAvailable();
    } catch (e) { notifyError(e); }
    finally { setBusy(false); }
  };
  const doCreate = async () => {
    const name = scratch.trim();
    if (!/^[\w.-]+$/.test(name)) return;
    setBusy(true);
    try { await api.createScratch(name); setScratch(''); load(); }
    catch (e) { notifyError(e); }
    finally { setBusy(false); }
  };

  return (
    <Page>
      <PageHeader title="Repositories"
        meta={<Hint>{repos ? `${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}` : 'loading…'} · every save is a git commit</Hint>} />

      <Card title="Your repositories" flush>
        {repos === null ? (
          <div style={{ padding: 16 }}><Spinner $size="16px" /></div>
        ) : repos.length === 0 ? (
          <div style={{ padding: 16 }}><Hint>nothing here yet — start a scratchpad or import a site below</Hint></div>
        ) : (
          repos.map((r) => <RepoRow key={r.id} repo={r} onRemoved={load} />)
        )}
      </Card>

      <Grid2>
        <Card title="Start writing">
          <Hint>a local scratchpad — just markdown files, no repository required. connect it to {me ? providerLabel(me.provider) : 'a provider'} later to publish.</Hint>
          <Row>
            <Full>
              <TextInput value={scratch} placeholder="my-notes"
                onChange={(e) => setScratch(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void doCreate(); }} />
            </Full>
            <Button size={SIZE.mini} kind={KIND.secondary} disabled={!/^[\w.-]+$/.test(scratch.trim())}
              isLoading={busy} onClick={() => void doCreate()}>create</Button>
          </Row>
        </Card>

        <Card title={`Import from ${providerLabel(me?.provider ?? 'github')}`}>
          {available === null && !availErr ? (
            <Spinner $size="16px" />
          ) : availErr ? (
            <Hint style={{ color: tokens.warning }}>couldn't list repositories: {availErr}</Hint>
          ) : available && available.length > 0 ? (
            <Row>
              <Full>
                <Select size={SIZE.mini} options={available.map((a) => ({ id: a.full_name, label: `${a.full_name}${a.private ? ' · private' : ''}` }))}
                  value={pick} onChange={(p) => setPick(p.value)} placeholder="choose a repository" clearable={false} />
              </Full>
              <Button size={SIZE.mini} kind={KIND.secondary} disabled={pick.length === 0} isLoading={busy}
                onClick={() => void doImport(String(pick[0]?.id))}>import</Button>
            </Row>
          ) : (
            <Hint>no additional repositories found</Hint>
          )}
          <Row>
            <Full>
              <TextInput value={byName} placeholder="owner/repo"
                onChange={(e) => setByName(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && /^[\w.-]+\/[\w.-]+$/.test(byName.trim())) void doImport(byName.trim()); }} />
            </Full>
            <Button size={SIZE.mini} kind={KIND.secondary} disabled={!/^[\w.-]+\/[\w.-]+$/.test(byName.trim())}
              isLoading={busy} onClick={() => void doImport(byName.trim())}>import by name</Button>
          </Row>
        </Card>
      </Grid2>
    </Page>
  );
}
