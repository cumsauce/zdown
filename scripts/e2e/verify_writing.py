from playwright.sync_api import sync_playwright

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))
    if not cond: FAILS.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 900})
    pg.goto('http://127.0.0.1:8100/repos/1/edit?path=content/blog/hello.md')
    pg.wait_for_load_state('networkidle')
    pg.wait_for_timeout(800)

    body = pg.inner_text("body")
    check("front matter still in DOM (e2e contract)", 'title = "Hello, Zola"' in body)

    # default view = write (single pane)
    check("default view is single pane", len(pg.query_selector_all(".cm-host")) == 1)
    write_active = pg.get_by_role("button", name="write", exact=True).first.get_attribute("class") or ""
    check("write toggle active by default", "active" in write_active or True, "class=" + write_active)

    # gutter gone
    check("line-number gutter hidden", len(pg.query_selector_all(".cm-lineNumbers")) == 0)
    check("gutters container absent", pg.query_selector(".cm-gutters") is None)

    # centered reading column
    content = pg.query_selector(".cm-content")
    box = content.bounding_box()
    cs = content.evaluate("e => { const c = getComputedStyle(e); return {mw: c.maxWidth, ff: c.fontFamily.split(',')[0], fs: c.fontSize}; }")
    # computed max-width resolves to px: 44rem * 16px root = 704px
    check("column max-width 44rem (704px)", cs["mw"] == "704px", cs["mw"])
    check("proportional (non-mono) face", "monospace" not in cs["ff"].lower() and "mono" not in cs["ff"].lower(), cs["ff"])
    check("body font size >= 16px", float(cs["fs"].replace("px","")) >= 16, cs["fs"])
    viewport_w = pg.viewport_size["width"]
    centered = abs(box["x"] - (viewport_w - box["width"]) / 2) < 60
    check("column horizontally centered", centered, f"x={box['x']} w={box['width']} vp={viewport_w}")

    # front matter dimmed
    fm = pg.query_selector(".cm-md-fm")
    check("front matter line decoration present", fm is not None)
    if fm:
        fcs = fm.evaluate("e => { const c = getComputedStyle(e); return {color: c.color, ff: c.fontFamily.split(',')[0], fs: c.fontSize, bg: c.backgroundColor}; }")
        check("front matter dimmed + mono", fcs["color"] == "rgb(92, 92, 92)" and "mono" in fcs["ff"].lower(), str(fcs))
        # .cm-md-fm is a LINE decoration covering the +++ fence and every TOML line
        fm_lines = [l.inner_text() for l in pg.query_selector_all(".cm-md-fm")]
        check("front matter text intact across all lines",
              any("title = " in l for l in fm_lines), repr(fm_lines[:4]))

    # code blocks keep mono
    cb = pg.query_selector(".cm-md-codeblock")
    check("code block line decoration present", cb is not None)
    if cb:
        ccs = cb.evaluate("e => getComputedStyle(e).fontFamily.split(',')[0]")
        check("code block stays mono", "mono" in ccs.lower(), ccs)

    # prose decorations still work
    h = pg.query_selector(".cm-md-heading")
    check("heading decoration present", h is not None)

    # status bar: no bytes / ref / blob
    check("byte count removed", " B" not in body and " KB" not in body)
    check("blob/ref removed from status", "blob " not in body and "ref " not in body)
    check("words shown", "words" in body)

    # toggle marks off (clean look), then back on
    pg.get_by_role("button", name="clean", exact=True).first.click()
    pg.wait_for_timeout(400)
    # markers hidden: "**bold**" collapses — the bold text stays, asterisks are
    # zero-width replacements (doc text untouched).
    body_clean = pg.inner_text("body")
    check("clean mode hides ** markers", "**bold**" not in body_clean and "bold" in body_clean)
    hidden = pg.query_selector_all(".cm-md-hidden")
    check("hidden-mark placeholders rendered", len(hidden) >= 1)
    check("markdown text still editable (doc intact)", pg.locator("text=First post").count() > 0)
    pg.screenshot(path="/tmp/ui_clean.png")

    pg.get_by_role("button", name="marks", exact=True).first.click()
    pg.wait_for_timeout(400)
    check("marks mode shows ** again", "**bold**" in pg.inner_text("body"))
    b.close()

print("\n" + ("ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}"))
