#!/usr/bin/env bash
# Reset the local E2E harness: a bare origin with a small Zola site, a seeded
# user+repo, and a server on :8100. Run scripts/e2e/flow.py against it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
W=/tmp/md_ui
B=http://127.0.0.1:8100

pkill -f 'bin/md_editor' 2>/dev/null || true
sleep 1
rm -rf "$W"
mkdir -p "$W/seed/content/blog" "$W/data"

# --- seed site -------------------------------------------------------------
cd "$W/seed"
git init -q -b main .
git config user.email test@example.com
git config user.name Test
cat > config.toml <<'EOF'
base_url = "https://doomy.org"
title = "doomy"
EOF
cat > content/_index.md <<'EOF'
+++
title = "home"
+++

welcome.
EOF
cat > content/blog/hello.md <<'EOF'
+++
title = "Hello, Zola"
date = 2026-01-04
[taxonomies]
tags = ["meta", "zola"]
+++

First post. Some **bold** and a [link](https://www.getzola.org).

```rust
fn main() { println!("hi"); }
```
EOF
cat > content/blog/shortcodes.md <<'EOF'
+++
title = "Shortcodes & friends"
date = 2026-02-11
+++

Embedded video:

{{ youtube(id="dQw4w9WgXcQ") }}

Note box:

{% note(type="warning") %}
Careful with this one.
{% end %}
EOF
cat > content/blog/draft.md <<'EOF'
+++
title = "Notes on drafts"
date = 2026-03-02
draft = true
+++

Still cooking.
EOF
cat > content/blog/broken.md <<'EOF'
title = "no front matter delimiters"

This file has no +++ fence.
EOF
git add -A && git commit -qm "initial zola site"
git clone -q --bare "$W/seed" "$W/origin.git"

# The server mirrors "https://github.com/<full_name>.git"; point that at the
# local bare repo so no network is involved. A second, empty bare repo backs
# the "connect a local scratch repo" flow (remote must be empty).
git init -q --bare "$W/origin-new.git"
cat > "$W/gitconfig" <<EOF
[url "$W/origin.git"]
	insteadOf = https://github.com/test/zola-site.git
[url "$W/origin-new.git"]
	insteadOf = https://github.com/test/scratch.git
EOF

# --- server config ---------------------------------------------------------
cat > "$W/config.toml" <<EOF
[server]
host = "127.0.0.1"
port = 8100
secret_key = "1111111111111111111111111111111111111111111111111111111111111111"
data_dir = "$W/data"
public_origin = "$B"

[providers.github]
client_id = "dev-client"
client_secret = "dev-secret"
EOF

# --- seed + start ----------------------------------------------------------
cd "$ROOT"
PATH=/opt/homebrew/bin:$PATH \
  GIT_CONFIG_GLOBAL="$W/gitconfig" MD_EDITOR_CONFIG="$W/config.toml" \
  crystal run scripts/seed_dev.cr -- test/zola-site | tee "$W/seed.out"
sed -n 's/^session=//p' "$W/seed.out" > "$W/session.txt"

GIT_CONFIG_GLOBAL="$W/gitconfig" MD_EDITOR_CONFIG="$W/config.toml" \
  nohup "$ROOT/bin/md_editor" > "$W/server.log" 2>&1 < /dev/null &
disown
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$B/")" = "200" ] && break
  sleep 0.5
done
echo "harness ready at $B  (session in $W/session.txt)"
