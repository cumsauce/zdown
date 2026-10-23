from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    page.goto('http://127.0.0.1:8100/repos/1/edit?path=content/blog/hello.md')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    page.screenshot(path='/tmp/ui_now.png')
    print('done')
    browser.close()
