import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, type Repo, type SiteData } from '../api';
import { recents } from './recents';
import { buildTree, type SiteTree } from './site';

// One in-memory copy of each site, shared by the sidebar, site page and editor,
// so navigating is instant: show what we have, refresh underneath. Syncing with
// the remote happens in the background and never blocks reading.

export interface SiteState {
  data: SiteData | null;
  tree: SiteTree | null;
  error: string | null;
  syncing: boolean;
  /** couldn't reach the remote; the local copy is still fully usable */
  syncError: string | null;
  /** files changed both here and on the remote, awaiting a decision */
  conflicts: string[];
  syncedAt: number | null;
}

const EMPTY: SiteState = { data: null, tree: null, error: null, syncing: false, syncError: null, conflicts: [], syncedAt: null };
const SYNC_EVERY_MS = 60_000;

const states = new Map<number, SiteState>();
const subs = new Set<() => void>();
const loading = new Map<number, Promise<void>>();
const lastSync = new Map<number, number>();

const get = (id: number) => states.get(id) ?? EMPTY;
function set(id: number, patch: Partial<SiteState>) {
  states.set(id, { ...get(id), ...patch });
  subs.forEach((f) => f());
}

export const siteStore = {
  get,
  /** Re-read the local copy (after a save, sync or rename). */
  load(id: number): Promise<void> {
    const running = loading.get(id);
    if (running) return running;
    const p = api.site(id)
      .then((data) => {
        set(id, { data, tree: buildTree(data.posts, data.site), error: null });
        recents.prune(id, new Set(data.posts.map((x) => x.path)));
      })
      .catch((e: unknown) => { set(id, { error: e instanceof Error ? e.message : String(e) }); })
      .finally(() => { loading.delete(id); });
    loading.set(id, p);
    return p;
  },
  /** Fetch the remote and fold it into the working branch. */
  async sync(id: number, repo: Repo | undefined, opts: { force?: boolean; resolve?: 'mine' | 'theirs' } = {}): Promise<boolean> {
    if (repo?.provider === 'local') return false;
    const now = Date.now();
    if (!opts.force && now - (lastSync.get(id) ?? 0) < SYNC_EVERY_MS) return false;
    lastSync.set(id, now);
    set(id, { syncing: true });
    try {
      const r = await api.sync(id, opts.resolve);
      set(id, { syncing: false, syncError: null, conflicts: r.state === 'conflict' ? r.conflicts : [], syncedAt: Date.now() });
      if (r.moved) await siteStore.load(id);
      return r.moved;
    } catch (e) {
      set(id, { syncing: false, syncError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },
  setConflicts(id: number, conflicts: string[]) { set(id, { conflicts }); },
  drop(id: number) { states.delete(id); lastSync.delete(id); subs.forEach((f) => f()); },
};

function subscribe(f: () => void) {
  subs.add(f);
  return () => { subs.delete(f); };
}

/** The site, loading it (and syncing in the background) on first use. */
export function useSite(id: number | null, repo?: Repo): SiteState {
  const state = useSyncExternalStore(subscribe, () => (id === null ? EMPTY : get(id)));
  useEffect(() => {
    if (id === null || Number.isNaN(id)) return;
    void siteStore.load(id);
  }, [id]);
  useEffect(() => {
    if (id === null || !repo) return;
    void siteStore.sync(id, repo);
  }, [id, repo]);
  return state;
}

// ---------- repos, shared the same way ----------

let repos: Repo[] | null = null;
const repoSubs = new Set<() => void>();
export const repoStore = {
  reload(): Promise<void> {
    return api.repos().then((r) => { repos = r; repoSubs.forEach((f) => f()); });
  },
};
export function useRepos(): Repo[] | null {
  const value = useSyncExternalStore((f) => { repoSubs.add(f); return () => repoSubs.delete(f); }, () => repos);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (repos === null && !asked) { setAsked(true); void repoStore.reload().catch(() => {}); }
  }, [asked]);
  return value;
}
