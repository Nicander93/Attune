import { describe, expect, it } from 'vitest';
import { migrateMaterial, normalizeSegments } from '../src/domain/migrate';
import type { LegacyMaterial } from '../src/domain/migrate';
import {
  materialProgress,
  recentStudy,
  bookmarkedSegments,
  roundProgress,
} from '../src/domain/progress';
import { parseSrt, parseVtt, toSrt } from '../src/domain/subtitles';
import { compareWords, isExactMatch } from '../src/domain/text';
import { WAV_TIME, legacyAudio, legacyUnstudied, legacyV1, legacyV2 } from './fixtures/legacy';

describe('migrating a schema v2 material', () => {
  const before = legacyV2();
  const after = migrateMaterial(before);

  it('keeps the audio, subtitles and segment ids untouched', () => {
    expect(after.audio).toBe(before.audio);
    expect(after.duration).toBe(30);
    expect(after.segments.map((s) => s.id)).toEqual(['seg-a', 'seg-b']);
    expect(after.segments.map((s) => s.reference)).toEqual(['Hello world.', 'Nice to meet you.']);
  });

  it('splits the display name from the original file name', () => {
    expect(after.displayName).toBe('podcast-01.mp3');
    expect(after.originalFileName).toBe('podcast-01.mp3');
    expect(after.folderId).toBeNull();
  });

  it('turns the attempt into a round with string drafts and completed sentences', () => {
    expect(after.rounds).toHaveLength(1);
    const round = after.rounds[0];
    expect(round.drafts).toEqual({ 'seg-a': 'Hello world' });
    expect(round.completedSegmentIds).toEqual(['seg-b']);
    expect(after.activeRoundId).toBe('round-1');
  });

  it('preserves the first-draft archive instead of deleting it', () => {
    expect(after.rounds[0].legacy?.['seg-b'].first).toEqual(['Nice', 'to', 'meet', 'you']);
  });

  it('moves the review flag to bookmarked segment ids', () => {
    expect(after.bookmarkedSegmentIds).toEqual(['seg-b']);
    expect(bookmarkedSegments(after).map((s) => s.reference)).toEqual(['Nice to meet you.']);
  });

  it('keeps the playback position', () => {
    expect(after.playbackPosition).toBe(4.5);
  });

  it('derives import time from the audio blob instead of guessing', () => {
    expect(after.createdAt).toBe(new Date(WAV_TIME).toISOString());
  });

  it('does not invent a study time the old data never recorded', () => {
    expect(after.lastStudiedAt).toBeUndefined();
  });

  it('reports 1 of 2 sentences as dictated in the current round', () => {
    expect(materialProgress(after)).toMatchObject({ total: 2, completed: 1, inProgress: 1 });
  });
});

describe('migrating a schema v1 material', () => {
  const after = migrateMaterial(legacyV1());

  it('repairs missing and duplicated segment ids', () => {
    const ids = after.segments.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.filter(Boolean)).toHaveLength(3);
  });

  it('follows a draft written against a duplicated id', () => {
    const draft = after.rounds[0].drafts;
    expect(Object.keys(draft)).toHaveLength(1);
    expect(Object.values(draft)[0]).toBe('Second sentence');
  });

  it('keeps a material with no attempts usable', () => {
    const bare = migrateMaterial(legacyUnstudied());
    expect(bare.rounds).toHaveLength(1);
    expect(bare.activeRoundId).toBe(bare.rounds[0].id);
    expect(materialProgress(bare).completed).toBe(0);
  });

  it('keeps every subtitle word that was there before', () => {
    const words = [{ text: 'Hello', start: 0, end: 0.5 }];
    const migrated = migrateMaterial({
      ...legacyV2(),
      segments: [{ id: 'x', start: 0, end: 1, reference: 'Hello.', words }],
    } as LegacyMaterial);
    expect(migrated.segments[0].words).toEqual(words);
  });
});

describe('segment id normalisation', () => {
  it('reports the remapping so records can follow their segment', () => {
    const { segments, remap } = normalizeSegments([
      { id: 'a', start: 0, end: 1, reference: '' },
      { id: 'a', start: 1, end: 2, reference: '' },
    ]);
    expect(segments[0].id).toBe('a');
    expect(segments[1].id).not.toBe('a');
    expect(remap.get('a')).toBe('a');
  });
});

describe('recent study', () => {
  const studied = migrateMaterial(legacyV2());
  const bare = migrateMaterial(legacyUnstudied());

  it('never lists a material that was only imported', () => {
    expect(recentStudy([bare])).toEqual([]);
  });

  it('lists a started material with its real progress', () => {
    const [first] = recentStudy([studied, bare]);
    expect(first.material.id).toBe(studied.id);
    expect(first.progress).toMatchObject({ completed: 1, total: 2 });
    expect(first.studiedAt).toBeUndefined();
  });

  it('sorts real study times ahead of legacy data', () => {
    const newer = { ...studied, id: 'newer', lastStudiedAt: '2026-05-01T00:00:00Z' };
    expect(recentStudy([studied, newer])[0].material.id).toBe('newer');
  });
});

describe('round progress', () => {
  it('treats a draft without a check as in progress, not dictated', () => {
    const progress = roundProgress(
      { id: 'r', createdAt: '', updatedAt: '', drafts: { a: 'hello' }, completedSegmentIds: [] },
      4,
    );
    expect(progress).toMatchObject({ completed: 0, inProgress: 1, percent: null });
  });

  it('ignores a blank draft', () => {
    expect(
      roundProgress(
        { id: 'r', createdAt: '', updatedAt: '', drafts: { a: '   ' }, completedSegmentIds: [] },
        4,
      ).inProgress,
    ).toBe(0);
  });
});

describe('import time derivation', () => {
  it('leaves createdAt unset when the blob has no mtime', () => {
    const migrated = migrateMaterial({
      ...legacyV2(),
      audio: new Blob([new Uint8Array(8)]),
    });
    expect(migrated.createdAt).toBeUndefined();
  });

  it('prefers an explicit timestamp when one exists', () => {
    const migrated = migrateMaterial({
      ...legacyV2(),
      createdAt: '2026-04-01T00:00:00Z',
    } as LegacyMaterial);
    expect(migrated.createdAt).toBe('2026-04-01T00:00:00Z');
  });

  it('still migrates a material whose audio has no metadata at all', () => {
    const migrated = migrateMaterial({ ...legacyV2(), audio: legacyAudio(0) });
    expect(migrated.segments).toHaveLength(2);
    expect(migrated.createdAt).toBeUndefined();
  });
});

describe('subtitle parsing round trip', () => {
  it('reads SRT and writes it back unchanged', () => {
    const srt =
      '\uFEFF1\r\n00:00:00,100 --> 00:00:02,500\r\nHello world\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nAgain\r\n';
    const segments = parseSrt(srt, 10);
    expect(segments.map((s) => s.reference)).toEqual(['Hello world', 'Again']);
    expect(parseSrt(toSrt(segments), 10).map((s) => s.reference)).toEqual(['Hello world', 'Again']);
  });

  it('splits a bilingual block into English and Chinese lines', () => {
    const [segment] = parseVtt(
      'WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHello world\n你好，世界\n',
      10,
    );
    expect(segment.reference).toBe('Hello world');
    expect(segment.translation).toBe('你好，世界');
  });

  it('keeps lines it cannot classify as the reference instead of dropping them', () => {
    const [segment] = parseVtt(
      'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello world\nSecond line\n',
      10,
    );
    expect(segment.reference).toBe('Hello world Second line');
    expect(segment.translation).toBeUndefined();
  });

  it('rejects overlapping cues and cues past the end of the audio', () => {
    expect(() => parseSrt('1\n00:00:00,000 --> 00:00:08,000\nHi', 5)).toThrow();
    expect(() =>
      parseSrt(
        '1\n00:00:00,000 --> 00:00:02,000\nHi\n\n2\n00:00:01,000 --> 00:00:03,000\nAgain',
        5,
      ),
    ).toThrow(/重叠/);
  });
});

describe('dictation comparison rules', () => {
  it('never counts punctuation or spacing as an error', () => {
    expect(isExactMatch(['sorry', ','], 'sorry,')).toBe(true);
    expect(isExactMatch(['Hello', 'world'], 'Hello, world!')).toBe(true);
  });

  it('accepts curly and straight apostrophes', () => {
    expect(isExactMatch(['don’t', 'stop'], "don't stop")).toBe(true);
  });

  it('treats a number word and a digit as the same', () => {
    expect(isExactMatch(['I', 'have', '3', 'apples'], 'I have three apples.')).toBe(true);
  });

  it('keeps a hyphenated original as one token', () => {
    expect(isExactMatch(['well-known'], 'well-known')).toBe(true);
  });

  it('reports a missing word without shifting the rest', () => {
    expect(compareWords(['I', 'really', 'like', 'tea'], 'I like green tea.')).toEqual([
      { text: 'I', kind: 'same' },
      { text: 'really', kind: 'extra' },
      { text: 'like', kind: 'same' },
      { text: 'green', kind: 'missing' },
      { text: 'tea', kind: 'same' },
    ]);
  });

  it('refuses a sentence too long to align cheaply', () => {
    expect(() => compareWords(new Array(700).fill('a'), 'a')).toThrow(/600/);
  });
});
