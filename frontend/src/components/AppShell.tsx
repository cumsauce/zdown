import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { styled } from 'styletron-react';
import { useAuth } from '../auth';
import { editUrl, useRecents } from '../lib/recents';
import { repoStore, useRepos, useSite } from '../lib/store';
import { api, type Repo } from '../api';
import { notifyError } from '../notify';
import { DESKTOP, DRAWERLESS, HOVER, SIDEBAR_W, TABS_H, tokens } from '../theme';
import { Icon, type IconName } from './icons';
import { Grow, IconBtn, Sheet } from './ui';
import { UserMark } from './UserMark';

// Wide screens get a sidebar; everything narrower gets the same destinations as
// a tab bar in thumb reach, with no hidden drawer to discover. The editor takes
// the whole screen and has its own way back.

const COLLAPSED_KEY = 'zdown.navCollapsed';

const Side = styled('nav', {
  position: 'fixed',
  top: 0,
  bottom: 0,
  left: 0,
  width: `${SIDEBAR_W}px`,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: tokens.sunken,
  zIndex: 30,
  [DRAWERLESS]: { display: 'none' },
});

const SideHead = styled('div', {
  height: '52px',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  padding: '0 8px 0 16px',
});

const Brand = styled(Link, {
  fontFamily: tokens.serif,
  fontStyle: 'italic',
  fontWeight: 500,
  fontSize: '22px',
  letterSpacing: '-.01em',
  color: tokens.fg,
  flex: 1,
});

export const BrandDot = () => <span style={{ color: tokens.accent }}>.</span>;

const NewBtn = styled('button', {
  appearance: 'none',
  margin: '2px 12px 10px',
  height: '36px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  border: 'none',
  borderRadius: '8px',
  backgroundColor: tokens.fg,
  color: tokens.bg,
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  flexShrink: 0,
  [HOVER]: { ':hover': { backgroundColor: tokens.fgSoft } },
  ':active': { opacity: 0.8 },
});

const Scroll = styled('div', { flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: '12px' });

const Label = styled('div', {
  padding: '14px 18px 4px',
  fontSize: '12px',
  fontWeight: 600,
  color: tokens.fgFaint,
  display: 'flex',
  alignItems: 'center',
});

const itemStyle = ($active?: boolean) => ({
  margin: '0 8px',
  padding: '6px 10px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  minWidth: 0,
  fontSize: '14px',
  borderRadius: '7px',
  color: $active ? tokens.fg : tokens.fgSoft,
  backgroundColor: $active ? tokens.active : 'transparent',
  fontWeight: $active ? 500 : 400,
  [HOVER]: { ':hover': { backgroundColor: $active ? tokens.active : tokens.hover, color: tokens.fg } },
} as const);

const Item = styled<typeof Link, { $active?: boolean }>(Link, ({ $active }) => itemStyle($active));

const SubItem = styled<typeof Link, { $active?: boolean }>(Link, ({ $active }) => ({ ...itemStyle($active), padding: '4px 10px 4px 26px', fontSize: '13.5px' }));

const Ellipsis = styled('span', { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 });

const Num = styled('span', { fontSize: '12px', color: tokens.fgFaint, fontVariantNumeric: 'tabular-nums', flexShrink: 0 });

const Foot = styled(NavLink, {
  flexShrink: 0,
  minHeight: '52px',
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  fontSize: '14px',
  color: tokens.fgSoft,
  [HOVER]: { ':hover': { backgroundColor: tokens.hover, color: tokens.fg } },
});

const Main = styled('main', {
  minHeight: '100dvh',
  minWidth: 0,
  [DRAWERLESS]: { paddingBottom: `calc(${TABS_H}px + env(safe-area-inset-bottom))` },
});

const Tabs = styled('nav', {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 20,
  display: 'flex',
  backgroundColor: tokens.bg,
  borderTop: `1px solid ${tokens.rule}`,
  paddingBottom: 'env(safe-area-inset-bottom)',
  [DESKTOP]: { display: 'none' },
});

const tabStyle = ($on?: boolean) => ({
  flex: 1,
  height: `${TABS_H}px`,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '2px',
  border: 'none',
  background: 'none',
  fontSize: '11px',
  fontWeight: 500,
  color: $on ? tokens.fg : tokens.fgMuted,
  cursor: 'pointer',
  ':active': { opacity: 0.6 },
} as const);

const TabLink = styled<typeof Link, { $on?: boolean }>(Link, ({ $on }) => tabStyle($on));
const TabBtn = styled('button', tabStyle(false));

const Collapsed = styled('div', {
  position: 'fixed',
  top: '8px',
  left: '8px',
  zIndex: 25,
  display: 'flex',
  gap: '2px',
  [DRAWERLESS]: { display: 'none' },
});

const fileName = (path: string) => (path.split('/').pop() ?? path).replace(/\.(md|markdown)$/i, '');
const short = (full: string) => full.split('/').pop() ?? full;

const LAST_REPO = 'zdown.lastRepo';
const remember = (id: number) => { try { localStorage.setItem(LAST_REPO, String(id)); } catch { /* storage blocked */ } };
const lastRepo = () => { try { return Number(localStorage.getItem(LAST_REPO)) || null; } catch { return null; } };

function SiteNav({ repo, currentDir, active }: { repo: Repo; currentDir: string | null; active: boolean }) {
  const { data, tree } = useSite(repo.id);
  const name = data?.site.title || short(repo.full_name);
  const changes = data?.status.changed.length ?? 0;
  return (
    <>
      <Item to={`/repos/${repo.id}`} $active={active && currentDir === null}>
        <Icon name="folder" size={16} style={{ color: tokens.fgMuted }} />
        <Ellipsis>{name}</Ellipsis>
        {changes > 0 && repo.provider !== 'local' && <Num title={`${changes} unpublished`} style={{ color: tokens.accent }}>{changes}</Num>}
      </Item>
      {active && tree?.root.children.map((s) => (
        <SubItem key={s.dir} to={`/repos/${repo.id}?s=${encodeURIComponent(s.dir)}`} $active={currentDir === s.dir || !!currentDir?.startsWith(`${s.dir}/`)}>
          <Ellipsis>{s.name}</Ellipsis><Num>{s.total}</Num>
        </SubItem>
      ))}
    </>
  );
}

/** Choose a site, then a section. Skipped entirely when there's only one place to go. */
function NewPostSheet({ repos, onClose }: { repos: Repo[]; onClose(): void }) {
  const navigate = useNavigate();
  const go = (r: Repo) => { onClose(); remember(r.id); navigate(`/repos/${r.id}/edit?new=1`); };
  return (
    <Sheet title="New post in…" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', margin: '0 -8px' }}>
        {repos.map((r) => (
          <button key={r.id} type="button" onClick={() => go(r)} style={{
            appearance: 'none', border: 'none', background: 'none', padding: '12px 8px', textAlign: 'left', cursor: 'pointer',
            fontSize: 15, color: tokens.fg, display: 'flex', alignItems: 'center', gap: 10, borderRadius: 8,
          }}>
            <Icon name="folder" size={18} style={{ color: tokens.fgMuted }} />
            <span style={{ flex: 1 }}>{short(r.full_name)}</span>
            <span style={{ fontSize: 13, color: tokens.fgMuted }}>{r.provider === 'local' ? 'Scratchpad' : r.full_name}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function AppShell({ children, bare = false }: { children: React.ReactNode; bare?: boolean }) {
  const { me } = useAuth();
  const loc = useLocation();
  const navigate = useNavigate();
  const recent = useRecents();
  const repos = useRepos();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; } });
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1'); } catch { /* storage blocked */ }
      return !c;
    });
  }, []);

  const docked = wide && !collapsed;

  // The editor shell is position:fixed; it reads this to sit beside the sidebar.
  useEffect(() => {
    document.documentElement.style.setProperty('--nav-w', docked ? `${SIDEBAR_W}px` : '0px');
  }, [docked]);

  // ⌘\ / Ctrl+\ toggles the sidebar (Linear, VS Code).
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggle(); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [toggle]);

  const repoMatch = /^\/repos\/(\d+)/.exec(loc.pathname);
  const activeRepo = repoMatch ? Number(repoMatch[1]) : null;
  useEffect(() => { if (activeRepo) remember(activeRepo); }, [activeRepo]);

  const params = new URLSearchParams(loc.search);
  const currentDir = params.get('s');
  const current = loc.pathname.endsWith('/edit') ? `${loc.pathname}${loc.search}` : null;
  const known = useMemo(() => new Map((repos ?? []).map((r) => [r.id, r])), [repos]);
  const shownRecent = recent.filter((r) => repos === null || known.has(r.repoId)).slice(0, 5);

  const newPost = useCallback(async () => {
    if (!repos) return;
    if (repos.length === 0) {
      try {
        const r = await api.createScratch('notes');
        await repoStore.reload();
        navigate(`/repos/${r.id}/edit?new=1&in=`);
      } catch (e) { notifyError(e); }
      return;
    }
    // writing "into" the site you're looking at, or the only one there is
    const here = activeRepo && known.has(activeRepo) ? activeRepo : repos.length === 1 ? repos[0].id : null;
    if (here) navigate(`/repos/${here}/edit?new=1${currentDir ? `&in=${encodeURIComponent(currentDir)}` : ''}`);
    else setPicking(true);
  }, [repos, activeRepo, known, currentDir, navigate]);

  const siteTab = activeRepo ?? (lastRepo() && known.has(lastRepo()!) ? lastRepo() : repos?.[0]?.id ?? null);

  return (
    <>
      {collapsed && !bare && (
        <Collapsed>
          <IconBtn icon="sidebar" label="Show sidebar (⌘\)" onClick={toggle} />
          <IconBtn icon="plus" label="New post" onClick={() => void newPost()} />
        </Collapsed>
      )}
      {!collapsed && (
        <Side aria-label="Sidebar">
          <SideHead>
            <Brand to="/">zdown<BrandDot /></Brand>
            <IconBtn icon="sidebar" label="Hide sidebar (⌘\)" onClick={toggle} />
          </SideHead>
          <NewBtn type="button" onClick={() => void newPost()}><Icon name="plus" size={17} />New post</NewBtn>
          <Scroll>
            <Item to="/" $active={loc.pathname === '/'}><Icon name="home" size={16} style={{ color: tokens.fgMuted }} /><Ellipsis>Home</Ellipsis></Item>
            {shownRecent.length > 0 && <Label>Recent</Label>}
            {shownRecent.map((r) => {
              const to = editUrl(r.repoId, r.path);
              return (
                <Item key={`${r.repoId}:${r.path}`} to={to} $active={to === current} title={r.path}>
                  <Ellipsis>{r.title || fileName(r.path)}</Ellipsis>
                </Item>
              );
            })}
            <Label>
              <Grow>Sites</Grow>
              <Link to="/repos" aria-label="Manage sites" title="Add or manage sites" style={{ color: tokens.fgMuted, display: 'grid' }}><Icon name="plus" size={15} /></Link>
            </Label>
            {repos?.map((r) => <SiteNav key={r.id} repo={r} active={activeRepo === r.id} currentDir={activeRepo === r.id ? currentDir : null} />)}
          </Scroll>
          {me && (
            <Foot to="/settings">
              <UserMark login={me.login} url={me.avatar_url} size={24} />
              <Ellipsis>{me.name || me.login}</Ellipsis>
            </Foot>
          )}
        </Side>
      )}
      <Main style={{ marginLeft: docked ? SIDEBAR_W : 0 }}>{children}</Main>
      {!bare && me && (
        <Tabs aria-label="Primary">
          <TabLink to="/" $on={loc.pathname === '/'}><TabIcon name="home" />Home</TabLink>
          {siteTab ? (
            <TabLink to={`/repos/${siteTab}`} $on={loc.pathname.startsWith('/repos/')}><TabIcon name="folder" />Site</TabLink>
          ) : (
            <TabLink to="/repos" $on={loc.pathname === '/repos'}><TabIcon name="folder" />Sites</TabLink>
          )}
          <TabBtn type="button" aria-label="New post" onClick={() => void newPost()}><TabIcon name="plus" />New</TabBtn>
          <TabLink to="/settings" $on={loc.pathname === '/settings'}><TabIcon name="user" />You</TabLink>
        </Tabs>
      )}
      {picking && repos && <NewPostSheet repos={repos} onClose={() => setPicking(false)} />}
    </>
  );
}

function TabIcon({ name }: { name: IconName }) {
  return <Icon name={name} size={22} />;
}
