# Phone audit (iPhone-ish, touch/coarse pointer): screenshots of every screen,
# tap targets < 40px, form text < 16px (iOS zoom), horizontal overflow; plus
# the delete-file flow.
import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100"
OUT = "scripts/e2e"
AUDIT = """() => {
  const bad = [];
  for (const el of document.querySelectorAll('button, a[href], input, textarea, [role=option]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (r.right < 0 || r.left > innerWidth) continue;  // off-canvas
    if (el.closest('.cm-editor')) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.tagName).trim().slice(0, 30);
    if (el.matches('input, textarea') && parseFloat(getComputedStyle(el).fontSize) < 16) bad.push(`font<16: ${label}`);
    if (!el.matches('input, textarea') && r.height < 40 && !el.closest('[data-baseweb=input]')) bad.push(`h=${Math.round(r.height)}: ${label}`);
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`overflow-x ${document.documentElement.scrollWidth}`);
  return bad;
}"""
problems = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    ctx.on("dialog", lambda d: d.accept())
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    def shot(name):
        pg.wait_for_timeout(500)
        pg.screenshot(path=f"{OUT}/50-m-{name}.png")
        problems[name] = pg.evaluate(AUDIT)
    pg.goto(BASE + "/"); pg.wait_for_selector("[aria-label=title]"); shot("home")
    pg.goto(BASE + "/repos/1"); pg.wait_for_selector("text=Hello, Zola"); shot("posts")
    pg.get_by_role("button", name="files").click(); shot("drawer")
    pg.goto(BASE + "/repos"); shot("projects")
    pg.goto(BASE + "/settings"); shot("settings")
    # new file → editor → delete it
    pg.goto(BASE + "/")
    pg.click("[aria-label=title]"); pg.keyboard.type("Delete me")
    pg.keyboard.press("Enter")
    for _ in range(100):
        if "/edit" in pg.url: break
        pg.wait_for_timeout(150)
    pg.wait_for_selector(".cm-content"); pg.keyboard.press("Escape")
    pg.locator(".cm-content").evaluate("e => e.blur()")
    shot("editor")
    pg.get_by_label("more actions").click(); shot("editor-menu")
    pg.get_by_role("option", name="Delete file…").click()
    for _ in range(60):
        if "/edit" not in pg.url: break
        pg.wait_for_timeout(150)
    print("after delete:", pg.url)
    r = pg.request.get(BASE + "/api/repos/3/post?path=delete-me.md")
    print("deleted file status:", r.status)
    b.close()
for k, v in problems.items():
    print(f"{k}: {'ok' if not v else v}")
print("errors:", errs)
