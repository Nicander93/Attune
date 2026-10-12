import type { Material, PracticeRound, SubtitleSegment } from './types';

/**
 * Progress for the active round only. A draft on its own is 进行中, never 已听写:
 * 已听写 means the user actually ran 核对答案 on that sentence in this round, which
 * says nothing about whether the answer was correct.
 */
export type RoundProgress = {
  total: number;
  completed: number;
  inProgress: number;
  stale: number;
  /** null when the round has not started, which the UI renders as 未开始. */
  percent: number | null;
};

export function roundProgress(round: PracticeRound | undefined, total: number): RoundProgress {
  const completed = round ? round.completedSegmentIds.filter(Boolean).length : 0;
  const stale = round?.staleSegmentIds?.length ?? 0;
  const inProgress = round
    ? Object.values(round.drafts).filter((text) => text.trim().length > 0).length
    : 0;
  return {
    total,
    completed,
    inProgress,
    stale,
    percent: completed === 0 ? null : Math.round((completed / Math.max(1, total)) * 100),
  };
}

export const materialProgress = (material: Material): RoundProgress => {
  const round = material.rounds.find((r) => r.id === material.activeRoundId) ?? material.rounds[0];
  return roundProgress(round, material.segments.length);
};

/** 难句 markers belong to the material, so they outlive any single round. */
export const isBookmarked = (material: Material, segmentId: string) =>
  material.bookmarkedSegmentIds.includes(segmentId);

export function toggleBookmark(material: Material, segmentId: string): Material {
  const marked = isBookmarked(material, segmentId);
  return {
    ...material,
    bookmarkedSegmentIds: marked
      ? material.bookmarkedSegmentIds.filter((id) => id !== segmentId)
      : [...material.bookmarkedSegmentIds, segmentId],
  };
}

/** Sentences marked 难句, in timeline order, for the 难句复习 pass. */
export const bookmarkedSegments = (material: Material): SubtitleSegment[] => {
  const order = new Map(material.segments.map((s, i) => [s.id, i]));
  return material.segments
    .filter((s) => material.bookmarkedSegmentIds.includes(s.id))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
};

/**
 * Recently studied materials, newest first.
 *
 * `lastStudiedAt` is absent on legacy data because the old code recorded import time,
 * not study time. Those materials keep a real progress count and sort after everything
 * with a real timestamp, ordered by their own createdAt - never presented as if we knew
 * when they were studied.
 */
export function recentStudy(
  materials: Material[],
  limit = 5,
): { material: Material; progress: RoundProgress; studiedAt: string | undefined }[] {
  const started = materials.filter((m) => {
    const round = m.rounds.find((r) => r.id === m.activeRoundId) ?? m.rounds[0];
    return Boolean(
      round &&
      (round.completedSegmentIds.length > 0 || Object.values(round.drafts).some((d) => d.trim())),
    );
  });
  return started
    .map((material) => ({
      material,
      progress: materialProgress(material),
      studiedAt: material.lastStudiedAt,
    }))
    .sort((a, b) => {
      if (a.studiedAt && b.studiedAt) return b.studiedAt.localeCompare(a.studiedAt);
      if (a.studiedAt) return -1;
      if (b.studiedAt) return 1;
      return (b.material.createdAt ?? '').localeCompare(a.material.createdAt ?? '');
    })
    .slice(0, limit);
}

/** The single material 继续学习 should offer, or undefined when nothing has been started. */
export const continueMaterial = (materials: Material[]) => recentStudy(materials, 1)[0]?.material;
