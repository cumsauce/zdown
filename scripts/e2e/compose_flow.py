# Composer → new local file → editor; sidebar recents; editor at 3 widths.
import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100"
OUT = "scripts/e2e"
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "/")
    pg.click("[aria-label='title']")
    pg.keyboard.type("Compose test")
    pg.click("[aria-label='body']")
    # keep typing straight through the create + handoff; nothing may be lost
    pg.keyboard.type("First line from the composer.", delay=60)
    pg.wait_for_timeout(500)
    pg.keyboard.type(" Still typing.", delay=60)
    for _ in range(100):  # CSP forbids wait_for_function's eval
        if "/edit" in pg.url: break
        pg.wait_for_timeout(150)
    pg.wait_for_selector(".cm-content")
    pg.wait_for_timeout(500)
    url = pg.url
    body = pg.inner_text(".cm-content")
    pg.keyboard.type(" After handoff.")
    pg.wait_for_timeout(2500)
    body = pg.inner_text(".cm-content")
    print("body:", body.split("+++")[-1].strip())
    assert pg.locator("nav[aria-label='sidebar'] >> text=Compose test").count() == 1, "recent missing"
    pg.screenshot(path=f"{OUT}/43-editor-desk.png")
    print("created:", url)
    for name, w, h in [("mid", 1000, 800), ("phone", 390, 844)]:
        pg.set_viewport_size({"width": w, "height": h})
        pg.goto(url); pg.wait_for_selector(".cm-content"); pg.wait_for_timeout(400)
        pg.screenshot(path=f"{OUT}/43-editor-{name}.png")
    print("errors:", errs)
    b.close()
