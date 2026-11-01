"""Compare our preview with what `zola build` really produces for the Zola >= 0.23 fixture.

    bash scripts/e2e/harness.sh
    uv run --with playwright python scripts/e2e/zola_parity.py

Compares the sequence of block elements and their text, after normalizing what
legitimately differs: resolved image URLs, the sanitizer's removals, heading ids.
"""
import re, subprocess, sys, tempfile
from html.parser import HTMLParser
from playwright.sync_api import sync_playwright

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
d = tempfile.mkdtemp()
subprocess.run(["bash", f"{ROOT}/scripts/e2e/fixture_components.sh", f"{d}/site"], check=True)
r = subprocess.run(["zola", "build"], cwd=f"{d}/site", capture_output=True, text=True, stdin=subprocess.DEVNULL)
assert r.returncode == 0, r.stderr
real = open(f"{d}/site/public/blog/trip/index.html").read()
real = real[real.index("<main>") + 6:real.index("</main>")]

VOID = {"img", "hr", "br", "input"}


class Skeleton(HTMLParser):
    """Tag tree with class and alt, plus whitespace-collapsed text."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "script":
            self.skip += 1
            return
        keep = "".join(f" {k}={a[k]}" for k in ("class", "alt") if a.get(k))
        self.out.append(f"<{tag}{keep}>")

    def handle_endtag(self, tag):
        if tag == "script":
            self.skip -= 1
            return
        if tag not in VOID:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        t = re.sub(r"\s+", " ", data).strip()
        if t and not self.skip:
            self.out.append(t)


def skeleton(html):
    p = Skeleton()
    p.feed(html)
    return p.out


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 3000})
    pg.goto("http://127.0.0.1:8100/repos/2/edit?path=content/blog/trip/index.md", wait_until="networkidle")
    pg.wait_for_selector(".cm-content")
    pg.get_by_role("button", name="Preview").click()
    pg.wait_for_selector("article.prose")
    pg.wait_for_timeout(500)
    ours = pg.eval_on_selector("article.prose", "e => e.innerHTML")
    title = pg.locator("h1").first.inner_text()
    b.close()

a, c = skeleton(real), skeleton(ours)
import difflib
diff = [l for l in difflib.unified_diff(a, c, "zola", "preview", lineterm="", n=1)]
print("\n".join(diff) or "identical")
print(f"\n{len(a)} tokens from zola, {len(c)} from the preview; title {title!r}")
sys.exit(1 if diff else 0)
