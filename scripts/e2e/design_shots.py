"""Design-review screenshots: landing, repos list, posts list, editor, preview."""
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8100'
OUT = '/Users/lume/md/md_editor/scripts/e2e'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(BASE + '/')
    page.wait_for_load_state('networkidle')
    page.screenshot(path=f'{OUT}/01-landing.png')

    page.goto(BASE + '/repos/2')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/02-posts.png')

    page.goto(BASE + '/repos/2/edit?path=ideas.md')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    page.screenshot(path=f'{OUT}/03-editor-write.png')

    # switch to preview if the seg control exists
    try:
        page.get_by_text('preview', exact=True).first.click(timeout=2000)
        page.wait_for_timeout(300)
        page.screenshot(path=f'{OUT}/04-editor-preview.png')
    except Exception as e:
        print('preview click failed:', e)

    print('JS errors:', errors or 'none')
    browser.close()
