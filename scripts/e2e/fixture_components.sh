#!/usr/bin/env bash
# Writes a Zola >= 0.23 site to $1: Tera v2 components, content that is itself a
# template. `zola build` must pass on it; zola_parity.py compares our rendering
# against the real thing.
set -euo pipefail
D="$1"
mkdir -p "$D/content/blog/trip" "$D/templates/ui" "$D/static/images"
cd "$D"
git init -q -b main .
git config user.email test@example.com
git config user.name Test
python3 - <<'PY'
import struct, zlib
def png(path, w, h, a, b):
    def chunk(t, x):
        c = t + x
        return struct.pack(">I", len(x)) + c + struct.pack(">I", zlib.crc32(c))
    raw = b"".join(bytes([0]) + b"".join(bytes(int(p * (1 - x / w) + q * x / w) for p, q in zip(a, b)) for x in range(w)) for _ in range(h))
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
png("static/images/harbor.png", 480, 270, (196, 61, 28), (240, 200, 120))
png("content/blog/trip/map.png", 320, 200, (40, 90, 120), (160, 210, 200))
PY
cat > config.toml <<'EOF'
base_url = "https://doomy.org"
title = "Components Site"

[extra]
author = "doomy"
EOF
cat > templates/page.html <<'EOF'
<!doctype html><html><body><main>{{ page.content | safe }}</main></body></html>
EOF
cat > templates/index.html <<'EOF'
<!doctype html><html><body><main>{{ section.content | safe }}</main></body></html>
EOF
cp templates/index.html templates/section.html
cat > templates/components.html <<'EOF'
{% component note(kind: string = "info", title: string = "") %}
<aside class="note note-{{ kind }}">{% if title %}<strong>{{ title }}</strong>{% endif %}{{ body }}</aside>
{% endcomponent note %}
{% component mdnote(kind="info") %}
<aside class="mdnote {{ kind }}">{{ body | markdown | safe }}</aside>
{% endcomponent mdnote %}
{% component fig(src: string, caption: string = "", ...attrs) %}
<figure><img src="{{ get_url(path=src) }}" alt="{{ attrs.alt or '' }}">{% if caption %}<figcaption>{{ caption }}</figcaption>{% endif %}</figure>
{% endcomponent fig %}
{% component youtube(id: string, autoplay: bool = false) %}
<iframe src="https://www.youtube-nocookie.com/embed/{{ id }}{% if autoplay %}?autoplay=1{% endif %}" title="Video"></iframe>
{% endcomponent youtube %}
{% component tally(n: number, items: array = []) %}
<p class="tally"><b>{{ n + 1 }}</b>{% for i in items %}<i>{{ loop.index }}:{{ i | upper }}</i>{% endfor %}</p>
{% endcomponent tally %}
{% component bomb() %}
<div class="bomb" onclick="alert(1)">safe<script>window.__pwned = true;</script></div>
{% endcomponent bomb %}
EOF
cat > templates/ui/cards.html <<'EOF'
{% component ui.card(title: string) %}
<div class="card"><h3>{{ title }}</h3>{{ body }}</div>
{% endcomponent ui.card %}
EOF
cat > content/_index.md <<'EOF'
+++
title = "Home"
sort_by = "date"
+++

Welcome to {{ config.title }}.
EOF
cat > content/blog/_index.md <<'EOF'
+++
title = "Writing"
sort_by = "date"
+++
EOF
cat > content/blog/trip/index.md <<'EOF'
+++
title = "Trip <notes>"
date = 2026-05-01
[extra]
mood = "good"
+++

The mood was {{ page.extra.mood }} on {{ config.title }}, by {{ config.extra.author }}.

{% <note kind="warning" title="Careful"> %}
Plain body text.
{% </note> %}

{% <mdnote kind="tip"> %}
A **bold** body:

- one
- two
{% </mdnote> %}

{{ <fig src="images/harbor.png" caption="The harbor" alt="Harbor" /> }}

{{ <youtube id="dQw4w9WgXcQ" /> }}

{{ <tally n={2} items={["a", "b"]} /> }}

{% <ui.card title="Nested"> %}
{{ <tally n={41} /> }}
{% </ui.card> %}

{% set kind = "tip" %}
{% set o = {"kind": "danger"} %}
{% <note {...o}> %}
Spread attributes.
{% </note> %}

{% for i in [1, 2] %}
- loop item {{ i }}
{% endfor %}

{% if page.title %}Conditional shows.{% else %}Conditional hides.{% endif %}

Inline {{ get_url(path="images/harbor.png") }} and {{ "ternary" if page.title else "no" }} and {{ page?.nothing?.x or "fallback" }} and {{ [1, 2, 3][::-1] }}.

A comment {# hidden #} here.

{% raw %}{{ page.title }}{% endraw %} is how you show the syntax.

Colocated image: ![Map](map.png)

Content root image: ![Map again](@/blog/trip/map.png)

{{ <bomb /> }}
EOF
git add -A
git commit -qm "initial site"
