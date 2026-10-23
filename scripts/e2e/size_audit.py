"""One-off: verify the SIZE.mini unification — every in-app button/input/select
should measure 28px tall (ListRowBtn rows and TextBtn text-links excluded).
Landing's hero CTA is SIZE.default by design but is not covered here: with
dev_auto_login the app redirects / -> /repos before it can render.
Screenshots: 30-*.png.

Run: ~/.local/bin/uv run --with playwright python scripts/e2e/size_audit.py
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8100"
SHOT = __file__.rsplit("/", 1)[0]

MEASURE = """
() => {
  const out = [];
  for (const el of document.querySelectorAll('input, [data-baseweb="select"], button')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue; // hidden inputs, collapsed rows
    // visual box: buttons are their own box; input/select borders live on the
    // baseui Root, so walk up to the nearest bordered ancestor for those.
    let v = el, node = el;
    if (el.tagName.toLowerCase() !== 'button') {
      while (node && node !== document.body) {
        if (parseFloat(getComputedStyle(node).borderTopWidth) > 0 && node.getBoundingClientRect().width > 0) { v = node; break; }
        node = node.parentElement;
      }
    }
    out.push({
      t: el.tagName.toLowerCase(),
      h: Math.round(v.getBoundingClientRect().height),
      w: Math.round(r.width),
      txt: (el.textContent || '').trim().slice(0, 24) ||
           el.getAttribute('placeholder') || el.getAttribute('aria-label') || '',
    });
  }
  return out;
}
"""

CONTROL_H = 28  # mini: buttons, inputs (Root box) and selects are all 28px


def audit(page, name, allow_short=()):
    """Controls must be CONTROL_H. Rows (buttons > 300px wide) and text links
    (buttons < 24px tall) are out of scope. allow_short: heights permitted
    for remaining oddities (e.g. the editor's 26px segmented control)."""
    items = page.evaluate(MEASURE)
    bad = []
    for i in items:
        if i["t"] == "button" and (i["w"] > 300 or i["h"] < 24):
            continue  # row-as-button / text-link button
        if i["h"] == CONTROL_H or i["h"] in allow_short:
            continue
        bad.append(i)
    heights = sorted({i["h"] for i in items})
    status = "OK" if not bad else f"{len(bad)} OFF-SIZE:"
    print(f"{name}: all heights={heights} {status}")
    for i in items:
        mark = "  <-- off" if i in bad else ""
        print(f"    {i['t']:7s} {i['h']:3d}px w={i['w']:4d} \"{i['txt']}\"{mark}")
    return not bad


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 900})

    page.goto(f"{BASE}/repos")
    page.wait_for_selector("text=repositories")
    ok = audit(page, "repos")
    page.screenshot(path=f"{SHOT}/30-size-repos.png", full_page=True)

    # test/zola-site = repo 1 in the /tmp/md_ui data dir (harness uses 2)
    page.goto(f"{BASE}/repos/1")
    page.wait_for_selector("text=Hello, Zola")
    ok &= audit(page, "posts")
    page.screenshot(path=f"{SHOT}/31-size-posts.png", full_page=True)

    page.click("text=Shortcodes & friends")
    page.wait_for_selector(".cm-content")
    page.get_by_role("button", name="settings", exact=True).first.click()
    page.wait_for_selector("text=taxonomies")
    # 26px = SegBtn, the segmented control beside the mini toolbar buttons
    ok &= audit(page, "editor+fm sheet", allow_short=(26,))
    page.screenshot(path=f"{SHOT}/32-size-editor-fm.png", full_page=True)

    page.get_by_role("button", name="done", exact=True).first.click()
    page.get_by_role("button", name="history", exact=True).first.click()
    page.wait_for_selector("text=select a commit")
    page.locator("button:has-text('initial zola site')").first.click()
    page.wait_for_selector("text=restore this version")
    ok &= audit(page, "versions")
    page.screenshot(path=f"{SHOT}/33-size-versions.png", full_page=True)

    b.close()

print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
