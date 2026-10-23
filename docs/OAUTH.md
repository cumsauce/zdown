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

## GitLab (M2, same pattern)

1. GitLab → Preferences → Applications → **Add new application**
   <https://gitlab.com/-/profile/applications>
2. Redirect URI: `http://localhost:5175/api/auth/gitlab/callback`
3. Scopes: `api`, `read_user`, `write_repository`
4. Same `[providers.gitlab]` block in `config.toml`.

## Token storage

Provider tokens are encrypted with `secret_key` before hitting SQLite and are
never sent to the browser. Session cookies are signed, HttpOnly, SameSite=Lax.
