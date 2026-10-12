import { newId, nowIso, type Material, type PracticeRound, type SubtitleSegment } from './types';

/** A segment as stored by schema v1 and v2 - `id` and `words` may be missing. */
export type LegacySegment = {
  id?: string;
  start: number;
  end: number;
  reference: string;
  words?: SubtitleSegment['words'];
};

/** An attempt as stored by schema v2. */
export type LegacyAttempt = {
  id: string;
  createdAt: string;
  /** Either one free-text entry or one entry per word, depending on the build. */
  drafts: Record<string, string[]>;
  checked: Record<string, { first: string[]; reference: string; revision?: string[] }>;
};

/** A material as stored by schema v1 and v2. */
export type LegacyMaterial = {
  id: string;
  name: string;
  audio: Blob;
  duration: number;
  segments: LegacySegment[];
  attempts: LegacyAttempt[];
  attemptId: string;
  segmentId: string;
  position: number;
  review: string[];
};

const joinDraft = (words: string[] | undefined) => (words || []).filter(Boolean).join(' ');

/**
 * `createdAt` from the audio blob's own mtime.
 *
 * Legacy records have no import timestamp, and the only honest source left is the file
 * metadata the browser kept with the blob. Returns undefined when even that is missing
 * rather than substituting today's date, which would make 最近导入 meaningless.
 */
function derivedCreatedAt(audio: Blob, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const modified = (audio as Blob & { lastModified?: number }).lastModified;
  if (typeof modified === 'number' && Number.isFinite(modified) && modified > 0)
    return new Date(modified).toISOString();
  return undefined;
}

/**
 * Rewrites segments into a list with stable unique ids.
 *
 * Returns the remapping so drafts, completed sentences and bookmarks written against
 * a duplicate or missing id follow their segment instead of being dropped.
 */
export function normalizeSegments(segments: LegacySegment[]): {
  segments: SubtitleSegment[];
  remap: Map<string, string>;
} {
  const taken = new Set<string>();
  const remap = new Map<string, string>();
  const next = segments.map((s) => {
    let id = s.id && !taken.has(s.id) ? s.id : newId();
    while (taken.has(id)) id = newId();
    taken.add(id);
    // The first occurrence keeps the old id, so records written against it still land
    // on the right sentence. Later duplicates are already unresolvable in the old data.
    if (s.id && !remap.has(s.id)) remap.set(s.id, id);
    return { id, start: s.start, end: s.end, reference: s.reference ?? '', words: s.words ?? [] };
  });
  return { segments: next, remap };
}

const remapKeys = (record: Record<string, string>, remap: Map<string, string>) => {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) next[remap.get(key) ?? key] = value;
  return next;
};

function migrateAttempt(attempt: LegacyAttempt, remap: Map<string, string>): PracticeRound {
  const drafts = remapKeys(
    Object.fromEntries(Object.entries(attempt.drafts || {}).map(([k, v]) => [k, joinDraft(v)])),
    remap,
  );
  const completedSegmentIds = Object.keys(attempt.checked || {}).map((id) => remap.get(id) ?? id);
  const legacy: PracticeRound['legacy'] = Object.fromEntries(
    Object.entries(attempt.checked || {}).map(([id, record]) => [
      remap.get(id) ?? id,
      { first: record.first ?? [], reference: record.reference ?? '', revision: record.revision },
    ]),
  );
  return {
    id: attempt.id || newId(),
    createdAt: attempt.createdAt || nowIso(),
    updatedAt: attempt.createdAt || nowIso(),
    drafts,
    completedSegmentIds,
    // Kept so cancelling the first-draft archive never destroys existing records.
    // Nothing reads it; the practice history shows progress only.
    legacy: Object.keys(legacy).length ? legacy : undefined,
  };
}

/**
 * Schema v1 and v2 material -> current shape. Additive and non-destructive: audio,
 * subtitles, drafts, completed sentences and bookmarks all survive, and ids stay
 * stable wherever they already were.
 *
 * `lastStudiedAt` is deliberately left unset. The old code created the first attempt
 * at import time, so no timestamp in the old data means "studied" - only that it exists.
 */
export function migrateMaterial(legacy: LegacyMaterial): Material {
  const { segments, remap } = normalizeSegments(legacy.segments || []);
  // Legacy rows carry no folder or study metadata; treat any stray fields as hints.
  const extra = legacy as Partial<Material>;
  const attempts = legacy.attempts || [];
  const rounds = attempts.map((a) => migrateAttempt(a, remap));
  if (!rounds.length)
    rounds.push({
      id: newId(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      drafts: {},
      completedSegmentIds: [],
    });
  const activeRoundId = rounds.some((r) => r.id === legacy.attemptId)
    ? legacy.attemptId
    : rounds[rounds.length - 1].id;
  const known = new Set(segments.map((s) => s.id));
  return {
    id: legacy.id || newId(),
    displayName: legacy.name || '未命名素材',
    originalFileName: legacy.name || '',
    folderId: null,
    audio: legacy.audio,
    duration: legacy.duration,
    segments,
    createdAt: derivedCreatedAt(legacy.audio, extra.createdAt),
    lastStudiedAt: undefined,
    lastView: extra.lastView,
    playbackPosition: legacy.position ?? 0,
    bookmarkedSegmentIds: (legacy.review || [])
      .map((id) => remap.get(id) ?? id)
      .filter((id) => known.has(id)),
    rounds: rounds.map((round) =>
      round.id === activeRoundId
        ? { ...round, activeSegmentId: remap.get(legacy.segmentId) ?? legacy.segmentId }
        : round,
    ),
    activeRoundId,
  };
}

/** Same shape, fed from whatever is already in the store, so v3 data is a no-op. */
export const isCurrentMaterial = (value: unknown): value is Material =>
  Boolean(
    value &&
    typeof (value as Material).displayName === 'string' &&
    Array.isArray((value as Material).rounds) &&
    Array.isArray((value as Material).bookmarkedSegmentIds),
  );
