import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { styled } from 'baseui';
import { Button, KIND, SIZE } from 'baseui/button';
import { Spinner } from 'baseui/spinner';
import { api, providerLabel, type PostSummary, type Repo } from '../api';
import { useAuth } from '../auth';
import { notifyError, notifyOk } from '../notify';
import { tokens } from '../theme';
import { editUrl } from '../lib/recents';
import { Card, Chevron, Chip, ErrorText, Full, HideMobile, Hint, ListRow, MonoText, TextBtn, OnlyMobile, Page, PageHeader, Row, TextInput } from '../components/ui';

const PostLink = styled(Link, {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flex: 1,
  minWidth: 0,
  padding: '12px 16px',
  '@media (max-width: 639px)': { padding: '12px' },
});

// Zola layout: a folder with `_index.md` is a *section* (that file is the
// section's own page); a folder with `index.md` is a *page bundle* — one post
// whose media sits beside it. Everything else is a plain post file.
interface Entry { post: PostSummary; name: string; bundle: boolean }
interface Group { dir: string; depth: number; section: PostSummary | null; entries: Entry[] }

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function groupPosts(posts: PostSummary[]): Group[] {
  const groups = new Map<string, Group>();
  const group = (dir: string) => {
    let g = groups.get(dir);
    if (!g) groups.set(dir, (g = { dir, depth: dir ? dir.split('/').length : 0, section: null, entries: [] }));
    return g;
  };
  for (const post of posts) {
    const dir = dirOf(post.path);
    const base = baseOf(post.path);
    if (base === '_index.md') { group(dir).section = post; continue; }
    if (base === 'index.md' && dir) {
      // a bundle is listed in its parent folder, named after its own folder
      group(dirOf(dir)).entries.push({ post, name: baseOf(dir), bundle: true });
      continue;
    }
    group(dir).entries.push({ post, name: base.replace(/\.(md|markdown)$/i, ''), bundle: false });
  }
  return [...groups.values()]
    .filter((g) => g.section || g.entries.length)
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

const usesBundles = (g: Group) => g.entries.length > 0 && g.entries.filter((e) => e.bundle).length > g.entries.length / 2;

const GroupHead = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '16px 16px 6px',
  borderBottom: `1px solid ${tokens.rowRule}`,
});

const Warn = styled('span', {
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.warning,
  border: `1px solid ${tokens.warning}`,
  padding: '0 4px',
  flexShrink: 0,
});

function PostRow({ repoId, entry, indent }: { repoId: number; entry: Entry; indent: number }) {
  const navigate = useNavigate();
  const { post } = entry;
  return (
    <ListRow style={{ padding: 0 }}>
      <PostLink to={editUrl(repoId, post.path)} style={{ paddingLeft: 16 + indent }} title={post.path}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: tokens.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.title ?? <span style={{ color: tokens.fgMuted, fontWeight: 400 }}>{entry.name}</span>}
          </span>
          <MonoText style={{ fontSize: 11, color: tokens.fgMuted }}>
            {entry.bundle ? `${entry.name}/ · post folder` : baseOf(post.path)}
          </MonoText>
        </div>
        {!post.valid_front_matter && (
          <Warn title="no valid +++ TOML front matter at the top of this file, so Zola may skip or fail on it — open it and use ⚙ post settings to add a title">
            no front matter
          </Warn>
        )}
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

function PostGroups({ repoId, posts, onNew }: { repoId: number; posts: PostSummary[]; onNew: (path: string) => void }) {
  const navigate = useNavigate();
  const groups = groupPosts(posts);
  const minDepth = Math.min(99, ...groups.filter((g) => g.dir).map((g) => g.depth));
  return (
    <>
      {groups.map((g) => {
        const indent = g.dir ? (g.depth - minDepth) * 16 : 0;
        return (
          <div key={g.dir}>
            {(g.dir || g.section) && (
              <GroupHead style={{ paddingLeft: 16 + indent }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: tokens.fgSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {g.section?.title ?? (baseOf(g.dir) || 'site root')}
                </span>
                <Hint style={{ whiteSpace: 'nowrap' }}>{g.dir ? `${g.dir}/` : '/'}</Hint>
                <Full />
                {g.section && (
                  <TextBtn style={{ flexShrink: 0 }} onClick={() => navigate(editUrl(repoId, g.section!.path))}
                    title="edit this section's _index.md (its title, sorting, intro text)">section page</TextBtn>
                )}
                <TextBtn style={{ flexShrink: 0 }} title="new post in this folder"
                  onClick={() => onNew(`${g.dir ? g.dir + '/' : ''}${usesBundles(g) ? 'my-post/index.md' : 'my-post.md'}`)}>+ new</TextBtn>
              </GroupHead>
            )}
            {g.entries.map((e) => <PostRow key={e.post.path} repoId={repoId} entry={e} indent={indent} />)}
          </div>
        );
      })}
    </>
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
            <TextInput id="new-post" value={newPath} placeholder="new post path, e.g. content/blog/my-post.md"
              onChange={(e) => setNewPath(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') newPost(); }} />
          </Full>
          <Button size={SIZE.mini} kind={KIND.secondary} disabled={!newPath.trim()} onClick={newPost}>new post</Button>
        </Row>
        {posts === null ? (
          <div style={{ padding: 16 }}><Spinner $size="16px" /></div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 16 }}><Hint>no posts{filter ? ' match' : ' yet — create one above'}</Hint></div>
        ) : (
          <PostGroups repoId={repoId} posts={shown} onNew={(p) => { setNewPath(p); const el = document.getElementById('new-post') as HTMLInputElement | null; el?.focus(); el?.select(); }} />
        )}
      </Card>
    </Page>
  );
}
