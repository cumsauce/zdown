import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { styled } from 'styletron-react';
import { api, ApiError, errorMessage } from '../api';
import { CodeMirror, type EditorHandle } from '../components/editor/CodeMirror';
import { InsertSheet } from '../components/editor/InsertSheet';
import { PostSettings } from '../components/editor/PostSettings';
import { ReviewBar, ReviewCard } from '../components/editor/ReviewBar';
import type { Issue, IssueKind, ReviewSummary } from '../components/editor/reviewTypes';
import { Toolbar } from '../components/editor/Toolbar';
import { Icon } from '../components/icons';
import { ConflictBox, PublishSheet } from '../components/Publish';
import { Badge, Banner, Btn, Center, confirmDialog, Grow, IconBtn, Loading, Menu, type MenuItem, Muted, Select, Spinner } from '../components/ui';
import { drafts, type Draft } from '../lib/drafts';
import { dateText, parseFields, setField, splitDoc, today } from '../lib/frontmatter';
import { editUrl, recents } from '../lib/recents';
import { type RenderCtx } from '../lib/render';
import { formatDate, isFuture, newPostPath, slugify, uploadTarget, usesBundles, defaultSection } from '../lib/site';
import { siteStore, useRepos, useSite } from '../lib/store';
import { clock } from '../lib/time';
import { prepareImage } from '../lib/upload';
import { notifyError, notifyOk } from '../notify';
import { COARSE, DESKTOP, HOVER, PHONE, tokens } from '../theme';

const Preview = lazy(() => import('../components/Preview').then((m) => ({ default: m.Preview })));

// One writing surface for every file, new or old: it never changes shape when
// you start typing, when the file gets created, or between screen sizes. The
// title is a real field that writes to front matter, the body is live markdown,
// and saving is automatic. The raw +++ block stays out of the way.

/** Pinned to the *visual* viewport so the toolbar rides above the on-screen keyboard. */
const Shell = styled('div', {
  position: 'fixed',
  left: 'var(--nav-w, 0px)',
  right: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  backgroundColor: tokens.bg,
  zIndex: 10,
});

const Bar = styled('header', {
  height: '52px',
  padding: '0 8px',
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  flexShrink: 0,
  minWidth: 0,
  paddingTop: 'env(safe-area-inset-top)',
  boxSizing: 'content-box',
  [PHONE]: { padding: '0 2px' },
});

const Back = styled(Link, {
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  height: '36px',
  padding: '0 10px 0 4px',
  borderRadius: '8px',
  fontSize: '14px',
  color: tokens.fgMuted,
  minWidth: 0,
  flexShrink: 1,
  [HOVER]: { ':hover': { backgroundColor: tokens.hover, color: tokens.fg } },
  [COARSE]: { height: '44px' },
});

const BackLabel = styled('span', { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

const SaveState = styled('span', {
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  fontSize: '13px',
  color: tokens.fgFaint,
  whiteSpace: 'nowrap',
  padding: '0 8px',
  flexShrink: 0,
});

const Body = styled('div', { flex: 1, minHeight: 0, display: 'flex', position: 'relative' });

const Scroller = styled('div', {
  flex: 1,
  minWidth: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  WebkitOverflowScrolling: 'touch',
});

const Column = styled('div', {
  maxWidth: '680px',
  margin: '0 auto',
  padding: '20px 32px 45vh',
  [PHONE]: { padding: '8px 20px 45vh' },
});

const TitleField = styled('textarea', {
  display: 'block',
  width: '100%',
  border: 'none',
  outline: 'none',
  background: 'none',
  resize: 'none',
  padding: 0,
  margin: 0,
  overflow: 'hidden',
  fontFamily: tokens.serif,
  fontSize: '40px',
  fontWeight: 500,
  lineHeight: 1.12,
  letterSpacing: '-.012em',
  color: tokens.fg,
  '::placeholder': { color: tokens.fgFaint },
  ':focus-visible': { outline: 'none' },
  [PHONE]: { fontSize: '32px !important' },
  [COARSE]: { fontSize: '32px !important' },
});

const MetaLine = styled('div', {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '4px 8px',
  margin: '10px 0 26px',
  minHeight: '24px',
  fontSize: '14px',
  color: tokens.fgMuted,
});

const MetaBtn = styled('button', {
  appearance: 'none',
  border: 'none',
  background: 'none',
  padding: '2px 0',
  fontSize: '14px',
  color: tokens.fgMuted,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  [HOVER]: { ':hover': { color: tokens.fg } },
  [COARSE]: { minHeight: '44px' },
});

const Side = styled('aside', {
  position: 'absolute',
  inset: 0,
  zIndex: 20,
  backgroundColor: tokens.bg,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  padding: '4px 20px 40px',
  '@media (min-width: 1100px)': {
    position: 'static',
    width: '340px',
    flexShrink: 0,
    borderLeft: `1px solid ${tokens.rule}`,
    padding: '0 20px 40px',
  },
});

const SideHead = styled('div', {
  display: 'flex',
  alignItems: 'center',
  height: '44px',
  fontSize: '15px',
  fontWeight: 600,
  color: tokens.fg,
  position: 'sticky',
  top: 0,
  backgroundColor: tokens.bg,
  zIndex: 1,
  margin: '0 -8px 6px 0',
});

const OnlyDesktop = styled('span', { display: 'none', [DESKTOP]: { display: 'contents' } });

function useVisualViewport() {
  const [box, setBox] = useState(() => ({ top: 0, height: window.innerHeight }));
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setBox(vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: window.innerHeight });
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return box;
}

interface DraftOffer extends Draft { applied: boolean }

const wordCount = (body: string) => {
  const t = body.trim();
  return t ? t.split(/\s+/).length : 0;
};

function template(title: string, isZola: boolean) {
  const lines = [`title = ${JSON.stringify(title)}`, `date = ${today()}`];
  if (isZola) lines.push('draft = true');
  return `+++\n${lines.join('\n')}\n+++\n\n`;
}

/** Stable identity across "new post" becoming a real file, so nothing remounts. */
export function EditorRoute() {
  const repoId = Number(useParams().repoId);
  const [params] = useSearchParams();
  const loc = useLocation();
  const path = params.get('path') ?? '';
  const key = useRef('');
  const adopted = (loc.state as { adopted?: boolean } | null)?.adopted;
  if (!adopted || !key.current) key.current = `${repoId}:${path}:${params.get('new') ?? ''}:${params.get('in') ?? ''}:${path ? '' : loc.key}`;
  return <Editor key={key.current} />;
}

function Editor() {
  const repoId = Number(useParams().repoId);
  const [params] = useSearchParams();
  const urlPath = params.get('path') ?? '';
  const isNew = params.get('new') === '1';
  const navigate = useNavigate();
  const loc = useLocation();

  const repos = useRepos();
  const repo = repos?.find((r) => r.id === repoId);
  const siteState = useSite(repoId, repo);
  const site = siteState.data?.site ?? null;
  const tree = siteState.tree;
  const local = repo?.provider === 'local';

  const [path, setPath] = useState(urlPath);
  const [dir, setDir] = useState<string | null>(params.get('in'));
  const [loading, setLoading] = useState(!isNew || !!urlPath);
  const [loadError, setLoadError] = useState<{ message: string; gone: boolean } | null>(null);
  const [content, setContent] = useState('');
  const [server, setServer] = useState<string | null>(null); // committed text; null = no such file yet
  const [baseBlob, setBaseBlob] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [offer, setOffer] = useState<DraftOffer | null>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [marks, setMarks] = useState(() => { try { return localStorage.getItem('zdown.marks') === '1'; } catch { return false; } });
  const [panel, setPanel] = useState(false);
  const [insert, setInsert] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [focused, setFocused] = useState(false);
  const [review, setReview] = useState(() => { try { return localStorage.getItem('zdown.review') === '1'; } catch { return false; } });
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(null);
  const [reviewHidden, setReviewHidden] = useState<Set<IssueKind>>(() => new Set());
  const [note, setNote] = useState<Issue[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  const editor = useRef<EditorHandle>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = server === null ? path !== '' || content.trim() !== '' : content !== server;
  const pendingNew = !path;

  const doc = useMemo(() => splitDoc(content), [content]);
  const fields = useMemo(() => parseFields(doc), [doc.raw, doc.format]); // eslint-disable-line react-hooks/exhaustive-deps
  const titleValue = fields && typeof fields.title === 'string' ? fields.title : '';
  const isSection = /(^|\/)_index\.[a-z-.]+$/i.test(path);
  const draftKey = path || `new:${dir ?? ''}`;

  // refs so the save queue always sees the latest values
  const live = useRef({ content, baseBlob, server, conflict, path });
  live.current = { content, baseBlob, server, conflict, path };
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const userEdited = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ---------- load ----------
  const fetchServer = useCallback(async (p: string) => {
    try {
      const r = await api.post(repoId, p);
      return { content: r.content, blob: r.blob };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && isNew) return { content: null, blob: null };
      throw e;
    }
  }, [repoId, isNew]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!urlPath) {
        // a new post lives only on this device until it has a name
        const d = await drafts.get(repoId, draftKey);
        if (cancelled) return;
        const pending = (loc.state as { body?: string } | null)?.body;
        const start = d?.content ?? (pending ? `+++\ntitle = ""\ndate = ${today()}\n+++\n\n${pending}` : '');
        setContent(start);
        setLoading(false);
        return;
      }
      try {
        const [s, d] = await Promise.all([fetchServer(urlPath), drafts.get(repoId, urlPath)]);
        if (cancelled) return;
        setServer(s.content);
        setBaseBlob(s.blob);
        const committed = s.content ?? '';
        if (d && d.content !== committed) {
          // the local draft wins on reopen; the banner offers the way back
          setContent(d.content);
          setBaseBlob(d.baseBlob);
          setOffer({ ...d, applied: true });
        } else {
          setContent(committed);
        }
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError({ message: errorMessage(e), gone: e instanceof ApiError && e.status === 404 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The remote moved while this was open and nothing here has been touched: follow it.
  const lastSyncedAt = siteState.syncedAt;
  useEffect(() => {
    // (a restored draft counts as touched: it must never be swapped out from under you)
    if (!path || loading || userEdited.current || dirty || !lastSyncedAt) return;
    const known = siteState.data?.posts.find((p) => p.path === path);
    if (known && baseBlob && known.blob !== baseBlob) {
      void fetchServer(path).then((s) => {
        if (userEdited.current || live.current.content !== live.current.server) return;
        setServer(s.content);
        setBaseBlob(s.blob);
        setContent(s.content ?? '');
      }, () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteState.data?.head]);

  // ---------- saving ----------

  // The first save names the file, so a slug isn't derived from half a title.
  const nameFile = useCallback((text: string): string | null => {
    const parts = splitDoc(text);
    const f = parseFields(parts);
    const title = f && typeof f.title === 'string' ? f.title : '';
    let slug = slugify(title);
    if (!slug && local) slug = slugify(parts.body.trim().split('\n')[0] ?? '');
    if (!slug || (dir === null && !tree)) return null;
    const section = dir !== null ? dir : tree ? defaultSection(tree).dir : '';
    const node = tree?.byDir.get(section);
    return newPostPath(section, slug, node ? usesBundles(node) : false);
  }, [dir, tree, local]);

  const save = useCallback(async (manual = false): Promise<void> => {
    if (inflight.current) { again.current = true; return inflight.current; }
    const run = async () => {
      const { content: text, baseBlob: base, server: committed, conflict: c, path: current } = live.current;
      if (c || (committed !== null && text === committed)) return;
      setSaving(true);
      try {
        let target = current;
        if (!target) {
          const named = nameFile(text);
          if (!named) return; // still waiting for a title
          // never overwrite: bump the name until it's free
          target = named;
          for (let n = 2; siteStore.get(repoId).data?.posts.some((p) => p.path === target); n++) {
            target = named.includes('/index.') ? named.replace(/\/index\./, `-${n}/index.`) : named.replace(/\.md$/, `-${n}.md`);
          }
        }
        const r = await api.save(repoId, { path: target, content: text, base_blob: base ?? undefined, autosave: !manual });
        setBaseBlob(r.blob);
        setServer(text);
        setSavedAt(Date.now());
        setSaveError(null);
        live.current = { ...live.current, baseBlob: r.blob, server: text, path: target };
        if (target !== current) {
          void drafts.clear(repoId, draftKey);
          setPath(target);
          if (mounted.current) navigate(editUrl(repoId, target), { replace: true, state: { adopted: true } });
        }
        if (live.current.content === text) void drafts.clear(repoId, target);
        setOffer(null);
        void siteStore.load(repoId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setConflict(true);
        else setSaveError(errorMessage(e));
      } finally {
        setSaving(false);
      }
    };
    inflight.current = run().finally(() => { inflight.current = null; });
    await inflight.current;
    if (again.current) { again.current = false; await save(manual); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, nameFile, draftKey]);

  // drafts: debounced, and only while there's something unsaved
  useEffect(() => {
    if (loading || !dirty || !userEdited.current) return;
    const t = setTimeout(() => {
      void drafts.put(repoId, draftKey, { content, baseBlob: live.current.baseBlob, savedAt: Date.now() });
    }, 250);
    return () => clearTimeout(t);
  }, [content, dirty, loading, repoId, draftKey]);

  // autosave a moment after the last edit. A new post waits for the title to
  // be finished (focus leaves it), or for a body.
  const titleFocused = useRef(false);
  useEffect(() => {
    if (loading || !userEdited.current || !dirty || conflict) return;
    if (pendingNew && (titleFocused.current || !nameFile(content))) return;
    const t = setTimeout(() => void save(), saveError ? 5000 : 900);
    return () => clearTimeout(t);
  }, [content, dirty, conflict, loading, save, saveError, pendingNew, nameFile]);

  useEffect(() => {
    const on = () => { if (dirty && !conflict) void save(); };
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [dirty, conflict, save]);

  const onBody = useCallback((b: string) => {
    setNote([]);
    userEdited.current = true;
    setContent((c) => splitDoc(c).head + b);
  }, []);
  const edit = useCallback((next: string) => { userEdited.current = true; setContent(next); }, []);

  // a brand-new post gets its front matter the moment it has a title
  const setTitle = (t: string) => {
    const one = t.replace(/\n/g, ' ');
    edit(setField(doc.raw === null && pendingNew ? template('', !!site?.zola) + doc.body : content, null, 'title', one));
  };

  // Flush the draft whenever we might lose the page mid-debounce: tab hidden or
  // closed, and in-app navigation, which unmounts us and cancels the timers.
  useEffect(() => {
    const flush = () => {
      const { content: c, baseBlob: b, server: s, path: p } = live.current;
      if (!userEdited.current || (s !== null && c === s) || (!p && !c.trim())) return;
      void drafts.put(repoId, p || draftKey, { content: c, baseBlob: b, savedAt: Date.now() });
      if (!live.current.conflict) void save();
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    const onUnload = (e: BeforeUnloadEvent) => {
      flush();
      const { content: c, server: s, path: p } = live.current;
      if (userEdited.current && p && (s === null || c !== s)) e.preventDefault();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, draftKey]);

  // ---------- reload / drafts / conflict ----------
  const reload = async () => {
    if (!path) return;
    try {
      if (dirty && userEdited.current) await drafts.put(repoId, path, { content, baseBlob, savedAt: Date.now() });
      const s = await fetchServer(path);
      const d = await drafts.get(repoId, path);
      const committed = s.content ?? '';
      userEdited.current = false;
      setServer(s.content);
      setBaseBlob(s.blob);
      setContent(committed);
      setConflict(false);
      setOffer(d && d.content !== committed ? { ...d, applied: false } : null);
    } catch (e) { notifyError(e); }
  };

  const discardDraft = async () => {
    await drafts.clear(repoId, path);
    try {
      const s = await fetchServer(path);
      userEdited.current = false;
      setServer(s.content);
      setBaseBlob(s.blob);
      setContent(s.content ?? '');
    } catch (e) { notifyError(e); }
    setOffer(null);
  };

  const restoreDraft = () => {
    if (!offer) return;
    userEdited.current = true;
    setContent(offer.content);
    setBaseBlob(offer.baseBlob);
    setOffer(null);
  };

  const keepMine = async () => {
    try {
      const s = await fetchServer(path);
      setBaseBlob(s.blob);
      setServer(s.content);
      live.current = { ...live.current, baseBlob: s.blob, server: s.content, conflict: false };
      setConflict(false);
      await save(true);
    } catch (e) { notifyError(e); }
  };

  const rename = async (slug: string) => {
    if (!baseBlob) return;
    try {
      await save(true);
      const parts = path.split('/');
      const base = parts[parts.length - 1];
      const bundle = /^index\.[a-z]+$/i.test(base);
      if (bundle) parts[parts.length - 2] = slug;
      else parts[parts.length - 1] = `${slug}${base.slice(base.lastIndexOf('.'))}`;
      const to = parts.join('/');
      await api.rename(repoId, path, to, live.current.baseBlob ?? baseBlob);
      recents.rename(repoId, path, to);
      await siteStore.load(repoId);
      notifyOk(`Renamed to ${slug}`);
      navigate(editUrl(repoId, to), { replace: true });
    } catch (e) { notifyError(e); }
  };

  const deleteFile = async () => {
    const committed = server !== null && baseBlob;
    const ok = await confirmDialog({
      title: committed ? 'Delete this post?' : 'Discard this draft?',
      body: committed ? `${path} is removed in a new commit. It stays in the history, and nothing changes on the site until you publish.` : 'It was never saved.',
      action: committed ? 'Delete' : 'Discard',
      danger: true,
    });
    if (!ok) return;
    try {
      if (committed) await api.deleteFile(repoId, path, baseBlob);
      userEdited.current = false;
      await drafts.clear(repoId, draftKey);
      if (path) recents.remove(repoId, path);
      await siteStore.load(repoId);
      notifyOk(committed ? 'Deleted' : 'Discarded');
      navigate(backTo, { replace: true });
    } catch (e) { notifyError(e); }
  };

  // ---------- images ----------
  const uploadFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const hole = editor.current?.placeholder(`![Uploading ${file.name.replace(/[[\]]/g, '')}…]()`);
      setUploading((n) => n + 1);
      try {
        const { blob, name } = await prepareImage(file);
        const { path: wanted, ref } = uploadTarget(name, live.current.path || null, siteStore.get(repoId).data?.site ?? null);
        const r = await api.uploadImage(repoId, wanted, blob);
        await siteStore.load(repoId);
        hole?.(`![](${ref(r.path)})`);
      } catch (e) {
        hole?.(null);
        notifyError(new Error(`Couldn't add ${file.name}: ${errorMessage(e)}`));
      } finally { setUploading((n) => n - 1); }
    }
  }, [repoId]);

  // ---------- review ----------
  const toggleReview = () => {
    const on = !review;
    setReview(on);
    setNote([]);
    if (!on) setReviewSummary(null);
    try { localStorage.setItem('zdown.review', on ? '1' : '0'); } catch { /* storage blocked */ }
  };
  const closeNote = useCallback(() => { setNote([]); editor.current?.clearActive(); }, []);

  // ---------- derived ----------
  const words = useMemo(() => wordCount(doc.body), [doc.body]);
  useEffect(() => { if (!loading && !loadError && path) recents.touch(repoId, path, titleValue || null); }, [repoId, path, loading, loadError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!loading && path) recents.retitle(repoId, path, titleValue || null); }, [titleValue, loading, repoId, path]);

  const vp = useVisualViewport();
  const keyboard = focused && window.matchMedia('(pointer: coarse)').matches;
  useEffect(() => {
    document.documentElement.classList.add('editing');
    return () => document.documentElement.classList.remove('editing');
  }, []);
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.matches('input, textarea') || t.isContentEditable);
    const on = (e: FocusEvent) => setFocused(isField(e.target));
    const off = () => setFocused(false);
    document.addEventListener('focusin', on);
    document.addEventListener('focusout', off);
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', off); };
  }, []);

  // A title wraps like the heading it is.
  useLayoutEffect(() => {
    const t = titleRef.current;
    if (!t) return;
    t.style.height = '0';
    t.style.height = `${t.scrollHeight}px`;
  }, [titleValue, loading, tab]);

  // New post: straight into the title.
  useEffect(() => {
    if (!loading && pendingNew) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const ctx: RenderCtx = useMemo(() => ({ repoId, path: path || null, site, fields: fields ?? {} }), [repoId, path, site, fields]);

  const postDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const listDir = /\/_?index\.[a-z-.]+$/i.test(path) && !isSection ? (postDir.includes('/') ? postDir.slice(0, postDir.lastIndexOf('/')) : '') : postDir;
  const section = tree?.byDir.get(pendingNew ? (dir ?? '') : listDir);
  const backTo = section && section !== tree?.root ? `/repos/${repoId}?s=${encodeURIComponent(section.dir)}` : `/repos/${repoId}`;
  const backLabel = section && section !== tree?.root ? section.name : (site?.title ?? repo?.full_name.split('/').pop() ?? 'Site');

  const chosenDir = dir !== null ? dir : tree ? defaultSection(tree).dir : '';
  const stateNode = conflict ? <span style={{ color: tokens.negative }}>Conflict</span>
    : saveError ? <span style={{ color: tokens.warning }} title={saveError}>Not saved, retrying</span>
    : saving || uploading ? <><Spinner size={12} />{uploading ? 'Adding image' : 'Saving'}</>
    : pendingNew ? (content.trim() && !nameFile(content) ? 'Add a title to save' : content.trim() ? 'Not saved yet' : '')
    : dirty ? 'Edited'
    : savedAt ? <><Icon name="check" size={14} />Saved {clock(savedAt)}</>
    : 'Saved';

  const menu: MenuItem[] = [
    { label: marks ? 'Hide markdown syntax' : 'Show markdown syntax', icon: 'code', run: () => { const m = !marks; setMarks(m); try { localStorage.setItem('zdown.marks', m ? '1' : '0'); } catch { /* storage blocked */ } } },
    ...(path ? [{ label: 'Version history', icon: 'history' as const, run: () => navigate(`/repos/${repoId}/versions?path=${encodeURIComponent(path)}`) }] : []),
    ...(path ? [{ label: 'Reload from server', icon: 'sync' as const, run: () => void reload() }] : []),
    ...(repo && !local ? [{ label: 'Publish…', icon: 'upload' as const, run: () => { void save(true); setPublishing(true); } }] : []),
    { separator: true, label: '' },
    { label: path ? 'Delete…' : 'Discard…', icon: 'trash', danger: true, run: () => void deleteFile() },
    { separator: true, label: '' },
    { label: `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`, disabled: true },
  ];

  if (loading) return <Loading />;
  if (loadError) {
    return (
      <Center>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', maxWidth: 420 }}>
          <div style={{ fontFamily: tokens.serif, fontSize: 24, color: tokens.fg }}>{loadError.gone ? 'This post is gone' : 'Couldn’t open this post'}</div>
          <Muted>{loadError.gone ? `${urlPath} no longer exists. It may have been renamed or removed.` : loadError.message}</Muted>
          <Btn onClick={() => { if (loadError.gone) recents.remove(repoId, urlPath); navigate(`/repos/${repoId}`, { replace: true }); }}>Back to the site</Btn>
        </div>
      </Center>
    );
  }

  const noFrontMatter = doc.raw === null && !pendingNew && !!site?.zola && path.startsWith(`${site.root}content/`);
  const badFrontMatter = fields === null;

  return (
    <Shell style={{ top: vp.top, height: vp.height }}>
      <Bar>
        <Back to={backTo} aria-label={`Back to ${backLabel}`}><Icon name="back" /><BackLabel>{backLabel}</BackLabel></Back>
        <Grow />
        <SaveState aria-live="polite">{stateNode}</SaveState>
        <IconBtn icon={tab === 'write' ? 'eye' : 'pen'} label={tab === 'write' ? 'Preview' : 'Edit'} aria-pressed={tab === 'preview'}
          onClick={() => setTab(tab === 'write' ? 'preview' : 'write')} />
        <IconBtn icon="review" label="Review writing" aria-pressed={review} on={review} onClick={toggleReview} />
        <IconBtn icon="sliders" label="Post details" aria-expanded={panel} on={panel} onClick={() => setPanel(!panel)} />
        <Menu items={menu} trigger={(t) => <IconBtn {...t} icon="more" label="More" />} />
        {repo && !local && (siteState.data?.status.ahead ?? 0) > 0 && (
          <OnlyDesktop><Btn small kind="primary" style={{ marginLeft: 6, marginRight: 4 }} onClick={() => { void save(true); setPublishing(true); }}>Publish</Btn></OnlyDesktop>
        )}
      </Bar>

      {conflict && (
        <Banner $tone="negative">
          <span>This post changed elsewhere since you opened it.</span>
          <Grow />
          <Btn small kind="ghost" onClick={() => void reload()}>Use the other version</Btn>
          <Btn small onClick={() => void keepMine()}>Keep mine</Btn>
        </Banner>
      )}
      {offer && (
        <Banner>
          <span>{offer.applied ? `Restored your unsaved edits from ${clock(offer.savedAt)}.` : `You have unsaved edits from ${clock(offer.savedAt)}.`}</span>
          <Grow />
          {!offer.applied && <Btn small onClick={restoreDraft}>Restore</Btn>}
          <Btn small kind="ghost" onClick={() => void discardDraft()}>Discard</Btn>
        </Banner>
      )}
      {siteState.conflicts.includes(path) && !conflict && (
        <Banner $tone="warning" style={{ display: 'block' }}><ConflictBox repo={repo!} onDone={() => void reload()} /></Banner>
      )}

      <Body>
        <Scroller ref={scroller} style={{ display: tab === 'write' ? undefined : 'none' }}
          onMouseDown={(e) => {
            // the empty space under the text belongs to the text
            if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.column !== undefined) {
              e.preventDefault();
              editor.current?.focusEnd();
            }
          }}>
          <Column data-column="">
            {pendingNew && tree && tree.byDir.size > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 14, color: tokens.fgMuted }}>
                <span>New post in</span>
                <div style={{ width: 'auto', minWidth: 120 }}>
                  <Select aria-label="Section" value={chosenDir} onChange={(e) => setDir(e.currentTarget.value)}>
                    {[...tree.byDir.values()].map((n) => <option key={n.dir} value={n.dir}>{n === tree.root ? (site?.title ?? 'Site root') : n.name}</option>)}
                  </Select>
                </div>
              </div>
            )}
            <TitleField ref={titleRef} rows={1} aria-label="Title" placeholder={isSection ? 'Section title' : 'Title'}
              readOnly={badFrontMatter}
              value={titleValue}
              onChange={(e) => setTitle(e.currentTarget.value)}
              onFocus={() => { titleFocused.current = true; }}
              onBlur={() => {
                titleFocused.current = false;
                if (pendingNew && nameFile(content)) void save();
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor.current?.focus(); } }} />
            <MetaLine>
              {!isSection && !pendingNew && fields?.date !== undefined && <MetaBtn onClick={() => setPanel(true)}>{formatDate(dateText(fields.date))}</MetaBtn>}
              {isSection && <Badge>Section page</Badge>}
              {fields?.draft === true && (
                <MetaBtn onClick={() => edit(setField(content, null, 'draft', null))} title="Draft: click to make it public"><Badge $tone="accent">Draft</Badge></MetaBtn>
              )}
              {fields?.draft !== true && isFuture(dateText(fields?.date) || null) && <Badge $tone="warning">Scheduled</Badge>}
              {noFrontMatter && (
                <MetaBtn onClick={() => edit(template(titleValue, false) + doc.body)}><Badge $tone="warning">No front matter: Zola will skip this</Badge> Add it</MetaBtn>
              )}
              {badFrontMatter && <MetaBtn onClick={() => setPanel(true)}><Badge $tone="negative">Front matter has an error</Badge> Fix it</MetaBtn>}
            </MetaLine>
            <CodeMirror ref={editor} value={doc.body} onChange={onBody} ctx={ctx} showMarks={marks}
              onSave={() => void save(true)} onFiles={(f) => void uploadFiles(f)}
              review={review} reviewHidden={reviewHidden} onReviewSummary={setReviewSummary} onIssues={setNote} />
          </Column>
        </Scroller>
        {tab === 'preview' && (
          <Scroller>
            <Column>
              <h1 style={{ fontFamily: 'var(--serif)', fontSize: 40, lineHeight: 1.12, fontWeight: 500, letterSpacing: '-.012em', margin: 0, color: tokens.fg }}>{titleValue}</h1>
              <MetaLine>{fields?.date !== undefined && formatDate(dateText(fields.date))}</MetaLine>
              <Suspense fallback={<Spinner />}><Preview body={doc.body} ctx={ctx} /></Suspense>
            </Column>
          </Scroller>
        )}
        {panel && (
          <Side aria-label="Post details">
            <SideHead><Grow>Post details</Grow><IconBtn icon="close" label="Close details" onClick={() => setPanel(false)} /></SideHead>
            <PostSettings content={content} path={path || null} isSection={isSection} onChange={edit} onRename={rename} canRename={!!baseBlob} />
          </Side>
        )}
        {review && tab === 'write' && note.length > 0 && (
          <ReviewCard issues={note} editor={editor} scroller={scroller} onClose={closeNote}
            onFix={(i, r) => { setNote([]); editor.current?.fix(i, r); }}
            onIgnore={(i) => { setNote([]); editor.current?.ignore(i); }} />
        )}
      </Body>

      {review && tab === 'write' && !panel && !keyboard && (
        <ReviewBar summary={reviewSummary} hidden={reviewHidden}
          onToggle={(k) => {
            setNote([]);
            setReviewHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
          }}
          onStep={(d) => editor.current?.stepIssue(d)}
          onRestore={() => editor.current?.restoreIgnored()}
          onClose={toggleReview} />
      )}
      {tab === 'write' && !panel && (
        <Toolbar editor={editor} words={words} keyboard={keyboard} onInsert={() => setInsert(true)}
          onImage={() => fileInput.current?.click()} />
      )}
      <input ref={fileInput} type="file" accept="image/*" multiple hidden aria-label="Choose images"
        onChange={(e) => { const f = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (f.length) void uploadFiles(f); }} />

      {insert && <InsertSheet site={site} editor={editor} onClose={() => setInsert(false)} />}
      {publishing && repo && <PublishSheet repo={repo} onClose={() => setPublishing(false)} />}
    </Shell>
  );
}
