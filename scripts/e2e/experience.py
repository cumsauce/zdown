"""End-to-end suite against scripts/e2e/harness.sh (a realistic Zola site).

    bash scripts/e2e/harness.sh
    uv run --with playwright python scripts/e2e/experience.py

Each check drives the real UI and verifies what ended up on disk (the bare
mirror), since a page can look right while the file is wrong.
"""
import json, os, struct, subprocess, sys, tempfile, time, urllib.request, zlib
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8100"
W = "/tmp/md_ui"
MIRROR = f"{W}/data/repos/1.git"
ORIGIN = f"{W}/origin.git"
BLOG = "content/blog"
GUIDE = f"{BLOG}/field-guide/index.md"
failures = []
only = sys.argv[1:] 


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def git(*a, cwd=MIRROR):
    r = subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True)
    return r.stdout


def show(path, ref="zola-site-user"):
    r = subprocess.run(["git", "show", f"{ref}:{path}"], cwd=MIRROR, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def api(path):
    return json.load(urllib.request.urlopen(f"{BASE}{path}"))


pump = None  # the page to keep servicing while polling (a plain sleep freezes its events)


def wait(fn, tries=60, pause=0.1):
    for _ in range(tries):
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        pump.wait_for_timeout(pause * 1000)
    return None


def remote_commit(mutate, msg="from elsewhere"):
    d = tempfile.mkdtemp()
    subprocess.run(["git", "clone", "-q", ORIGIN, d], check=True)
    subprocess.run(["git", "config", "user.email", "x@x"], cwd=d)
    subprocess.run(["git", "config", "user.name", "x"], cwd=d)
    mutate(d)
    subprocess.run(["git", "add", "-A"], cwd=d, check=True)
    subprocess.run(["git", "commit", "-qm", msg], cwd=d, check=True)
    subprocess.run(["git", "push", "-q", "origin", "main"], cwd=d, check=True)


def png_bytes(w, h, rgb):
    def chunk(t, x):
        c = t + x
        return struct.pack(">I", len(x)) + c + struct.pack(">I", zlib.crc32(c))
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def goto(pg, path):
    pg.goto(BASE + path, wait_until="networkidle")
    pg.wait_for_timeout(500)


def open_post(pg, path):
    goto(pg, f"/repos/1/edit?path={path}")
    pg.wait_for_selector(".cm-content")
    pg.wait_for_timeout(300)


def type_at_end(pg, text):
    pg.click(".cm-content")
    pg.keyboard.press("ControlOrMeta+End")
    pg.keyboard.type(text)


def visible_titles(pg):
    return pg.eval_on_selector_all('a[title^="content/"]', "els => els.map(e => e.getAttribute('title'))")


def saved(pg):
    return wait(lambda: pg.locator('header [aria-live="polite"]').inner_text().startswith("Saved"), tries=80)


def section(name):
    return not only or name in only


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    pg = pump = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    if section("browse"):
        print("\n-- browsing the site")
        goto(pg, "/repos/1")
        rows = visible_titles(pg)
        check("drafts are pinned first", rows and rows[0].endswith("notes-on-drafts.md"), rows[:2])
        dated = [r for r in rows if "next-year" in r or "field-guide" in r or "oldest" in r]
        check("newest first, whatever the filenames sort as", dated == [f"{BLOG}/next-year.md", GUIDE, f"{BLOG}/2021-02-03-oldest-post.md"], dated)
        check("dated filenames give dates", "Feb 3" in pg.inner_text("main"))
        check("no theme/README files in the list", not any("themes/" in r or "README" in r for r in rows))
        check("they're reachable, folded away", pg.get_by_text("other file").count() == 1)
        check("sections are named from _index.md", pg.get_by_role("navigation", name="Sections").get_by_role("link", name="Writing").count() == 1)
        pg.get_by_role("navigation", name="Sections").get_by_role("link", name="Projects").click()
        wait(lambda: "s=content" in pg.url)
        pg.wait_for_timeout(200)
        rows = visible_titles(pg)
        check("sort_by = weight is honoured", rows == ["content/projects/zebra.md", "content/projects/aardvark.md"], rows)
        check("the section stays in the URL", "s=content%2Fprojects" in pg.url or "s=content/projects" in pg.url, pg.url)
        pg.go_back()
        pg.wait_for_timeout(200)
        check("back returns to the full list", "s=" not in pg.url and len(visible_titles(pg)) > 5)
        pg.get_by_label("Search posts").fill("oldest")
        rows = visible_titles(pg)
        check("search filters across the site", rows == [f"{BLOG}/2021-02-03-oldest-post.md"], rows)
        pg.get_by_label("Search posts").fill("")
        check("a broken file is flagged", pg.locator('span[title^="Zola needs"]').count() == 1)
        check("YAML front matter is understood", pg.get_by_text("Setup guide (YAML)").count() == 1)
        goto(pg, "/repos/1?s=content/docs")
        check("nested sections drill down", pg.get_by_role("link", name="Guides").count() >= 1)

    if section("images"):
        print("\n-- images")
        for label, opener in (("write", None), ("preview", "Preview")):
            open_post(pg, f"{BLOG}/2023-06-14-trip-notes/index.md")
            if opener:
                pg.get_by_role("button", name=opener).click()
            pg.wait_for_timeout(1200)
            imgs = pg.eval_on_selector_all("article img" if opener else ".cm-content img", "els => els.map(e => [e.getAttribute('src'), e.naturalWidth])")
            check(f"{label}: bundle, static/ and own-domain images all load", len(imgs) == 3 and all(w > 0 for _, w in imgs), imgs)
        open_post(pg, GUIDE)
        # scrolling the outer pane must bring virtualized blocks into the document
        for y in range(0, 9000, 500):
            pg.evaluate("y => document.querySelector('[data-column]').parentElement.scrollTo(0, y)", y)
            pg.wait_for_timeout(60)
            if pg.get_by_text("Image not found: /images/nope.png").count():
                break
        check("a missing image says so, and where it looked", pg.get_by_text("Image not found: /images/nope.png").count() >= 1 and pg.get_by_text("static/images/nope.png").count() >= 1)
        # upload through the toolbar's file input
        goto(pg, "/repos/1/edit?path=content/blog/2022-09-30-middle.md")
        pg.wait_for_selector(".cm-content")
        pg.click(".cm-content")
        pg.keyboard.press("ControlOrMeta+End")
        pg.set_input_files('input[type="file"]', {"name": "Summer Photo.PNG", "mimeType": "image/png", "buffer": png_bytes(40, 30, (10, 120, 200))})
        ok = wait(lambda: "/images/summer-photo.png" in (show(f"{BLOG}/2022-09-30-middle.md") or ""), tries=80)
        check("upload lands in static/ and the post references it", ok, show(f"{BLOG}/2022-09-30-middle.md"))
        check("the file is committed", git("ls-tree", "-r", "--name-only", "zola-site-user", "static/images/").count("summer-photo.png") == 1)
        pg.evaluate("document.activeElement?.blur?.()")
        pg.wait_for_timeout(600)
        loaded = pg.eval_on_selector_all(".cm-content img", "els => els.filter(e => e.getAttribute('src').includes('summer-photo')).map(e => e.naturalWidth)")
        check("the upload shows immediately", loaded == [40], loaded)
        # bundles keep media beside them
        goto(pg, "/repos/1/edit?path=content/blog/2023-06-14-trip-notes/index.md")
        pg.wait_for_selector(".cm-content")
        pg.click(".cm-content")
        pg.keyboard.press("ControlOrMeta+End")
        pg.set_input_files('input[type="file"]', {"name": "stop.png", "mimeType": "image/png", "buffer": png_bytes(10, 10, (1, 2, 3))})
        ok = wait(lambda: "![](stop.png)" in (show(f"{BLOG}/2023-06-14-trip-notes/index.md") or ""), tries=80)
        check("a bundle's upload stays in the bundle", ok and "stop.png" in git("ls-tree", "-r", "--name-only", "zola-site-user", f"{BLOG}/2023-06-14-trip-notes/"))
        # click reveals source
        goto(pg, "/repos/1/edit?path=content/blog/2023-06-14-trip-notes/index.md")
        pg.wait_for_selector(".cm-content figure img")
        before = pg.locator(".cm-content").inner_text()
        pg.locator(".cm-content figure").first.click()
        pg.wait_for_timeout(300)
        check("tapping an image reveals its markdown", "![The route north](map.png" in pg.locator(".cm-content").inner_text() and "![The route north]" not in before)

    if section("shortcodes"):
        print("\n-- components")
        open_post(pg, GUIDE)
        pg.set_viewport_size({"width": 1280, "height": 7000})
        pg.wait_for_timeout(1000)
        text = pg.locator(".cm-content").inner_text()
        html = pg.locator(".cm-content").inner_html()
        check("write: raw shortcode syntax is gone", "{{ figure" not in text and "{% note" not in text and "{% end %}" not in text)
        check("write: block component renders its markdown body", pg.locator(".cm-content aside.note-warning strong").first.inner_text() == "Careful" and pg.locator(".cm-content aside.note-warning li").count() == 2)
        check("write: figure template renders with a real image", wait(lambda: pg.eval_on_selector(".cm-content figure img[alt='Harbor']", "e => e.naturalWidth") > 0))
        check("write: caption's markdown renders", pg.locator(".cm-content figcaption em").first.inner_text() == "at dusk")
        check("write: for-loop template renders", pg.locator(".cm-content .gallery figure").count() == 2)
        check("write: filters and page/config context work", "3.1 Pies Eaten A field guide to everything / doomy #1" in text.replace("\n", " ") , text[-600:])
        check("write: markdown templates render", pg.locator(".cm-content blockquote strong", has_text="Doomy").count() == 1)
        check("write: theme's component is found", pg.locator(".cm-content kbd", has_text="ESC").count() == 1)
        check("write: site template shadows the theme's", pg.locator(".theme-should-be-shadowed").count() == 0)
        check("write: embeds are a placeholder, not a live frame", pg.locator(".cm-content iframe").count() == 0 and "youtube-nocookie.com" in text)
        check("write: unknown component reads as a named card", pg.locator(".sc-card-head b", has_text="unknown_widget").count() == 1)
        check("scripts and handlers are stripped", pg.evaluate("window.__pwned !== true") and "onclick" not in html and "<script" not in html)
        pg.locator(".cm-content aside.note-warning").click()
        pg.wait_for_timeout(300)
        check("tapping a component reveals its source, still rendered", "{% note(kind=" in pg.locator(".cm-content").inner_text() and pg.locator(".cm-content aside.note-warning").count() == 1)
        pg.get_by_role("button", name="Preview").click()
        pg.wait_for_timeout(1500)
        art = pg.locator("article.prose")
        check("preview: live embed is sandboxed", art.locator("iframe").get_attribute("sandbox") is not None)
        check("preview: every component renders", art.locator("aside.note-warning li").count() == 2 and art.locator(".gallery figure").count() == 2)
        check("preview: escaped shortcodes show literally", '{{ youtube(id="abc") }}' in art.inner_text())
        check("preview: code is highlighted", art.locator("pre code .tok-keyword").count() >= 1)
        check("preview: task checkboxes", art.locator("input[type=checkbox]").count() == 3)
        check("preview: footnotes", art.locator(".footnotes li").count() == 1)
        check("preview: nesting is real", art.locator("ul ul ul ul li").count() == 1 and art.locator("ol ul ol li").count() == 1)
        art.get_by_role("link", name="internal link").click()
        wait(lambda: "2022-09-30-middle" in pg.url)
        check("preview: @/ links open that post", "2022-09-30-middle" in pg.url, pg.url)
        pg.set_viewport_size({"width": 1280, "height": 860})

    if section("components"):
        print("\n-- components (Zola 0.23)")
        C = "content/blog/trip/index.md"
        goto(pg, f"/repos/2/edit?path={C}")
        pg.set_viewport_size({"width": 1280, "height": 5000})
        pg.wait_for_selector(".cm-content aside")
        pg.wait_for_timeout(800)
        text = pg.locator(".cm-content").inner_text()
        check("write: no raw component syntax", "{% <note" not in text and "{{ <fig" not in text and "{% </" not in text, text[:300])
        check("write: block component with attributes", pg.locator(".cm-content aside.note-warning strong").inner_text() == "Careful")
        check("write: body | markdown works", pg.locator(".cm-content aside.mdnote li").count() == 2)
        check("write: get_url resolves to the repo's image", wait(lambda: pg.eval_on_selector(".cm-content figure img[alt='Harbor']", "e => e.naturalWidth") > 0))
        check("write: dotted, nested components", pg.locator(".cm-content .card h3").inner_text() == "Nested" and pg.locator(".cm-content .card .tally b").inner_text() == "42")
        check("write: {expr} attributes and loops", pg.locator(".cm-content .tally i").count() == 2 and "1:A" in text)
        check("write: spread attributes", pg.locator(".cm-content aside.note-danger").count() == 1)
        check("write: content expressions render inline", "The mood was good on Components Site, by doomy." in text, text[:200])
        check("write: control tags stay visible, dimmed", "{% for i in [1, 2] %}" in text)
        check("write: images via @/ load", wait(lambda: pg.eval_on_selector_all(".cm-content img[alt^='Map'], .cm-content figure img", "els => els.every(e => e.naturalWidth > 0)")))
        check("write: embeds are placeholders", pg.locator(".cm-content iframe").count() == 0)
        check("write: scripts stripped", pg.evaluate("window.__pwned !== true") and "onclick" not in pg.locator(".cm-content").inner_html())
        pg.locator(".cm-content aside.note-warning").click()
        pg.wait_for_timeout(300)
        check("tap reveals the component's source, still rendered", '{% <note kind="warning"' in pg.locator(".cm-content").inner_text() and pg.locator(".cm-content aside.note-warning").count() == 1)
        pg.get_by_role("button", name="Preview").click()
        pg.wait_for_timeout(800)
        art = pg.locator("article.prose")
        check("preview: for-loops expand through markdown", art.get_by_text("loop item 2").count() == 1)
        check("preview: conditionals evaluate", "Conditional shows." in art.inner_text() and "Conditional hides" not in art.inner_text())
        check("preview: raw blocks are literal", "{{ page.title }} is how you show the syntax." in art.inner_text())
        check("preview: comments vanish", "hidden" not in art.inner_text())
        check("preview: live embed sandboxed", art.locator("iframe").get_attribute("sandbox") is not None)
        # errors a real build would hit are shown where they happen
        pg.get_by_role("button", name="Edit").click()
        pg.set_viewport_size({"width": 1280, "height": 860})
        goto(pg, "/repos/2/edit?path=content/_index.md")
        pg.click(".cm-content")
        pg.keyboard.press("ControlOrMeta+End")
        pg.keyboard.type('\n\n{{ <nope a="b" /> }}\n\n{{ <note wrong="x" /> }}\n\nend')
        pg.wait_for_timeout(600)
        check("unknown component: named, with the reason", pg.locator(".sc-card-head b", has_text="nope").count() == 1 and pg.get_by_text("Unknown component").count() >= 1)
        check("wrong argument: says which", pg.get_by_text("unknown argument `wrong`").count() >= 1)
        pg.get_by_label("Insert…").click()
        pg.get_by_text("ui.card", exact=True).click()
        pg.wait_for_timeout(300)
        saved(pg)
        t = subprocess.run(["git", "show", "components-site-user:content/_index.md"], cwd=f"{W}/data/repos/2.git", capture_output=True, text=True).stdout
        check("insert writes the new syntax with required params", '{% <ui.card title=""> %}' in t and "{% </ui.card> %}" in t, t)
        goto(pg, "/repos/1")

    if section("editor"):
        print("\n-- writing")
        P = f"{BLOG}/next-year.md"
        original = show(P)
        open_post(pg, P)
        pg.wait_for_timeout(1500)
        check("opening a file changes nothing on disk", show(P) == original)
        check("the +++ block is out of the way", "+++" not in pg.locator(".cm-content").inner_text() and "Scheduled" in pg.inner_text("main"))
        check("the title is a real field", pg.get_by_label("Title").input_value() == "Scheduled for the future")
        type_at_end(pg, "\n\n- one\n")
        pg.keyboard.type("two")
        pg.keyboard.press("Enter")
        pg.keyboard.type("nested")
        pg.keyboard.press("Tab")
        pg.keyboard.press("Enter")
        pg.keyboard.type("nested two")
        pg.keyboard.press("Enter")
        pg.keyboard.press("Enter")
        pg.keyboard.type("outdented by empty enter")
        saved(pg)
        t = show(P)
        check("Enter continues, Tab nests, empty Enter steps out", "- one\n- two\n  - nested\n  - nested two\n- outdented by empty enter" in t, t)
        check("bullets render by depth", pg.locator(".md-li-marker", has_text="◦").count() == 2 and pg.locator(".md-li-marker", has_text="•").count() == 3)
        pg.keyboard.press("Shift+Tab")
        pg.keyboard.press("Tab")
        pg.keyboard.press("Enter")
        pg.keyboard.press("Enter")
        pg.keyboard.press("Enter")
        pg.keyboard.type("1. first\n")
        pg.keyboard.type("second")
        pg.keyboard.press("Enter")
        pg.keyboard.type("under second")
        pg.keyboard.press("Tab")
        saved(pg)
        t = show(P)
        check("nesting under a number uses its content column", "1. first\n2. second\n   1. under second" in t, t)
        pg.keyboard.press("Shift+Tab")
        saved(pg)
        t = show(P)
        check("Shift-Tab brings it back", "\n2. second\n1. under second" in t, t)
        pg.keyboard.press("Enter")
        pg.keyboard.press("Enter")
        pg.keyboard.type("\n\nplain ")
        pg.keyboard.press("ControlOrMeta+b")
        pg.keyboard.type("bold")
        pg.keyboard.press("ArrowRight")
        pg.keyboard.press("ArrowRight")
        pg.keyboard.type(" after")
        saved(pg)
        check("⌘B wraps and the cursor walks out", "plain **bold** after" in show(P), show(P))
        pg.keyboard.press("Enter")
        pg.keyboard.press("Enter")
        vis = pg.locator(".cm-content").inner_text()
        check("syntax is hidden away from the cursor", "plain bold after" in vis and "**" not in vis, vis[-200:])
        pg.keyboard.type("- [ ] tick me")
        saved(pg)
        box = pg.locator("input.md-task").last
        box.click()
        saved(pg)
        check("checkbox toggles the markdown", "- [x] tick me" in show(P), show(P))
        # undo stays within this document
        for _ in range(60):
            pg.keyboard.press("ControlOrMeta+z")
        pg.wait_for_timeout(1500)
        check("undo goes back to the opened text, no further", pg.get_by_label("Title").input_value() == "Scheduled for the future" and "one" not in pg.locator(".cm-content").inner_text())
        # title round-trip
        before = show(P)
        pg.get_by_label("Title").fill('A "quoted" title')
        pg.keyboard.press("Enter")
        saved(pg)
        t = show(P)
        check("title writes only its own line", 'title = "A \\"quoted\\" title"' in t and t.split("+++")[2] == before.split("+++")[2] and "date = 2099-01-01" in t, t)
        goto(pg, "/repos/1?s=content/blog")
        check("the list has the new title immediately", pg.locator("main").get_by_text('A "quoted" title').count() == 1)
        # autosave coalescing
        n0 = len(api(f"/api/repos/1/post/versions?path={P}"))
        open_post(pg, P)
        for w in ["alpha", " beta", " gamma"]:
            type_at_end(pg, w)
            saved(pg)
            pg.wait_for_timeout(1000)
        n1 = len(api(f"/api/repos/1/post/versions?path={P}"))
        check("a run of typing is one version, not one per pause", n1 - n0 <= 1, (n0, n1))
        # switching documents keeps them apart
        pg.locator("nav").get_by_role("link", name="Home", exact=True).first.click()
        pg.wait_for_timeout(300)
        goto(pg, f"/repos/1/edit?path={BLOG}/2021-02-03-oldest-post.md")
        pg.wait_for_selector(".cm-content")
        check("documents don't bleed into each other", "gamma" not in pg.locator(".cm-content").inner_text())
        # settings
        open_post(pg, f"{BLOG}/2021-02-03-oldest-post.md")
        pg.get_by_role("button", name="Post details").click()
        pg.get_by_label("Tags").fill("a, b")
        pg.get_by_label("Tags").blur()
        pg.get_by_label("Draft").check()
        saved(pg)
        t = show(f"{BLOG}/2021-02-03-oldest-post.md")
        check("details edit the front matter in place", 'tags = ["a", "b"]' in t and "draft = true" in t and "From the very beginning" in t, t)
        pg.get_by_label("Draft").uncheck()
        saved(pg)
        pg.get_by_label("Slug").fill("Renamed Post!")
        pg.get_by_role("button", name="Rename").click()
        ok = wait(lambda: show(f"{BLOG}/renamed-post.md") is not None and show(f"{BLOG}/2021-02-03-oldest-post.md") is None)
        check("rename moves the file", ok)
        wait(lambda: "renamed-post" in pg.url)
        check("rename follows in the URL", "renamed-post" in pg.url, pg.url)
        pg.wait_for_selector(".cm-content")
        # long documents stay responsive
        long_doc = "".join(f"## Section {i}\n\nSome **bold** text with a [link](https://x.y) and `code`.\n\n- a\n  - b\n\n" for i in range(800))
        open_post(pg, "content/docs/guides/setup.md")
        pg.route("**/post/content", lambda r: r.abort())  # keep the synthetic text out of later checks
        pg.click(".cm-content")
        pg.keyboard.press("ControlOrMeta+a")
        pg.keyboard.insert_text(long_doc)
        pg.wait_for_timeout(600)
        ms = pg.evaluate("""async () => {
            const t0 = performance.now();
            for (let i = 0; i < 30; i++) {
                document.execCommand('insertText', false, 'x');
                await new Promise((r) => setTimeout(r, 0));
            }
            return (performance.now() - t0) / 30;
        }""")
        check(f"typing in a {len(long_doc) // 1000}kB post stays responsive ({ms:.1f}ms per key)", ms < 16, ms)
        goto(pg, "/repos/1")
        pg.unroute("**/post/content")

    if section("new"):
        print("\n-- starting a new post")
        goto(pg, "/repos/1?s=content/blog")
        pg.locator("nav").get_by_role("button", name="New post").first.click()
        pg.wait_for_selector(".cm-content")
        pg.wait_for_timeout(300)
        check("goes to the section you were in", "in=content%2Fblog" in pg.url or "in=content/blog" in pg.url, pg.url)
        title = pg.get_by_label("Title")
        check("the title has focus", pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Title")
        box0 = title.bounding_box()
        pg.evaluate("document.querySelector('.cm-content').dataset.marker = 'same-node'")
        pg.keyboard.type("My Fresh Post")
        pg.wait_for_timeout(1500)
        check("nothing is created while the title is still being typed", show(f"{BLOG}/my-fresh-post.md") is None and show(f"{BLOG}/my-fre.md") is None)
        pg.keyboard.press("Enter")
        pg.keyboard.type("First body line")
        ok = wait(lambda: "First body line" in (show(f"{BLOG}/my-fresh-post.md") or ""), tries=80)
        check("the file appears with a slug from the finished title", ok)
        t = show(f"{BLOG}/my-fresh-post.md") or ""
        check("front matter is written for you, as a draft", 'title = "My Fresh Post"' in t and "draft = true" in t and "date = " in t, t)
        check("the URL becomes the file's", "path=content%2Fblog%2Fmy-fresh-post.md" in pg.url, pg.url)
        check("the page never remounted or changed shape", pg.evaluate("document.querySelector('.cm-content').dataset.marker") == "same-node")
        pg.keyboard.type(" and more")
        saved(pg)
        check("typing continues uninterrupted", "First body line and more" in show(f"{BLOG}/my-fresh-post.md"))
        # same title again doesn't overwrite
        goto(pg, "/repos/1/edit?new=1&in=content/blog")
        pg.get_by_label("Title").fill("My Fresh Post")
        pg.keyboard.press("Enter")
        pg.keyboard.type("second")
        ok = wait(lambda: show(f"{BLOG}/my-fresh-post-2.md") is not None, tries=60)
        check("a taken slug gets -2, never overwrites", ok and "and more" in show(f"{BLOG}/my-fresh-post.md"))
        # draft without a title survives
        goto(pg, "/repos/1/edit?new=1&in=content/projects")
        pg.click(".cm-content")
        pg.keyboard.type("no title yet")
        pg.wait_for_timeout(500)
        check("no title: tells you what it needs", pg.get_by_text("Add a title to save").count() == 1)
        goto(pg, "/repos/1/edit?new=1&in=content/projects")
        check("no title: text is still there when you come back", "no title yet" in pg.locator(".cm-content").inner_text())
        pg.get_by_role("button", name="More").click()
        pg.get_by_role("menuitem", name="Discard").click()
        pg.get_by_role("button", name="Discard").last.click()
        pg.wait_for_timeout(300)
        goto(pg, "/")
        check("home has the new post in recents", pg.get_by_text("My Fresh Post").count() >= 1)
        check("home is stable: no fields to type into", pg.locator("main input, main textarea").count() == 0)

    if section("safety"):
        print("\n-- not losing work")
        P = f"{BLOG}/2022-09-30-middle.md"
        open_post(pg, P)
        # server down: the save fails, the text survives, and it recovers
        pg.route("**/post/content", lambda r: r.abort())
        type_at_end(pg, " offline-edit")
        check("a failed save is stated once, calmly", wait(lambda: pg.get_by_text("Not saved").count() == 1, tries=40))
        pg.unroute("**/post/content")
        pg.wait_for_timeout(200)
        ok = wait(lambda: "offline-edit" in (show(P) or ""), tries=100)
        check("it retries by itself and lands", ok)
        # draft restored on reopen
        pg.route("**/post/content", lambda r: r.abort())
        type_at_end(pg, " draft-edit")
        pg.wait_for_timeout(500)
        goto(pg, f"/repos/1/edit?path={P}")
        pg.unroute("**/post/content")
        pg.wait_for_selector(".cm-content")
        check("reopening restores unsaved text and says so", "draft-edit" in pg.locator(".cm-content").inner_text() and pg.get_by_text("Restored your unsaved edits").count() == 1)
        pg.get_by_role("button", name="Discard").click()
        pg.wait_for_timeout(500)
        check("the restore can be discarded", "draft-edit" not in pg.locator(".cm-content").inner_text())
        # conflict
        open_post(pg, P)
        tmp = tempfile.mkdtemp()
        subprocess.run(["git", "clone", "-q", "--branch", "zola-site-user", MIRROR, tmp], check=True)
        open(f"{tmp}/{P}", "a").write("\nedited behind your back\n")
        subprocess.run(["git", "-c", "user.email=x@x", "-c", "user.name=x", "commit", "-qam", "behind"], cwd=tmp, check=True)
        subprocess.run(["git", "push", "-q", "origin", "zola-site-user"], cwd=tmp, check=True)
        type_at_end(pg, " mine-wins")
        check("a conflict is explained", wait(lambda: pg.get_by_text("changed elsewhere").count() == 1, tries=40))
        pg.get_by_role("button", name="Keep mine").click()
        ok = wait(lambda: "mine-wins" in (show(P) or ""), tries=60)
        check("keep mine saves", ok)
        # history
        goto(pg, f"/repos/1/versions?path={P}")
        check("history reads in plain words", pg.get_by_text("(current)").count() == 1 and pg.locator(".diff").count() == 1)
        pg.locator("button", has_text="Created").or_(pg.locator("button", has_text="initial site")).last.click()
        pg.get_by_role("button", name="Restore this version").click()
        pg.get_by_role("button", name="Restore", exact=True).click()
        ok = wait(lambda: "mine-wins" not in (show(P) or "x"), tries=60)
        check("restore brings the text back as a new commit", ok)
        # delete
        open_post(pg, f"{BLOG}/my-fresh-post-2.md")
        pg.get_by_role("button", name="More").click()
        pg.get_by_role("menuitem", name="Delete").click()
        pg.get_by_role("button", name="Delete", exact=True).click()
        ok = wait(lambda: show(f"{BLOG}/my-fresh-post-2.md") is None)
        check("delete commits the removal", ok)
        pg.wait_for_timeout(400)
        check("and the file is gone from the list", pg.get_by_text("my-fresh-post-2").count() == 0)
        goto(pg, f"/repos/1/edit?path={BLOG}/never-existed.md")
        check("a dead link explains itself", pg.get_by_text("This post is gone").count() == 1)

    if section("sync"):
        print("\n-- the remote moves")
        # an article removed and another edited upstream, while this side has unpublished work
        def mutate(d):
            os.remove(f"{d}/{BLOG}/removed-upstream.md")
            open(f"{d}/{BLOG}/added-upstream.md", "w").write('+++\ntitle = "Added upstream"\ndate = 2026-10-01\n+++\n\nhi\n')
        goto(pg, f"/repos/1/edit?path={BLOG}/removed-upstream.md")
        pg.wait_for_selector(".cm-content")
        remote_commit(mutate)
        goto(pg, "/repos/1")
        pg.get_by_role("button", name="Check GitHub for changes").click()
        ok = wait(lambda: pg.get_by_text("Added upstream").count() == 1, tries=80)
        check("new upstream articles appear", ok)
        check("removed upstream articles disappear", wait(lambda: pg.get_by_text("Removed upstream soon").count() == 0))
        check("unpublished work survives the merge", show(f"{BLOG}/my-fresh-post.md") is not None)
        goto(pg, "/")
        check("recents forget removed files", pg.get_by_text("Removed upstream soon").count() == 0)
        # same lines on both sides
        P = f"{BLOG}/next-year.md"
        open_post(pg, P)
        type_at_end(pg, "\n\nmy side")
        saved(pg)
        def clash(d):
            with open(f"{d}/{P}", "a") as f:
                f.write("\n\ntheir side\n")
        remote_commit(clash)
        goto(pg, "/repos/1")
        pg.get_by_role("button", name="Check GitHub for changes").click()
        check("a real conflict is surfaced, not silently resolved", wait(lambda: pg.get_by_text("changed both here and on GitHub").count() == 1, tries=60))
        pg.get_by_role("button", name="Keep my version").click()
        check("choosing resolves it", wait(lambda: "my side" in (show(P) or "") and pg.get_by_text("changed both here").count() == 0, tries=60))

    if section("publish"):
        print("\n-- publishing")
        goto(pg, "/repos/1")
        pg.get_by_role("button", name="Publish").click()
        pg.wait_for_timeout(300)
        dlg = pg.get_by_role("dialog")
        check("publish shows what goes out, by title", dlg.get_by_text("My Fresh Post").count() == 1)
        check("and warns about drafts", dlg.get_by_text("won't appear on the site").count() == 1)
        head = git("rev-parse", "zola-site-user").strip()
        dlg.get_by_role("button", name="Publish").click()
        ok = wait(lambda: git("rev-parse", "main", cwd=ORIGIN).strip() == head, tries=80)
        check("the branch reaches the remote", ok)
        check("everything now reads as published", wait(lambda: pg.get_by_role("button", name="Publish").count() == 0))
        check("no conflict markers ever reach the remote", "<<<<" not in git("grep", "-c", "<<<<<<<", "main", cwd=ORIGIN))

    if section("scratch"):
        print("\n-- scratchpads")
        goto(pg, "/repos")
        pg.get_by_label("Scratchpad name").fill("scratch")
        pg.get_by_role("button", name="Create").click()
        pg.wait_for_timeout(500)
        check("a scratchpad appears", pg.get_by_role("link", name="scratch", exact=False).count() >= 1)
        rid = [r["id"] for r in api("/api/repos") if r["full_name"] == "scratch"][0]
        goto(pg, f"/repos/{rid}/edit?new=1&in=")
        pg.click(".cm-content")
        pg.keyboard.type("A quick thought\n\nmore")
        ok = wait(lambda: subprocess.run(["git", "cat-file", "-e", "scratch-user:a-quick-thought.md"], cwd=f"{W}/data/repos/{rid}.git", capture_output=True).returncode == 0, tries=80)
        check("a note needs no title: first line names it", ok)
        goto(pg, f"/repos/{rid}")
        check("scratchpads don't pretend to be Zola", pg.get_by_text("Add it").count() == 0 and pg.get_by_text("A quick thought").count() >= 1)
        pg.get_by_role("button", name="Connect a repository").click()
        pg.get_by_role("textbox", name="Repository").fill("test/scratch")
        pg.get_by_role("dialog").get_by_role("button", name="Connect").click()
        ok = wait(lambda: "a-quick-thought.md" in git("ls-tree", "-r", "--name-only", "main", cwd=f"{W}/origin-new.git"), tries=80)
        check("connect pushes the history", ok)

    check("no uncaught page errors", not errors, errors[:3])
    ctx.close()

    if section("mobile"):
        print("\n-- a phone")
        for scheme in ("light", "dark"):
            m = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2, color_scheme=scheme)
            mp = m.new_page()
            routes = ["/", "/repos", "/repos/1", "/repos/1?s=content/blog", f"/repos/1/edit?path={GUIDE}", "/repos/1/edit?new=1&in=content/blog", f"/repos/1/versions?path={GUIDE}", "/settings"]
            for r in routes:
                goto(mp, r)
                over = mp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                check(f"[{scheme}] {r}: no sideways scroll", over <= 0, over)
                small = mp.evaluate("""() => [...document.querySelectorAll('button, a[href], input, select, textarea, [role=menuitem]')]
                    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && e.type !== 'checkbox' && !e.closest('.cm-content') && (r.height < 36 || r.width < 36); })
                    .map(e => [e.tagName, (e.getAttribute('aria-label') || e.textContent || '').slice(0, 24), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)])""")
                check(f"[{scheme}] {r}: tap targets are big enough", not small, small[:5])
                tiny = mp.evaluate("""() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=file]), textarea, select')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).length""")
                check(f"[{scheme}] {r}: fields won't zoom iOS", tiny == 0, tiny)
                check(f"[{scheme}] {r}: text is readable", mp.evaluate("""() => { const s = getComputedStyle(document.body); return s.color !== s.backgroundColor; }"""))
            # the keyboard: a shrunken visual viewport pins the toolbar above it
            goto(mp, f"/repos/1/edit?path={GUIDE}")
            bar = mp.get_by_role("toolbar", name="Formatting")
            check(f"[{scheme}] toolbar at the bottom", bar.bounding_box()["y"] > 700)
            mp.set_viewport_size({"width": 390, "height": 480})
            mp.wait_for_timeout(300)
            b = bar.bounding_box()
            check(f"[{scheme}] toolbar stays above a keyboard", b["y"] + b["height"] <= 480 + 40 and b["y"] > 300, b)
            mp.set_viewport_size({"width": 390, "height": 844})
            mp.get_by_label("Post details").click()
            mp.wait_for_timeout(200)
            box = mp.get_by_label("Post details", exact=True).last.bounding_box()
            check(f"[{scheme}] details fill the screen", box["width"] >= 380)
            m.close()
        m = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        mp = pump = m.new_page()
        goto(mp, "/repos/1?s=content/blog")
        mp.get_by_role("button", name="New post").tap()
        mp.wait_for_selector(".cm-content")
        check("New from the tab bar goes to this section", "content%2Fblog" in mp.url or "content/blog" in mp.url, mp.url)
        title = mp.get_by_label("Title")
        title.fill("From my phone")
        mp.locator(".cm-content").tap()
        mp.keyboard.type("- thumb")
        mp.keyboard.press("Enter")
        mp.keyboard.type("nest")
        mp.get_by_role("toolbar", name="Formatting").get_by_label("Indent").tap()
        ok = wait(lambda: "- thumb\n  - nest" in (show(f"{BLOG}/from-my-phone.md") or ""), tries=80)
        check("the toolbar nests lists without a Tab key", ok, show(f"{BLOG}/from-my-phone.md"))
        mp.get_by_label("Insert…").tap()
        mp.get_by_text("note", exact=True).tap()
        mp.wait_for_timeout(300)
        ok = wait(lambda: '{% note(' in (show(f"{BLOG}/from-my-phone.md") or ""), tries=80)
        check("components can be inserted from the toolbar", ok, show(f"{BLOG}/from-my-phone.md"))
        mp.get_by_role("button", name="More").tap()
        wb = mp.get_by_role("menu").bounding_box()
        check("menus open in thumb reach", wb["y"] + wb["height"] > 700 and wb["width"] > 350, wb)
        m.close()

    browser.close()

print(f"\n{'ALL PASSED' if not failures else str(len(failures)) + ' FAILED: ' + '; '.join(failures)}")
sys.exit(1 if failures else 0)
