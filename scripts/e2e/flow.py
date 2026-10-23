"""End-to-end flow against the local harness.

Drives: repos -> posts -> editor -> edit/save -> history -> diff -> restore.
Prints PASS/FAIL per step and exits non-zero if anything failed.
"""

import subprocess
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8100"
SESSION = open("/tmp/md_ui/session.txt").read().strip()
SHOT = "/Users/lume/md/md_editor/scripts/e2e"
ORIGINAL = "+++\ntitle = \"Shortcodes & friends\"\n"

failures = []
js_errors = []


def step(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_cookies([{"name": "md_editor_session", "value": SESSION, "url": BASE}])
    page = ctx.new_page()
    page.on("pageerror", lambda e: js_errors.append(f"pageerror: {e}"))
    page.on("dialog", lambda d: d.accept())

    # --- repos ---
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    step("repos listed", page.locator("text=test/zola-site").count() > 0)
    page.screenshot(path=f"{SHOT}/01-repos.png", full_page=True)

    page.click("text=test/zola-site")
    page.wait_for_url("**/repos/1")
    page.wait_for_timeout(600)
    step("posts listed", page.locator("text=Hello, Zola").count() > 0)
    step("broken front matter flagged", page.locator("text=(untitled)").count() > 0)
    step("shortcode badges", page.locator("text=youtube").count() > 0)
    page.screenshot(path=f"{SHOT}/02-posts.png", full_page=True)

    # --- editor ---
    page.click("text=Shortcodes & friends")
    page.wait_for_url("**/repos/1/edit**")
    page.wait_for_timeout(1200)
    step("editor opened", "shortcodes.md" in page.url, page.url)
    body = page.inner_text("body")
    step("editor shows front matter", 'title = "Shortcodes & friends"' in body)
    # the editor opens on the writing view; toggle the marks affordance off+on
    page.get_by_role("button", name="marks", exact=True).first.click()
    page.wait_for_timeout(600)
    step("clean mode keeps prose text", page.locator("text=Careful with this one.").count() > 0)
    page.screenshot(path=f"{SHOT}/03-editor.png", full_page=True)

    # --- edit + save ---
    page.get_by_role("button", name="marks", exact=True).first.click()
    page.wait_for_timeout(400)
    editor = page.locator(".cm-content").first
    step("codemirror present", editor.count() > 0)
    editor.click()
    page.keyboard.press("Meta+A")
    page.keyboard.type("+++\ntitle = \"Edited in browser\"\n+++\n\nNew body from the UI.\n")
    page.wait_for_timeout(400)
    step("dirty indicator", page.locator("[title*='modified']").count() > 0)

    page.get_by_role("button", name="save").first.click()
    page.wait_for_timeout(1500)
    step("save succeeded", page.locator("[title='saved']").count() > 0)
    page.screenshot(path=f"{SHOT}/04-saved.png", full_page=True)

    # --- reload keeps the saved text ---
    page.get_by_label("reload from server").first.click()
    page.wait_for_timeout(1200)
    step("reload shows saved text", "Edited in browser" in page.inner_text("body"))

    # --- history ---
    page.get_by_role("button", name="history").first.click()
    page.wait_for_timeout(1200)
    step("versions page", "/versions" in page.url, page.url)
    step("commit listed", page.locator("text=Update content/blog/shortcodes.md").count() > 0)
    page.screenshot(path=f"{SHOT}/05-versions.png", full_page=True)

    page.locator("text=Update content/blog/shortcodes.md").first.click()
    page.wait_for_timeout(1500)
    diff = page.inner_text("body")
    step("diff rendered", "Edited in browser" in diff and "@@" in diff)
    page.screenshot(path=f"{SHOT}/06-diff.png", full_page=True)

    # --- root commit diffs against the empty tree, not sha~1 ---
    page.locator("text=initial zola site").first.click()
    page.wait_for_timeout(1500)
    root = page.inner_text("body")
    step("root commit diff", "bad range" not in root and "@@" in root,
         "shown" if "@@" in root else root[0:120])

    # --- restore the pre-edit version (the root commit) ---
    page.get_by_role("button", name="restore this version").first.click()
    page.wait_for_timeout(2500)
    step("restore committed",
         page.locator("text=Revert content/blog/shortcodes.md").count() > 0,
         "list shows revert" if page.locator("text=Revert content/blog/shortcodes.md").count() else "missing")

    page.goto(f"{BASE}/repos/1/edit?path=content%2Fblog%2Fshortcodes.md")
    page.wait_for_timeout(1500)
    text = page.inner_text("body")
    step("content reverted", "Shortcodes & friends" in text and "Edited in browser" not in text)
    page.screenshot(path=f"{SHOT}/07-restored.png", full_page=True)

    # --- local scratch repo: create, write, verify history, no sync/publish ---
    page.goto(f"{BASE}/repos")
    page.wait_for_load_state("networkidle")
    page.fill('input[placeholder="my-notes"]', "scratchpad")
    page.click("text=start writing")
    page.get_by_role("button", name="create", exact=True).click()
    page.wait_for_timeout(800)
    step("local repo created", page.locator("a:has-text('scratchpad')").count() > 0)
    page.screenshot(path=f"{SHOT}/08-local-created.png", full_page=True)

    page.click("a:has-text('scratchpad')")
    # client-side routing: no new 'load' event, so wait_for_url would hang
    page.wait_for_function("location.pathname === '/repos/2'")
    page.wait_for_timeout(800)
    step("local repo lists seeded post", page.locator("text=README.md").count() > 0)
    step("local hides sync/publish", page.locator('button:has-text("publish")').count() == 0)
    step("local shows connect panel", "connect to a repository" in page.inner_text("body").lower())
    page.screenshot(path=f"{SHOT}/09-local-posts.png", full_page=True)

    page.fill('input[placeholder="content/blog/my-new-post.md"]', "ideas.md")
    page.click("text=new post")
    page.wait_for_function("location.pathname.includes('/edit')")
    page.wait_for_timeout(800)
    editor = page.locator(".cm-content").first
    editor.click()
    page.keyboard.type("# first idea\n\nwritten outside any git repo.\n")
    page.wait_for_timeout(300)
    page.get_by_role("button", name="save").first.click()
    page.wait_for_timeout(1500)
    step("local save committed", page.locator("[title='saved']").count() > 0)

    page.get_by_role("button", name="history").first.click()
    page.wait_for_timeout(1200)
    step("local history works", page.locator("text=Create ideas.md").count() > 0)

    # sync on a local repo should be refused by the API
    resp = page.request.post(f"{BASE}/api/repos/2/sync")
    step("local sync refused", resp.status == 409, f"HTTP {resp.status}")
    page.screenshot(path=f"{SHOT}/10-local-versions.png", full_page=True)

    # --- connect the local repo to an (empty) remote ---
    # (dialog auto-accept is already installed on `page` at the top of the run)
    page.goto(f"{BASE}/repos/2")
    page.wait_for_timeout(800)
    page.fill('input[placeholder="owner/repo"]', "test/scratch")
    page.get_by_role("button", name="connect", exact=True).click()
    page.wait_for_timeout(2000)
    step("connect enabled publish", page.locator('button:has-text("publish")').count() > 0)
    step("connect dropped local panel", "connect to a repository" not in page.inner_text("body").lower())
    page.screenshot(path=f"{SHOT}/11-connected.png", full_page=True)

    out = subprocess.run(
        ["git", "--git-dir=/tmp/md_ui/origin-new.git", "log", "--oneline", "main"],
        capture_output=True, text=True).stdout
    step("remote has pushed history", "init" in out and "Create ideas.md" in out, out.strip().splitlines()[-1] if out.strip() else "")

    print("\nJS errors:", js_errors if js_errors else "(none)")
    browser.close()

print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
