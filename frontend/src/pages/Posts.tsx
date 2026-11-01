import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { styled } from 'styletron-react';
import { api, providerLabel, type Repo } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/icons';
import { ConflictBox, PublishSheet } from '../components/Publish';
import { Badge, Banner, Btn, Center, Field, Grow, H1, IconBtn, Input, Loading, Muted, Page, Path, QuietA, Row, Section, Sheet, Spinner } from '../components/ui';
import { editUrl } from '../lib/recents';
import { allPages, buildTree, defaultSection, formatDate, isFuture, sortPages, type Page as SitePage, type SectionNode } from '../lib/site';
import { repoStore, siteStore, useRepos, useSite } from '../lib/store';
import { relTime } from '../lib/time';
import { notifyError, notifyOk } from '../notify';
import { COARSE, HOVER, PHONE, tokens } from '../theme';

// A site reads like its own archive: sections across the top, newest writing
// first, drafts pinned above. Files that aren't part of the site stay folded away.

const Chips = styled('div', {
  display: 'flex',
  gap: '6px',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  margin: '0 -4px',
  padding: '2px 4px',
  '::-webkit-scrollbar': { display: 'none' },
  [PHONE]: { margin: '0 -16px', padding: '2px 16px' },
});

const Chip = styled<typeof Link, { $on: boolean }>(Link, ({ $on }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  height: '32px',
  padding: '0 12px',
  borderRadius: '16px',
  fontSize: '14px',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  fontWeight: $on ? 500 : 400,
  backgroundColor: $on ? tokens.fg : tokens.sunken,
  color: $on ? tokens.bg : tokens.fgSoft,
  [HOVER]: { ':hover': $on ? {} : { backgroundColor: tokens.active } },
  [COARSE]: { height: '38px', borderRadius: '19px' },
}));

const Count = styled('span', { opacity: 0.6, fontSize: '13px', fontVariantNumeric: 'tabular-nums' });

const YearHead = styled('div', {
  display: 'flex',
  alignItems: 'baseline',
  gap: '8px',
  fontSize: '13px',
  fontWeight: 600,
  color: tokens.fgMuted,
  padding: '20px 4px 6px',
  borderBottom: `1px solid ${tokens.rule}`,
});

const PostLink = styled(Link, {
  display: 'grid',
  gridTemplateColumns: '64px minmax(0, 1fr)',
  gap: '0 12px',
  alignItems: 'baseline',
  padding: '11px 4px',
  borderBottom: `1px solid ${tokens.rule}`,
  [HOVER]: { ':hover': { backgroundColor: tokens.hover } },
  ':active': { backgroundColor: tokens.active },
  [PHONE]: { gridTemplateColumns: 'minmax(0, 1fr)' },
});

const Day = styled('span', {
  fontSize: '13px',
  color: tokens.fgMuted,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  [PHONE]: { display: 'none' },
});

const PostTitle = styled('span', {
  fontFamily: tokens.serif,
  fontSize: '19px',
  lineHeight: 1.25,
  color: tokens.fg,
  overflowWrap: 'anywhere',
});

const Desc = styled('div', {
  fontSize: '14px',
  color: tokens.fgMuted,
  marginTop: '2px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  [PHONE]: { whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
});

const Badges = styled('span', { display: 'inline-flex', gap: '4px', marginLeft: '8px', verticalAlign: '2px', flexWrap: 'wrap' });

const FolderRow = styled(Link, {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '11px 4px',
  minHeight: '46px',
  borderBottom: `1px solid ${tokens.rule}`,
  fontSize: '15px',
  color: tokens.fgSoft,
  [HOVER]: { ':hover': { backgroundColor: tokens.hover } },
  ':active': { backgroundColor: tokens.active },
});

const Crumbs = styled('div', { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', fontSize: '14px', color: tokens.fgMuted });
const Crumb = styled(Link, { color: tokens.fgMuted, [HOVER]: { ':hover': { color: tokens.fg } } });

const PhoneOnly = styled('span', { display: 'none', [PHONE]: { display: 'inline' } });

const yearOf = (date: string | null) => date?.slice(0, 4) ?? '';
const dayLabel = (date: string | null) => (date ? formatDate(date, false) : '');

function PostRow({ repoId, page, changed, showDate, showSection }: {
  repoId: number;
  page: SitePage;
  changed: boolean;
  showDate: boolean;
  showSection?: string | null;
}) {
  const { post } = page;
  const future = !post.draft && isFuture(post.date);
  const day = showDate ? dayLabel(post.date) : post.modified ? relTime(post.modified) : '';
  return (
    <PostLink to={editUrl(repoId, post.path)} title={post.path}>
      <Day>{day}</Day>
      <div style={{ minWidth: 0 }}>
        <PostTitle>{page.title}</PostTitle>
        {(post.draft || future || changed || !post.valid_front_matter || !post.render) && (
          <Badges>
            {post.draft && <Badge $tone="accent">Draft</Badge>}
            {future && <Badge $tone="warning">Scheduled</Badge>}
            {!post.valid_front_matter && <Badge $tone="negative" title="Zola needs +++ front matter at the top of this file">No front matter</Badge>}
            {changed && <Badge title="Changed here, not yet published">Unpublished</Badge>}
          </Badges>
        )}
        {(post.description || showSection || day) && (
          <Desc>
            {day && <PhoneOnly>{day}{post.description || showSection ? ' · ' : ''}</PhoneOnly>}
            {showSection ? `${showSection}${post.description ? ' · ' : ''}` : ''}{post.description}
          </Desc>
        )}
      </div>
    </PostLink>
  );
}

function PostList({ repoId, pages, changed, sortBy, sectionOf }: {
  repoId: number;
  pages: SitePage[];
  changed: Set<string>;
  sortBy: string | null | undefined;
  sectionOf?: (p: SitePage) => string | null;
}) {
  const drafts = pages.filter((p) => p.post.draft);
  const live = sortPages(pages.filter((p) => !p.post.draft), sortBy);
  const dated = live.some((p) => p.post.date) && sortBy !== 'weight' && sortBy !== 'title';
  const row = (p: SitePage) => <PostRow key={p.post.path} repoId={repoId} page={p} changed={changed.has(p.post.path)} showDate={!!p.post.date} showSection={sectionOf?.(p)} />;
  const rows: React.ReactNode[] = [];
  let year = '';
  for (const p of live) {
    const y = yearOf(p.post.date);
    if (dated && y !== year && y) {
      year = y;
      rows.push(<YearHead key={`y${y}`}>{y}</YearHead>);
    }
    rows.push(row(p));
  }
  return (
    <>
      {drafts.length > 0 && (
        <div>
          <YearHead style={{ paddingTop: 4 }}>Drafts</YearHead>
          {sortPages(drafts, undefined).map(row)}
        </div>
      )}
      {live.length > 0 && <div style={!dated ? { borderTop: `1px solid ${tokens.rule}`, marginTop: drafts.length ? 18 : 0 } : undefined}>{rows}</div>}
    </>
  );
}

function ConnectSheet({ repo, onClose }: { repo: Repo; onClose(): void }) {
  const { me } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[\w.-]+\/[\w.-]+$/.test(name.trim());
  const connect = async () => {
    setBusy(true);
    try {
      await api.connect(repo.id, name.trim(), me?.provider);
      notifyOk(`Connected to ${name.trim()}`);
      await repoStore.reload();
      await siteStore.load(repo.id);
      onClose();
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Connect a repository" onClose={onClose} footer={
      <><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={busy} disabled={!valid} onClick={() => void connect()}>Connect</Btn></>
    }>
      <Muted>This scratchpad lives only on this server. Give it a home on {me ? providerLabel(me.provider) : 'your provider'} to publish it. The repository must be empty; your full history goes with it.</Muted>
      <Field>Repository
        <Input value={name} placeholder="owner/repo" autoCapitalize="none" spellCheck={false} autoFocus
          onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter' && valid) void connect(); }} />
      </Field>
    </Sheet>
  );
}

export function Posts() {
  const repoId = Number(useParams().repoId);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const repos = useRepos();
  const repo = repos?.find((r) => r.id === repoId);
  const state = useSite(repoId, repo);
  const { data, error, syncing, syncError, conflicts, syncedAt } = state;
  const tree = useMemo(() => state.tree ?? (data ? buildTree(data.posts, data.site) : null), [state.tree, data]);
  const [filter, setFilter] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showOther, setShowOther] = useState(false);

  const local = repo?.provider === 'local';
  const sectionDir = params.get('s');
  const current = tree && sectionDir !== null ? tree.byDir.get(sectionDir) : undefined;
  const node = current ?? tree?.root;

  const changed = useMemo(() => new Set(data?.status.changed.map((c) => c.path) ?? []), [data]);
  const ahead = data?.status.ahead ?? 0;
  const sectionUrl = useCallback((dir: string | null) => (dir === null ? `/repos/${repoId}` : `/repos/${repoId}?s=${encodeURIComponent(dir)}`), [repoId]);

  const shown = useMemo(() => {
    if (!tree || !node) return null;
    const f = filter.trim().toLowerCase();
    const pages = f || node === tree.root ? allPages(node) : node.pages;
    if (!f) return pages;
    return allPages(tree.root).filter((p) => p.title.toLowerCase().includes(f) || p.post.path.toLowerCase().includes(f) || (p.post.description ?? '').toLowerCase().includes(f));
  }, [tree, node, filter]);

  // Reopened from the sidebar: don't keep showing a filter from last time.
  useEffect(() => setFilter(''), [repoId, sectionDir]);

  if (error && !data) return <Page><Banner $tone="negative" style={{ borderRadius: 8 }}>{error}</Banner></Page>;
  if (!data || !tree || !node || !repo) return <Loading />;

  const site = data.site;
  const name = site.title || repo.full_name.split('/').pop();
  const topSections = tree.root.children;
  const sectionNameOf = (p: SitePage) => {
    if (node !== tree.root) return null;
    const n = tree.byDir.get(p.dir);
    return n && n !== tree.root ? n.name : null;
  };
  const newUrl = `/repos/${repoId}/edit?new=1&in=${encodeURIComponent((current && current !== tree.root ? current : defaultSection(tree)).dir)}`;
  const crumbs: SectionNode[] = [];
  if (current && current !== tree.root) {
    let dir = current.dir;
    while (dir.length > tree.contentDir.length) {
      const n = tree.byDir.get(dir);
      if (n) crumbs.unshift(n);
      dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    }
  }
  const sync = () => void siteStore.sync(repoId, repo, { force: true }).then(() => undefined);
  const domain = site.base_url?.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <Page>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row style={{ alignItems: 'flex-start', gap: 12 }}>
          <Grow><H1>{name}</H1></Grow>
          {!local && ahead > 0 && <Btn kind="primary" icon="upload" onClick={() => setPublishing(true)}>Publish<Count style={{ marginLeft: 2 }}>{data.status.changed.length}</Count></Btn>}
        </Row>
        <Row style={{ flexWrap: 'wrap', gap: '2px 10px', minHeight: 24 }}>
          {domain && !domain.startsWith('localhost') && (
            <QuietA href={site.base_url!} target="_blank" rel="noopener noreferrer">
              {domain}<Icon name="external" size={13} />
            </QuietA>
          )}
          {local ? (
            <>
              <Muted>Scratchpad on this server</Muted>
              <Btn kind="ghost" small onClick={() => setConnecting(true)} style={{ marginLeft: -6 }}>Connect a repository</Btn>
            </>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: tokens.fgMuted }}>
              {syncing ? <><Spinner size={12} />Checking {providerLabel(repo.provider)}…</>
                : syncError ? <span style={{ color: tokens.warning }} title={syncError}>Couldn't reach {providerLabel(repo.provider)}; showing your copy</span>
                : syncedAt ? <>Up to date with {providerLabel(repo.provider)}</> : repo.full_name}
              {!syncing && <IconBtn icon="sync" label={`Check ${providerLabel(repo.provider)} for changes`} onClick={sync} />}
            </span>
          )}
        </Row>
      </div>

      {conflicts.length > 0 && (
        <Banner $tone="warning" style={{ borderRadius: 8, display: 'block' }}><ConflictBox repo={repo} onDone={() => undefined} /></Banner>
      )}

      {topSections.length > 0 && !filter && (
        <Chips role="navigation" aria-label="Sections">
          <Chip to={sectionUrl(null)} $on={node === tree.root}>All<Count>{tree.root.total}</Count></Chip>
          {topSections.map((s) => {
            const on = !!current && (current === s || current.dir.startsWith(`${s.dir}/`));
            return <Chip key={s.dir} to={sectionUrl(s.dir)} $on={on} aria-current={on ? 'page' : undefined}>{s.name}<Count>{s.total}</Count></Chip>;
          })}
        </Chips>
      )}

      <Section style={{ gap: 12 }}>
        <Row style={{ gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            <Icon name="search" size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: tokens.fgFaint, pointerEvents: 'none' }} />
            <Input value={filter} placeholder={`Search ${tree.root.total} ${tree.root.total === 1 ? 'post' : 'posts'}`} aria-label="Search posts" style={{ paddingLeft: 32 }}
              onChange={(e) => setFilter(e.currentTarget.value)} />
          </div>
          {current && current !== tree.root && current.index && !filter && (
            <Link to={editUrl(repoId, current.index.path)} tabIndex={-1}><Btn kind="ghost" icon="sliders" title="Edit this section's _index.md">Section page</Btn></Link>
          )}
        </Row>

        {crumbs.length > 1 && !filter && (
          <Crumbs>
            {crumbs.map((c, i) => (
              <span key={c.dir} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <Icon name="forward" size={13} />}
                {i < crumbs.length - 1 ? <Crumb to={sectionUrl(c.dir)}>{c.name}</Crumb> : <span style={{ color: tokens.fg }}>{c.name}</span>}
              </span>
            ))}
          </Crumbs>
        )}

        {current && current !== tree.root && current.children.length > 0 && !filter && (
          <div style={{ borderTop: `1px solid ${tokens.rule}` }}>
            {current.children.map((c) => (
              <FolderRow key={c.dir} to={sectionUrl(c.dir)}>
                <Icon name="folder" size={18} style={{ color: tokens.fgMuted }} />
                <Grow>{c.name}</Grow>
                <Count>{c.total}</Count>
                <Icon name="forward" size={15} style={{ color: tokens.fgFaint }} />
              </FolderRow>
            ))}
          </div>
        )}

        {shown && shown.length > 0 ? (
          <PostList repoId={repoId} pages={shown} changed={changed} sectionOf={sectionNameOf}
            sortBy={filter || node === tree.root ? undefined : node.index?.sort_by} />
        ) : (
          <Center style={{ minHeight: 160 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Muted>{filter ? `Nothing matches “${filter}”` : 'No posts here yet'}</Muted>
              {!filter && <Btn kind="primary" icon="plus" onClick={() => navigate(newUrl)}>Write the first one</Btn>}
            </div>
          </Center>
        )}

        {tree.other.length > 0 && !filter && node === tree.root && (
          <div>
            <Btn kind="ghost" small style={{ marginLeft: -10 }} onClick={() => setShowOther(!showOther)}>
              <Icon name={showOther ? 'down' : 'forward'} size={14} />
              {tree.other.length} other {tree.other.length === 1 ? 'file' : 'files'} outside the site
            </Btn>
            {showOther && (
              <div style={{ borderTop: `1px solid ${tokens.rule}`, marginTop: 6 }}>
                {tree.other.map((p) => (
                  <FolderRow key={p.post.path} to={editUrl(repoId, p.post.path)} style={{ minHeight: 40 }}>
                    <Icon name="note" size={17} style={{ color: tokens.fgFaint }} /><Path style={{ fontSize: 13 }}>{p.post.path}</Path>
                  </FolderRow>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      {publishing && <PublishSheet repo={repo} onClose={() => setPublishing(false)} />}
      {connecting && <ConnectSheet repo={repo} onClose={() => setConnecting(false)} />}
    </Page>
  );
}
