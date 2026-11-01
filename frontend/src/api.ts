// Typed same-origin fetch wrapper. Auth is the session cookie (or the
// backend's dev_auto_login), so nothing is attached here.

export interface Me { id: number; provider: string; login: string; name: string | null; avatar_url: string | null }
export interface Repo { id: number; provider: string; full_name: string; default_branch: string }
export interface AvailableRepo { full_name: string; private: boolean; default_branch: string }
export interface PostSummary {
  path: string;
  title: string | null;
  blob: string;
  shortcodes: string[];
  valid_front_matter: boolean;
  date: string | null;
  updated: string | null;
  draft: boolean;
  description: string | null;
  weight: number | null;
  sort_by: string | null;
  transparent: boolean;
  render: boolean;
  /** last commit touching the file, unix seconds */
  modified: number | null;
}
export interface Post {
  path: string;
  blob: string | null;
  head_ref: string;
  content: string;
  title: string | null;
  valid_front_matter: boolean;
}
export interface ShortcodeTemplate { name: string; path: string; kind: 'html' | 'md'; source: string }
/** A Tera `{% component %}` (Zola >= 0.23); `source` is the whole definition. */
export interface ComponentTemplate { name: string; path: string; source: string }
export interface Site {
  zola: boolean;
  /** folder holding the site config, "" or "web/" */
  root: string;
  title: string | null;
  base_url: string | null;
  description: string | null;
  theme: string | null;
  extra: Record<string, unknown>;
  images: string[];
  shortcodes: ShortcodeTemplate[];
  components: ComponentTemplate[];
}
export interface Changed { status: string; path: string }
export interface RepoStatus { ahead: number; changed: Changed[] }
export interface SiteData { head: string; posts: PostSummary[]; site: Site; status: RepoStatus }
export interface SyncResult { ok: boolean; state: string; conflicts: string[]; moved: boolean }
export interface Version { sha: string; author: string; email: string; time: number; subject: string }
export interface SaveResult { ok: boolean; blob: string; branch: string }

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401 && data && typeof data === 'object' && (data as { error?: string }).error === 'gate') {
    // the site gate's pass expired mid-session: go through it and come back
    window.location.assign(`/gate?next=${encodeURIComponent(location.pathname + location.search)}`);
  }
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'error' in data) ? String((data as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const api = {
  me: () => req<Me>('GET', '/api/me'),
  providers: () => req<{ providers: { id: string; label: string }[] }>('GET', '/api/auth/providers'),
  logout: () => req<{ ok: boolean }>('POST', '/api/auth/logout'),
  repos: () => req<Repo[]>('GET', '/api/repos'),
  available: (provider?: string) =>
    req<AvailableRepo[]>('GET', `/api/repos/available${provider ? `?${q({ provider })}` : ''}`),
  importRepo: (provider: string, full_name: string) => req<Repo>('POST', '/api/repos', { provider, full_name }),
  createScratch: (full_name: string) => req<Repo>('POST', '/api/repos', { full_name }),
  removeRepo: (id: number) => req<{ ok: boolean }>('DELETE', `/api/repos/${id}`),
  sync: (id: number, resolve?: 'mine' | 'theirs') =>
    req<SyncResult>('POST', `/api/repos/${id}/sync${resolve ? `?${q({ resolve })}` : ''}`),
  site: (id: number) => req<SiteData>('GET', `/api/repos/${id}/posts`),
  post: (id: number, path: string) => req<Post>('GET', `/api/repos/${id}/post?${q({ path })}`),
  save: (id: number, body: { path: string; content: string; base_blob?: string | null; message?: string; autosave?: boolean }) =>
    req<SaveResult>('POST', `/api/repos/${id}/post/content`, body),
  rename: (id: number, from: string, to: string, base_blob: string) =>
    req<{ ok: boolean; path: string }>('POST', `/api/repos/${id}/post/rename`, { from, to, base_blob }),
  uploadImage: async (id: number, path: string, file: Blob) => {
    const res = await fetch(`/api/repos/${id}/assets?${q({ path })}`, { method: 'POST', credentials: 'same-origin', body: file });
    const data = await res.json().catch(() => null) as { error?: string; path?: string } | null;
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`);
    return data as { ok: boolean; path: string };
  },
  deleteFile: (id: number, path: string, base_blob: string) =>
    req<{ ok: boolean }>('DELETE', `/api/repos/${id}/post?${q({ path, base_blob })}`),
  versions: (id: number, path: string) => req<Version[]>('GET', `/api/repos/${id}/post/versions?${q({ path })}`),
  contentAt: (id: number, sha: string, path: string) =>
    req<{ content: string }>('GET', `/api/repos/${id}/post/content_at?${q({ sha, path })}`),
  diff: (id: number, range: string, path: string) =>
    req<{ diff: string }>('GET', `/api/repos/${id}/diff?${q({ range, path })}`),
  publish: (id: number) => req<{ ok: boolean; pushed: string }>('POST', `/api/repos/${id}/publish`),
  connect: (id: number, full_name: string, provider?: string) =>
    req<{ ok: boolean; provider: string; full_name: string }>('POST', `/api/repos/${id}/connect`, { provider, full_name }),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const providerLabel = (id: string) =>
  ({ github: 'GitHub', gitlab: 'GitLab', local: 'local' } as Record<string, string>)[id] ?? id;
