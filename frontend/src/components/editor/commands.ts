import { EditorSelection, type EditorState, type SelectionRange } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

// Editing commands, shared by keyboard shortcuts and the toolbar.

/** Wrap the selection in `m`, or unwrap it if it's already wrapped. */
export function toggleWrap(v: EditorView, m: string): boolean {
  const { state } = v;
  v.dispatch(
    state.changeByRange((r) => {
      const sel = state.sliceDoc(r.from, r.to);
      const n = m.length;
      // markers just outside the selection: **[bold]**
      // (for `*`, don't eat half of a surrounding `**`)
      const lone = m !== '*' || (state.sliceDoc(r.from - 2, r.from - 1) !== '*' && state.sliceDoc(r.to + 1, r.to + 2) !== '*');
      if (lone && state.sliceDoc(r.from - n, r.from) === m && state.sliceDoc(r.to, r.to + n) === m) {
        return {
          changes: [{ from: r.from - n, to: r.from }, { from: r.to, to: r.to + n }],
          range: EditorSelection.range(r.from - n, r.to - n),
        };
      }
      // markers inside the selection: [**bold**]
      if (sel.length >= 2 * n && sel.startsWith(m) && sel.endsWith(m)) {
        return {
          changes: { from: r.from, to: r.to, insert: sel.slice(n, -n) },
          range: EditorSelection.range(r.from, r.to - 2 * n),
        };
      }
      // keep surrounding whitespace outside the markers: "**word** " not "**word **"
      const lead = /^\s*/.exec(sel)![0].length;
      const trail = sel.trim() ? /\s*$/.exec(sel)![0].length : 0;
      const inner = sel.slice(lead, sel.length - trail);
      const anchor = r.from + lead + n;
      return {
        changes: { from: r.from + lead, to: r.to - trail, insert: m + inner + m },
        range: inner ? EditorSelection.range(anchor, anchor + inner.length) : EditorSelection.cursor(anchor),
      };
    }),
  );
  v.focus();
  return true;
}

export function insertLink(v: EditorView): boolean {
  const r = v.state.selection.main;
  const sel = v.state.sliceDoc(r.from, r.to);
  const url = 'https://';
  const at = r.from + sel.length + 3;
  // no selected text: the cursor goes between the brackets, url comes after
  if (!sel) {
    v.dispatch({ changes: { from: r.from, insert: `[](${url})` }, selection: { anchor: r.from + 1 } });
  } else {
    v.dispatch({ changes: { from: r.from, to: r.to, insert: `[${sel}](${url})` }, selection: { anchor: at, head: at + url.length } });
  }
  v.focus();
  return true;
}

// ---------- lists ----------

const LIST = /^(\s*)((?:[-*+]|\d+[.)])[ \t]+)/;
const indentOf = (text: string) => /^[ \t]*/.exec(text)![0].replace(/\t/g, '    ').length;

interface Item { n: number; indent: number; contentCol: number; marker: string }

function itemAt(state: EditorState, n: number): Item | null {
  const text = state.doc.line(n).text;
  const m = LIST.exec(text);
  if (!m) return null;
  const indent = indentOf(m[1]);
  return { n, indent, contentCol: indent + m[2].length, marker: m[2].trim() };
}

function selectedLines(state: EditorState, r: SelectionRange) {
  const from = state.doc.lineAt(r.from).number;
  let to = state.doc.lineAt(r.to).number;
  if (r.to > r.from && state.doc.line(to).from === r.to) to--; // a selection ending at column 0
  return { from, to };
}

/** The last line of this item's subtree: its nested items and continuation text. */
function subtreeEnd(state: EditorState, item: Item): number {
  let end = item.n;
  for (let n = item.n + 1; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text;
    if (!text.trim()) {
      // a blank line belongs only if the subtree continues after it
      let next = n + 1;
      while (next <= state.doc.lines && !state.doc.line(next).text.trim()) next++;
      if (next > state.doc.lines || indentOf(state.doc.line(next).text) < item.contentCol) break;
      continue;
    }
    if (indentOf(text) < item.contentCol) break;
    end = n;
  }
  return end;
}

/** Nearest earlier item at exactly `indent`, stopping at anything shallower. */
function siblingAbove(state: EditorState, item: Item): Item | null {
  for (let n = item.n - 1; n >= 1; n--) {
    const text = state.doc.line(n).text;
    if (!text.trim()) continue;
    const it = itemAt(state, n);
    const ind = indentOf(text);
    if (it && it.indent === item.indent) return it;
    if (ind < item.indent) return null;
    if (!it && ind <= item.indent) return null;
  }
  return null;
}

/** The item this one is nested under. */
function parentOf(state: EditorState, item: Item): Item | null {
  for (let n = item.n - 1; n >= 1; n--) {
    const text = state.doc.line(n).text;
    if (!text.trim()) continue;
    const it = itemAt(state, n);
    if (it && it.indent < item.indent && it.contentCol <= item.indent) return it;
    if (!it && indentOf(text) === 0) return null;
  }
  return null;
}

function shift(state: EditorState, from: number, to: number, delta: number) {
  const changes: { from: number; to?: number; insert?: string }[] = [];
  for (let n = from; n <= to; n++) {
    const l = state.doc.line(n);
    if (!l.text.trim()) continue;
    const lead = /^[ \t]*/.exec(l.text)![0];
    const col = lead.replace(/\t/g, '    ').length;
    changes.push({ from: l.from, to: l.from + lead.length, insert: ' '.repeat(Math.max(0, col + delta)) });
  }
  return changes;
}

/**
 * Tab / Shift-Tab on list items. A nested item must start at its parent's
 * *content* column, or markdown doesn't nest it: 2 spaces under `- `, 3 under
 * `1. `. Children move with their parent. False when no selected line is a list
 * item, so plain text and code keep the standard behaviour.
 */
export function nestList(v: EditorView, nest: boolean): boolean {
  const { state } = v;
  const changes: { from: number; to?: number; insert?: string }[] = [];
  let handled = false;
  for (const r of state.selection.ranges) {
    const { from, to } = selectedLines(state, r);
    let n = from;
    while (n <= to) {
      const item = itemAt(state, n);
      if (!item) { n++; continue; }
      handled = true;
      const end = subtreeEnd(state, item);
      const target = nest ? siblingAbove(state, item)?.contentCol : parentOf(state, item)?.indent;
      if (target !== undefined) {
        changes.push(...shift(state, item.n, end, target - item.indent));
        // first of a new nested ordered list starts over at 1
        if (nest && /^\d/.test(item.marker)) {
          const l = state.doc.line(item.n);
          const m = /^\s*(\d+)/.exec(l.text)!;
          const at = l.from + m[0].length - m[1].length;
          changes.push({ from: at, to: at + m[1].length, insert: '1' });
        }
      }
      n = end + 1;
    }
  }
  if (!handled) return false;
  if (changes.length) v.dispatch({ changes, scrollIntoView: true });
  v.focus();
  return true;
}

// ---------- block prefixes ----------

const PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

/** Toggle a block type on every selected line, keeping indentation. Replaces any other prefix. */
export function linePrefix(v: EditorView, prefix: string | ((i: number) => string)): boolean {
  const { state } = v;
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  let i = 0;
  for (const r of state.selection.ranges) {
    const { from, to } = selectedLines(state, r);
    for (let n = from; n <= to; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const l = state.doc.line(n);
      if (!l.text.trim() && from !== to) continue;
      const m = PREFIX.exec(l.text)!;
      const existing = m[2] ?? '';
      const want = typeof prefix === 'string' ? prefix : prefix(i++);
      const same = typeof prefix === 'string' ? existing === want : /^\d+[.)]\s/.test(existing);
      changes.push({ from: l.from + m[1].length, to: l.from + m[1].length + existing.length, insert: same ? '' : want });
    }
  }
  v.dispatch({ changes, scrollIntoView: true });
  v.focus();
  return true;
}

/** H1 → H2 → H3 → plain, for the one heading button on the toolbar. */
export function cycleHeading(v: EditorView): boolean {
  const l = v.state.doc.lineAt(v.state.selection.main.head);
  const m = /^(#{1,6})\s/.exec(l.text);
  const level = m ? m[1].length : 0;
  return linePrefix(v, level === 0 ? '## ' : level === 2 ? '### ' : level === 3 ? '# ' : level === 1 ? '#'.repeat(level) + ' ' : '## ');
}

/** Insert text as its own block, with blank lines around it; `cursor` is the offset within `text`. */
export function insertBlock(v: EditorView, text: string, cursor = text.length, select = 0): boolean {
  const { state } = v;
  const r = state.selection.main;
  const line = state.doc.lineAt(r.from);
  const empty = !line.text.trim() && r.empty;
  const from = empty ? line.from : state.doc.lineAt(r.to).to;
  const before = from === 0 ? '' : empty && state.sliceDoc(Math.max(0, from - 2), from) === '\n\n' ? '' : empty ? '\n' : '\n\n';
  const after = from >= state.doc.length || state.sliceDoc(from, from + 2).startsWith('\n\n') ? '\n' : '\n\n';
  const insert = `${before}${text}${after}`;
  const anchor = from + before.length + cursor;
  v.dispatch({
    changes: { from, to: empty ? line.to : from, insert },
    selection: { anchor, head: anchor + select },
    scrollIntoView: true,
  });
  v.focus();
  return true;
}
