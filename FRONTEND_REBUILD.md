# Frontend rebuild prompt

Hand this to an agent (or follow it yourself) to reconstruct `md_editor/frontend/`
from scratch. The backend (Crystal/Kemal + SQLite + git mirrors) is complete and
must not be changed. The previous frontend was lost; only the last built bundle
in `md_editor/public/` survives (you may inspect it for reference, but write
clean source — don't decompile). Vite must be configured so `npm run build`
outputs to `../public` (that's what the Crystal server serves) with the usual
content-hashed asset filenames.

## Stack & project shape

- React 18 + TypeScript + Vite, React Router (full paths, no hash fragments).
- **baseui + styletron** for all chrome components (Button, Input, Select,
  Modal/Dialog, Toast). Dark theme only.
- CodeMirror 6 for the editor pane (`@codemirror/state`, `@codemirror/view`,
  `@codemirror/lang-markdown`, custom dark theme).
- `package.json` scripts: `dev` (vite, proxying `/api` to `http://127.0.0.1:8099`,
  overridable via `MD_EDITOR_API`), `typecheck` (`tsc -b --noEmit` semantics),
  `build` (`tsc -b && vite build` → `../public`).
- Source layout: `src/main.tsx`, `src/App.tsx` (router + auth gate), `src/api.ts`
  (typed fetch wrapper, same-origin, session cookie auth), `src/theme.ts`,
  `src/styles.css`, `src/pages/{Landing,Repos,Posts,Editor,Settings}.tsx`,
  `src/components/{CodeMirror,Preview,VersionHistory,...}.tsx`,
  `src/components/ui.tsx`, `src/lib/frontmatter.ts`.

## Theme (strict — this is a hard design system, "switchyard" tokens)

Dark, zero-radius, one accent hue. Central tokens object in `theme.ts`;
everything in `.tsx` consumes `tokens`, never raw hex:

```ts
export const tokens = {
  bg: '#000', fg: '#fff',            // canvas / primary text
  fgSoft: '#e5e5e5',                 // secondary list/body text
  fgMuted: '#8a8a8a',                // hints, meta, inactive controls
  fgFaint: '#5c5c5c',                // panel titles, placeholders
  border: '#262626',                 // panel/toolbar hairline
  rowRule: '#171717',                // separators BETWEEN rows inside a panel
  borderStrong: '#3a3a3a',           // emphasis hairline
  accent: '#7dd3fc',                 // the one hue: links, sha, cursor
  accentLine: '#1f3a4a', accentWash: '#060d12',  // accent banner
  dangerLine: '#4a2626', dangerWash: '#120606',  // conflict banner
  negative: '#f87171', warning: '#fbbf24', positive: '#4ade80',
  hover: '#0a0a0a', active: '#1f1f1f',
  codeBg: '#0d0d0d',
  serif: '"Newsreader", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
};
```

Rules: zero border-radius everywhere (zero out baseui's `buttonBorderRadius`,
`inputBorderRadius`, `inputBorderRadiusMini`, `popoverBorderRadius`,
`tagBorderRadius` in `createDarkTheme` overrides). Prose (preview + editor body)
= serif; chrome = sans; anything code-like (paths, shas, status, labels) = mono.
Type sizes: 11px labels/meta, 13px titles and list rows, 17px prose. Spacing
4/8/12/16/24. List rows inside panels: padding `10px 16px`, `rowRule`
separators, hover bg `hover`. Shared chrome primitives live once in
`components/ui.tsx` (`Page`, `Panel`, `Row`, `Full`, `Hint`, `ListRow`,
`TextBtn`, `MonoText`) and are reused everywhere. Buttons: baseui `Button`,
`SIZE.mini` everywhere in-app; one `primary` CTA per screen; `secondary` for
form create/import; `tertiary mini` for low-emphasis actions (sync, history,
sign out). Never hand-roll buttons/inputs/selects. Non-interactive text gets no
hover; interactive text brightens to `fg` or `accent`.

Fonts: Newsreader is self-hosted (woff/woff2, latin/latin-ext/vietnamese,
weights 400/500/600 + italics) — copy the font files from
`md_editor/public/assets/` (they survive) and register `@font-face` in
`styles.css`.

## Backend API (implemented — trust this exactly)

All routes under `/api`, JSON, cookie-session auth. Repos are owned by the
current user; repo ids in paths are `repo_id`. Note: posts are addressed by
**path within the repo**, not by post id.

- `GET /api/me` → `{id, provider, login, name, avatar_url}` (401 if not logged
  in; frontend: use this to gate routes → redirect to landing).
- `GET /api/auth/:provider/start` → 302 OAuth flow; `POST /api/auth/logout`.
- `GET /api/repos` → `[{id, provider, full_name, default_branch}]`. `provider`
  is `"github"`, `"gitlab"`, or **`"local"`** (scratch repo with no remote).
- `GET /api/repos/available?provider=` → `[{full_name, private, default_branch}]`
  not yet imported.
- `POST /api/repos` — with `{provider, full_name}` imports (mirror-clones) a
  provider repo; with **no `provider`**, `{full_name}` creates a local scratch
  repo (returns 201). 409 if the scratch name is taken.
- `DELETE /api/repos/:id`, `POST /api/repos/:id/sync` (fetch --prune).
- `GET /api/repos/:id/posts` →
  `[{path, title, blob, shortcodes, valid_front_matter}]` (fetches remote first
  for non-local repos; local repos skip that).
- `GET /api/repos/:repo_id/post?path=...` →
  `{path, blob, head_ref, content, title, valid_front_matter, shortcodes,
  front_matter, body}`. `content` is the **raw file including `+++` TOML front
  matter**; round-trip it verbatim, never re-serialize TOML client-side.
- `POST /api/repos/:repo_id/post/content` body
  `{path, content, base_blob, message?}` → commits; returns `{ok, blob,
  branch}`. **Conflict-safe**: if the file changed remotely since `base_blob`,
  you get **409** — surface a conflict UI (keep mine / take server version),
  never silently overwrite.
- `GET /api/repos/:repo_id/post/versions?path=` → commit list (sha, author,
  date, message). `GET /api/repos/:repo_id/post/content_at?sha=&path=` →
  `{content}` for any version. `GET /api/repos/:repo_id/diff?range=a..b&path=`
  → `{diff}` (unified diff text; also accepts a single rev, needed for root
  commits).
- `POST /api/repos/:repo_id/publish` → pushes the working branch to the remote
  (400 "nothing to publish" if empty; 409 if remote moved). **Hidden/disabled
  for `provider === "local"`.**
- `POST /api/repos/:repo_id/connect` body `{provider?, full_name}` → attaches a
  remote to a local repo and pushes history (409 if already connected / name
  taken). Local repos show this connect panel **instead of** sync/publish
  buttons, with a confirm dialog.

## Pages & behavior

1. **Landing** (`/`): hero explaining the app, one `primary` SIZE.default
   "Continue with GitHub" button → `/api/auth/github/start`. If already authed
   (`/api/me`), route straight to repos.
2. **Repos** (`/repos`): list of imported repos (path-styled mono full names,
   provider tag, sync + remove as tertiary mini actions, sync shows a spinner
   then success/error toast). "New scratchpad" form (name only → POST without
   provider) and "Import from GitHub" section fed by `/api/repos/available`.
   Empty states for both.
3. **Posts** (`/repos/:id`): list rows — title (13px), path (mono, muted),
   front-matter validity indicator, mtime. "New post" creates via the content
   endpoint (base_blob omitted → "Create …" commit). Editing front matter fields
   (title, etc.) happens in the editor.
4. **Editor** (`/repos/:id/edit?path=...`): the core screen.
   - **Tabs: Write / Preview** (no separate "code" tab — Write IS the raw
     markdown with live formatting, see below). Optional front-matter sheet:
     parsed TOML fields shown styled on `codeBg`, editable and round-tripped
     into the `+++` block.
   - **Write pane**: CodeMirror 6 with a custom dark theme built from tokens
     (accent cursor/selection, `codeBg` background, mono). **WYSIWYG decoration
     layer, on by default**: headings styled by level, `**bold**`/`*italic*`/
     inline code/links/quotes/lists styled live with the `#`/`**` markers
     dimmed — implemented as pure decorations, **never mutating document text**.
     Skip decorating `+++` front-matter lines and fenced-code interiors
     (decorate the fence line only). No `userSelect: 'none'` on decoration
     spans (breaks cursor placement).
   - **Mobile toolbar** (visible < 640px only, hairline `border` top): buttons
     H1 H2 H3 (also H4–H6, ideally behind a long-press/overflow), ```` ``` ````,
     **B**, *I*, link `[t](u)`, blockquote, list. Each wraps the selection or
     inserts at the cursor via CodeMirror `view.dispatch` (expose an insert
     command from the CodeMirror component — e.g. `forwardRef` +
     `useImperativeHandle` with `insert(before, after?)`). This exists because
     symbol characters are hard to type on phone keyboards; it must not require
     a hardware keyboard.
   - **Preview pane**: rendered markdown, serif 17px, restrained type scale
     (no giant headers), styled code blocks/quotes/links (accent on hover),
     `{% %}` shortcodes detected (helper `SHORTCODE_RE` in
     `lib/frontmatter.ts`) and shown as highlighted chips.
   - **Save**: dirty tracking (compare against loaded content), debounced
     autosave ~800ms + explicit save button; sends
     `{path, content, base_blob, message}`; on success updates `base_blob` from
     the response; on 409 show conflict banner (`dangerLine`/`dangerWash`) with
     keep-mine / take-theirs.
   - **History**: version list (sha mono accent, relative date, message),
     click → diff view of unified diff text rendered with simple +/- line
     coloring, "restore this version" → loads `content_at` into the editor and
     saves as a new commit (never rewrites history).
   - Top bar 44px (`0 16px` padding): back link, path (mono), save state (dirty
     dot / saved time), publish button (hidden for local repos), history
     toggle.
5. **Settings** (`/settings`): signed-in user (avatar, login), sign out,
   connected providers, token/connection status.

## Cross-cutting

- IndexedDB draft per post (debounced write of content + base_blob while
  typing); on load, if a local draft differs from server content → offer merge
  choice banner (use draft / discard), never auto-pick. Drafts are also the
  offline safety net.
- Toasts for sync/publish/save errors; confirm dialogs for destructive actions
  (remove repo, connect, discard draft).
- Fully responsive: single-column on mobile, the app must be usable one-thumbed
  on a phone (that's a primary use case — hence the toolbar). Test widths at
  375px.
- `GET /` HTML is served with `no-cache` by the backend and assets are
  immutable — no special handling needed client-side, just normal Vite output.

## Definition of done

`npm run typecheck` and `npm run build` both pass; app is manually exercisable
against the backend with `MD_EDITOR_CONFIG=<config> ./bin/md_editor` (config
enables `dev_auto_login`, which makes `/api/me` return the seeded user with no
cookie). No console errors on the main flows: login → repos → create scratchpad
→ new post → type with live formatting → mobile toolbar insert → save → version
→ restore → publish.

## Notes for the person driving (not part of the prompt)

- The surviving Newsreader font files in `public/assets/` can be reused
  verbatim.
- The e2e scripts (`scripts/e2e/flow.py`, `mobile_check.py`, `size_audit.py`)
  are intact — use them to verify the rebuild afterwards. Run them via
  `~/.local/bin/uv run --with playwright python scripts/e2e/<script>.py`.
