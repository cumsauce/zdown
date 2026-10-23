import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8100"
SESSION = open("/tmp/md_ui/session.txt").read().strip()
SHOT = "/Users/lume/md/md_editor/scripts/e2e"

errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_cookies([{"name": "md_editor_session", "value": SESSION, "url": BASE}])
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"console[{m.type}]: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    # 1. repos list
    page.goto(f"{BASE}/")
    page.wait_for_load_state("networkidle")
    print("== repos page ==")
    print(page.inner_text("body")[:600])
    page.screenshot(path=f"{SHOT}/01-repos.png", full_page=True)

    # 2. posts list
    page.click("text=test/zola-site")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(800)
    print("\n== posts page ==")
    print(page.inner_text("body")[:1200])
    page.screenshot(path=f"{SHOT}/02-posts.png", full_page=True)

    # 3. editor: shortcodes post
    page.click("text=Shortcodes & friends")
    page.wait_for_timeout(1500)
    print("\n== editor page ==")
    print(page.inner_text("body")[:1500])
    page.screenshot(path=f"{SHOT}/03-editor.png", full_page=True)

    print("\n== errors ==")
    print("\n".join(errors) if errors else "(none)")

    browser.close()
    if errors:
        sys.exit(1)
