/** Word-level timing from speech recognition; empty for SRT/VTT or manual segments. */
export type WordTiming = { text: string; start: number; end: number };

/**
 * One subtitle line. `id` stays stable for the life of a segment so practice rounds,
 * drafts and bookmarks can refer to it.
 */
export type SubtitleSegment = {
  id: string;
  start: number;
  end: number;
  /** Primary English text. Never generated - it comes from a file or local recognition. */
  reference: string;
  /** Optional Chinese translation. Absent means the file did not provide one. */
  translation?: string;
  /** Unreliable timings must be cleared rather than left to look trustworthy. */
  words: WordTiming[];
};

/** Sentence produced by the desktop recognizer, before it becomes a segment. */
export type RecognizedSentence = { text: string; start: number; end: number; words: WordTiming[] };

/**
 * One pass through a material. Drafts and completed sentences belong here so a new
 * round never destroys the previous one. `completedSegmentIds` means "the user ran
 * 核对答案 on this sentence in this round" - not that the answer was right.
 */
export type PracticeRound = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** segmentId -> current free text. */
  drafts: Record<string, string>;
  completedSegmentIds: string[];
  /** Sentences whose reference changed after they were checked; need checking again. */
  staleSegmentIds?: string[];
  /**
   * First-draft archive carried over from schema v2 so removing that feature never
   * destroys existing records. Nothing reads it - the history page shows progress only.
   */
  legacy?: Record<string, { first: string[]; reference: string; revision?: string[] }>;
};

export type Folder = { id: string; name: string; createdAt: string };

/**
 * A material is one audio file plus optional subtitles.
 *
 * `createdAt` is optional because legacy data has no honest import time: guessing one
 * would make 最近导入 and 最近学习 lie. Materials without it sort last, stably.
 * `lastStudiedAt` is only set by real study behaviour (typing, checking, or playing in
 * 听读) - never by listing, importing or switching folders.
 */
export type Material = {
  id: string;
  /** What the user sees. Renaming changes this only - never the blob or the file name. */
  displayName: string;
  /** The file name the audio arrived under. Never changed by rename. */
  originalFileName: string;
  /** Exactly one folder or null for 未分类. */
  folderId: string | null;
  audio: Blob;
  duration: number;
  segments: SubtitleSegment[];
  createdAt?: string;
  lastStudiedAt?: string;
  lastView?: 'dictation' | 'reading';
  playbackPosition: number;
  /** 难句标记. Belongs to the material, so it survives across rounds. */
  bookmarkedSegmentIds: string[];
  rounds: PracticeRound[];
  activeRoundId: string;
};

export type DiffWord = { text: string; kind: 'same' | 'missing' | 'extra' };

/** `—` when a time is unknown, so the UI can say so instead of printing a guess. */
export const UNKNOWN_TIME = '—';

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function newRound(createdAt = nowIso()): PracticeRound {
  return {
    id: uid(),
    createdAt,
    updatedAt: createdAt,
    drafts: {},
    completedSegmentIds: [],
  };
}

export const activeRound = (material: Material): PracticeRound | undefined =>
  material.rounds.find((r) => r.id === material.activeRoundId) ?? material.rounds[0];

/**
 * Guarantees the material has an active round, creating one on demand.
 *
 * Materials can legitimately arrive with no rounds - freshly created ones, and records
 * written before rounds existed. Saving a draft into nothing would silently discard it,
 * so every write path goes through this first.
 */
export function ensureRound(material: Material): Material {
  if (material.rounds.some((r) => r.id === material.activeRoundId)) return material;
  if (material.rounds.length) return { ...material, activeRoundId: material.rounds[0].id };
  const round = newRound();
  return { ...material, rounds: [round], activeRoundId: round.id };
}

export const displayTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)
    .toString()
    .padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
};
