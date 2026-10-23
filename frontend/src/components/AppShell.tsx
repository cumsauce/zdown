import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { styled } from 'baseui';
import { api, type Repo } from '../api';
import { useAuth } from '../auth';
import { editUrl, useRecents } from '../lib/recents';
import { notifyError } from '../notify';
import { tokens } from '../theme';
import { UserMark } from './UserMark';
import { COARSE } from './ui';

// One layout at every size (ChatGPT/Claude/Linear pattern): a sidebar with
// "new", recent files and projects; content on the right. Below DRAWER the
// same sidebar slides over the content instead of sitting beside it — its
// contents never change between sizes.
export const NAV_W = 260;
const DRAWER_Q = '(max-width: 899px)';
const PHONE_Q = '(max-width: 639px)';
export const BOTTOM_BAR_H = 56;
const COLLAPSED_KEY = 'zdown.navCollapsed';

interface ShellCtx {
  /** sidebar not visible — pages show a ☰ button */
  navHidden: boolean;
  openNav: () => void;
  repos: Repo[] | null;
  reloadRepos: () => void;
}
const Ctx = createContext<ShellCtx>({ navHidden: false, openNav: () => {}, repos: null, reloadRepos: () => {} });
export const useShell = () => useContext(Ctx);

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

const Side = styled<'nav', { $drawer: boolean; $open: boolean }>('nav', ({ $drawer, $open }) => ({
  position: 'fixed',
  top: 0,
  bottom: 0,
  left: 0,
  width: `${NAV_W}px`,
  maxWidth: '85vw',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: tokens.bg,
  borderRight: `1px solid ${tokens.border}`,
  zIndex: 30,
  transform: $open ? 'none' : `translateX(-100%)`,
  transition: $drawer ? 'transform 160ms ease-out' : 'none',
  visibility: $open ? 'visible' : 'hidden',
}));

const Scrim = styled('div', {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.6)',
  zIndex: 29,
});

const SideHead = styled('div', {
  height: '48px',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '0 8px 0 16px',
});

const Brand = styled(Link, {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontWeight: 600,
  fontSize: '13px',
  color: tokens.fg,
  flex: 1,
  [COARSE]: { minHeight: '40px' },
});

const Mark = styled('span', { width: '10px', height: '10px', backgroundColor: tokens.accent, flexShrink: 0 });

export const IconBtn = styled('button', {
  width: '32px',
  height: '32px',
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  border: 'none',
  background: 'none',
  color: tokens.fgMuted,
  fontSize: '15px',
  cursor: 'pointer',
  ':hover': { color: tokens.fg, backgroundColor: tokens.hover },
  ':focus-visible': { outline: `1px solid ${tokens.accent}` },
  [COARSE]: { width: '40px', height: '40px' },
});

const NewBtn = styled(Link, {
  margin: '4px 8px 8px',
  height: '36px',
  padding: '0 12px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  border: `1px solid ${tokens.border}`,
  fontSize: '13px',
  color: tokens.fg,
  ':hover': { backgroundColor: tokens.hover, borderColor: tokens.borderStrong },
  [COARSE]: { height: '44px' },
});

const Scroll = styled('div', { flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: '8px' });

const Section = styled('div', {
  padding: '16px 16px 4px',
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.fgFaint,
  display: 'flex',
  alignItems: 'center',
});

const Item = styled<typeof Link, { $active?: boolean }>(Link, ({ $active }) => ({
  margin: '0 8px',
  padding: '7px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '1px',
  minWidth: 0,
  color: tokens.fgSoft,
  ':hover': { backgroundColor: $active ? tokens.active : tokens.hover, color: tokens.fg },
  ...($active ? { backgroundColor: tokens.active, color: tokens.fg } : {}),
  [COARSE]: { padding: '10px 8px' },
}));

const ItemTitle = styled('span', {
  fontSize: '13px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const ItemMeta = styled('span', {
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.fgMuted,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const SectionLink = styled(Link, {
  marginLeft: 'auto',
  [COARSE]: { padding: '14px 0 14px 16px', margin: '-14px 0 -14px auto' },
  color: tokens.fgMuted,
  ':hover': { color: tokens.fg },
});

const Foot = styled(NavLink, {
  flexShrink: 0,
  minHeight: '52px',
  paddingBottom: 'env(safe-area-inset-bottom)',
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  borderTop: `1px solid ${tokens.border}`,
  fontSize: '13px',
  color: tokens.fgSoft,
  ':hover': { backgroundColor: tokens.hover, color: tokens.fg },
  '&.active': { color: tokens.fg },
});

const Main = styled('main', { minHeight: '100vh', minWidth: 0 });

// Phones: primary navigation sits at the bottom, in thumb reach (iOS tab bar
// pattern) — browse (opens the sidebar), new file, account.
const BottomBar = styled('nav', {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 20,
  display: 'flex',
  backgroundColor: tokens.bg,
  borderTop: `1px solid ${tokens.border}`,
  paddingBottom: 'env(safe-area-inset-bottom)',
});

const Tab = styled<'button', { $on?: boolean }>('button', ({ $on }) => ({
  flex: 1,
  height: `${BOTTOM_BAR_H}px`,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '3px',
  border: 'none',
  background: 'none',
  fontFamily: tokens.sans,
  fontSize: '11px',
  color: $on ? tokens.fg : tokens.fgMuted,
  cursor: 'pointer',
}));

const TabIcon = styled('span', { fontSize: '18px', lineHeight: 1, height: '20px', display: 'grid', placeItems: 'center' });

/** Slim header for pages when the sidebar is hidden (drawer mode / collapsed). */
const PageBar = styled('div', {
  height: '48px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '0 8px',
  position: 'sticky',
  top: 0,
  zIndex: 10,
  backgroundColor: tokens.bg,
  borderBottom: `1px solid ${tokens.border}`,
});

const short = (full: string) => full.split('/').pop() ?? full;
const fileName = (path: string) => (path.split('/').pop() ?? path).replace(/\.(md|markdown)$/i, '');

export function NavButton() {
  const { navHidden, openNav } = useShell();
  if (!navHidden) return null;
  return <IconBtn aria-label="open sidebar" onClick={openNav}>☰</IconBtn>;
}

export function AppShell({ children, bare = false }: { children: React.ReactNode; bare?: boolean }) {
  const { me } = useAuth();
  const drawer = useMedia(DRAWER_Q);
  const phone = useMedia(PHONE_Q);
  // hide the bottom bar while typing (it would ride the keyboard on Android)
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.matches('input, textarea') || t.isContentEditable);
    const on = (e: FocusEvent) => setTyping(isField(e.target));
    const off = () => setTyping(false);
    document.addEventListener('focusin', on);
    document.addEventListener('focusout', off);
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', off); };
  }, []);
  const loc = useLocation();
  const navigate = useNavigate();
  const recent = useRecents();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; } });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [repos, setRepos] = useState<Repo[] | null>(null);

  const reloadRepos = useCallback(() => { api.repos().then(setRepos, notifyError); }, []);
  useEffect(reloadRepos, [reloadRepos]);
  useEffect(() => setDrawerOpen(false), [loc.pathname, loc.search]);

  const open = drawer ? drawerOpen : !collapsed;
  const navHidden = !open || drawer;
  const docked = !drawer && open;

  // The editor shell is position:fixed; it reads this to sit beside the sidebar.
  useEffect(() => {
    document.documentElement.style.setProperty('--nav-w', docked ? `${NAV_W}px` : '0px');
  }, [docked]);

  const setCollapsedPersist = (c: boolean) => {
    setCollapsed(c);
    try { localStorage.setItem(COLLAPSED_KEY, c ? '1' : '0'); } catch { /* ignore */ }
  };
  const openNav = useCallback(() => (drawer ? setDrawerOpen(true) : setCollapsedPersist(false)), [drawer]);
  const closeNav = () => (drawer ? setDrawerOpen(false) : setCollapsedPersist(true));

  // ⌘\ / Ctrl+\ toggles the sidebar (Linear, VS Code).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); open ? closeNav() : openNav(); }
      if (e.key === 'Escape' && drawer && drawerOpen) setDrawerOpen(false);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const repoName = useMemo(() => new Map((repos ?? []).map((r) => [r.id, short(r.full_name)])), [repos]);
  const shownRecent = recent.filter((r) => repos === null || repoName.has(r.repoId)).slice(0, 15);
  const current = loc.pathname.endsWith('/edit') ? `${loc.pathname}${loc.search}` : null;

  const ctx = useMemo(() => ({ navHidden, openNav, repos, reloadRepos }), [navHidden, openNav, repos, reloadRepos]);

  return (
    <Ctx.Provider value={ctx}>
      {drawer && drawerOpen && <Scrim onClick={() => setDrawerOpen(false)} />}
      <Side $drawer={drawer} $open={open} aria-label="sidebar" aria-hidden={!open}>
        <SideHead>
          <Brand to="/"><Mark />zdown</Brand>
          <IconBtn aria-label="close sidebar" title="close sidebar (⌘\)" onClick={closeNav}>{drawer ? '✕' : '«'}</IconBtn>
        </SideHead>
        <NewBtn to="/" onClick={(e) => { if (loc.pathname === '/') { e.preventDefault(); navigate('/', { state: { fresh: Date.now() } }); } }}>
          <span style={{ color: tokens.accent }}>+</span> New file
        </NewBtn>
        <Scroll>
          <Section>recent</Section>
          {shownRecent.length === 0 && <Section style={{ paddingTop: 4, color: tokens.fgMuted }}>files you open show up here</Section>}
          {shownRecent.map((r) => {
            const to = editUrl(r.repoId, r.path);
            return (
              <Item key={`${r.repoId}:${r.path}`} to={to} $active={to === current} title={r.path}>
                <ItemTitle>{r.title || fileName(r.path)}</ItemTitle>
                <ItemMeta>{repoName.get(r.repoId) ?? '…'}</ItemMeta>
              </Item>
            );
          })}
          <Section>projects<SectionLink to="/repos" aria-label="add project" title="add or import a project">+ add</SectionLink></Section>
          {repos?.map((r) => (
            <Item key={r.id} to={`/repos/${r.id}`} $active={loc.pathname === `/repos/${r.id}`}>
              <ItemTitle>{short(r.full_name)}</ItemTitle>
              <ItemMeta>{r.provider === 'local' ? 'local' : r.full_name}</ItemMeta>
            </Item>
          ))}
        </Scroll>
        {me && (
          <Foot to="/settings">
            <UserMark login={me.login} url={me.avatar_url} size={24} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.name || me.login}</span>
          </Foot>
        )}
      </Side>
      <Main style={{ marginLeft: docked ? NAV_W : 0 }}>
        {!bare && navHidden && !phone && <PageBar><NavButton /><Brand to="/" style={{ flex: 'none' }}><Mark />zdown</Brand></PageBar>}
        {children}
        {!bare && phone && <div style={{ height: `calc(${BOTTOM_BAR_H}px + env(safe-area-inset-bottom))` }} />}
      </Main>
      {!bare && phone && me && !typing && (
        <BottomBar aria-label="primary">
          <Tab $on={drawerOpen || loc.pathname.startsWith('/repos')} onClick={() => setDrawerOpen(true)}>
            <TabIcon>☰</TabIcon>files
          </Tab>
          <Tab $on={loc.pathname === '/'} aria-label="new file"
            onClick={() => navigate('/', { state: { fresh: Date.now() } })}>
            <TabIcon style={{ color: tokens.accent }}>＋</TabIcon>new
          </Tab>
          <Tab $on={loc.pathname === '/settings'} onClick={() => navigate('/settings')}>
            <TabIcon><UserMark login={me.login} url={me.avatar_url} size={20} /></TabIcon>account
          </Tab>
        </BottomBar>
      )}

    </Ctx.Provider>
  );
}
