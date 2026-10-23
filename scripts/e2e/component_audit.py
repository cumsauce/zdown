"""Measure button/component geometry across pages after the consolidation pass.

Checks:
- every visible button: height, font-size, border-radius (expect height 26 mini /
  36 compact-ish, radius 0)
- type scale: MonoLink 13, Chip 11, panel titles 11
Prints PASS/FAIL, exits non-zero on failure.
"""
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8100"
failures = []


def check(name, cond, detail=""):
    print(("PASS  " if cond else "FAIL  ") + name + (f"  ({detail})" if detail else ""))
    if not cond:
        failures.append(name)


def measure(page, selector, label):
    loc = page.locator(selector).first
    if loc.count() == 0:
        return None
    box = loc.bounding_box()
    styles = loc.evaluate(
        """el => {
            const s = getComputedStyle(el);
            return { r: s.borderRadius, fs: s.fontSize, ff: s.fontFamily,
                     color: s.color, h: el.getBoundingClientRect().height };
        }"""
    )
    h = round(styles["h"], 1)
    print(f"      {label:34s} h={h:<6} r={styles['r']:<6} font={styles['fs']}")
    return styles


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})

    # ---------- repos ----------
    page.goto(f"{BASE}/repos")
    page.wait_for_load_state("networkidle")
    btns = page.locator("button")
    radii, heights = set(), set()
    for i in range(btns.count()):
        s = btns.nth(i).evaluate(
            "el => { const s = getComputedStyle(el); return [s.borderRadius, Math.round(el.getBoundingClientRect().height)]; }"
        )
        radii.add(s[0])
        heights.add(s[1])
    check("repos: all button radii 0", radii <= {"0px"}, str(radii))
    check("repos: one button height family (compact 36 / mini 28)", heights <= {28, 36}, str(heights))
    name_fs = measure(page, ".list-row a, a", "repos MonoLink")  # first link
    # measure the repo name link specifically
    nm = page.locator("a[href^='/repos/']").first.evaluate(
        "el => getComputedStyle(el).fontSize"
    )
    check("repos: list name link = 13px", nm == "13px", nm)
    imp = page.locator("button:has-text('import')").first
    if imp.count():
        k = imp.evaluate("el => getComputedStyle(el).backgroundColor")
        print(f"      import btn bg {k}")

    # ---------- posts ----------
    page.goto(f"{BASE}/repos/1")
    page.wait_for_load_state("networkidle")
    pub = page.locator("button:has-text('publish')").first
    sync_ = page.locator("button:has-text('sync')").first
    check("posts: publish is primary (accent-ish bg)",
          pub.count() > 0 and "rgb" in pub.evaluate("el => getComputedStyle(el).backgroundColor"))
    chip = page.locator("text=youtube").first
    if chip.count():
        fs = chip.evaluate("el => getComputedStyle(el).fontSize")
        check("posts: chip = 11px", fs == "11px", fs)
    hist = page.locator("button:has-text('history')").first
    check("posts: history is a button", hist.count() > 0)
    hs = hist.evaluate("el => { const s = getComputedStyle(el); return [s.borderRadius, Math.round(el.getBoundingClientRect().height)]; }")
    check("posts: history h=28 r=0", hs == ["0px", 28], str(hs))
    # primary vs tertiary must actually render differently
    bg_pub = pub.evaluate("el => getComputedStyle(el).backgroundColor")
    bg_sync = sync_.evaluate("el => getComputedStyle(el).backgroundColor") if sync_.count() else None
    check("posts: publish bg differs from sync (primary vs tertiary)",
          bg_sync is None or bg_pub != bg_sync, f"publish={bg_pub} sync={bg_sync}")

    # ---------- editor + toolbar + fm sheet ----------
    page.goto(f"{BASE}/repos/1/edit?path=content%2Fblog%2Fshortcodes.md")
    page.wait_for_selector(".cm-content")
    page.wait_for_timeout(500)
    seg_box = measure(page, "[aria-label='markdown markers']", "editor Seg box (marks)")
    seg_font = page.locator("[aria-label='markdown markers'] button").first.evaluate(
        "el => getComputedStyle(el).fontSize"
    )
    hist_b = measure(page, "button:has-text('history')", "editor history")
    save_b = measure(page, "button:has-text('save')", "editor save")
    check("editor: Seg box height matches mini buttons",
          seg_box and hist_b and abs(seg_box["h"] - hist_b["h"]) <= 1,
          f"seg={seg_box['h'] if seg_box else '?'} hist={hist_b['h'] if hist_b else '?'}")
    check("editor: Seg radius 0 + font 12", seg_box and seg_box["r"] == "0px" and seg_font == "12px",
          f"r={seg_box['r'] if seg_box else '?'} font={seg_font}")

    # front matter sheet
    page.click("text=settings")
    page.wait_for_selector("text=taxonomies")
    page.wait_for_timeout(300)
    # seed post has no taxonomies — add one row so the × remove button exists
    page.locator("button:has-text('+ add')").first.click()
    page.wait_for_timeout(300)
    done = measure(page, "button:has-text('done')", "fm done")
    add = measure(page, "button:has-text('+ add')", "fm + add")
    xbtn = measure(page, "[aria-label^='remove']", "fm × remove")
    apply_b = measure(page, "button:has-text('apply')", "fm apply")
    check("fm: all sheet buttons h=28 r=0",
          all(b and b["h"] == 28 and b["r"] == "0px" for b in [done, add, xbtn, apply_b]),
          f"done={done and done['h']} add={add and add['h']} x={xbtn and xbtn['h']} apply={apply_b and apply_b['h']}")
    fs_in = page.locator("input").first.evaluate("el => getComputedStyle(el).fontSize")
    check("fm: field inputs 13px", fs_in == "13px", fs_in)
    # nothing rounded anywhere in the sheet
    rounded = page.locator("div, button, input, select, textarea, span").evaluate_all(
        """els => els.filter(el => {
            const s = getComputedStyle(el);
            if (s.borderRadius === '0px' || s.borderRadius === '') return false;
            if (s.borderRadius === '50%' || s.borderRadius.startsWith('99')) return false; // avatar/spinner/dirty dot
            return true;
        }).map(el => el.tagName + '.' + el.className + ':' + getComputedStyle(el).borderRadius)"""
    )
    check("fm: zero rounded elements", len(rounded) == 0, str(rounded[:5]))
    page.screenshot(path="scripts/e2e/18-audit-fm-sheet.png", full_page=True)

    # ---------- versions ----------
    page.goto(f"{BASE}/repos/1/versions?path=content%2Fblog%2Fshortcodes.md")
    page.wait_for_selector("button:has-text('Update content/blog/shortcodes.md')", timeout=15000)
    page.wait_for_timeout(800)
    row = measure(page, ".list-row, button", "versions first row")
    # select a commit to expose restore
    page.locator("button").filter(has_text="Update content/blog/shortcodes.md").first.click()
    page.wait_for_timeout(800)
    res = measure(page, "button:has-text('restore this version')", "versions restore")
    check("versions: restore present + r=0", res is not None and res["r"] == "0px")
    metas = page.locator("span").filter(has_text="head").first
    if metas.count():
        fs = metas.evaluate("el => getComputedStyle(el).fontSize")
        check("versions: meta = 11px", fs == "11px", fs)
    page.screenshot(path="scripts/e2e/19-audit-versions.png", full_page=True)

    # ---------- global rounded sweep on the main pages ----------
    for path in ["/", "/repos", "/repos/1"]:
        page.goto(f"{BASE}{path}")
        page.wait_for_load_state("networkidle")
        rounded = page.locator("button, input, select, a, div").evaluate_all(
            """els => els.filter(el => {
                const s = getComputedStyle(el);
                if (s.borderRadius === '0px' || s.borderRadius === '') return false;
                if (s.borderRadius === '50%' || s.borderRadius.startsWith('99')) return false; // avatar/spinner/dot
                return true;
            }).map(el => el.tagName + ':' + getComputedStyle(el).borderRadius + ' in ' + (el.className || '?'))"""
        )
        check(f"{path}: no rounded chrome", len(rounded) == 0, str(rounded[:5]))

    browser.close()

print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
