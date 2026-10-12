import { describe, expect, it } from 'vitest';
import {
  SubtitleError,
  editSegment,
  mergeWithNext,
  replaceTimeline,
  splitSegment,
  validateSpan,
} from '../src/domain/subtitle-edits';
import { materialize, untouchedMaterial } from './fixtures/material';

describe('editing one sentence', () => {
  it('keeps the segment id, the draft and the 难句 marker', () => {
    const before = materialize();
    const { material } = editSegment(before, 's1', { reference: 'A different sentence.' });
    expect(material.segments[0].id).toBe('s1');
    expect(material.segments[0].reference).toBe('A different sentence.');
    expect(material.rounds[0].drafts.s1).toBe(before.rounds[0].drafts.s1);
    expect(material.bookmarkedSegmentIds).toContain('s1');
  });

  it('marks a checked sentence as needing another check instead of dropping it', () => {
    const { material, report } = editSegment(materialize(), 's1', { reference: 'Changed.' });
    expect(report.stale).toEqual(['s1']);
    expect(material.rounds[0].staleSegmentIds).toContain('s1');
    expect(material.rounds[0].completedSegmentIds).toContain('s1');
  });

  it('leaves an untouched sentence unmarked', () => {
    const { report } = editSegment(materialize(), 's1', { reference: 'First sentence.' });
    expect(report.stale).toEqual([]);
    expect(report.timingsDropped).toBe(false);
  });

  it('drops word timings when the text or the span moves', () => {
    const words = [{ text: 'Hi', start: 0, end: 0.5 }];
    const base = materialize({
      segments: [{ id: 's1', start: 0, end: 2, reference: 'Hi.', words }],
    });
    expect(editSegment(base, 's1', { reference: 'Hi there.' }).material.segments[0].words).toEqual(
      [],
    );
    expect(editSegment(base, 's1', { end: 1 }).report.timingsDropped).toBe(true);
  });

  it('refuses an empty sentence or an illegal span', () => {
    const base = untouchedMaterial();
    expect(() => editSegment(base, 's1', { reference: '   ' })).toThrow(SubtitleError);
    expect(() => editSegment(base, 's1', { start: 5, end: 2 })).toThrow(SubtitleError);
    expect(() => editSegment(base, 's1', { end: 999 })).toThrow(/音频时长/);
  });

  it('accepts a span that ends where the neighbour begins, rejects one that overlaps', () => {
    const base = untouchedMaterial();
    expect(validateSpan(base, 's1', 0, 2)).toBeUndefined();
    expect(validateSpan(base, 's1', 0, 2.5)).toMatch(/重叠/);
    expect(() => editSegment(base, 's1', { start: 1, end: 7 })).toThrow(/重叠/);
  });
});

describe('splitting a sentence', () => {
  it('keeps the first half on the original id and gives the second a new one', () => {
    const { material } = splitSegment(materialize(), 's1', 1.5);
    expect(material.segments[0]).toMatchObject({ id: 's1', start: 0, end: 1.5 });
    expect(material.segments[1].id).not.toBe('s1');
    expect(material.segments[1]).toMatchObject({ start: 1.5, end: 2 });
    expect(material.segments[0].reference + material.segments[1].reference).toBe('First sentence.');
  });

  it('carries the draft and the 难句 mark onto the surviving half', () => {
    const before = materialize();
    const { material } = splitSegment(before, 's1', 1.5);
    expect(material.rounds[0].drafts.s1).toBe(before.rounds[0].drafts.s1);
    expect(material.bookmarkedSegmentIds).toContain('s1');
  });

  it('marks the surviving half as needing another check', () => {
    const { material, report } = splitSegment(materialize(), 's1', 1.5);
    expect(report.stale).toEqual(['s1']);
    expect(material.rounds[0].staleSegmentIds).toContain('s1');
  });

  it('refuses a split point outside the sentence', () => {
    const base = untouchedMaterial();
    expect(() => splitSegment(base, 's1', 0)).toThrow(/中间/);
    expect(() => splitSegment(base, 's1', 2)).toThrow(/中间/);
  });
});

describe('merging with the next sentence', () => {
  it('keeps the first id and joins the text and span', () => {
    const { material } = mergeWithNext(untouchedMaterial(), 's1');
    expect(material.segments).toHaveLength(2);
    expect(material.segments[0]).toMatchObject({
      id: 's1',
      end: 5,
      reference: 'First sentence. Second sentence.',
    });
    expect(material.segments[1].id).toBe('s3');
  });

  it('joins both drafts, removes obsolete completion ids and marks the result stale', () => {
    const { material, report } = mergeWithNext(materialize(), 's1');
    expect(report.lost).toEqual([]);
    expect(material.rounds[0].staleSegmentIds).toContain('s1');
    expect(material.rounds[0].drafts.s1).toBe('First sentence Second sentence');
    expect(material.rounds[0].completedSegmentIds).toEqual(['s1']);
    expect(material.rounds[0].drafts.s2).toBeUndefined();
    expect(material.bookmarkedSegmentIds).not.toContain('s2');
  });

  it('moves a lone draft across when the target sentence has none', () => {
    const base = materialize({
      rounds: [
        {
          id: 'r1',
          createdAt: '',
          updatedAt: '',
          drafts: { s2: 'only here' },
          completedSegmentIds: [],
        },
      ],
    });
    const { material } = mergeWithNext(base, 's1');
    expect(material.rounds[0].drafts.s1).toBe('only here');
  });

  it('refuses when there is no next sentence', () => {
    expect(() => mergeWithNext(untouchedMaterial(), 's3')).toThrow(SubtitleError);
  });
  it('carries the second sentence bookmark and both translations into the merged sentence', () => {
    const base = materialize({ bookmarkedSegmentIds: ['s2'] });
    base.segments[0].translation = '第一句';
    base.segments[1].translation = '第二句';
    const next = mergeWithNext(base, 's1').material;
    expect(next.bookmarkedSegmentIds).toEqual(['s1']);
    expect(next.segments[0].translation).toBe('第一句 第二句');
  });
});

describe('replacing the whole timeline', () => {
  it('is allowed while nothing has been written', () => {
    const material = replaceTimeline(untouchedMaterial(), [
      { id: 'new1', start: 0, end: 3, reference: 'Brand new.', words: [] },
    ]);
    expect(material.segments.map((s) => s.id)).toEqual(['new1']);
  });

  it('is refused once a draft or a check exists', () => {
    expect(() => replaceTimeline(materialize(), [])).toThrow(/听写记录/);
  });
});
