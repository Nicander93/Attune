import type { Material } from '../../src/domain/types';

/** Three sentences with a practice round: drafts, two checks and a 难句 mark. */
export function materialize(overrides: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    displayName: 'podcast.mp3',
    originalFileName: 'podcast.mp3',
    folderId: null,
    audio: new Blob(),
    duration: 9,
    segments: [
      { id: 's1', start: 0, end: 2, reference: 'First sentence.', words: [] },
      { id: 's2', start: 2, end: 5, reference: 'Second sentence.', words: [] },
      { id: 's3', start: 5, end: 9, reference: 'Third sentence.', words: [] },
    ],
    createdAt: '2026-03-01T08:00:00Z',
    lastStudiedAt: '2026-03-05T08:00:00Z',
    playbackPosition: 0,
    bookmarkedSegmentIds: ['s1'],
    rounds: [
      {
        id: 'r1',
        createdAt: '2026-03-02T08:00:00Z',
        updatedAt: '2026-03-05T08:00:00Z',
        drafts: { s1: 'First sentence', s2: 'Second sentence' },
        completedSegmentIds: ['s1', 's2'],
      },
    ],
    activeRoundId: 'r1',
    ...overrides,
  };
}

/** The same three sentences with an empty round, so nothing has been written yet. */
export function untouchedMaterial(overrides: Partial<Material> = {}): Material {
  return {
    ...materialize(overrides),
    lastStudiedAt: undefined,
    bookmarkedSegmentIds: [],
    rounds: [{ id: 'r1', createdAt: '', updatedAt: '', drafts: {}, completedSegmentIds: [] }],
  };
}
