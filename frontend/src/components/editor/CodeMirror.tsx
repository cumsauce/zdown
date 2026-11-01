import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import type { RenderCtx } from '../../lib/render';
import { cycleHeading, insertBlock, insertLink, linePrefix, nestList, toggleWrap } from './commands';
import { livePreview, setRenderCtx, setShowMarks } from './live';
import { applyFix, issuesAt, reviewField, ReviewEngine, setActive, setHidden, visibleIssues } from './review';
import type { Issue, IssueKind, ReviewSummary } from './reviewTypes';

export interface EditorHandle {
  toggleWrap(marker: string): void;
  link(): void;
  heading(): void;
  /** toggle a block prefix ("> ", "- ") on every selected line */
  prefix(prefix: string | ((i: number) => string)): void;
  nest(deeper: boolean): void;
  /** insert text as its own block; `cursor` is an offset within it, `select` chars after that stay selected */
  block(text: string, cursor?: number, select?: number): void;
  /** a placeholder for work in progress: returns a function that swaps it for the final text */
  placeholder(text: string): (final: string | null) => void;
  focus(): void;
  focusEnd(): void;
  undo(): void;
  redo(): void;
  /** drop focus — closes the on-screen keyboard */
  blur(): void;
  /** review mode */
  rectOf(issue: Issue): { top: number; bottom: number; left: number } | null;
  stepIssue(delta: number): void;
  fix(issue: Issue, replacement: string): void;
  ignore(issue: Issue): void;
  restoreIgnored(): void;
  clearActive(): void;
}

interface Props {
  value: string;
  onChange(value: string): void;
  ctx: RenderCtx | null;
  showMarks: boolean;
  onSave(): void;
  /** image files pasted or dropped into the text */
  onFiles(files: File[]): void;
  placeholderText?: string;
  review: boolean;
  reviewHidden: Set<IssueKind>;
  onReviewSummary(s: ReviewSummary): void;
  /** the issues under a tap or step; empty closes the note */
  onIssues(issues: Issue[]): void;
}

const isImage = (f: File) => f.type.startsWith('image/');

export const CodeMirror = memo(forwardRef<EditorHandle, Props>(function CodeMirror(
  { value, onChange, ctx, showMarks, onSave, onFiles, placeholderText, review, reviewHidden, onReviewSummary, onIssues }, ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const emitted = useRef(value); // what we last told the parent: no need to diff it back
  const cb = useRef({ onChange, onSave, onFiles, onReviewSummary, onIssues });
  cb.current = { onChange, onSave, onFiles, onReviewSummary, onIssues };
  const engine = useRef<ReviewEngine | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown({
            base: markdownLanguage,
            addKeymap: false,
            // Zola fences can carry options: ```rust,linenos
            codeLanguages: (info) => LanguageDescription.matchLanguageName(languages, info.split(/[\s,]/)[0], true),
          }),
          syntaxHighlighting(classHighlighter),
          EditorView.lineWrapping,
          placeholder(placeholderText ?? 'Start writing…'),
          EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'sentences', autocorrect: 'on', 'aria-label': 'Post text' }),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { cb.current.onSave(); return true; } },
            { key: 'Mod-b', preventDefault: true, run: (x) => toggleWrap(x, '**') },
            { key: 'Mod-i', preventDefault: true, run: (x) => toggleWrap(x, '*') },
            { key: 'Mod-e', preventDefault: true, run: (x) => toggleWrap(x, '`') },
            { key: 'Mod-k', preventDefault: true, run: insertLink },
            { key: 'Tab', run: (x) => nestList(x, true) },
            { key: 'Shift-Tab', run: (x) => nestList(x, false) },
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          livePreview,
          reviewField,
          EditorView.domEventHandlers({
            click(e) {
              if (!engine.current || !v.state.selection.main.empty) return false;
              const at = v.posAtCoords({ x: e.clientX, y: e.clientY });
              const found = at === null || !(e.target as HTMLElement).closest('.rv') ? [] : issuesAt(v.state, at);
              v.dispatch({ effects: setActive.of(found[0] ?? null) });
              cb.current.onIssues(found);
              return false;
            },
            touchstart(e) {
              touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              return false;
            },
            // Reading through notes on a phone shouldn't keep throwing the keyboard up.
            touchend(e) {
              const t = e.changedTouches[0];
              const start = touch.current;
              if (!engine.current || v.hasFocus || !start || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8) return false;
              if (!(e.target as HTMLElement).closest('.rv')) return false;
              const at = v.posAtCoords({ x: t.clientX, y: t.clientY });
              const found = at === null ? [] : issuesAt(v.state, at);
              if (!found.length) return false;
              e.preventDefault();
              v.dispatch({ effects: setActive.of(found[0]) });
              cb.current.onIssues(found);
              return true;
            },
            paste(e) {
              const files = [...(e.clipboardData?.files ?? [])].filter(isImage);
              if (files.length) { e.preventDefault(); cb.current.onFiles(files); return true; }
              // pasting a URL over selected text makes a link
              const text = e.clipboardData?.getData('text/plain')?.trim() ?? '';
              const r = v.state.selection.main;
              if (!r.empty && /^https?:\/\/\S+$/.test(text)) {
                e.preventDefault();
                v.dispatch({ changes: { from: r.from, to: r.to, insert: `[${v.state.sliceDoc(r.from, r.to)}](${text})` } });
                return true;
              }
              return false;
            },
            drop(e) {
              const files = [...(e.dataTransfer?.files ?? [])].filter(isImage);
              if (!files.length) return false;
              e.preventDefault();
              const at = v.posAtCoords({ x: e.clientX, y: e.clientY });
              if (at !== null) v.dispatch({ selection: { anchor: at } });
              cb.current.onFiles(files);
              return true;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              emitted.current = u.state.doc.toString();
              cb.current.onChange(emitted.current);
              engine.current?.schedule();
            }
          }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // the editor is created once; value/props flow in through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || !review) return undefined;
    const e = new ReviewEngine(v, (s) => cb.current.onReviewSummary(s));
    engine.current = e;
    return () => { e.destroy(); engine.current = null; };
  }, [review]);
  useEffect(() => { view.current?.dispatch({ effects: setHidden.of(reviewHidden) }); }, [reviewHidden]);

  useEffect(() => { view.current?.dispatch({ effects: setRenderCtx.of(ctx) }); }, [ctx]);
  useEffect(() => { view.current?.dispatch({ effects: setShowMarks.of(showMarks) }); }, [showMarks]);

  // external replacement (reload, restore draft): not an undoable edit
  useEffect(() => {
    const v = view.current;
    if (!v || value === emitted.current) return;
    const cur = v.state.doc.toString();
    emitted.current = value;
    if (cur === value) return;
    const head = Math.min(v.state.selection.main.head, value.length);
    v.dispatch({
      changes: { from: 0, to: cur.length, insert: value },
      selection: { anchor: head },
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  useImperativeHandle(ref, () => ({
    toggleWrap(m) { if (view.current) toggleWrap(view.current, m); },
    link() { if (view.current) insertLink(view.current); },
    heading() { if (view.current) cycleHeading(view.current); },
    prefix(p) { if (view.current) linePrefix(view.current, p); },
    nest(deeper) {
      const v = view.current;
      if (v && !nestList(v, deeper)) v.focus();
    },
    block(text, cursor, select) { if (view.current) insertBlock(view.current, text, cursor, select); },
    placeholder(text) {
      const v = view.current!;
      const r = v.state.selection.main;
      const line = v.state.doc.lineAt(r.head);
      const own = !line.text.trim();
      const insert = own ? text : `\n\n${text}\n\n`;
      const from = own ? line.from : line.to;
      v.dispatch({ changes: { from, to: own ? line.to : from, insert }, selection: EditorSelection.cursor(from + insert.length), scrollIntoView: true });
      return (final) => {
        const now = view.current;
        if (!now) return;
        const at = now.state.doc.toString().indexOf(text);
        if (at < 0) return;
        now.dispatch({ changes: { from: at, to: at + text.length, insert: final ?? '' } });
      };
    },
    focus() { view.current?.focus(); },
    focusEnd() {
      const v = view.current;
      if (!v) return;
      v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true });
      v.focus();
    },
    undo() { if (view.current) { undo(view.current); view.current.focus(); } },
    redo() { if (view.current) { redo(view.current); view.current.focus(); } },
    blur() { view.current?.contentDOM.blur(); },
    rectOf(issue) {
      const live = view.current?.state.field(reviewField).issues.find((i) => i.kind === issue.kind && i.text === issue.text) ?? issue;
      return view.current?.coordsAtPos(live.from) ?? null;
    },
    stepIssue(delta) {
      const v = view.current;
      if (!v) return;
      const list = visibleIssues(v.state);
      if (!list.length) return;
      const { active } = v.state.field(reviewField);
      const here = active ? list.findIndex((i) => i.from === active.from && i.kind === active.kind) : -1;
      const next = list[here < 0 ? (delta > 0 ? 0 : list.length - 1) : (here + delta + list.length) % list.length];
      v.dispatch({ effects: [setActive.of(next), EditorView.scrollIntoView(next.from, { y: 'center' })] });
      cb.current.onIssues([next]);
    },
    fix(issue, replacement) {
      const v = view.current;
      if (!v) return;
      applyFix(v, issue, replacement);
      engine.current?.schedule(0);
    },
    ignore(issue) { engine.current?.ignore(issue); },
    restoreIgnored() { engine.current?.restoreIgnored(); },
    clearActive() { view.current?.dispatch({ effects: setActive.of(null) }); },
  }), []);

  return <div ref={host} className="cm-host" />;
}));
