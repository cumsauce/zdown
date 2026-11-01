import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { type EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { parsedField } from './live';
import type { Issue, IssueKind, ReviewRequest, ReviewResponse, ReviewSummary } from './reviewTypes';

// Review mode: highlights over the text, never edits to it. Marks follow the
// text as you type (mapped through each change) and refresh once you pause.

export const setIssues = StateEffect.define<Issue[]>();
export const setHidden = StateEffect.define<Set<IssueKind>>();
export const setActive = StateEffect.define<Issue | null>();

interface ReviewState { issues: Issue[]; hidden: Set<IssueKind>; active: Issue | null; deco: DecorationSet }

const SMALLEST_FIRST = (a: Issue, b: Issue) => (a.to - a.from) - (b.to - b.from);

function decorate(s: Omit<ReviewState, 'deco'>): ReviewState {
  const ranges = s.issues
    .filter((i) => !s.hidden.has(i.kind) && i.to > i.from)
    .map((i) => Decoration.mark({ class: `rv rv-${i.kind}${s.active && s.active.from === i.from && s.active.kind === i.kind ? ' rv-active' : ''}` }).range(i.from, i.to));
  return { ...s, deco: Decoration.set(ranges, true) };
}

export const reviewField = StateField.define<ReviewState>({
  create: () => ({ issues: [], hidden: new Set(), active: null, deco: Decoration.none }),
  update(v, tr) {
    let next = v;
    if (tr.docChanged) {
      const map = (i: Issue) => ({ ...i, from: tr.changes.mapPos(i.from, 1), to: tr.changes.mapPos(i.to, -1) });
      next = { ...next, issues: next.issues.map(map).filter((i) => i.to > i.from), active: null };
    }
    let dirty = next !== v;
    for (const e of tr.effects) {
      if (e.is(setIssues)) { next = { ...next, issues: e.value }; dirty = true; }
      if (e.is(setHidden)) { next = { ...next, hidden: e.value }; dirty = true; }
      if (e.is(setActive)) { next = { ...next, active: e.value }; dirty = true; }
    }
    return dirty ? decorate(next) : next;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** Visible issues in reading order. */
export function visibleIssues(state: EditorState): Issue[] {
  const { issues, hidden } = state.field(reviewField);
  return issues.filter((i) => !hidden.has(i.kind)).sort((a, b) => a.from - b.from || SMALLEST_FIRST(a, b));
}

/** What's under a position, most specific first: a word before its sentence. */
export function issuesAt(state: EditorState, pos: number): Issue[] {
  return visibleIssues(state).filter((i) => i.from <= pos && pos <= i.to).sort(SMALLEST_FIRST);
}

// ---------- what counts as prose ----------

const MASK_WHOLE = new Set(['EmphasisMark', 'StrikethroughMark', 'LinkMark', 'URL', 'LinkTitle', 'LinkLabel', 'CodeMark', 'HTMLTag', 'Image', 'Autolink', 'Comment', 'QuoteMark', 'ListMark', 'TaskMarker']);

/** Paragraph text at the same offsets as the document, with everything but prose blanked. */
export function extractProse(state: EditorState): { from: number; text: string }[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const { shortcodes } = state.field(parsedField);
  const out: { from: number; text: string }[] = [];
  tree.iterate({
    enter(n) {
      if (n.name !== 'Paragraph' && n.name !== 'Task') return undefined;
      const from = n.from;
      const chars = state.doc.sliceString(n.from, n.to, ' ').split('');
      const blank = (a: number, b: number) => {
        for (let i = Math.max(a, from); i < Math.min(b, n.to); i++) chars[i - from] = ' ';
      };
      n.node.cursor().iterate((c) => {
        if (c.from === n.from && c.to === n.to && c.name === n.name) return undefined;
        if (MASK_WHOLE.has(c.name)) { blank(c.from, c.to); return false; }
        if (c.name === 'Escape') { blank(c.from, c.from + 1); return false; }
        // code and bare URLs count as one word, with nothing in them to flag
        if (c.name === 'InlineCode') { blank(c.from, c.to); chars[c.from - from] = 'x'; return false; }
        return undefined;
      });
      for (const s of shortcodes) {
        if (s.to <= n.from || s.from >= n.to) continue;
        blank(s.from, s.to);
        if (s.kind !== 'tag' && s.kind !== 'comment') chars[Math.max(s.from, from) - from] = 'x';
      }
      const text = chars.join('').replace(/\[\^[^\]\s]+\]/g, (m) => ' '.repeat(m.length));
      if (/\p{L}/u.test(text)) out.push({ from, text });
      return false;
    },
  });
  return out;
}

// ---------- ignored, per device ----------

const IGNORED_KEY = 'zdown.review.ignored';
const keyOf = (i: Issue) => `${i.kind === 'veryhard' ? 'hard' : i.kind}:${i.text.trim().toLowerCase()}`;

function readIgnored(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(IGNORED_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function writeIgnored(s: Set<string>) {
  try { localStorage.setItem(IGNORED_KEY, JSON.stringify([...s])); } catch { /* storage blocked */ }
}

// ---------- the analysis loop ----------

const EMPTY_COUNTS = (): Record<IssueKind, number> => ({ veryhard: 0, hard: 0, simpler: 0, passive: 0, weak: 0 });

/** Sends the prose to the worker once typing pauses, and publishes what comes back. */
export class ReviewEngine {
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private id = 0;
  private last: ReviewResponse | null = null;
  private ignored = readIgnored();

  constructor(private view: EditorView, private onSummary: (s: ReviewSummary) => void) {
    this.worker = new Worker(new URL('./review.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<ReviewResponse>) => {
      if (e.data.id !== this.id) return; // the text moved on; a newer request is coming
      this.last = e.data;
      this.publish();
    };
    this.schedule(0);
  }

  schedule(delay = 450) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.id += 1;
      const msg: ReviewRequest = { id: this.id, paragraphs: extractProse(this.view.state) };
      this.worker?.postMessage(msg);
    }, delay);
  }

  private publish() {
    if (!this.last) return;
    const issues = this.last.issues.filter((i) => !this.ignored.has(keyOf(i)));
    this.view.dispatch({ effects: setIssues.of(issues) });
    const counts = EMPTY_COUNTS();
    for (const i of issues) counts[i.kind] += 1;
    this.onSummary({ grade: this.last.grade, words: this.last.words, counts, ignored: this.ignored.size });
  }

  ignore(i: Issue) {
    this.ignored.add(keyOf(i));
    writeIgnored(this.ignored);
    this.publish();
  }

  restoreIgnored() {
    this.ignored.clear();
    writeIgnored(this.ignored);
    this.publish();
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.view.dispatch({ effects: [setIssues.of([]), setActive.of(null)] });
  }
}

/** Swap in `replacement`, or remove the words when it's empty, keeping capitals and spacing right. */
export function applyFix(view: EditorView, issue: Issue, replacement: string) {
  const { doc } = view.state;
  const original = doc.sliceString(issue.from, issue.to);
  const capital = /^\p{Lu}/u.test(original);
  if (replacement) {
    const insert = capital ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
    view.dispatch({ changes: { from: issue.from, to: issue.to, insert } });
    return;
  }
  // take one neighbouring space with it, and pass a capital on to the next word
  let to = issue.to;
  let from = issue.from;
  if (doc.sliceString(to, to + 1) === ' ') to += 1;
  else if (doc.sliceString(from - 1, from) === ' ') from -= 1;
  const next = doc.sliceString(to, to + 1);
  const changes = [{ from, to, insert: capital && /\p{Ll}/u.test(next) ? next.toUpperCase() : '' }];
  if (capital && /\p{Ll}/u.test(next)) changes[0].to = to + 1;
  view.dispatch({ changes });
}
