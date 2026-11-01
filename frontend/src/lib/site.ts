import type { PostSummary, Site } from '../api';

// Reads a repo the way Zola does. `_index.md` makes a folder a *section*,
// `dir/index.md` is one page whose media sits beside it (a *bundle*), anything
// else under content/ is a page, and everything outside content/ (READMEs,
// theme files…) isn't site content at all.

export interface Page {
  post: PostSummary;
  /** folder it's listed under */
  dir: string;
  /** url-ish name: file name without extension, or the bundle's folder */
  slug: string;
  bundle: boolean;
  title: string;
}

export interface SectionNode {
  dir: string;
  name: string;
  /** the _index.md, when the folder has one */
  index: PostSummary | null;
  pages: Page[];
  children: SectionNode[];
  /** pages here and in every subsection */
  total: number;
}

export interface SiteTree {
  root: SectionNode;
  /** every section by dir, root included */
  byDir: Map<string, SectionNode>;
  /** markdown files that aren't site content */
  other: Page[];
  /** content root: "content" for a Zola site, "" for a plain folder of notes */
  contentDir: string;
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/^\p{L}/u, (c) => c.toUpperCase());

function toPage(post: PostSummary): Page {
  const base = baseOf(post.path);
  const dir = dirOf(post.path);
  const bundle = /^index(\.[a-z-]+)?\.(md|markdown)$/i.test(base) && dir !== '';
  const slug = bundle ? baseOf(dir) : base.replace(/\.(md|markdown)$/i, '');
  return { post, dir: bundle ? dirOf(dir) : dir, slug, bundle, title: post.title?.trim() || titleCase(slug.replace(/^\d{4}-\d{2}-\d{2}[-_]/, '')) };
}

export function buildTree(posts: PostSummary[], site: Site | null): SiteTree {
  const contentDir = site?.zola ? `${site.root}content` : '';
  const prefix = contentDir ? `${contentDir}/` : '';
  const byDir = new Map<string, SectionNode>();
  const node = (dir: string): SectionNode => {
    let n = byDir.get(dir);
    if (n) return n;
    n = { dir, name: dir === contentDir ? 'All' : titleCase(baseOf(dir)), index: null, pages: [], children: [], total: 0 };
    byDir.set(dir, n);
    if (dir !== contentDir) {
      const parent = node(dirOf(dir).length >= contentDir.length ? dirOf(dir) : contentDir);
      parent.children.push(n);
    }
    return n;
  };
  const root = node(contentDir);
  const other: Page[] = [];
  for (const post of posts) {
    if (prefix && !post.path.startsWith(prefix)) { other.push(toPage(post)); continue; }
    if (baseOf(post.path).startsWith('_index.')) {
      const n = node(dirOf(post.path));
      // the default language's _index.md names the section
      if (baseOf(post.path) === '_index.md' || !n.index) n.index = post;
      if (post.title?.trim() && baseOf(post.path) === '_index.md' && n !== root) n.name = post.title.trim();
      continue;
    }
    const page = toPage(post);
    node(page.dir).pages.push(page);
  }
  const count = (n: SectionNode): number => {
    n.total = n.pages.length + n.children.reduce((s, c) => s + count(c), 0);
    n.children.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return n.total;
  };
  count(root);
  return { root, byDir, other, contentDir };
}

export const isFuture = (date: string | null) => !!date && date.slice(0, 10) > new Date().toISOString().slice(0, 10);

const byTitle = (a: Page, b: Page) => a.title.localeCompare(b.title);
const when = (p: Page) => p.post.date ?? '';
const dateDesc = (a: Page, b: Page) => when(b).localeCompare(when(a)) || (b.post.modified ?? 0) - (a.post.modified ?? 0) || byTitle(a, b);

/**
 * Newest first, however the file names sort. A section's `sort_by` is honoured
 * for the orders an author chooses deliberately (weight, title). Undated pages
 * sort by when they were last edited, so a new file isn't buried.
 */
export function sortPages(pages: Page[], sortBy: string | null | undefined): Page[] {
  const list = pages.slice();
  if (sortBy === 'weight') {
    return list.sort((a, b) => (a.post.weight ?? Infinity) - (b.post.weight ?? Infinity) || byTitle(a, b));
  }
  if (sortBy === 'title' || sortBy === 'title_bytes') return list.sort(byTitle);
  if (list.some((p) => p.post.date)) return list.sort(dateDesc);
  return list.sort((a, b) => (b.post.modified ?? 0) - (a.post.modified ?? 0) || byTitle(a, b));
}

/** Every page in a section and below, as one list. */
export function allPages(n: SectionNode): Page[] {
  return [...n.pages, ...n.children.flatMap(allPages)];
}

/** Where a new post goes when nothing more specific was chosen: the busiest section with dated pages. */
export function defaultSection(tree: SiteTree): SectionNode {
  let best: SectionNode = tree.root;
  let score = -1;
  for (const n of tree.byDir.values()) {
    if (n === tree.root && tree.byDir.size > 1) continue;
    const s = n.pages.filter((p) => p.post.date).length * 2 + n.pages.length;
    if (s > score) { best = n; score = s; }
  }
  return best;
}

/** A section where most posts are bundles gets bundles for new posts too. */
export const usesBundles = (n: SectionNode) => {
  const bundles = n.pages.filter((p) => p.bundle).length;
  return bundles > 0 && bundles >= n.pages.length / 2;
};

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export function newPostPath(dir: string, slug: string, bundle: boolean) {
  const prefix = dir ? `${dir}/` : '';
  return bundle ? `${prefix}${slug}/index.md` : `${prefix}${slug}.md`;
}

export function formatDate(date: string | null, withYear = true): string {
  if (!date) return '';
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

// ---------- resolving image references ----------

export interface Resolved {
  /** what to put in src; null when nothing in the repo matches */
  url: string | null;
  external: boolean;
  /** repo paths that were tried, for the "not found" message */
  tried: string[];
}

const normalize = (p: string) => {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
};

export const rawUrl = (repoId: number, path: string) => `/api/repos/${repoId}/raw?path=${encodeURIComponent(path)}`;

/**
 * Where `src` points in the repo, the way Zola serves it: `static/` is the site
 * root, `content/` pages are served beside their assets, `@/` is the content
 * root, and an absolute URL on the site's own domain is the same as a root path.
 */
export function resolveImage(src: string, postPath: string | null, site: Site | null, repoId: number): Resolved {
  let s = src.trim().replace(/^<|>$/g, '').split(/[?#]/)[0];
  try { s = decodeURI(s); } catch { /* keep as written */ }

  const base = site?.base_url?.replace(/\/+$/, '');
  if (base && s.startsWith(`${base}/`)) s = s.slice(base.length);
  else if (/^(https?:)?\/\//i.test(s) || /^(data|blob):/i.test(s)) return { url: src.trim(), external: true, tried: [] };

  const root = site?.root ?? '';
  const theme = site?.theme ? `${root}themes/${site.theme}/static/` : null;
  const dir = postPath ? dirOf(postPath) : '';
  const candidates: string[] = [];
  if (s.startsWith('@/')) {
    candidates.push(`${root}content/${s.slice(2)}`);
  } else if (s.startsWith('/')) {
    const r = s.slice(1);
    // a base_url with a path (user.github.io/blog) prefixes root-relative links
    const basePath = base ? (/^https?:\/\/[^/]+(\/.*)$/.exec(base)?.[1] ?? '') : '';
    const noBase = basePath && s.startsWith(`${basePath}/`) ? s.slice(basePath.length + 1) : null;
    for (const x of noBase ? [noBase, r] : [r]) {
      candidates.push(`${root}static/${x}`, `${root}content/${x}`);
      if (theme) candidates.push(`${theme}${x}`);
      candidates.push(`${root}${x}`);
    }
  } else {
    candidates.push(normalize(`${dir}/${s}`));
    // a plain page is served at /section/slug/, so relative paths usually
    // mean a sibling folder of that slug, or the site root
    if (postPath && !/^_?index\./.test(baseOf(postPath))) {
      candidates.push(normalize(`${dir}/${baseOf(postPath).replace(/\.\w+$/, '')}/${s}`));
    }
    candidates.push(normalize(`${root}static/${s}`), normalize(`${root}content/${s}`));
    if (theme) candidates.push(normalize(`${theme}${s}`));
    candidates.push(normalize(`${root}${s}`));
  }
  const tried = [...new Set(candidates.map(normalize))].filter(Boolean);
  if (!site) return { url: tried[0] ? rawUrl(repoId, tried[0]) : null, external: false, tried };
  const hit = tried.find((c) => site.images.includes(c));
  return { url: hit ? rawUrl(repoId, hit) : null, external: false, tried };
}

/** Where an uploaded image goes, and how the post should refer to it. */
export function uploadTarget(fileName: string, postPath: string | null, site: Site | null): { path: string; ref: (landed: string) => string } {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : '.png';
  const stem = slugify(dot > 0 ? fileName.slice(0, dot) : fileName) || 'image';
  const name = `${stem}${ext}`;
  const dir = postPath ? dirOf(postPath) : '';
  // a bundle keeps its media beside it
  if (postPath && /^index\.[a-z]+$/i.test(baseOf(postPath))) {
    return { path: `${dir}/${name}`, ref: (p) => baseOf(p) };
  }
  if (site?.zola) {
    const staticDir = `${site.root}static/`;
    return { path: `${staticDir}images/${name}`, ref: (p) => `/${p.slice(staticDir.length)}` };
  }
  const prefix = dir ? `${dir}/` : '';
  return { path: `${prefix}images/${name}`, ref: (p) => p.slice(prefix.length) };
}
