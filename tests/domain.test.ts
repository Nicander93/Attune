import { describe, expect, it } from 'vitest';
import {
  checkSegment,
  compareWords,
  migrateMaterial,
  newAttempt,
  parseSrt,
  sentencesToSegments,
  toSrt,
  type Material,
  type Segment,
} from '../src/domain';
import { mixToMono } from '../src/recognition';
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
    const segment = { id: 's', start: 0, end: 1, reference: 'Hello world', words: [] };
    a = checkSegment(a, segment);
    a.drafts.s = ['Hello', 'world'];
    const repeated = checkSegment(a, segment);
    expect(repeated.checked.s.first).toEqual(['hello']);
    expect(repeated.checked.s.reference).toBe('Hello world');
  });
});
describe('SRT export', () => {
  const segments: Segment[] = [
    { id: 'a', start: 0.1, end: 2.5, reference: 'Hello world.', words: [] },
    { id: 'b', start: 2.5, end: 3, reference: '', words: [] },
    { id: 'c', start: 61.234, end: 3725.009, reference: 'Line one\nline two', words: [] },
  ];
  it('writes numbered SubRip blocks with HH:MM:SS,mmm times and skips empty text', () =>
    expect(toSrt(segments)).toBe(
      '\uFEFF1\r\n00:00:00,100 --> 00:00:02,500\r\nHello world.\r\n\r\n' +
        '2\r\n00:01:01,234 --> 01:02:05,009\r\nLine one line two\r\n',
    ));
  it('round-trips sentences and times through import', () => {
    const imported = parseSrt(toSrt(segments), 4000);
    expect(imported.map(({ start, end, reference }) => ({ start, end, reference }))).toEqual([
      { start: 0.1, end: 2.5, reference: 'Hello world.' },
      { start: 61.234, end: 3725.009, reference: 'Line one line two' },
    ]);
  });
  it('exports nothing when no segment has text', () =>
    expect(toSrt([{ id: 'x', start: 0, end: 1, reference: ' ', words: [] }])).toBe(''));
});
describe('recognized sentences', () => {
  it('become segments with fresh ids, word timings and spans inside the audio', () => {
    const words = [{ text: 'Hi.', start: 0, end: 0.4 }];
    const result = sentencesToSegments(
      [
        { text: ' Hi. ', start: 0, end: 0.5, words },
        { text: '', start: 1, end: 2, words: [] },
        { text: 'Bye.', start: 2, end: 9, words: [] },
      ],
      5,
    );
    expect(result.map(({ start, end, reference }) => ({ start, end, reference }))).toEqual([
      { start: 0, end: 0.5, reference: 'Hi.' },
      { start: 2, end: 5, reference: 'Bye.' },
    ]);
    expect(result[0].words).toEqual(words);
    expect(new Set(result.map((s) => s.id)).size).toBe(2);
  });
});
describe('stored material migration', () => {
  const old = (segments: Partial<Segment>[], segmentId: string) =>
    ({ segments, segmentId }) as unknown as Material;
  it('keeps existing ids, gives duplicates and missing ids new ones, and adds word lists', () => {
    const migrated = migrateMaterial(
      old(
        [
          { id: 'a', start: 0, end: 1, reference: 'x' },
          { id: 'a', start: 1, end: 2, reference: 'y' },
          { start: 2, end: 3, reference: 'z' },
        ],
        'a',
      ),
    );
    const ids = migrated.segments.map((s) => s.id);
    expect(ids[0]).toBe('a');
    expect(new Set(ids).size).toBe(3);
    expect(migrated.segments.every((s) => Array.isArray(s.words))).toBe(true);
    expect(migrated.segmentId).toBe('a');
  });
  it('points the current segment at an existing one', () =>
    expect(
      migrateMaterial(old([{ id: 'b', start: 0, end: 1, reference: '' }], 'gone')).segmentId,
    ).toBe('b'));
});
describe('audio preparation', () => {
  it('averages channels into mono', () =>
    expect(Array.from(mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([
      0.5, 0.5,
    ]));
});
