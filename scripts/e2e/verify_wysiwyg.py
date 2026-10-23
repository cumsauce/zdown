from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 900})
    pg.goto('http://127.0.0.1:8100/repos/1/edit?path=content/blog/hello.md')
    pg.wait_for_load_state('networkidle')
    pg.wait_for_timeout(600)

    for sel, label in [('.cm-md-heading', 'heading'), ('.cm-md-marker', 'marker'),
                       ('.cm-md-code', 'code'), ('.cm-md-link', 'link')]:
        el = pg.query_selector(sel)
        if not el:
            print(f'{label}: NOT RENDERED')
            continue
        s = el.evaluate("e => { const c = getComputedStyle(e); return {text: e.textContent, fw: c.fontWeight, color: c.color, fs: c.fontStyle}; }")
        print(f'{label}: {s}')

    # what still looks code-y
    print('line-number elements:', len(pg.query_selector_all('.cm-lineNumbers .cm-gutterElement')))
    print('gutter present:', bool(pg.query_selector('.cm-gutters')))
    print('default view = write, panes:', len(pg.query_selector_all('.cm-host')))
    print('status text:', pg.inner_text('.cm-host >> xpath=ancestor::div[contains(@class,"css")][1]') if False else '')
    b.close()
