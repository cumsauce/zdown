# Selection formatting: desktop popover (toggle bold on/off, ⌘I), phone
# toolbar switches to "format" mode while text is selected.
import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100"
OUT = "scripts/e2e"
URL = BASE + "/repos/1/edit?path=content%2Fblog%2Fhello.md"
def doc(pg): return pg.inner_text(".cm-content")
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector(".cm-content"); pg.wait_for_timeout(500)
    word = pg.locator(".cm-line", has_text="First post").first
    word.dblclick(position={"x": 15, "y": 10}); pg.wait_for_timeout(300)
    pop = pg.locator("[aria-label='format selection']")
    print("popover shown:", pop.count() == 1)
    pg.screenshot(path=f"{OUT}/60-popover-desk.png")
    pop.get_by_label("bold").click(); pg.wait_for_timeout(200)
    print("bolded:", "**First**" in doc(pg))
    pop.get_by_label("bold").click(); pg.wait_for_timeout(200)
    print("unbolded:", "**First**" not in doc(pg) and "First post" in doc(pg))
    pg.keyboard.press("Meta+i"); pg.wait_for_timeout(200)
    print("cmd-i:", "*First*" in doc(pg))
    pg.keyboard.press("Meta+i"); pg.wait_for_timeout(200)
    print("cmd-i toggles off:", "*First*" not in doc(pg))
    pg.keyboard.press("ArrowRight"); pg.wait_for_timeout(200)
    print("popover hides on collapse:", pop.count() == 0)
    print("back to original:", "First post. Some **bold**" in doc(pg))
    ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    m = ctx.new_page(); m.goto(URL); m.wait_for_selector(".cm-content"); m.wait_for_timeout(500)
    m.locator(".cm-line", has_text="First post").first.dblclick(position={"x": 15, "y": 10}); m.wait_for_timeout(300)
    print("phone: no popover:", m.locator("[aria-label='format selection']").count() == 0)
    print("phone: toolbar format mode:", m.locator("[aria-label=formatting] >> text=format").count() == 1)
    m.screenshot(path=f"{OUT}/61-format-phone.png")
    print("errors:", errs)
    # leave the doc as it was (autosave may have stored edits)
    b.close()
