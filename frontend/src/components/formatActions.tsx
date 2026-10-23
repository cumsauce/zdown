import type { CodeMirrorHandle } from './CodeMirror';

// One list of formatting actions, shared by the desktop selection popover
// and the phone keyboard toolbar so both always offer the same things.
export type Act = { label: React.ReactNode; aria: string; key?: string; run(e: CodeMirrorHandle): void };

export const HEADINGS: Act[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  label: `H${n}`,
  aria: `heading ${n}`,
  run: (e) => e.linePrefix(`${'#'.repeat(n)} `),
}));

export const INLINE: Act[] = [
  { label: <b>B</b>, aria: 'bold', key: '⌘B', run: (e) => e.toggleWrap('**') },
  { label: <i>I</i>, aria: 'italic', key: '⌘I', run: (e) => e.toggleWrap('*') },
  { label: <s>S</s>, aria: 'strikethrough', run: (e) => e.toggleWrap('~~') },
  { label: '`', aria: 'inline code', key: '⌘E', run: (e) => e.toggleWrap('`') },
  { label: '[ ]( )', aria: 'link', key: '⌘K', run: (e) => e.insert('[', '](https://)') },
];

export const BLOCK: Act[] = [
  { label: '❝', aria: 'quote', run: (e) => e.linePrefix('> ') },
  { label: '•', aria: 'list', run: (e) => e.linePrefix('- ') },
  { label: '1.', aria: 'numbered list', run: (e) => e.linePrefix('1. ') },
  { label: '```', aria: 'code block', run: (e) => e.insert('```\n', '\n```') },
];
