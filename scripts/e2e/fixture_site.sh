#!/usr/bin/env bash
# Writes a realistic Zola site to $1 and commits it: sections with different
# sort orders, dated filenames, page bundles with colocated images, static/
# images, site and theme shortcodes, a draft, a broken file, non-content
# markdown. `zola build` must pass on it (only the broken file is left out of
# the build check; see the test that removes it).
set -euo pipefail
D="$1"
mkdir -p "$D"
cd "$D"
git init -q -b main .
git config user.email test@example.com
git config user.name Test
mkdir -p content/blog/2023-06-14-trip-notes content/blog/field-guide content/projects content/docs/guides static/images templates/shortcodes themes/quill/templates/shortcodes themes/quill/content themes/quill/templates

python3 - <<'PY'
import struct, zlib
def png(path, w, h, rgb, rgb2):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    rows = []
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            t = (x * 2 + y) / (2 * w + h)
            row += bytes(int(a * (1 - t) + b * t) for a, b in zip(rgb, rgb2))
        rows.append(bytes(row))
    raw = b"".join(rows)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
png("static/images/harbor.png", 960, 540, (196, 61, 28), (240, 200, 120))
png("static/images/logo.png", 120, 120, (29, 27, 23), (120, 110, 90))
png("content/blog/2023-06-14-trip-notes/map.png", 640, 400, (40, 90, 120), (160, 210, 200))
png("content/blog/field-guide/moss.png", 640, 480, (50, 90, 50), (190, 200, 110))
PY

cat > config.toml <<'EOF'
base_url = "https://doomy.org"
title = "Doomy Field Notes"
description = "Slow writing about fast machines"
theme = "quill"
compile_sass = false
build_search_index = false
taxonomies = [{ name = "tags" }]

[extra]
author = "doomy"
accent = "red"
EOF
cat > themes/quill/theme.toml <<'EOF'
name = "quill"
description = "fixture theme"
license = "MIT"
min_version = "0.18.0"
[author]
name = "fixture"
EOF
cat > themes/quill/content/README.md <<'EOF'
# Quill theme docs

Not part of the site.
EOF
for t in index section page; do
cat > themes/quill/templates/$t.html <<'EOF'
<!doctype html><html><body><h1>{% if page %}{{ page.title }}{% elif section %}{{ section.title }}{% endif %}</h1>{% if page %}{{ page.content | safe }}{% elif section %}{{ section.content | safe }}{% endif %}</body></html>
EOF
done
cat > themes/quill/templates/shortcodes/kbd.html <<'EOF'
<kbd>{{ key | upper }}</kbd>
EOF
cat > themes/quill/templates/shortcodes/note.html <<'EOF'
<aside class="theme-should-be-shadowed">{{ body }}</aside>
EOF

cat > templates/shortcodes/note.html <<'EOF'
{% set kind = kind | default(value="info") %}
<aside class="note note-{{ kind }}">
  {%- if title %}<strong>{{ title }}</strong>{% endif -%}
  {{ body | markdown | safe }}
</aside>
EOF
cat > templates/shortcodes/figure.html <<'EOF'
<figure>
  <img src="{{ get_url(path=src) }}" alt="{{ alt | default(value="") }}"{% if width %} width="{{ width }}"{% endif %}>
  {% if caption %}<figcaption>{{ caption | markdown(inline=true) | safe }}</figcaption>{% endif %}
</figure>
EOF
cat > templates/shortcodes/youtube.html <<'EOF'
<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/{{ id }}" title="{{ title | default(value="Video") }}" allowfullscreen></iframe></div>
EOF
cat > templates/shortcodes/gallery.html <<'EOF'
<div class="gallery">
{% for img in images %}
  <figure data-index="{{ loop.index }}"><img src="{{ get_url(path=img) }}" alt="">{% if not loop.last %}<hr>{% endif %}</figure>
{% endfor %}
</div>
EOF
cat > templates/shortcodes/stat.html <<'EOF'
<div class="stat"><b>{{ value | round(precision=1) }}</b> {{ label | title }} {{ page.title }} / {{ config.extra.author }} #{{ nth }}</div>
EOF
cat > templates/shortcodes/aside_md.md <<'EOF'
> **{{ who }}** says: {{ body }}
EOF
cat > templates/shortcodes/script_bomb.html <<'EOF'
<div class="bomb" onclick="alert(1)">safe text<script>window.__pwned = true;</script><img src="x" onerror="window.__pwned = true"></div>
EOF

cat > README.md <<'EOF'
# doomy.org

Source for the site. `zola serve` to run.
EOF
cat > content/_index.md <<'EOF'
+++
title = "Doomy Field Notes"
sort_by = "date"
+++

Welcome.
EOF
cat > content/about.md <<'EOF'
+++
title = "About"
weight = 1
+++

Who writes this. ![logo](/images/logo.png)
EOF
cat > content/blog/_index.md <<'EOF'
+++
title = "Writing"
sort_by = "date"
paginate_by = 10
+++

All the posts.
EOF
cat > content/blog/2021-02-03-oldest-post.md <<'EOF'
+++
title = "The oldest post"
description = "From the very beginning"
+++

Date comes from the filename.
EOF
cat > content/blog/2022-09-30-middle.md <<'EOF'
+++
title = "Somewhere in the middle"
+++

Still here.
EOF
cat > content/blog/removed-upstream.md <<'EOF'
+++
title = "Removed upstream soon"
date = 2022-01-01
+++

The e2e test deletes this on the remote.
EOF
cat > content/blog/2023-06-14-trip-notes/index.md <<'EOF'
+++
title = "Trip notes"
description = "A bundle with its own map"
[taxonomies]
tags = ["travel"]
+++

The route, colocated with this post:

![The route north](map.png "Route north")

And one from static:

![Harbor at dusk](/images/harbor.png)

And an absolute link to the site's own domain:

![Harbor again](https://doomy.org/images/harbor.png)
EOF
cat > content/blog/field-guide/index.md <<'EOF'
+++
title = "A field guide to everything"
date = 2026-03-14
description = "Exercises every kind of markdown and every component"
[taxonomies]
tags = ["meta", "zola"]
[extra]
hero = "moss.png"
+++

Intro with **bold**, *italic*, ***both***, ~~struck~~, `inline code`, a [link](https://www.getzola.org), an [internal link](@/blog/2022-09-30-middle.md), and an escaped \*asterisk\*. Keys: {{ kbd(key="esc") }} inline.

## Lists, nested every way

- First level
  - Second level with **bold**
    - Third level
      - Fourth level
  - Back to second, and a long line that has to wrap around so that we can see whether wrapped text lines up with the text above it rather than running under the bullet
- First again

1. One
2. Two
   - Bullet under a number (3 spaces, or it wouldn't nest)
   - Another
     1. Number under a bullet under a number
3. Three

    Continuation paragraph inside item three.

* Star bullets
* With *emphasis* inside
    * Four-space nesting

- [ ] Open task
- [x] Finished task
  - [ ] Nested task

## Code

```rust,linenos
fn main() {
    println!("hello"); // greet
}
```

    indented code block

- A list with code inside

  ```python
  print("nested fence")
  ```

## Quote, table, rule

> A quote with *emphasis*
> that spans two lines.
>
> > And a nested quote.

| Name | Size | Notes |
| ---- | ---: | ----- |
| Moss | 12 | **soft** |
| Lichen | 3 | `crusty` |

---

Setext heading
--------------

## Images

![Moss, colocated](moss.png)

Inline ![logo](/images/logo.png) in a sentence.

![This one does not exist](/images/nope.png)

## Components

{% note(kind="warning", title="Careful") %}
A **block** component with *markdown* inside:

- item one
- item two
{% end %}

{{ figure(src="images/harbor.png", alt="Harbor", caption="The harbor, *at dusk*") }}

{{ youtube(id="dQw4w9WgXcQ", title="A video") }}

{{ gallery(images=["images/harbor.png", "images/logo.png"]) }}

{{ stat(value=3.14159, label="pies eaten") }}

{% aside_md(who="Doomy") %}
markdown templates work
{% end %}

{{ unknown_widget(foo="bar", n=3) }}

{{ script_bomb() }}

Show the syntax in code: `{{/* note() */}}`

```
{{/* youtube(id="abc") */}}
```

## HTML

<details><summary>More</summary>

Hidden **text**.

</details>

<div class="callout">Raw <em>HTML</em> block</div>

Footnote here[^1].

[^1]: The footnote text.
EOF
cat > content/blog/next-year.md <<'EOF'
+++
title = "Scheduled for the future"
date = 2099-01-01
+++

Not yet.
EOF
cat > content/blog/notes-on-drafts.md <<'EOF'
+++
title = "Notes on drafts"
date = 2026-03-02
draft = true
+++

Still cooking.
EOF
cat > content/projects/_index.md <<'EOF'
+++
title = "Projects"
sort_by = "weight"
+++
EOF
cat > content/projects/zebra.md <<'EOF'
+++
title = "Zebra (weight 1)"
weight = 1
+++

First by weight, last alphabetically.
EOF
cat > content/projects/aardvark.md <<'EOF'
+++
title = "Aardvark (weight 2)"
weight = 2
+++

Second by weight.
EOF
cat > content/docs/_index.md <<'EOF'
+++
title = "Docs"
+++
EOF
cat > content/docs/guides/_index.md <<'EOF'
+++
title = "Guides"
+++
EOF
cat > content/docs/guides/setup.md <<'EOF'
---
title: Setup guide (YAML)
date: 2025-05-05
---

YAML front matter works too.
EOF
git add -A
git commit -qm "initial site"
cat > content/blog/no-front-matter.md <<'EOF'
title = "no front matter delimiters"

This file has no +++ fence.
EOF
git add -A
git commit -qm "a file zola would choke on"
