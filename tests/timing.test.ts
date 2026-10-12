import { describe, expect, it } from 'vitest';
import { activeWordIndex, timingIndexByDiff } from '../src/domain/timing';
import { compareWords } from '../src/domain/text';

const words = [
  { text: 'Hello', start: 0, end: 0.4 },
  { text: 'world', start: 0.4, end: 0.9 },
];

describe('word timing lookup', () => {
  it('finds the active word by playback position', () => {
    expect(activeWordIndex(words, 0.2)).toBe(0);
    expect(activeWordIndex(words, 0.4)).toBe(1);
    expect(activeWordIndex(words, 1)).toBe(-1);
    expect(activeWordIndex([], 0.2)).toBe(-1);
  });

  it('maps comparison tokens to timings without inventing any', () => {
    const diff = compareWords(['Hello', 'there'], 'Hello world');
    expect(timingIndexByDiff(diff, [])).toEqual([null, null, null]);
    expect(timingIndexByDiff(diff, words)).toEqual([0, 1, null]);
  });
});
