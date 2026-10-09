export type Segment = { id: string; start: number; end: number; reference: string };
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
const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
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
export function checkSegment(attempt: Attempt, segment: Segment): Attempt {
  if (attempt.checked[segment.id]) return attempt;
  const first = [...(attempt.drafts[segment.id] || [])];
  return {
    ...attempt,
    checked: { ...attempt.checked, [segment.id]: { first, reference: segment.reference } },
  };
}
