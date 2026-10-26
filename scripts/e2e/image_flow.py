"""E2E: in-repo images show up in the editor preview (bundle-relative, root-relative, external)."""
import json, struct, subprocess, time, urllib.request, zlib
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8100"
MIRROR = "/tmp/md_ui/data/repos/1.git"


def git(*args, **kw):
    r = subprocess.run(["git", *args], cwd=MIRROR, capture_output=True, text=True, **kw)
    assert r.returncode == 0, (args, r.stderr)


def png_bytes(w, h, rgb):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


ref = subprocess.run(["git", "for-each-ref", "--format=%(refname:short)", "refs/heads/"],
                     cwd=MIRROR, capture_output=True, text=True).stdout.split()
branch = "zola-site-user" if "zola-site-user" in ref else "main"
print("working branch:", branch)
head = subprocess.run(["git", "rev-parse", branch], cwd=MIRROR, capture_output=True, text=True).stdout.strip()

import tempfile, os
tmp = tempfile.mkdtemp()
subprocess.run(["git", "clone", "-q", "--no-hardlinks", MIRROR, tmp, "--branch", branch], check=True)
os.makedirs(f"{tmp}/content/blog/first-post", exist_ok=True)
os.makedirs(f"{tmp}/static", exist_ok=True)
open(f"{tmp}/content/blog/first-post/index.md", "w").write(
    "+++\ntitle = \"Images post\"\ndate = 2026-10-23\n+++\n\n"
    "Bundle: ![](photo.png)\n\n"
    "Root: ![](/static/logo.png)\n\n"
    "External: ![](https://github.com/cumsauce.png)\n")
open(f"{tmp}/content/blog/first-post/photo.png", "wb").write(png_bytes(64, 48, (125, 211, 252)))
open(f"{tmp}/static/logo.png", "wb").write(png_bytes(32, 32, (74, 222, 128)))
subprocess.run(["git", "add", "."], cwd=tmp, check=True)
if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=tmp).returncode != 0:
    subprocess.run(["git", "commit", "-q", "-m", "images post"], cwd=tmp,
                   env={"GIT_AUTHOR_NAME": "lume", "GIT_AUTHOR_EMAIL": "lume@local",
                        "GIT_COMMITTER_NAME": "lume", "GIT_COMMITTER_EMAIL": "lume@local",
                        "PATH": os.environ["PATH"], "HOME": os.environ["HOME"]}, check=True)
subprocess.run(["git", "push", "-q", MIRROR, f"{branch}:{branch}"], cwd=tmp, check=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/repos/1/edit?path=content/blog/first-post/index.md", wait_until="networkidle")
    time.sleep(1)
    btn = pg.get_by_role("button", name="preview")
    btn.click()
    time.sleep(1.5)
    imgs = pg.eval_on_selector_all(".preview img",
        "els => els.map(e => ({cls: e.alt, src: e.src.slice(0, 90), ok: e.complete && e.naturalWidth > 0}))")
    for i in imgs:
        print(("PASS " if i["ok"] else "FAIL "), i["cls"], i["src"])
    pg.screenshot(path="/Users/lume/md/md_editor/scripts/e2e/31-images-preview.png", full_page=True)
    b.close()
