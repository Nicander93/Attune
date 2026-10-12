import { newId, type Material, type PracticeRound, type SubtitleSegment } from './types';

export type SegmentEdit = { reference?: string; start?: number; end?: number };

/** What an edit did to existing study records, so the UI can tell the user. */
export type EditReport = {
  /** Segments whose checked result no longer matches the new text or span. */
  stale: string[];
  /** True when word timings had to be dropped because they no longer line up. */
  timingsDropped: boolean;
  /** Records that could not be carried over and would be lost. */
  lost: string[];
};

export class SubtitleError extends Error {}

const fail = (message: string): never => {
  throw new SubtitleError(message);
};

function segmentAt(material: Material, id: string): SubtitleSegment {
  const segment = material.segments.find((s) => s.id === id);
  if (!segment) throw new SubtitleError('片段不存在。');
  return segment;
}

/** Legal spans: inside the audio, and never overlapping a neighbour. */
export function validateSpan(
  material: Material,
  id: string,
  start: number,
  end: number,
): string | undefined {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)
    return '开始时间必须早于结束时间，且不能为负。';
  if (end > material.duration + 0.01) return '结束时间超出了音频时长。';
  const clash = material.segments.some((s) => s.id !== id && start < s.end && end > s.start);
  return clash ? '这段时间和其它字幕重叠了。' : undefined;
}

function updateSegment(material: Material, id: string, next: SubtitleSegment): Material {
  return {
    ...material,
    segments: material.segments
      .map((s) => (s.id === id ? next : s))
      .sort((a, b) => a.start - b.start),
  };
}

/**
 * Flags a sentence as needing another check in every round that already checked it.
 * The earlier result is kept - it is marked, never deleted.
 */
function markStale(material: Material, ids: string[]): PracticeRound[] {
  if (!ids.length) return material.rounds;
  return material.rounds.map((round) =>
    ids.some((id) => round.completedSegmentIds.includes(id))
      ? { ...round, staleSegmentIds: [...new Set([...(round.staleSegmentIds ?? []), ...ids])] }
      : round,
  );
}

export function editSegment(
  material: Material,
  id: string,
  edit: SegmentEdit,
): { material: Material; report: EditReport } {
  const current = segmentAt(material, id);
  const start = edit.start ?? current.start;
  const end = edit.end ?? current.end;
  const reference = edit.reference ?? current.reference;
  const problem = validateSpan(material, id, start, end);
  if (problem) fail(problem);
  if (!reference.trim()) fail('字幕内容不能为空。');

  const movedInTime = start !== current.start || end !== current.end;
  const changedText = reference !== current.reference;
  if (!movedInTime && !changedText)
    return { material, report: { stale: [], timingsDropped: false, lost: [] } };

  // Word timings come from recognition; once the span or the words move they no longer
  // describe the audio, so they are dropped rather than left to look trustworthy.
  const next = updateSegment(material, id, {
    ...current,
    start,
    end,
    reference,
    words: [],
  });
  return {
    material: { ...next, rounds: markStale(next, [id]) },
    report: { stale: [id], timingsDropped: true, lost: [] },
  };
}

/**
 * Splits a sentence at `at`. The first half keeps the original id so its draft, 难句
 * marker and checked result stay on it; the second half is a new sentence with no
 * records, which is the honest outcome - its text has not been written yet.
 */
export function splitSegment(
  material: Material,
  id: string,
  at: number,
): { material: Material; report: EditReport } {
  const current = segmentAt(material, id);
  if (at <= current.start + 0.05 || at >= current.end - 0.05) fail('拆分点必须落在这一句的中间。');
  const second: SubtitleSegment = {
    id: newId(),
    start: at,
    end: current.end,
    reference: '',
    words: [],
  };
  const first: SubtitleSegment = { ...current, end: at, words: [] };
  const next = {
    ...material,
    segments: [...material.segments.filter((s) => s.id !== id), first, second].sort(
      (a, b) => a.start - b.start,
    ),
    rounds: markStale(material, [id]),
  };
  return {
    material: next,
    // The checked result on the first half no longer covers the whole original text.
    report: { stale: [id], timingsDropped: true, lost: [] },
  };
}

/**
 * Merges a sentence with the one after it. The first keeps its id and records; the
 * second id disappears, so anything recorded against it cannot follow and is reported
 * rather than silently dropped.
 */
export function mergeWithNext(
  material: Material,
  id: string,
): { material: Material; report: EditReport } {
  const index = material.segments.findIndex((s) => s.id === id);
  const first = material.segments[index];
  const second = material.segments[index + 1];
  if (!first || !second) fail('后面没有可以合并的句子。');

  const merged: SubtitleSegment = {
    ...first,
    end: second.end,
    reference: [first.reference, second.reference].filter((t) => t.trim()).join(' '),
    words: [],
  };
  const next = [...material.segments.filter((s) => s.id !== id && s.id !== second.id), merged].sort(
    (a, b) => a.start - b.start,
  );

  const lost: string[] = [];
  const stale: string[] = [];

  const rounds = material.rounds.map((round) => {
    let { drafts } = round;
    let { completedSegmentIds: completed } = round;
    let { staleSegmentIds = [] } = round;

    // A draft on the swallowed sentence moves across only if the target has none;
    // otherwise the target's own draft would be overwritten and both would be lost.
    // Either way the dead key is removed, so nothing dangles against a gone id.
    if (drafts[second.id]) {
      const { [second.id]: swallowed, ...rest } = drafts;
      drafts = rest;
      if (rest[first.id]) lost.push(second.id);
      else drafts = { ...rest, [first.id]: swallowed };
    }
    // Its checked result can never be re-used: it covered text now inside the first
    // sentence, so the merged sentence is marked stale instead.
    if (completed.includes(second.id)) {
      lost.push(second.id);
      if (!completed.includes(first.id)) completed = [...completed, first.id];
      if (!staleSegmentIds.includes(first.id)) staleSegmentIds = [...staleSegmentIds, first.id];
    }
    return { ...round, drafts, completedSegmentIds: completed, staleSegmentIds };
  });

  // 难句 marks live on the material, so the surviving sentence inherits the merged pair.
  const bookmarks = material.bookmarkedSegmentIds.includes(second.id)
    ? material.bookmarkedSegmentIds.filter((s) => s !== second.id)
    : material.bookmarkedSegmentIds;

  return {
    material: { ...material, segments: next, rounds, bookmarkedSegmentIds: bookmarks },
    report: { stale: [...new Set(stale)], timingsDropped: true, lost: [...new Set(lost)] },
  };
}

/**
 * Replaces every sentence with a freshly imported or recognised timeline.
 *
 * Refused once anything has been written: new ids would orphan every draft, 难句
 * marker and completed sentence, and losing a round of work silently is worse than
 * making the user re-import.
 */
export function replaceTimeline(material: Material, segments: SubtitleSegment[]): Material {
  const started = material.rounds.some(
    (r) => r.completedSegmentIds.length > 0 || Object.values(r.drafts).some((d) => d.trim()),
  );
  if (started) fail('这段素材已经有听写记录，换一份字幕会让旧记录的句子对不上。请新建素材再导入。');
  return {
    ...material,
    segments: [...segments].sort((a, b) => a.start - b.start),
    rounds: material.rounds,
  };
}
