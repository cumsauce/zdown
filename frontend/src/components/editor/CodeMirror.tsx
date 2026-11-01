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
}

const isImage = (f: File) => f.type.startsWith('image/');

export const CodeMirror = memo(forwardRef<EditorHandle, Props>(function CodeMirror(
  { value, onChange, ctx, showMarks, onSave, onFiles, placeholderText }, ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const emitted = useRef(value); // what we last told the parent: no need to diff it back
  const cb = useRef({ onChange, onSave, onFiles });
  cb.current = { onChange, onSave, onFiles };

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
          EditorView.domEventHandlers({
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
  }), []);

  return <div ref={host} className="cm-host" />;
}));
