import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { styled } from 'baseui';
import { Select } from 'baseui/select';
import { SIZE } from 'baseui/input';
import { api, ApiError, errorMessage, type Repo } from '../api';
import { useShell } from '../components/AppShell';
import { Hint, TextInput } from '../components/ui';
import { tomlLiteral } from '../lib/frontmatter';
import { editUrl, recents } from '../lib/recents';
import { notifyError } from '../notify';
import { tokens } from '../theme';

// The signed-in landing is a blank page. Start typing: once there's a body
// (or you press Enter in the title) the file is created as a commit and the
// page becomes the real editor, cursor where you left off. Nothing to click.
// Default destination is a local "notes" scratchpad, created on first use.

const NEW_NOTES = 'new:notes';
const DEST_KEY = 'zdown.dest';
const DIR_KEY = 'zdown.dir.';
const IDLE_MS = 700;

const Wrap = styled('div', {
  maxWidth: '720px',
  margin: '0 auto',
  padding: '48px 24px 96px',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 'calc(100vh - 48px)',
  '@media (max-width: 639px)': { padding: '16px 14px 64px' },
});

const Where = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '6px',
});

const TitleField = styled('input', {
  border: 'none',
  outline: 'none',
  background: 'none',
  padding: 0,
  margin: '0 0 12px',
  width: '100%',
  fontFamily: tokens.serif,
  fontSize: '32px',
  fontWeight: 500,
  color: tokens.fg,
  '::placeholder': { color: tokens.fgFaint },
  '@media (max-width: 639px)': { fontSize: '24px' },
});

const BodyField = styled('textarea', {
  border: 'none',
  outline: 'none',
  background: 'none',
  resize: 'none',
  padding: 0,
  flex: 1,
  minHeight: '50vh',
  width: '100%',
  fontFamily: tokens.serif,
  fontSize: '17px',
  lineHeight: 1.65,
  color: tokens.fgSoft,
  '::placeholder': { color: tokens.fgFaint },
});

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const defaultDir = (r: Repo | undefined) =>
  (r && store.get(DIR_KEY + r.id)) ?? (r && r.provider !== 'local' ? 'content/' : '');

const compose = (title: string, body: string) => {
  const today = new Date().toISOString().slice(0, 10);
  return `+++\ntitle = ${tomlLiteral(title.trim() || 'Untitled')}\ndate = ${today}\n+++\n\n${body}`;
};

export function Home() {
  const { repos, reloadRepos } = useShell();
  const navigate = useNavigate();
  const loc = useLocation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dest, setDest] = useState<string | null>(null);
  const [dir, setDir] = useState<string | null>(null); // null = derived from destination
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ title, body });
  latest.current = { title, body };
  const creating = useRef(false);

  // "+ New file" while already here resets the page.
  useEffect(() => { setTitle(''); setBody(''); setDir(null); setState('idle'); titleRef.current?.focus(); }, [loc.state]);

  const options = useMemo(() => {
    const list = (repos ?? []).map((r) => ({
      id: String(r.id),
      label: `${r.full_name.split('/').pop()}${r.provider === 'local' ? ' · local' : ` · ${r.full_name}`}`,
    }));
    if (!(repos ?? []).some((r) => r.provider === 'local')) list.unshift({ id: NEW_NOTES, label: 'notes · local' });
    return list;
  }, [repos]);

  // Destination: last used, else first local scratchpad, else a new "notes".
  const destId = dest ?? (() => {
    const last = store.get(DEST_KEY);
    if (last && options.some((o) => o.id === last)) return last;
    const local = (repos ?? []).find((r) => r.provider === 'local');
    return local ? String(local.id) : options[0]?.id ?? NEW_NOTES;
  })();
  const destRepo = repos?.find((r) => String(r.id) === destId);
  const folder = (dir ?? defaultDir(destRepo)).replace(/^\/+/, '');
  const prefix = folder && !folder.endsWith('/') ? `${folder}/` : folder;
  const path = `${prefix}${slugify(title)}.md`;

  const create = async () => {
    if (creating.current || !repos) return;
    creating.current = true;
    setState('saving');
    try {
      let repoId: number;
      if (destId === NEW_NOTES) {
        repoId = (await api.createScratch('notes')).id;
        reloadRepos();
      } else {
        repoId = Number(destId);
      }
      // Never overwrite: bump the name until it's free.
      let p = path;
      for (let n = 2; ; n++) {
        try { await api.post(repoId, p); p = path.replace(/\.md$/, `-${n}.md`); }
        catch (e) { if (e instanceof ApiError && e.status === 404) break; throw e; }
      }
      const first = compose(latest.current.title, latest.current.body);
      await api.save(repoId, { path: p, content: first, message: `new: ${p}` });
      store.set(DEST_KEY, String(repoId));
      if (dir !== null) store.set(DIR_KEY + repoId, folder);
      recents.touch(repoId, p, latest.current.title.trim() || 'Untitled');
      // Anything typed while the save was in flight rides along to the editor.
      const now = compose(latest.current.title, latest.current.body);
      navigate(editUrl(repoId, p), { replace: true, state: { pending: now !== first ? now : undefined, focusEnd: true } });
    } catch (e) {
      creating.current = false;
      setState('error');
      notifyError(new Error(`couldn't create the file: ${errorMessage(e)}`));
    }
  };

  // Autosave-by-creation: once there's body text and you pause, it's a file.
  useEffect(() => {
    if (!body.trim() || state !== 'idle') return;
    const t = setTimeout(() => void create(), IDLE_MS);
    return () => clearTimeout(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const status = state === 'saving' ? 'saving…'
    : state === 'error' ? 'not saved — keep typing to retry'
    : body.trim() ? 'saving soon…' : 'saves automatically once you start writing';

  return (
    <Wrap>
      <Where>
        <div style={{ flex: '0 1 200px', minWidth: 0 }}>
          <Select size={SIZE.mini} options={options} clearable={false} searchable={false} aria-label="save to"
            value={options.filter((o) => o.id === destId)} isLoading={repos === null}
            onChange={(p) => { setDest(String(p.value[0]?.id)); setDir(null); }} />
        </div>
        <div style={{ flex: '0 1 140px', minWidth: 0 }}>
          <TextInput value={folder} placeholder="folder" aria-label="folder" onChange={(e) => setDir(e.currentTarget.value)} />
        </div>
      </Where>
      <Hint style={{ marginBottom: 32 }}>
        {path} · <span style={{ color: state === 'error' ? tokens.negative : undefined }}>{status}</span>
      </Hint>
      <TitleField ref={titleRef} autoFocus value={title} placeholder="Untitled" aria-label="title"
        onChange={(e) => { setTitle(e.currentTarget.value); if (state === 'error') setState('idle'); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (title.trim()) void create(); else bodyRef.current?.focus(); }
        }} />
      <BodyField ref={bodyRef} value={body} placeholder="Start writing…" aria-label="body"
        onChange={(e) => { setBody(e.currentTarget.value); if (state === 'error') setState('idle'); }} />
    </Wrap>
  );
}
