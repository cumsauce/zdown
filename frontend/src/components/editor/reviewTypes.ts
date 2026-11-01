export type IssueKind = 'veryhard' | 'hard' | 'simpler' | 'passive' | 'weak';

export interface Issue {
  from: number;
  to: number;
  kind: IssueKind;
  text: string;
  /** sentence issues */
  words?: number;
  grade?: number;
  /** simpler alternatives; none means it can simply go */
  expected: string[];
  /** weak words: hedge, weasel or filler */
  weak?: string;
}

export interface ReviewRequest { id: number; paragraphs: { from: number; text: string }[] }
export interface ReviewResponse { id: number; issues: Issue[]; words: number; grade: number | null }

export interface ReviewSummary {
  grade: number | null;
  words: number;
  counts: Record<IssueKind, number>;
  ignored: number;
}
