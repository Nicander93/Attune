import { describe, expect, it } from 'vitest';
import { checkSegment, compareWords, newAttempt, parseSrt } from '../src/domain';
describe('reference comparison', () => {
  it('aligns omitted and added words without shifting the whole sentence', () =>
    expect(compareWords(['I', 'really', 'like', 'tea'], 'I like green tea.')).toEqual([
      { text: 'I', kind: 'same' },
      { text: 'really', kind: 'extra' },
      { text: 'like', kind: 'same' },
      { text: 'green', kind: 'missing' },
      { text: 'tea', kind: 'same' },
    ]));
  it('ignores case and punctuation', () =>
    expect(compareWords(['Hello,', 'WORLD!'], 'hello world.').every((w) => w.kind === 'same')).toBe(
      true,
    ));
});
describe('SRT import', () => {
  it('imports millisecond timing, multiline text and BOM', () => {
    const s = parseSrt(
      '\uFEFF1\r\n00:00:00,100 --> 00:00:02,500\r\nHello\r\nworld\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nAgain',
      5,
    );
    expect(s.map(({ start, end, reference }) => ({ start, end, reference }))).toEqual([
      { start: 0.1, end: 2.5, reference: 'Hello world' },
      { start: 3, end: 4, reference: 'Again' },
    ]);
  });
  it('rejects overlapping or out of range subtitles', () => {
    expect(() => parseSrt('1\n00:00:00,000 --> 00:00:08,000\nHi', 5)).toThrow();
    expect(() =>
      parseSrt(
        '1\n00:00:00,000 --> 00:00:02,000\nHi\n\n2\n00:00:01,000 --> 00:00:03,000\nAgain',
        5,
      ),
    ).toThrow();
  });
});
describe('history', () => {
  it('keeps the first checked draft and reference immutable while later drafts change', () => {
    let a = newAttempt();
    a.drafts.s = ['hello'];
    const segment = { id: 's', start: 0, end: 1, reference: 'Hello world' };
    a = checkSegment(a, segment);
    a.drafts.s = ['Hello', 'world'];
    const repeated = checkSegment(a, segment);
    expect(repeated.checked.s.first).toEqual(['hello']);
    expect(repeated.checked.s.reference).toBe('Hello world');
  });
});
