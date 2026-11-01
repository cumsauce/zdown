# Design

**Paper and ink.** Warm paper, near-black ink, one proofreader's-red accent used
sparingly (caret, links, what needs your attention). It should feel like a
manuscript, not a dashboard.

## Rules

- **The post is the interface.** The editor looks like the published page: real
  title, real type, rendered images and components. Syntax shows up only where
  the cursor is. Raw front matter stays behind "Post details".
- **One surface.** Nothing changes shape when you start typing, when a file gets
  created, or between screen sizes. New posts use the same editor as old ones.
- **Tokens only.** Colours and fonts come from `tokens` in `theme.ts`, which are
  CSS variables defined for light and dark in `styles.css`. Never a raw hex in a
  component.
- **Type.** Newsreader for what you write and titles. System sans for interface.
  Mono only for code and paths. Interface text is 14–15px, meta never below 13px;
  prose is 19px (18px on phones).
- **Touch.** Every target is at least 44px on a coarse pointer, and fields are 16px
  so iOS doesn't zoom. `scripts/e2e/experience.py` enforces both, plus no sideways
  scroll, on every page in both themes.
- **Navigation.** A sidebar from 900px; below that the same destinations as a tab
  bar. No drawer. The editor takes the whole screen and has its own way back.
- **Plain words.** "Publish", not "push". "Changed here and on GitHub", not
  "merge conflict". Say what happened and what to do next.
- **Primitives** live in `components/ui.tsx` (`Btn`, `Input`, `Sheet`, `Menu`, …).
  Menus and modals become bottom sheets on phones.

## How the editor renders

`components/editor/live.ts` builds decorations from the Lezer markdown tree, so
list depth, code in lists and emphasis read the way a renderer reads them. They
never edit the document; the file on disk is always plain markdown.

`lib/render.ts` has two paths, chosen per document:

| | Zola >= 0.23 (components) | Zola < 0.23 (shortcodes) |
|---|---|---|
| Syntax | `{{ <x a="b" /> }}`, `{% <x> %}…{% </x> %}` | `{{ x(a="b") }}`, `{% x() %}…{% end %}` |
| Templates | `{% component %}` in any template | `templates/shortcodes/*` |
| Order | whole content through Tera, then markdown | each call rendered, stashed around markdown |
| Escaping | none | autoescape in `.html` |
| Scope | a component sees only its parameters | `page`, `config`, `nth`, … |
| Undefined variable | error, shown in place | renders empty |

Everything passes through DOMPurify. A site's stylesheet isn't loaded (it's often
Sass that needs a build), so components show their structure with the app's type;
common class names like `note` and `warning` get a callout look.
