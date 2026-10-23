"""Editor header/toolbar at phone, mid and desktop widths → scripts/e2e/41-*.png"""
from playwright.sync_api import sync_playwright
U = "http://127.0.0.1:8100/repos/1/edit?path=content%2Fblog%2Fhello.md"
D = "scripts/e2e"
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, touch in [("phone", (375, 760), True), ("mid", (703, 800), False), ("desk", (1280, 800), False)]:
        ctx = b.new_context(viewport={"width": vp[0], "height": vp[1]}, has_touch=touch, is_mobile=touch)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(U, wait_until="networkidle"); pg.wait_for_timeout(500)
        pg.screenshot(path=f"{D}/41-{name}.png")
        if vp[0] < 1100:
            pg.click("[aria-label='more actions']"); pg.wait_for_timeout(300)
            pg.screenshot(path=f"{D}/41-{name}-menu.png")
            pg.click("text=Post settings")
        else:
            pg.click("[aria-label='settings']")
        pg.wait_for_timeout(300)
        pg.screenshot(path=f"{D}/41-{name}-settings.png")
        print(name, "errors:", errs)
        ctx.close()
    b.close()
