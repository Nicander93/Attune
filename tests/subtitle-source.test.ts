import { describe, expect, it } from 'vitest';
import { isTextSubtitleCodec, toClipRelativeSegments } from '../src/domain/subtitle-source';

describe('isTextSubtitleCodec', () => {
  it('accepts common text codecs', () => {
    for (const c of ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'wvtt', 'ttml']) {
      expect(isTextSubtitleCodec(c)).toBe(true);
      expect(isTextSubtitleCodec(c.toUpperCase())).toBe(true);
    }
  });

  it('rejects bitmap codecs (OCR = P4)', () => {
    expect(isTextSubtitleCodec('hdmv_pgs_subtitle')).toBe(false);
    expect(isTextSubtitleCodec('dvd_subtitle')).toBe(false);
    expect(isTextSubtitleCodec('pgssub')).toBe(false);
  });
});

describe('toClipRelativeSegments', () => {
  it('keeps already clip-relative cues', () => {
    const out = toClipRelativeSegments(
      [
        { id: 'a', start: 0.5, end: 2, reference: 'Hi', words: [] },
        { id: 'b', start: 2, end: 4, reference: 'There', words: [] },
      ],
      10,
      5,
    );
    expect(out.map((s) => [s.start, s.end])).toEqual([
      [0.5, 2],
      [2, 4],
    ]);
  });

  it('subtracts clipStart when cues look absolute', () => {
    const out = toClipRelativeSegments(
      [
        { id: 'a', start: 10.5, end: 12, reference: 'Hi', words: [] },
        { id: 'b', start: 12, end: 14, reference: 'There', words: [] },
      ],
      10,
      5,
    );
    expect(out.map((s) => [s.start, s.end])).toEqual([
      [0.5, 2],
      [2, 4],
    ]);
  });

  it('clamps to clip duration and drops empty spans', () => {
    const out = toClipRelativeSegments(
      [
        { id: 'a', start: 0, end: 0.02, reference: 'tiny', words: [] },
        { id: 'b', start: 4.5, end: 9, reference: 'tail', words: [] },
      ],
      0,
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].start).toBe(4.5);
    expect(out[0].end).toBe(5);
  });
});
