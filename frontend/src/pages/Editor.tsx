import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { styled } from 'baseui';
import { Button, KIND, SIZE } from 'baseui/button';
import { Spinner } from 'baseui/spinner';
import { api, ApiError, errorMessage, type Repo } from '../api';
import { CodeMirror, type CodeMirrorHandle, type SelectionBox } from '../components/CodeMirror';
import { FormatPopover } from '../components/FormatPopover';
import { FrontMatterSheet } from '../components/FrontMatterSheet';
import { MobileToolbar } from '../components/MobileToolbar';
import { Preview } from '../components/Preview';
import { NavButton } from '../components/AppShell';
import { recents } from '../lib/recents';
import { Banner, Center, ErrorText, Full } from '../components/ui';
import { StatefulPopover, PLACEMENT } from 'baseui/popover';
import { StatefulMenu } from 'baseui/menu';
import { drafts, type Draft } from '../lib/drafts';
import { splitFrontMatter, tryParseToml } from '../lib/frontmatter';
import { clock } from '../lib/time';
import { notifyError, notifyOk } from '../notify';
import { tokens } from '../theme';

// One header at every size (iA Writer/Bear): title · state · ⚙ · preview ·
// save · ⋯. Secondary actions live in the ⋯ menu. WIDE only decides
// whether post settings dock beside the text or cover it.
const NotPhone = styled('span', { display: 'contents', '@media (max-width: 639px)': { display: 'none' } });
const WIDE = '@media (min-width: 1100px)';
const COMPACT = '@media (max-width: 1099px)';
const PHONE = '@media (max-width: 639px)';

// Pinned to the *visual* viewport so the formatting bar rides above the
// on-screen keyboard on iOS/Android instead of hiding behind it.
const Shell = styled('div', {
  position: 'fixed',
  left: 'var(--nav-w, 0px)',
  right: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  backgroundColor: tokens.bg,
});

const Bar = styled('header', {
  height: '48px',
  padding: '0 12px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  borderBottom: `1px solid ${tokens.border}`,
  flexShrink: 0,
  minWidth: 0,
  '& button': { whiteSpace: 'nowrap', flexShrink: 0 },
  [PHONE]: { padding: '0 4px', gap: '4px' },
});

const TitleBlock = styled('div', { display: 'flex', flexDirection: 'column', minWidth: 0, flex: '0 1 auto' });

const DocTitle = styled('span', {
  fontSize: '13px',
  fontWeight: 600,
  color: tokens.fg,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const DocPath = styled('span', {
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.fgFaint,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  [PHONE]: { display: 'none' },
});

const SaveState = styled('span', {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.fgMuted,
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

const DirtyDot = styled<'span', { $saved: boolean }>('span', ({ $saved }) => ({
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  flexShrink: 0,
  backgroundColor: $saved ? tokens.borderStrong : tokens.warning,
}));

const StateLabel = styled('span', { [PHONE]: { display: 'none' } });


const Status = styled('footer', {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '5px 14px',
  borderTop: `1px solid ${tokens.border}`,
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.fgMuted,
  flexShrink: 0,
  [PHONE]: { display: 'none' },
});


const Body = styled('div', { flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', position: 'relative' });

/** Post settings: docked right on wide screens, a full-screen sheet below. */
const SettingsPane = styled('aside', {
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: tokens.codeBg,
  overflowY: 'auto',
  [WIDE]: { width: '360px', flexShrink: 0, borderLeft: `1px solid ${tokens.border}` },
  [COMPACT]: { position: 'absolute', inset: 0, zIndex: 20 },
});

const PaneHead = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 16px',
  borderBottom: `1px solid ${tokens.border}`,
  fontSize: '13px',
  fontWeight: 600,
  color: tokens.fg,
  position: 'sticky',
  top: 0,
  backgroundColor: tokens.codeBg,
  zIndex: 1,
});

function useVisualViewport() {
  const [box, setBox] = useState({ top: 0, height: typeof window === 'undefined' ? 0 : window.innerHeight });
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

function templateFor(path: string) {
  const name = path.split('/').pop()!.replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
  const today = new Date().toISOString().slice(0, 10);
  return `+++\ntitle = ${JSON.stringify(name)}\ndate = ${today}\n+++\n\n`;
}

const wordCount = (content: string) => {
  const body = splitFrontMatter(content).body.trim();
  return body ? body.split(/\s+/).length : 0;
};

export function Editor() {
  const repoId = Number(useParams().repoId);
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const isNew = params.get('new') === '1';
  const navigate = useNavigate();

  const [repo, setRepo] = useState<Repo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [server, setServer] = useState<string | null>(null); // committed text; null = file doesn't exist yet
  const [baseBlob, setBaseBlob] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [offer, setOffer] = useState<DraftOffer | null>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [marks, setMarks] = useState(true);
  const [sheet, setSheet] = useState(false);

  const editor = useRef<CodeMirrorHandle>(null);
  const dirty = server === null || content !== server;

  // refs so the save queue always sees the latest values
  const live = useRef({ content, baseBlob, server, conflict });
  live.current = { content, baseBlob, server, conflict };
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const userEdited = useRef(false);
  const [selBox, setSelBox] = useState<SelectionBox | null>(null);
  const finePointer = useMemo(() => window.matchMedia('(pointer: fine)').matches, []);
  // Handoff from the Home composer: text typed after the file was created
  // (`pending`) and a request to continue typing at the end.
  const handoff = useLocation().state as { pending?: string; focusEnd?: boolean } | null;
  const handoffRef = useRef(handoff);

  // ---------- load ----------
  const fetchServer = useCallback(async () => {
    try {
      const p = await api.post(repoId, path);
      return { content: p.content, blob: p.blob as string | null };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && isNew) return { content: null, blob: null };
      throw e;
    }
  }, [repoId, path, isNew]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [repos, s, d] = await Promise.all([api.repos(), fetchServer(), drafts.get(repoId, path)]);
        if (cancelled) return;
        setRepo(repos.find((r) => r.id === repoId) ?? null);
        setServer(s.content);
        setBaseBlob(s.blob);
        const committed = s.content ?? templateFor(path);
        if (d && d.content !== committed) {
          // the local draft wins on reopen; the banner offers the way back
          setContent(d.content);
          setBaseBlob(d.baseBlob);
          setOffer({ ...d, applied: true });
        } else {
          setContent(committed);
        }
        const pending = handoffRef.current?.pending;
        if (pending != null && pending !== committed) { userEdited.current = true; setContent(pending); }
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [repoId, path, fetchServer]);

  useEffect(() => {
    if (loading || !handoffRef.current?.focusEnd) return;
    handoffRef.current = null;
    requestAnimationFrame(() => editor.current?.focusEnd());
  }, [loading]);

  // ---------- drafts (debounced, only while dirty) ----------
  useEffect(() => {
    if (loading || !dirty || !userEdited.current) return;
    const t = setTimeout(() => {
      void drafts.put(repoId, path, { content, baseBlob: live.current.baseBlob, savedAt: Date.now() });
    }, 250);
    return () => clearTimeout(t);
  }, [content, dirty, loading, repoId, path]);

  // ---------- save (serialized; a save requested mid-flight re-runs after) ----------
  const save = useCallback(async (): Promise<void> => {
    if (inflight.current) { again.current = true; return inflight.current; }
    const run = async () => {
      const { content: text, baseBlob: base, server: committed, conflict: c } = live.current;
      if (c || (committed !== null && text === committed)) return;
      setSaving(true);
      try {
        const r = await api.save(repoId, { path, content: text, base_blob: base ?? undefined });
        setBaseBlob(r.blob);
        setServer(text);
        setSavedAt(Date.now());
        live.current = { ...live.current, baseBlob: r.blob, server: text };
        if (live.current.content === text) void drafts.clear(repoId, path);
        setOffer(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setConflict(true);
        else notifyError(e);
      } finally {
        setSaving(false);
      }
    };
    inflight.current = run().finally(() => { inflight.current = null; });
    await inflight.current;
    if (again.current) { again.current = false; await save(); }
  }, [repoId, path]);

  // autosave ~800ms after the last edit
  useEffect(() => {
    if (loading || !userEdited.current || !dirty || conflict) return;
    const t = setTimeout(() => void save(), 800);
    return () => clearTimeout(t);
  }, [content, dirty, conflict, loading, save]);

  const onChange = useCallback((v: string) => { userEdited.current = true; setContent(v); }, []);

  // ---------- reload / drafts / conflict ----------
  const reload = async () => {
    try {
      if (dirty && userEdited.current) {
        await drafts.put(repoId, path, { content, baseBlob, savedAt: Date.now() });
      }
      const s = await fetchServer();
      const d = await drafts.get(repoId, path);
      const committed = s.content ?? templateFor(path);
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
      const s = await fetchServer();
      userEdited.current = false;
      setServer(s.content);
      setBaseBlob(s.blob);
      setContent(s.content ?? templateFor(path));
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
      const s = await fetchServer();
      setBaseBlob(s.blob);
      setServer(s.content);
      live.current = { ...live.current, baseBlob: s.blob, server: s.content, conflict: false };
      setConflict(false);
      await save();
    } catch (e) { notifyError(e); }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      if (dirty) await save();
      const r = await api.publish(repoId);
      notifyOk(`published ${r.pushed.slice(0, 7)}`);
    } catch (e) { notifyError(e); }
    finally { setPublishing(false); }
  };

  // Flush the draft whenever we might lose the page mid-debounce: tab hidden
  // or closed, and — the easy one to miss — in-app navigation (back arrow,
  // history), which unmounts us and cancels the pending timers.
  useEffect(() => {
    const flush = () => {
      const { content: c, baseBlob: b, server: s } = live.current;
      if (userEdited.current && (s === null || c !== s)) void drafts.put(repoId, path, { content: c, baseBlob: b, savedAt: Date.now() });
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    const onUnload = (e: BeforeUnloadEvent) => {
      flush();
      const { content: c, server: s } = live.current;
      if (userEdited.current && (s === null || c !== s)) e.preventDefault();
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
  }, [repoId, path]);

  const words = useMemo(() => wordCount(content), [content]);
  const docTitle = useMemo(() => {
    const { toml } = splitFrontMatter(content);
    const t = toml ? tryParseToml(toml)?.title : null;
    return typeof t === 'string' && t.trim() ? t : null;
  }, [content]);
  const vp = useVisualViewport();
  useEffect(() => { if (!loading && !loadError) recents.touch(repoId, path, docTitle); }, [repoId, path, loading, loadError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!loading) recents.retitle(repoId, path, docTitle); }, [docTitle, loading, repoId, path]);
  const local = repo?.provider === 'local';

  const basename = path.split('/').pop() ?? path;
  const deleteFile = async () => {
    const committed = server !== null && baseBlob;
    const msg = committed
      ? `Delete ${path}?\n\nIt's removed in a new commit — still in version history, and nothing changes on the remote until you publish.`
      : `Discard ${path}? It was never saved.`;
    if (!window.confirm(msg)) return;
    try {
      if (committed) await api.deleteFile(repoId, path, baseBlob);
      userEdited.current = false;
      await drafts.clear(repoId, path);
      recents.remove(repoId, path);
      notifyOk(`deleted ${basename}`);
      navigate(`/repos/${repoId}`, { replace: true });
    } catch (e) { notifyError(e); }
  };
  const openHistory = () => navigate(`/repos/${repoId}/versions?path=${encodeURIComponent(path)}`);
  const stateText = conflict ? 'conflict' : saving ? 'saving…' : dirty ? (server === null ? 'new · modified' : 'modified')
    : savedAt ? `saved ${clock(savedAt)}` : 'saved';
  const menuItems = [
    { label: marks ? 'Hide markdown marks' : 'Show markdown marks', run: () => setMarks(!marks) },
    { label: 'Version history', run: openHistory },
    { label: 'Reload from server', run: () => void reload() },
    ...(repo && !local ? [{ label: 'Publish', run: () => void publish() }] : []),
    { label: <span style={{ color: tokens.negative }}>Delete file…</span>, run: () => void deleteFile() },
    { label: `${words} words`, disabled: true, run: () => {} },
  ];

  if (loading) return <Center><Spinner $size="24px" /></Center>;
  if (loadError) return <Center><ErrorText>{loadError}</ErrorText></Center>;

  return (
    <Shell style={{ top: vp.top, height: vp.height }}>
      <Bar>
        <NavButton />
        <TitleBlock title={path}>
          <DocTitle>{docTitle ?? basename}</DocTitle>
          <DocPath>{path}</DocPath>
        </TitleBlock>
        <SaveState>
          <DirtyDot $saved={!dirty} title={dirty ? 'modified — ⌘S to save' : 'saved'} />
          <StateLabel style={{ color: conflict ? tokens.negative : undefined }}>{stateText}</StateLabel>
        </SaveState>
        <Full />
        <Button size={SIZE.mini} kind={KIND.tertiary} aria-label="post settings" aria-expanded={sheet}
          title="post settings" onClick={() => setSheet(!sheet)}>⚙</Button>
        <Button size={SIZE.mini} kind={KIND.tertiary} aria-pressed={tab === 'preview'}
            onClick={() => setTab(tab === 'write' ? 'preview' : 'write')}>{tab === 'write' ? 'preview' : 'edit'}</Button>
        {repo && !local && !dirty && (
          <NotPhone><Button size={SIZE.mini} kind={KIND.secondary} isLoading={publishing} onClick={() => void publish()}>publish</Button></NotPhone>
        )}
        <Button size={SIZE.mini} kind={dirty ? KIND.primary : KIND.tertiary} isLoading={saving}
          disabled={!dirty || conflict} onClick={() => void save()}>save</Button>
        <StatefulPopover placement={PLACEMENT.bottomRight}
            content={({ close }) => (
              <StatefulMenu
                items={menuItems}
                onItemSelect={({ item }) => { if (!item.disabled) { close(); item.run(); } }}
                overrides={{
                  List: { style: { width: '220px', backgroundColor: tokens.bg, border: `1px solid ${tokens.border}`, boxShadow: 'none' } },
                  Option: { props: { overrides: { ListItem: { style: { fontSize: '13px', paddingTop: '12px', paddingBottom: '12px' } } } } },
                }}
              />
            )}>
            <Button size={SIZE.mini} kind={KIND.tertiary} aria-label="more actions">⋯</Button>
        </StatefulPopover>
      </Bar>

      {conflict && (
        <Banner $kind="danger">
          <span style={{ color: tokens.negative }}>conflict</span>
          <span style={{ color: tokens.fgMuted }}>this file changed on the server since you opened it</span>
          <Full />
          <Button size={SIZE.mini} kind={KIND.tertiary} onClick={() => void keepMine()}>keep mine</Button>
          <Button size={SIZE.mini} kind={KIND.tertiary} onClick={() => void reload()}>take server version</Button>
        </Banner>
      )}

      {offer && (
        <Banner>
          <span style={{ color: tokens.accent }}>local draft from {clock(offer.savedAt)}</span>
          {offer.applied ? (
            <>
              <span style={{ color: tokens.fgMuted }}>restored instead of the committed file</span>
              <Full />
              <Button size={SIZE.mini} kind={KIND.tertiary} onClick={() => void discardDraft()}>discard, show committed</Button>
            </>
          ) : (
            <>
              <span style={{ color: tokens.fgMuted }}>differs from the committed file</span>
              <Full />
              <Button size={SIZE.mini} kind={KIND.tertiary} onClick={restoreDraft}>restore</Button>
              <Button size={SIZE.mini} kind={KIND.tertiary} onClick={() => void discardDraft()}>discard</Button>
            </>
          )}
        </Banner>
      )}

      <Body>
        <div style={{ display: tab === 'write' ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}>
          <CodeMirror ref={editor} value={content} onChange={onChange} showMarks={marks} onSave={() => void save()} onSelection={setSelBox} />
        </div>
        {tab === 'preview' && <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}><Preview content={content} repoId={repoId} path={path} /></div>}
        {sheet && (
          <SettingsPane aria-label="post settings">
            <PaneHead>
              Post settings
              <Full />
              <Button size={SIZE.mini} kind={KIND.tertiary} aria-label="close settings" onClick={() => setSheet(false)}>✕</Button>
            </PaneHead>
            <FrontMatterSheet content={content} onClose={() => setSheet(false)}
              onApply={(next) => { userEdited.current = true; setContent(next); }} />
          </SettingsPane>
        )}
      </Body>

      {tab === 'write' && !sheet && <MobileToolbar editor={editor} selecting={!!selBox} />}
      {tab === 'write' && selBox && finePointer && <FormatPopover box={selBox} editor={editor} />}

      <Status>
        <span>{words} words</span>
        <Full />
        <span>⌘S save · autosaves while you type</span>
      </Status>
    </Shell>
  );
}
