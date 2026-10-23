"""Verify the local draft wins on reopen, and the escape hatches work."""
import asyncio
import sys

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8100"
PATH = "content%2Fblog%2Fshortcodes.md"
URL = f"{BASE}/repos/1/edit?path={PATH}"
failures = []


def step(name, ok, extra=""):
    print(("ok  " if ok else "FAIL") + f"  {name} {extra}")
    if not ok:
        failures.append(name)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        js_errors = []
        page.on("pageerror", lambda e: js_errors.append(str(e)))

        # harness sessions: same cookie flow.py uses (no-op under dev_auto_login)
        try:
            session = open("/tmp/md_ui/session.txt").read().strip()
            await page.context.add_cookies(
                [{"name": "md_editor_session", "value": session, "url": BASE}]
            )
        except OSError:
            pass

        await page.goto(URL)
        await page.wait_for_selector(".cm-content")
        await page.wait_for_timeout(600)

        # type something, do NOT save
        await page.locator(".cm-content").first.click()
        await page.keyboard.press("Meta+A")
        await page.keyboard.type("+++\ntitle = \"Draft precedence\"\n+++\n\nunsaved draft words.\n")
        await page.wait_for_timeout(400)

        # reopen the editor (fresh load)
        await page.goto(URL)
        await page.wait_for_selector(".cm-content")
        await page.wait_for_timeout(600)

        body = await page.inner_text(".cm-content")
        step("draft applied on reopen", "unsaved draft words" in body)
        banner = await page.inner_text("body")
        step("banner says restored", "restored instead of the committed file" in banner)
        step("dirty dot on", await page.locator("[title*='modified']").count() > 0)
        await page.screenshot(path="scripts/e2e/15-draft-applied.png", full_page=True)

        # discard -> back to committed
        await page.get_by_role("button", name="discard, show committed").first.click()
        await page.wait_for_timeout(400)
        body = await page.inner_text(".cm-content")
        step("discard shows committed", "unsaved draft words" not in body)
        step("banner gone", "local draft from" not in await page.inner_text("body"))

        # second round: make a draft again, then reload-from-server via ↻
        await page.locator(".cm-content").first.click()
        await page.keyboard.press("Meta+A")
        await page.keyboard.type("+++\ntitle = \"Draft precedence\"\n+++\n\nsecond round draft.\n")
        await page.wait_for_timeout(400)
        await page.get_by_label("reload from server").first.click()
        await page.wait_for_timeout(800)
        body = await page.inner_text(".cm-content")
        step("reload shows committed", "second round draft" not in body)
        step("reload offers restore", "differs from the committed file" in await page.inner_text("body"))
        await page.screenshot(path="scripts/e2e/16-draft-offered.png", full_page=True)

        # restore puts it back
        await page.get_by_role("button", name="restore", exact=True).first.click()
        await page.wait_for_timeout(300)
        step("restore re-applies", "second round draft" in await page.inner_text(".cm-content"))

        step("no js errors", not js_errors, "; ".join(js_errors))
        await browser.close()

    print(f"\n{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)


asyncio.run(main())
