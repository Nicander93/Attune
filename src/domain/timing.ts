import type { DiffWord, WordTiming } from './types';

/**
 * Index of the word covering `position`, or -1 when the position is outside every word.
 * Only meaningful for segments that carry real word timings - SRT and VTT never do.
 */
export function activeWordIndex(words: WordTiming[], position: number): number {
  if (!words.length) return -1;
  return words.findIndex((w) => position >= w.start && position < w.end);
}

/**
 * Maps each comparison token to the word timing it came from, for reference-side
 * words (`same` and `missing`). Tokens the draft added get null, as do segments with
 * no timings at all - inventing a time we do not have would make 听读 look synced when
 * it is not.
 */
export function timingIndexByDiff(diff: DiffWord[], words: WordTiming[]): Array<number | null> {
  if (!words.length) return diff.map(() => null);
  let reference = 0;
  return diff.map((token) => {
    if (token.kind === 'extra') return null;
    const index = reference < words.length ? reference : null;
    reference += 1;
    return index;
  });
}
