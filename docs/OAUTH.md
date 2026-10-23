# OAuth provider setup

Both flows need the server's public origin. For dev that's `http://localhost:5175`
(the Vite dev server proxies `/api` to Crystal on `:3000`). For prod use your real domain.

## GitHub

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App
   <https://github.com/settings/developers>
2. Fill in:
   - Application name: `md_editor (dev)`
   - Homepage URL: `http://localhost:5175`
   - Authorization callback URL: `http://localhost:5175/api/auth/github/callback`
3. Create. Copy the **Client ID**, then "Generate a new client secret" and copy it.
4. Put both in `config.toml`:

```toml
[server]
secret_key = "<run: openssl rand -hex 32>"

[providers.github]
client_id = "..."
client_secret = "..."
```

Scopes requested: `repo` (private repo read/write) and `read:user`.

## GitLab

1. GitLab → Preferences → Applications → **Add new application**
   <https://gitlab.com/-/user_settings/applications> (or your instance's equivalent)
2. Redirect URI: `http://localhost:5175/api/auth/gitlab/callback`
3. Confidential: yes. Scopes: `api`, `read_user`, `write_repository`
4. In `config.toml`:

```toml
[providers.gitlab]
client_id = "..."       # "Application ID"
client_secret = "..."
# base_url = "https://gitlab.example.com"   # self-hosted only
```

GitLab access tokens expire after ~2 hours; the refresh token is stored
(encrypted) and the server refreshes transparently. Git over HTTPS uses
`Authorization: Basic oauth2:<token>` (GitLab's form), GitHub uses Bearer.

Each provider login is its own account: a GitLab sign-in sees GitLab repos.

## Restricting access

```toml
[access]
password = "..."                       # site gate: every page, asset and API call
allowed_users = ["github:lume", "gitlab:lume"]   # sign-in allowlist
```

The gate is a server-rendered `/gate` page that sets a signed, HttpOnly
30-day cookie (changing the password invalidates it). `MD_EDITOR_GATE_PASSWORD`
overrides the config value. Both checks are skipped when
`server.dev_auto_login = true`.

## Token storage

Provider tokens are encrypted with `secret_key` before hitting SQLite and are
never sent to the browser. Session cookies are signed, HttpOnly, SameSite=Lax.
