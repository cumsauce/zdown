// Typed same-origin fetch wrapper. Auth is the session cookie (or the
// backend's dev_auto_login), so nothing is attached here.

export interface Me { id: number; provider: string; login: string; name: string | null; avatar_url: string | null }
export interface Repo { id: number; provider: string; full_name: string; default_branch: string }
export interface AvailableRepo { full_name: string; private: boolean; default_branch: string }
export interface PostSummary { path: string; title: string | null; blob: string; shortcodes: string[]; valid_front_matter: boolean }
export interface Post extends PostSummary {
  head_ref: string;
  content: string;
  front_matter: Record<string, unknown>;
  body: string;
}
export interface Version { sha: string; author: string; email: string; time: number; subject: string }
export interface SaveResult { ok: boolean; blob: string; branch: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown, onHeaders?: (h: Headers) => void): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  onHeaders?.(res.headers);
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401 && data && typeof data === 'object' && (data as { error?: string }).error === 'gate') {
    // the site gate's pass expired mid-session: go through it and come back
    window.location.assign(`/gate?next=${encodeURIComponent(location.pathname + location.search)}`);
  }
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'error' in data) ? String((data as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
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
  sync: (id: number) => req<{ ok: boolean }>('POST', `/api/repos/${id}/sync`),
  posts: async (id: number) => {
    let syncError: string | null = null;
    const posts = await req<PostSummary[]>('GET', `/api/repos/${id}/posts`, undefined, (h) => { syncError = h.get('X-Sync-Error'); });
    return { posts, syncError: syncError as string | null };
  },
  post: (id: number, path: string) => req<Post>('GET', `/api/repos/${id}/post?${q({ path })}`),
  save: (id: number, body: { path: string; content: string; base_blob?: string | null; message?: string }) =>
    req<SaveResult>('POST', `/api/repos/${id}/post/content`, body),
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
