import type { LegacyMaterial } from '../../src/domain/migrate';

/** Audio bytes with a known mtime, so import-time derivation is deterministic. */
export function legacyAudio(lastModified: number, bytes = 64): Blob {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
  Object.defineProperty(blob, 'lastModified', { value: lastModified });
  return blob;
}

const WAV_TIME = new Date('2026-03-01T08:00:00Z').getTime();

/**
 * A schema v2 material as the previous build wrote it: two segments, one attempt with
 * a free-text draft, a checked sentence with first and revision, and a 难句 marker.
 * This is the shape Phase 0 must not lose anything from.
 */
export function legacyV2(): LegacyMaterial {
  return {
    id: 'material-1',
    name: 'podcast-01.mp3',
    audio: legacyAudio(WAV_TIME),
    duration: 30,
    segments: [
      { id: 'seg-a', start: 0, end: 4, reference: 'Hello world.', words: [] },
      { id: 'seg-b', start: 4, end: 9, reference: 'Nice to meet you.', words: [] },
    ],
    attempts: [
      {
        id: 'round-1',
        createdAt: '2026-03-02T09:00:00Z',
        drafts: { 'seg-a': ['Hello world'] },
        checked: {
          'seg-b': { first: ['Nice', 'to', 'meet', 'you'], reference: 'Nice to meet you.' },
        },
      },
    ],
    attemptId: 'round-1',
    segmentId: 'seg-b',
    position: 4.5,
    review: ['seg-b'],
  };
}

/**
 * A schema v1 material: segments without ids or word lists, a word-array draft, and a
 * duplicated segment id - the exact shapes the old v1 -> v2 cursor fix had to repair.
 */
export function legacyV1(): LegacyMaterial {
  return {
    id: 'material-old',
    name: 'old-lesson.wav',
    audio: legacyAudio(WAV_TIME - 86_400_000),
    duration: 12,
    segments: [
      { start: 0, end: 5, reference: 'First sentence.' },
      { id: 'dup', start: 5, end: 9, reference: 'Second sentence.' },
      { id: 'dup', start: 9, end: 12, reference: 'Third sentence.' },
    ],
    attempts: [
      {
        id: 'old-round',
        createdAt: '2026-01-01T00:00:00Z',
        drafts: { dup: ['Second', 'sentence'] },
        checked: {},
      },
    ],
    attemptId: 'old-round',
    segmentId: '',
    position: 0,
    review: ['dup'],
  };
}

/** A material with no attempts at all - it was imported and never opened. */
export function legacyUnstudied(): LegacyMaterial {
  return {
    id: 'material-bare',
    name: 'untouched.mp3',
    audio: legacyAudio(WAV_TIME - 172_800_000),
    duration: 5,
    segments: [{ id: 'only', start: 0, end: 5, reference: 'Just audio.', words: [] }],
    attempts: [],
    attemptId: '',
    segmentId: 'only',
    position: 0,
    review: [],
  };
}

export { WAV_TIME };
