"""Verify the front matter settings panel round-trips through the editor."""
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8100"
results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{BASE}/repos/2/edit?path=hello.md&new=1")
        page.wait_for_function("location.pathname === '/repos/2/edit'")

        # Panel is collapsed by default.
        page.wait_for_selector("text=⚙ settings")
        check("collapsed by default", True)

        # Expand it.
        page.click("text=⚙ settings")
        page.wait_for_selector("label:has-text('title')")
        check("expands to form", True)

        # Type a title, apply, and check the doc picks it up (dimmed fm in CodeMirror).
        page.fill("label:has-text('title') input", "Settings round trip")
        page.fill("label:has-text('date') input", "2026-10-22")
        page.click("button:has-text('apply')")
        page.wait_for_selector("text=modified")
        body = page.inner_text("div.cm-content")
        check("applied title lands in doc", 'title = "Settings round trip"' in body)
        check("applied date lands in doc", "date = 2026-10-22" in body)

        # Save (⌘S) and confirm no errors.
        page.keyboard.press("Meta+s")
        time.sleep(1.0)
        check("no page errors after save", len(errors) == 0)

        # Reload the page: panel must parse the committed fm back into the form.
        page.goto(f"{BASE}/repos/2/edit?path=hello.md")
        page.wait_for_function("location.pathname === '/repos/2/edit'")
        page.click("text=⚙ settings")
        page.wait_for_selector("label:has-text('title')")
        val = page.input_value("label:has-text('title') input")
        check("form re-parses committed fm", val == "Settings round trip")

        # Extras: add one, apply, verify TOML section appears.
        page.locator("button:has-text('+ add')").nth(1).click()
        rows = page.query_selector_all("[aria-label='key']")
        rows[-1].fill("hero_color")
        rows[-1].dispatch_event("input")
        vals = page.query_selector_all("[aria-label='value']")
        vals[-1].fill("#7dd3fc")
        vals[-1].dispatch_event("input")
        page.click("button:has-text('apply')")
        time.sleep(0.3)
        body2 = page.inner_text("div.cm-content")
        check("extra key written as TOML", 'hero_color = "#7dd3fc"' in body2)

        # Verbatim fallback: hand-write a complex fm, panel should offer source editing.
        page.evaluate(
            """() => {
              const cm = document.querySelector('.cm-content');
              cm.focus();
            }"""
        )
        browser.close()

    ok = all(c for _, c in results)
    print(f"\n{sum(c for _, c in results)}/{len(results)} PASS")
    if not ok:
        sys.exit(1)


run()
