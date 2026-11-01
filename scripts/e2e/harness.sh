#!/usr/bin/env bash
# Reset the local E2E harness: a bare origin holding a realistic Zola site, a
# seeded user+repo, and a server on :8100. See scripts/e2e/experience.py.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
W=/tmp/md_ui
B=http://127.0.0.1:8100

pkill -f 'bin/md_editor' 2>/dev/null || true
sleep 1
rm -rf "$W"
mkdir -p "$W/data"

bash "$ROOT/scripts/e2e/fixture_site.sh" "$W/seed"
git clone -q --bare "$W/seed" "$W/origin.git"
bash "$ROOT/scripts/e2e/fixture_components.sh" "$W/seed-components"
git clone -q --bare "$W/seed-components" "$W/origin-components.git"

# The server mirrors "https://github.com/<full_name>.git"; point that at the
# local bare repo so no network is involved. A second, empty bare repo backs
# the "connect a local scratch repo" flow (remote must be empty).
git init -q --bare "$W/origin-new.git"
cat > "$W/gitconfig" <<EOF
[url "$W/origin.git"]
	insteadOf = https://github.com/test/zola-site.git
[url "$W/origin-components.git"]
	insteadOf = https://github.com/test/components-site.git
[url "$W/origin-new.git"]
	insteadOf = https://github.com/test/scratch.git
EOF

# --- server config ---------------------------------------------------------
cat > "$W/config.toml" <<EOF
[server]
host = "0.0.0.0"
port = 8100
secret_key = "1111111111111111111111111111111111111111111111111111111111111111"
data_dir = "$W/data"
public_origin = "$B"
public_dir = "$ROOT/public"
dev_auto_login = true

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
PATH=/opt/homebrew/bin:$PATH \
  GIT_CONFIG_GLOBAL="$W/gitconfig" MD_EDITOR_CONFIG="$W/config.toml" \
  crystal run scripts/seed_dev.cr -- test/components-site > /dev/null

python3 - <<PY
import os, subprocess
subprocess.Popen(['$ROOT/bin/md_editor'], stdout=open('$W/server.log', 'a'), stderr=subprocess.STDOUT,
    stdin=subprocess.DEVNULL, start_new_session=True,
    env={**os.environ, 'GIT_CONFIG_GLOBAL': '$W/gitconfig', 'MD_EDITOR_CONFIG': '$W/config.toml'})
PY
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$B/healthz")" = "200" ] && break
  sleep 0.5
done
echo "harness ready at $B  (session in $W/session.txt)"
