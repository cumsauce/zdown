import { toString as text } from 'nlcst-to-string';
import english from 'retext-english';
import intensify from 'retext-intensify';
import passive from 'retext-passive';
import simplify from 'retext-simplify';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { VFile } from 'vfile';
import type { Issue, ReviewRequest, ReviewResponse } from './reviewTypes';

// Runs off the main thread so review can never make typing lag. Results are
// cached per paragraph: an edit only re-reads the paragraph it touched.

const HARD_GRADE = 10;
const VERY_HARD_GRADE = 14;
const MIN_WORDS = 14; // a short sentence with one long word is fine

// The stock list is broad. These read as nagging rather than help: "it is"
// isn't wordy, and "however", "contains" or "provide" are plain enough already.
const SIMPLIFY_IGNORE = ['it-is', 'there-are', 'there-is', 'however', 'contains', 'provide', 'provided', 'require', 'request', 'requirement', 'additional', 'component', 'function', 'type-of'];

// Pronouns and everyday quantifiers carry meaning; flagging them is just noise.
const INTENSIFY_IGNORE = ['someone', 'somebody', 'something', 'some', 'many', 'few', 'several', 'most', 'various', 'often', 'usually', 'may', 'might', 'could', 'can', 'would', 'should', 'probably', 'perhaps'];

const processor = unified().use(english).use(simplify, { ignore: SIMPLIFY_IGNORE }).use(passive).use(intensify, { ignore: INTENSIFY_IGNORE }).freeze();

interface Counts { letters: number; words: number; sentences: number }
type Local = Omit<Issue, 'from' | 'to'> & { start: number; end: number };

const ari = (c: Counts) => 4.71 * (c.letters / Math.max(1, c.words)) + 0.5 * (c.words / Math.max(1, c.sentences)) - 21.43;

const cache = new Map<string, { issues: Local[]; counts: Counts }>();

function analyze(source: string) {
  const hit = cache.get(source);
  if (hit) return hit;
  const file = new VFile(source);
  const tree = processor.parse(file);
  processor.runSync(tree, file);

  const issues: Local[] = [];
  const counts: Counts = { letters: 0, words: 0, sentences: 0 };

  visit(tree, 'SentenceNode', (sentence) => {
    const words = sentence.children.filter((c) => c.type === 'WordNode');
    if (!words.length) return;
    const letters = words.reduce((n, w) => n + text(w).replace(/[^\p{L}\p{N}]/gu, '').length, 0);
    const own = { letters, words: words.length, sentences: 1 };
    counts.letters += letters;
    counts.words += words.length;
    counts.sentences += 1;
    const grade = Math.round(ari(own));
    const start = sentence.position?.start.offset;
    const end = sentence.position?.end.offset;
    if (start === undefined || end === undefined || words.length < MIN_WORDS || grade < HARD_GRADE) return;
    issues.push({
      start,
      end,
      kind: grade >= VERY_HARD_GRADE ? 'veryhard' : 'hard',
      text: source.slice(start, end),
      words: words.length,
      grade,
      expected: [],
    });
  });

  for (const m of file.messages) {
    const start = m.place && 'start' in m.place ? m.place.start.offset : undefined;
    const end = m.place && 'end' in m.place ? m.place.end.offset : undefined;
    if (start === undefined || end === undefined) continue;
    if (m.source === 'retext-simplify') {
      issues.push({ start, end, kind: 'simpler', text: source.slice(start, end), expected: (m.expected ?? []).filter((e): e is string => !!e) });
    } else if (m.source === 'retext-passive') {
      // retext marks the participle; "was broken" is what the writer should see
      const before = /\b(am|are|were|being|is|been|was|be)\s+$/i.exec(source.slice(0, start));
      const from = before ? before.index : start;
      issues.push({ start: from, end, kind: 'passive', text: source.slice(from, end), expected: [] });
    } else if (m.source === 'retext-intensify') {
      issues.push({ start, end, kind: 'weak', weak: m.ruleId ?? 'weasel', text: source.slice(start, end), expected: [] });
    }
  }

  const result = { issues, counts };
  if (cache.size > 5000) cache.clear();
  cache.set(source, result);
  return result;
}

self.onmessage = (e: MessageEvent<ReviewRequest>) => {
  const issues: Issue[] = [];
  const total: Counts = { letters: 0, words: 0, sentences: 0 };
  for (const p of e.data.paragraphs) {
    const r = analyze(p.text);
    for (const { start, end, ...i } of r.issues) issues.push({ ...i, from: p.from + start, to: p.from + end });
    total.letters += r.counts.letters;
    total.words += r.counts.words;
    total.sentences += r.counts.sentences;
  }
  const response: ReviewResponse = {
    id: e.data.id,
    issues,
    words: total.words,
    grade: total.words >= 20 ? Math.max(1, Math.round(ari(total))) : null,
  };
  (self as unknown as Worker).postMessage(response);
};
