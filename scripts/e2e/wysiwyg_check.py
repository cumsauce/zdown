from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    page.goto('http://127.0.0.1:8100/repos/2')
    page.wait_for_load_state('networkidle')

    # Open the seeded post (first edit link in the file list)
    links = page.locator('a').all()
    target = None
    for l in links:
        href = l.get_attribute('href') or ''
        if '/edit?path=' in href:
            target = l
            break
    if target is None:
        page.goto('http://127.0.0.1:8100/repos/2/edit?path=scratch.md')
    else:
        target.click()
    page.wait_for_load_state('networkidle')

    # Type a markdown sample to see live formatting
    cm = page.locator('.cm-content')
    cm.click()
    page.keyboard.press('Control+a')
    page.keyboard.type('# Heading one')
    page.keyboard.press('Enter')
    page.keyboard.type('Normal text with **bold** and *italic* and `code` inside.')
    page.keyboard.press('Enter')
    page.keyboard.type('> A blockquote line')
    page.keyboard.press('Enter')
    page.keyboard.type('- bullet item one')
    page.keyboard.press('Enter')
    page.keyboard.type('A [link](https://example.com) and ~~struck~~ text.')
    page.wait_for_timeout(300)
    page.screenshot(path='/tmp/wysiwyg_check.png', full_page=False)

    info = page.evaluate('''() => {
      const out = {};
      const h = document.querySelector('.cm-md-heading');
      if (h) out.heading = { cls: h.className, fw: getComputedStyle(h).fontWeight, color: getComputedStyle(h).color };
      const m = document.querySelector('.cm-md-marker');
      if (m) out.marker = { text: m.textContent, color: getComputedStyle(m).color };
      const c = document.querySelector('.cm-md-code');
      if (c) out.code = { text: c.textContent, color: getComputedStyle(c).color };
      const e = document.querySelector('.cm-md-em');
      if (e) out.em = { text: e.textContent, style: getComputedStyle(e).fontStyle };
      const q = document.querySelector('.cm-md-quote');
      if (q) out.quote = { text: q.textContent };
      const l = document.querySelector('.cm-md-link');
      if (l) out.link = { text: l.textContent, color: getComputedStyle(l).color };
      return out;
    }''')
    print('DECORATIONS:', info)

    browser.close()
