import type { DiffWord } from './types';

/** Splits free text into comparison tokens on whitespace. */
export function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Number words that compare equal to their digit form, so `3` and `three` match.
 * Kept deliberately small: this is a dictation aid, not a language tool.
 */
const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
};

/**
 * The comparison form of one token: punctuation, spacing and letter case are not
 * part of dictation. `sorry ,` and `sorry,` therefore compare equal, and `don't`
 * and `don’t` normalise to the same string.
 *
 * Hyphenated words lose their hyphen and stay one token (`well-known` -> `wellknown`).
 * That is the stable rule we commit to: a hyphenated original can only be typed the
 * same way, and splitting it would make every half-word look wrong.
 */
export function normalize(token: string): string {
  const base = token
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}]/gu, '');
  return NUMBER_WORDS[base] ?? base;
}

/** Above this, the quadratic table is not worth building; the sentence should be split. */
const MAX_TOKENS = 600;

/** Drops tokens that are pure punctuation, so stray `,` or `—` is never an error. */
const comparable = (tokens: string[]) => tokens.filter((token) => normalize(token) !== '');

/**
 * Word-level alignment of a draft against the reference, using a longest-common-
 * subsequence backtrace so one missing word does not turn the rest of the sentence
 * into errors.
 *
 * `same` is an exact match after normalisation, `missing` is a reference word the
 * draft did not write, and `extra` is something the draft added. Spelling mistakes
 * show up as an `extra` next to a `missing`, which is how they read best.
 */
export function compareWords(draft: string[], reference: string): DiffWord[] {
  const a = comparable(draft.filter(Boolean).map(tokenize).flat());
  const b = comparable(tokenize(reference));
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS)
    throw new Error('单段超过 600 个词，请先拆分片段再核对。');

  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  const normalizedA = a.map(normalize);
  const normalizedB = b.map(normalize);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        normalizedA[i] === normalizedB[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);

  const result: DiffWord[] = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && normalizedA[i] === normalizedB[j]) {
      result.push({ text: a[i++], kind: 'same' });
      j++;
    } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j]))
      result.push({ text: b[j++], kind: 'missing' });
    else result.push({ text: a[i++], kind: 'extra' });
  }
  return result;
}

/** True when every token matched after normalisation. Punctuation never counts as wrong. */
export const isExactMatch = (draft: string[], reference: string) =>
  compareWords(draft, reference).every((w) => w.kind === 'same');

export const countKinds = (diff: DiffWord[]) => ({
  missing: diff.filter((w) => w.kind === 'missing').length,
  extra: diff.filter((w) => w.kind === 'extra').length,
});
