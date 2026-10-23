"""Screenshots of every main screen at desktop + phone width → scripts/e2e/40-*.png"""
from playwright.sync_api import sync_playwright
B = "http://127.0.0.1:8100"
D = "scripts/e2e"
pages = [("repos", "/repos"), ("posts", "/repos/1"), ("editor", "/repos/1/edit?path=content%2Fblog%2Fhello.md"),
         ("versions", "/repos/1/versions?path=content%2Fblog%2Fhello.md"), ("settings", "/settings")]
with sync_playwright() as p:
    b = p.chromium.launch()
    for tag, vp in [("d", {"width": 1280, "height": 800}), ("m", {"width": 375, "height": 760})]:
        pg = b.new_page(viewport=vp)
        for name, url in pages:
            pg.goto(B + url, wait_until="networkidle"); pg.wait_for_timeout(500)
            if name == "versions":
                pg.locator("button:has-text('initial zola site')").first.click(); pg.wait_for_timeout(600)
            pg.screenshot(path=f"{D}/40-{tag}-{name}.png")
        pg.close()
    b.close()
