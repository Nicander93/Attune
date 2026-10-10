/** Word-level timing from speech recognition; empty for SRT or manual segments. */
export type WordTiming = { text: string; start: number; end: number };
/** `id` stays stable for the life of a segment so dictation records can refer to it. */
export type Segment = {
  id: string;
  start: number;
  end: number;
  reference: string;
  words: WordTiming[];
};
/** Sentence returned by the desktop speech recognizer. */
export type RecognizedSentence = { text: string; start: number; end: number; words: WordTiming[] };
export type Attempt = {
  id: string;
  createdAt: string;
  drafts: Record<string, string[]>;
  checked: Record<string, { first: string[]; reference: string; revision?: string[] }>;
};
export type Material = {
  id: string;
  name: string;
  audio: Blob;
  duration: number;
  segments: Segment[];
  attempts: Attempt[];
  attemptId: string;
  segmentId: string;
  position: number;
  review: string[];
};
export type DiffWord = { text: string; kind: 'same' | 'missing' | 'extra' };
export const uid = () => crypto.randomUUID();
export const newAttempt = (): Attempt => ({
  id: uid(),
  createdAt: new Date().toISOString(),
  drafts: {},
  checked: {},
});
export function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}
/** Map common English number words to digits so 3 and three compare equal. */
const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
};
function normalized(text: string): string {
  const base = text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  return NUMBER_WORDS[base] ?? base;
}
/** Join a stored word draft into free-text for the sentence field. */
export function draftText(words: string[] | undefined): string {
  return (words || []).filter(Boolean).join(' ');
}
/** Split free-text back into the word array used by drafts and checked records. */
export function draftWords(text: string): string[] {
  return tokenize(text);
}
/** Index of the word timing that covers position, or -1 when none / no timings. */
export function activeWordIndex(words: WordTiming[], position: number): number {
  if (!words.length) return -1;
  return words.findIndex((w) => position >= w.start && position < w.end);
}
/**
 * Maps each comparison token to a word-timing index for reference-side words
 * (same / missing). extra tokens and empty timings yield null — never invent times.
 */
export function timingIndexByDiff(diff: DiffWord[], words: WordTiming[]): Array<number | null> {
  if (!words.length) return diff.map(() => null);
  let ref = 0;
  return diff.map((token) => {
    if (token.kind === 'extra') return null;
    const index = ref < words.length ? ref : null;
    ref += 1;
    return index;
  });
}
export function compareWords(draft: string[], reference: string): DiffWord[] {
  const a = draft.filter(Boolean),
    b = tokenize(reference);
  // Bound the quadratic comparison; long material is divided into segments.
  if (a.length > 500 || b.length > 500) throw new Error('单段最多核对 500 个词，请先拆分片段。');
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        normalized(a[i]) === normalized(b[j])
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
  const result: DiffWord[] = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && normalized(a[i]) === normalized(b[j])) {
      result.push({ text: a[i++], kind: 'same' });
      j++;
    } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j]))
      result.push({ text: b[j++], kind: 'missing' });
    else result.push({ text: a[i++], kind: 'extra' });
  }
  return result;
}
function timestamp(text: string): number {
  const parts = text.replace(',', '.').split(':').map(Number);
  if (
    parts.length !== 3 ||
    parts.some((x) => !Number.isFinite(x) || x < 0) ||
    parts[1] >= 60 ||
    parts[2] >= 60
  )
    throw new Error('字幕时间格式无效。');
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
export function parseSrt(text: string, duration: number): Segment[] {
  const blocks = text
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n/);
  const segments = blocks
    .map((block) => {
      const lines = block.split('\n'),
        timeIndex = lines.findIndex((line) => line.includes('-->'));
      if (timeIndex < 0) throw new Error('没有找到有效的 SRT 时间轴。');
      const match = lines[timeIndex].match(
        /(\d+:\d{2}:\d{2}[,.]\d+)\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d+)/,
      );
      if (!match) throw new Error('字幕时间格式无效。');
      const start = timestamp(match[1]),
        end = timestamp(match[2]);
      if (end <= start || end > duration + 0.25)
        throw new Error('字幕片段超出音频范围或结束时间无效。');
      return {
        id: uid(),
        start,
        end: Math.min(end, duration),
        words: [],
        reference: lines
          .slice(timeIndex + 1)
          .join(' ')
          .replace(/<[^>]*>/g, '')
          .trim(),
      };
    })
    .sort((a, b) => a.start - b.start);
  if (!segments.length) throw new Error('字幕为空。');
  for (let i = 1; i < segments.length; i++)
    if (segments[i].start < segments[i - 1].end)
      throw new Error('首版暂不支持重叠字幕，请先调整时间轴。');
  return segments;
}
export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
export const hasDictation = (material: Material) =>
  material.attempts.some((a) => Object.values(a.drafts).some((w) => w.some(Boolean)));
export function checkSegment(attempt: Attempt, segment: Segment): Attempt {
  if (attempt.checked[segment.id]) return attempt;
  const first = [...(attempt.drafts[segment.id] || [])];
  return {
    ...attempt,
    checked: { ...attempt.checked, [segment.id]: { first, reference: segment.reference } },
  };
}
const pad = (value: number, length = 2) => value.toString().padStart(length, '0');
function srtTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:${pad(
    Math.floor(total / 1000) % 60,
  )},${pad(total % 1000, 3)}`;
}
/** SubRip text for segments that have reference text; UTF-8 BOM and CRLF suit most players. */
export function toSrt(segments: Segment[]): string {
  const blocks = segments
    .filter((s) => s.reference.trim())
    .map(
      (s, i) =>
        `${i + 1}\r\n${srtTimestamp(s.start)} --> ${srtTimestamp(s.end)}\r\n${s.reference
          .trim()
          .replace(/\s*\n\s*/g, ' ')}\r\n`,
    );
  return blocks.length ? `\uFEFF${blocks.join('\r\n')}` : '';
}
export function sentencesToSegments(sentences: RecognizedSentence[], duration: number): Segment[] {
  return sentences
    .map((s) => ({
      id: uid(),
      start: Math.max(0, s.start),
      end: Math.min(s.end, duration),
      reference: s.text.trim(),
      words: s.words,
    }))
    .filter((s) => s.reference && s.end > s.start);
}
/** Brings materials saved by older versions up to the current shape. */
export function migrateMaterial(material: Material): Material {
  const seen = new Set<string>();
  const segments = material.segments.map((s) => {
    const id = s.id && !seen.has(s.id) ? s.id : uid();
    seen.add(id);
    return { ...s, id, words: s.words ?? [] };
  });
  const segmentId = segments.some((s) => s.id === material.segmentId)
    ? material.segmentId
    : (segments[0]?.id ?? '');
  return { ...material, segments, segmentId };
}
