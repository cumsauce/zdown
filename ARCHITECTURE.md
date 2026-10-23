# md_editor — Architecture

Working name: **md_editor** (rename pending). A self-hostable, multi-user, multi-provider
markdown blog editor with git-backed storage and local versioning.

## Decision log

| Decision | Choice | Why |
|---|---|---|
| Backend language | Crystal (1.22, Kemal) | Fast, single small binary, Lua has no good git/OAuth story, Rust binary rejected as too heavy, Python "meh" |
| Git transport | **System `git` CLI** | smacker/libgit2.cr links but lacks clone/fetch/push, credential callbacks, and staging (index). Verified: `git clone --mirror`, `git log --json`, and `http.extraHeader` auth all work (GitHub correctly rejects bad tokens). Reliability > purity. |
| Git model | Bare mirror per imported repo, owned by server | Option B: server owns `<data_dir>/repos/<repo_id>.git`, syncs with GitHub/GitLab on demand; GitLab/GitHub are just remotes |
| Frontend | React + TS + Vite | Mature markdown ecosystem (CodeMirror 6), matches switchyard UI stack; Yew considered, lost on ecosystem |
| Routing | Full paths, no hash fragments | Explicit user preference |
| Accounts | OAuth login with the git provider | One flow gives identity + repo-scoped token. No password storage. Provider-abstracted: GitHub now, GitLab next, extensible |
| Database | SQLite (WAL mode) | Light/zero-ops, fine for public small-scale hosting; schema keeps a provider abstraction so Postgres can come later if needed |
| Versioning | Git commits as the version log | Every save = commit on the user's working branch; "version tree" UI reads `git log --json`. M2 adds visual tree/diff explorer |
| Offline safety | Browser-side draft store + explicit sync protocol | IndexedDB draft per post, periodic save, dirty-state banner; sync never blind-overwrites: server compares HEAD and refuses/merges |
| Zola awareness | Front matter + shortcode detection (M1), shortcode preview render (M2) | Parse `+++` TOML front matter; detect `{% %}` shortcodes and highlight/complete them |
| Style | switchyard tokens | `#000` canvas, white type, 1px hairlines (`#262626`), zero radius, mono for code/status. Restrained preview type scale (no giant headers) |
| Image CI | Actions multi-arch on **native runners**, per-arch digests merged into one manifest | QEMU-emulated static `--release` Crystal builds are unusably slow, so amd64/arm64 each build natively (amd64: `ubuntu-24.04`, arm64: `ubuntu-24.04-arm`) and push by digest; `merge` reassembles via `buildx imagetools create`. `main` ships `latest`/`sha-*`, `v*` git tags ship semver tags — keep tag = `shard.yml` version. Image: `ghcr.io/cumsauce/zdown` |

## Data flow

```
Browser (React SPA)
  │  REST/JSON, OAuth session cookie
  ▼
Crystal API server (Kemal)
  ├── SQLite (users, providers, repos, posts, sync_state)
  ├── Git worker ── spawn git CLI ──► bare mirror repos under data_dir
  │                                      │ http.extraHeader w/ OAuth token
  │                                      ▼
  │                              GitHub / GitLab (push/pull)
  └── OAuth flows ◄── provider apps (GitHub, GitLab)
```

## Multi-provider abstraction

- `providers` registry in code: each provider implements
  `authorize_url`, `exchange_code`, `refresh`, `fetch_repos`, `clone_url(token)`.
- GitHub provider ships in M1. GitLab provider is the same interface
  (OAuth endpoints + API base are config values).
- Tokens stored encrypted at rest (libsodium-style secretbox via Crystal `openssl`/
  secret key in config). Refresh handled server-side.

## API surface (v1)

All under `/api`, JSON, session cookie auth. Native app reuses the same routes.

```
GET  /api/auth/:provider/start        → 302 to provider authorize URL (state cookie set)
GET  /api/auth/:provider/callback     → exchange code, upsert user, set session
POST /api/auth/logout

GET  /api/me                          → { user, connected_providers }
GET  /api/repos                       → repos imported by current user
POST /api/repos                       → { provider, repo_full_name } → mirror clone, register
DELETE /api/repos/:id                 → unregister + delete mirror
POST /api/repos/:id/sync              → fetch --prune; returns new head

GET  /api/repos/:id/posts             → list markdown posts (path, title, front matter, mtime)
GET  /api/posts/:id                   → { path, content, front_matter, head_sha, dirty }
POST /api/posts/:id/content           → { base_sha, content } → verify head == base_sha,
                                        commit on user branch; 409 on mismatch (never blind-overwrite)
POST /api/posts/:id/restore           → { sha } → checkout content from old commit as new commit
GET  /api/posts/:id/versions          → git log --json for that path
GET  /api/repos/:id/diff?range=a..b   → unified diff for version views
POST /api/uploads/:repo_id            → image upload → stored under assets dir, committed, returns path

GET  /api/repos/:id/publish           → push user branch to remote (M1: explicit button)
```

## Offline/recovery protocol (reliability)

1. Every keystroke batch (debounced ~500ms) writes content + `base_sha` to IndexedDB.
2. On load: if IndexedDB draft exists and differs from server content → show merge UI
   ("browser draft newer / server newer / identical"), never auto-pick.
3. Save sends `base_sha`; server compares to mirror HEAD for that path.
   - match → commit, return new sha
   - mismatch → 409 + server content + diff; client offers "keep mine / keep theirs / edit merged"
4. Periodic background sync of mirror (configurable); crash-safe: all git mutations
   go through per-repo lock, commits are atomic, SQLite in WAL mode.

## Project layout

```
md_editor/
├── shard.yml
├── src/
│   ├── md_editor.cr          # entry, Kemal boot
│   ├── config.cr             # config file/env loading
│   ├── db.cr                 # SQLite setup + migrations
│   ├── models/               # user, provider_token, repo, post meta
│   ├── providers/            # provider.cr (interface), github.cr, gitlab.cr
│   ├── git/                  # shell wrapper: mirror, fetch, commit, log, diff, push
│   ├── api/                  # routes: auth, repos, posts, uploads
│   └── jobs/                 # background mirror sync
├── spec/
├── config.example.toml
└── docs/OAUTH.md             # provider app setup steps
```

## Milestones

- **M1 (core)**: GitHub OAuth login, import repo → mirror, post list, editor +
  live preview, IndexedDB drafts, conflict-safe save, explicit publish (push),
  image upload into repo.
- **M2**: visual version tree + diff explorer, Zola shortcode render preview,
  GitLab provider, auto-sync scheduling, public multi-user hardening.
