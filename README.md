# zdown

(binary/internal name: `md_editor`)

A small, self-hosted markdown editor for git-backed blogs (Zola-style `+++`
TOML front matter). Sign in with GitHub or GitLab, pick a repo, write — on a
laptop or one-thumbed on a phone.

- **Every save is a git commit** on your own working branch (`<repo>-user`)
  in a server-side bare mirror. Nothing reaches your remote until you press
  **publish**, which pushes that branch to the repo's default branch
  (fast-forward only — it never force-pushes).
- Full per-file history, diffs, and restore (restore = a new commit; history
  is never rewritten).
- Live-formatted editor (CodeMirror 6), preview, front-matter form, a
  keyboard-accessory toolbar on phones, local drafts in the browser as a
  safety net, conflict detection when the file changed elsewhere.
- Local "scratchpads": write without any remote, connect one later.
- One static binary + a built SPA. State is SQLite + bare git repos in one
  directory. No other services.

This README is for running it **as a podman container on NixOS** (flake
configs). Development notes are at the end.

---

## 1. What you need

- NixOS with `virtualisation.podman.enable = true` (the `oci-containers`
  module uses it as backend).
- A hostname with TLS in front of it (Caddy/nginx on the host). OAuth
  providers and secure cookies want `https://`.
- A GitHub OAuth App and/or a GitLab application (see §3).

## 2. Get the image

CI publishes a multi-arch (amd64 + arm64) image on every push to `main`:

```
ghcr.io/cumsauce/zdown:latest        # tip of main
ghcr.io/cumsauce/zdown:sha-<short>   # a specific commit (pin this for reproducibility)
ghcr.io/cumsauce/zdown:1.2.3         # release tags (git tag v1.2.3)
```

It's public — no registry login needed. Node builds the SPA, Crystal builds a
static binary, the runtime is Alpine + `git`, and it runs as uid 1000.

Prefer to build it yourself? `podman build -t localhost/zdown:latest .` from
this repo, then use that name below with `pull = "never"` (nixpkgs 25.05+).
Build with the same podman the service uses — `oci-containers` runs rootful,
so `sudo podman build`.

## 3. OAuth apps

Callback URLs use your public origin (`https://md.example.com` below).

**GitHub** — Settings → Developer settings → OAuth Apps → New:
- Homepage: `https://md.example.com`
- Callback: `https://md.example.com/api/auth/github/callback`
- Scopes requested at login: `repo read:user`

**GitLab** (gitlab.com or self-hosted) — Preferences → Applications → Add:
- Redirect URI: `https://md.example.com/api/auth/gitlab/callback`
- Confidential: yes. Scopes: `api`, `read_user`, `write_repository`
- Self-hosted: set `base_url` (below).

You can enable one or both; the login page shows a button per configured
provider. Each provider login is its own account (a GitLab sign-in sees GitLab
repos).

## 4. Secrets

Keep secrets out of the Nix store. The server reads these **environment
variables**, which override the config file:

| variable | what |
|---|---|
| `MD_EDITOR_SECRET_KEY` | **required**, ≥32 chars: `openssl rand -hex 32`. Signs sessions, encrypts provider tokens at rest. Changing it signs everyone out and makes stored tokens unreadable (users just sign in again). |
| `MD_EDITOR_GITHUB_CLIENT_ID` / `MD_EDITOR_GITHUB_CLIENT_SECRET` | GitHub app |
| `MD_EDITOR_GITLAB_CLIENT_ID` / `MD_EDITOR_GITLAB_CLIENT_SECRET` | GitLab app |
| `MD_EDITOR_GATE_PASSWORD` | optional site password (§6) |

Put them in an env file managed by agenix / sops-nix, e.g. `md_editor.env`:

```sh
MD_EDITOR_SECRET_KEY=3f1c…64 hex chars…
MD_EDITOR_GITHUB_CLIENT_ID=Iv1.abc…
MD_EDITOR_GITHUB_CLIENT_SECRET=…
MD_EDITOR_GATE_PASSWORD=…
```

## 5. NixOS module

```nix
{ config, ... }:
let
  domain = "md.example.com";
in {
  virtualisation.podman.enable = true;
  virtualisation.oci-containers.backend = "podman";

  # Non-secret config: fine in the store.
  environment.etc."md_editor/config.toml".text = ''
    [server]
    host = "0.0.0.0"          # inside the container; the port is published on 127.0.0.1 below
    port = 3000
    data_dir = "/data"
    public_origin = "https://${domain}"

    [providers.github]        # ids/secrets come from the env file

    # [providers.gitlab]
    # base_url = "https://gitlab.example.com"   # only for self-hosted

    [access]
    allowed_users = ["github:your-login"]       # who may sign in; omit = anyone with an account
  '';

  # Data volume, owned by the container user (uid/gid 1000).
  systemd.tmpfiles.rules = [ "d /var/lib/md_editor 0750 1000 1000 -" ];

  virtualisation.oci-containers.containers.md_editor = {
    # Pin a sha-… tag for reproducible deploys; `latest` + `pull = "newer"`
    # (nixpkgs 25.05+) picks up new builds on service restart.
    image = "ghcr.io/cumsauce/zdown:latest";
    ports = [ "127.0.0.1:3000:3000" ];
    volumes = [
      "/var/lib/md_editor:/data"
      "/etc/md_editor/config.toml:/etc/md_editor/config.toml:ro"
    ];
    environmentFiles = [ config.age.secrets.md_editor.path ];  # or sops-nix's path
  };

  # TLS reverse proxy (Caddy shown; nginx works the same).
  services.caddy = {
    enable = true;
    virtualHosts.${domain}.extraConfig = ''
      encode zstd gzip
      reverse_proxy 127.0.0.1:3000
    '';
  };
  networking.firewall.allowedTCPPorts = [ 80 443 ];
}
```

`environment.etc` files are symlinks into the store; podman bind-mounts the
resolved file, which is what you want. If your podman complains, mount
`/etc/static/md_editor/config.toml` instead.

Update: bump the pinned tag and `nixos-rebuild switch`, or with `latest`:
`sudo podman pull ghcr.io/cumsauce/zdown:latest && sudo systemctl restart podman-md_editor`.

Check it:

```bash
systemctl status podman-md_editor
journalctl -u podman-md_editor -f
curl -s http://127.0.0.1:3000/healthz      # → ok
```

## 6. Access control

Two optional layers, both in `[access]`:

- **Site password** (`password = "…"` or `MD_EDITOR_GATE_PASSWORD`): every
  page, asset and API call sits behind a `/gate` page until the password is
  entered once (signed HttpOnly cookie, 30 days). Changing the password
  invalidates all passes. 10 wrong tries per address per 15 minutes, then a
  lockout. Behind a reverse proxy every client shares the proxy's address, so
  the lockout is effectively global — fine for a personal instance.
- **Allowlist** (`allowed_users = ["github:alice", "gitlab:bob"]`): only these
  `provider:login` pairs can sign in; removing someone also ends their
  existing session on the next request.

Use both for an internet-facing personal instance. `/healthz` is the only
path outside the gate.

**Never set `server.dev_auto_login = true` in production.** It signs every
visitor in as the first user *and disables both layers above*. The server
prints a large warning at startup when it's on.

## 7. Your data, and backups

Everything lives in the data volume (`/var/lib/md_editor`):

```
app.db, app.db-wal     SQLite: users, encrypted provider tokens, repo list
repos/<id>.git         one bare git mirror per repo
```

**Unpublished work exists only here** — your `<repo>-user` branch is not on
GitHub/GitLab until you publish. Back the directory up (restic/borg/ZFS
snapshots). For a consistent copy either stop the service briefly or use
`sqlite3 app.db ".backup app.db.bak"` for the database; git mirrors are safe
to copy live.

Safety properties worth knowing:

- Syncing with the remote never deletes or overwrites working branches, and
  mirrors keep a reflog (`git --git-dir=repos/1.git reflog show <branch>`), so
  even a bad ref move is recoverable.
- Saves are compare-and-swap: if the file or branch changed since you loaded
  it, you get a conflict banner (keep mine / take server version), never a
  silent overwrite.
- Publish is a normal push — if the remote moved, it's rejected, not forced.
- The browser also keeps a per-post draft in IndexedDB while you type; if a
  save never landed (offline, tab killed), reopening the post restores it.
- Removing a repo in the UI deletes its mirror **including unpublished work**
  (there's a confirm dialog — publish first).
- If the remote is unreachable, the post list still opens from the local
  mirror (with a warning).

Recover a mirror by hand any time — they're plain bare repos:

```bash
sudo -u '#1000' git --git-dir=/var/lib/md_editor/repos/1.git log --oneline mysite-user
```

## 8. Security notes

- Provider tokens are AES-256-GCM encrypted at rest and never sent to the
  browser. GitLab tokens (2h lifetime) are refreshed automatically.
- Git credentials are passed to `git` via environment, not argv (not visible
  in `ps`).
- Session/gate cookies are HttpOnly, SameSite=Lax, and `Secure` when
  `public_origin` is `https://`. State-changing requests from another site are
  refused (Origin / Sec-Fetch-Site check).
- Strict CSP (no inline script), `X-Frame-Options: DENY`, `nosniff`, HSTS when
  on https. The post preview renders raw HTML as text and drops
  `javascript:`/`data:` links, so a malicious post in a shared repo can't run
  script.
- Writes are restricted to relative `.md`/`.markdown` paths (no `..`, no
  `.git`). Request bodies are capped at 8 MB.
- The container runs as uid 1000, not root. Publish the port on `127.0.0.1`
  and let the proxy terminate TLS.
- Logout clears the cookie; sessions are stateless (30 days). To revoke all
  sessions at once, rotate `MD_EDITOR_SECRET_KEY`.

## 9. Configuration reference

All keys (see `config.example.toml`):

| key | default | |
|---|---|---|
| `server.host` | `127.0.0.1` | use `0.0.0.0` inside a container |
| `server.port` | `3000` | |
| `server.secret_key` | — | or `MD_EDITOR_SECRET_KEY` (preferred) |
| `server.data_dir` | `./data` | `/data` in the container |
| `server.public_origin` | `http://localhost:5175` | exact external URL, no trailing slash; used for OAuth callbacks and cookie flags |
| `server.public_dir` | `./public` | built SPA; already correct in the image |
| `server.dev_auto_login` | `false` | **dev only** |
| `providers.github.client_id/client_secret` | — | or env |
| `providers.gitlab.client_id/client_secret` | — | or env |
| `providers.gitlab.base_url` | `https://gitlab.com` | self-hosted GitLab |
| `access.password` | — | or `MD_EDITOR_GATE_PASSWORD` |
| `access.allowed_users` | `[]` (anyone) | `["github:login", …]` |

Config is read at startup only: `systemctl restart podman-md_editor` after
changes.

## Troubleshooting

- **"redirect_uri mismatch"** at GitHub/GitLab: `public_origin` must match the
  callback URL registered with the provider exactly (scheme, host, no slash).
- **Signed in, then immediately "not signed in"** over plain http: cookies are
  `Secure` only when `public_origin` is https — make sure the origin matches how
  you actually reach the site.
- **`permission denied` on `/data`**: the volume must be owned by uid 1000
  (the tmpfiles rule above), or add `--userns=keep-id` style mapping if you run
  rootless.
- **GitLab "session expired; sign in again"**: the refresh token was revoked
  or the app's secret changed — sign in again.
- **Publish rejected**: someone pushed to the default branch since your last
  sync. Your work is safe on `<repo>-user`; merge on the remote side (or
  locally with plain git against the mirror), then sync.

## Development

See `AGENTS.md` (toolchain paths, e2e harness, design system) and
`ARCHITECTURE.md`. Short version:

```bash
make check                         # typecheck the Crystal server
make spec                          # specs
make build                         # bin/md_editor
cd frontend && npm ci && npm run build   # SPA → ../public
MD_EDITOR_CONFIG=config.toml ./bin/md_editor
```

`cd frontend && npm run dev` runs Vite with `/api` proxied to `:8099`
(`MD_EDITOR_API` overrides).

## License

MIT
