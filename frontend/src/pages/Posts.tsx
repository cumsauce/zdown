import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { styled } from 'baseui';
import { Button, KIND, SIZE } from 'baseui/button';
import { Spinner } from 'baseui/spinner';
import { api, providerLabel, type PostSummary, type Repo } from '../api';
import { useAuth } from '../auth';
import { notifyError, notifyOk } from '../notify';
import { tokens } from '../theme';
import { Card, Chevron, Chip, ErrorText, Full, HideMobile, Hint, ListRow, MonoText, OnlyMobile, Page, PageHeader, Row, TextInput } from '../components/ui';

const PostLink = styled(Link, {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flex: 1,
  minWidth: 0,
  padding: '12px 16px',
  '@media (max-width: 639px)': { padding: '12px' },
});

const Dot = styled<'span', { $ok: boolean }>('span', ({ $ok }) => ({
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  flexShrink: 0,
  backgroundColor: $ok ? tokens.borderStrong : tokens.warning,
}));

function PostRow({ repoId, post }: { repoId: number; post: PostSummary }) {
  const navigate = useNavigate();
  const shortcodes = post.shortcodes.filter((s) => s !== 'end' && s !== 'else');
  return (
    <ListRow style={{ padding: 0 }}>
      <PostLink to={`/repos/${repoId}/edit?path=${encodeURIComponent(post.path)}`}>
        <Dot $ok={post.valid_front_matter} title={post.valid_front_matter ? 'front matter ok' : 'no valid +++ front matter'} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: post.valid_front_matter ? tokens.fg : tokens.warning }}>
            {post.title ?? <span style={{ color: tokens.fgFaint, fontWeight: 400 }}>(untitled)</span>}
          </span>
          <MonoText style={{ fontSize: 11, color: tokens.fgMuted }}>{post.path}</MonoText>
          {shortcodes.length > 0 && <Row style={{ gap: 4, marginTop: 4 }}>{shortcodes.map((s) => <Chip key={s}>{s}</Chip>)}</Row>}
        </div>
        <OnlyMobile><Chevron>›</Chevron></OnlyMobile>
      </PostLink>
      <HideMobile>
        <div style={{ paddingRight: 12 }}>
          <Button size={SIZE.mini} kind={KIND.tertiary}
            onClick={() => navigate(`/repos/${repoId}/versions?path=${encodeURIComponent(post.path)}`)}>history</Button>
        </div>
      </HideMobile>
    </ListRow>
  );
}

function ConnectPanel({ repo, onConnected }: { repo: Repo; onConnected: () => void }) {
  const { me } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[\w.-]+\/[\w.-]+$/.test(name.trim());
  const connect = async () => {
    const full = name.trim();
    if (!valid) return;
    if (!window.confirm(`connect ${repo.full_name} to ${me?.provider ?? 'provider'}:${full}?\nthe remote must be empty; your full history is pushed there.`)) return;
    setBusy(true);
    try { await api.connect(repo.id, full, me?.provider); notifyOk(`connected to ${full}`); onConnected(); }
    catch (e) { notifyError(e); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Connect to a repository">
      <div>
        <Hint>this scratchpad is local-only. give it a home on {me ? providerLabel(me.provider) : 'your provider'} to enable sync + publish — your history gets pushed there.</Hint>
      </div>
      <Row>
        <Full>
          <TextInput value={name} placeholder="owner/repo" onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }} />
        </Full>
        <Button size={SIZE.mini} kind={KIND.secondary} disabled={!valid} isLoading={busy} onClick={() => void connect()}>connect</Button>
      </Row>
    </Card>
  );
}

export function Posts() {
  const repoId = Number(useParams().repoId);
  const navigate = useNavigate();
  const [repo, setRepo] = useState<Repo | null>(null);
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [newPath, setNewPath] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    try {
      const repos = await api.repos();
      const r = repos.find((x) => x.id === repoId) ?? null;
      setRepo(r);
      if (!r) { setError('repository not found'); return; }
      const r2 = await api.posts(repoId);
      setPosts(r2.posts);
      setSyncError(r2.syncError);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [repoId]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = (posts ?? []).slice().sort((a, b) => a.path.localeCompare(b.path));
    return f ? list.filter((p) => p.path.toLowerCase().includes(f) || (p.title ?? '').toLowerCase().includes(f)) : list;
  }, [posts, filter]);

  const local = repo?.provider === 'local';
  const sync = async () => {
    setSyncing(true);
    try { await api.sync(repoId); await load(); notifyOk('synced'); }
    catch (e) { notifyError(e); }
    finally { setSyncing(false); }
  };
  const publish = async () => {
    setPublishing(true);
    try { const r = await api.publish(repoId); notifyOk(`published ${r.pushed.slice(0, 7)}`); }
    catch (e) { notifyError(e); }
    finally { setPublishing(false); }
  };
  const newPost = () => {
    let p = newPath.trim().replace(/^\/+/, '');
    if (!p) return;
    if (!/\.md$/i.test(p)) p += '.md';
    navigate(`/repos/${repoId}/edit?path=${encodeURIComponent(p)}&new=1`);
  };

  if (error && !posts) return <Page><ErrorText>{error}</ErrorText></Page>;

  const short = repo?.full_name.split('/').pop() ?? '…';
  return (
    <Page>
      <PageHeader
        back={{ to: '/repos', label: 'repositories' }}
        title={short}
        meta={repo && <><MonoText style={{ fontSize: 11, color: tokens.fgMuted }}>{repo.full_name}</MonoText><Chip>{providerLabel(repo.provider)}</Chip></>}
        actions={repo && !local && (
          <>
            <Button size={SIZE.mini} kind={KIND.tertiary} isLoading={syncing} onClick={() => void sync()}>sync</Button>
            <Button size={SIZE.mini} kind={KIND.primary} isLoading={publishing} onClick={() => void publish()}>publish</Button>
          </>
        )}
      />

      {syncError && (
        <Hint style={{ color: tokens.warning }}>couldn't reach {repo ? providerLabel(repo.provider) : 'the remote'} — showing your local copy. ({syncError})</Hint>
      )}
      {repo && local && <ConnectPanel repo={repo} onConnected={() => void load()} />}

      <Card flush title={<>Posts {posts && <Hint style={{ fontWeight: 400, marginLeft: 4 }}>{posts.length}</Hint>}</>}
        aside={<><Full /><div style={{ width: 200, maxWidth: '100%', flex: '0 1 200px' }}>
          <TextInput value={filter} placeholder="filter" onChange={(e) => setFilter(e.currentTarget.value)} clearable />
        </div></>}>
        <Row style={{ padding: '12px 16px', borderBottom: `1px solid ${tokens.border}`, backgroundColor: tokens.hover, flexWrap: 'nowrap' }}>
          <Full>
            <TextInput value={newPath} placeholder="content/blog/my-new-post.md"
              onChange={(e) => setNewPath(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') newPost(); }} />
          </Full>
          <Button size={SIZE.mini} kind={KIND.secondary} disabled={!newPath.trim()} onClick={newPost}>new post</Button>
        </Row>
        {posts === null ? (
          <div style={{ padding: 16 }}><Spinner $size="16px" /></div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 16 }}><Hint>no posts{filter ? ' match' : ' yet — create one above'}</Hint></div>
        ) : (
          shown.map((p) => <PostRow key={p.path} repoId={repoId} post={p} />)
        )}
      </Card>
    </Page>
  );
}
