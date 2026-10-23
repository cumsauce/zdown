# Screenshots of the sidebar shell at desktop / mid / phone widths.
import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100"
OUT = "scripts/e2e"
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, w, h in [("desk", 1440, 900), ("mid", 1000, 800), ("phone", 390, 844)]:
        pg = b.new_page(viewport={"width": w, "height": h})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE + "/")
        pg.wait_for_selector("[aria-label=title]")
        pg.wait_for_timeout(400)
        pg.screenshot(path=f"{OUT}/40-home-{name}.png")
        pg.goto(BASE + "/repos/1")
        pg.wait_for_timeout(800)
        pg.screenshot(path=f"{OUT}/41-posts-{name}.png")
        if name == "phone":
            pg.click("[aria-label='open sidebar']")
            pg.wait_for_timeout(300)
            pg.screenshot(path=f"{OUT}/42-drawer-{name}.png")
        print(name, "errors:", errs)
        pg.close()
    b.close()
