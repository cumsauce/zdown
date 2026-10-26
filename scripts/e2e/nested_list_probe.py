"""Probe: Tab / Shift-Tab / Enter on lists in the write mode (with auto-continuation)."""
import time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8100"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/repos/3/edit?path=list-probe-2.md&new=1", wait_until="networkidle")
    pg.wait_for_selector(".cm-content", timeout=10000)
    cm = pg.locator(".cm-content")
    cm.click()

    def doc(label):
        lines = pg.eval_on_selector_all(".cm-line", "els => els.map(e => e.textContent)")
        print(f"{label:16}", lines)

    pg.keyboard.press("ControlOrMeta+a")
    pg.keyboard.type("first\n\n- one", delay=15)
    doc("typed")
    pg.keyboard.press("Enter")   # auto-continues "- "
    pg.keyboard.type("two", delay=15)
    doc("item two")
    pg.keyboard.press("Tab")     # nest "two"
    doc("after Tab")
    pg.keyboard.press("End")
    pg.keyboard.type(" x", delay=15)
    pg.keyboard.press("Enter")   # continue the nested item
    doc("nested Enter")
    pg.keyboard.type("sub-a", delay=15)
    pg.keyboard.press("Enter")
    pg.keyboard.type("sub-b", delay=15)
    doc("two subs")
    pg.keyboard.press("Shift+Tab")  # dedent sub-b to top level
    doc("after Shift-Tab")
    pg.keyboard.press("Enter")
    pg.keyboard.press("Enter")      # empty item escapes the list
    doc("2x Enter")
    time.sleep(0.5)
    pg.screenshot(path="/Users/lume/md/md_editor/scripts/e2e/32-nested-write.png")
    b.close()
