import { uid, type RecognizedSentence, type SubtitleSegment, type WordTiming } from './types';

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

/** Longest single segment we accept, to keep editing and diffing responsive. */
const MAX_SEGMENT_SECONDS = 60;

class SubtitleError extends Error {}
const fail = (message: string): never => {
  throw new SubtitleError(message);
};

/** `HH:MM:SS,mmm`, `MM:SS.mmm` and dot separators all appear in the wild. */
function parseTimestamp(raw: string): number {
  const text = raw.trim().replace(',', '.');
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3) fail('字幕时间格式无效。');
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) fail('字幕时间格式无效。');
  const [h, m, s] = numbers.length === 3 ? numbers : [0, numbers[0], numbers[1]];
  if (m >= 60 || s >= 60) fail('字幕时间格式无效。');
  return h * 3600 + m * 60 + s;
}

const stripTags = (text: string) => text.replace(/<[^>]*>/g, '');

/** Reads a bilingual block: the line without CJK is English, the one with it is Chinese. */
function splitBilingual(lines: string[]): { reference: string; translation?: string } {
  const cleaned = lines.map((l) => stripTags(l).trim()).filter(Boolean);
  if (cleaned.length < 2) return { reference: cleaned.join(' ') };
  const chinese = cleaned.filter((l) => CJK.test(l));
  const latin = cleaned.filter((l) => !CJK.test(l));
  // Undecidable (all one script) or no Latin at all: keep every line as the reference
  // rather than dropping text we cannot classify.
  if (!latin.length || !chinese.length) return { reference: cleaned.join(' ') };
  return { reference: latin.join(' '), translation: chinese.join(' ') };
}

/** A cue before ids and empty word timings are attached. */
type Cue = { start: number; end: number; reference: string; translation?: string };

function validate(cues: Cue[], duration: number): SubtitleSegment[] {
  if (!cues.length) fail('字幕为空。');
  const segments = cues.map((c) => ({ ...c, id: uid() })).sort((a, b) => a.start - b.start);
  for (const segment of segments) {
    if (!(segment.end > segment.start)) fail('字幕片段结束时间必须晚于开始时间。');
    if (segment.end > duration + 0.25)
      fail(`字幕片段结束于 ${segment.end.toFixed(2)}s，超出音频时长 ${duration.toFixed(2)}s。`);
    if (segment.end - segment.start > MAX_SEGMENT_SECONDS)
      fail(`有一段字幕超过 ${MAX_SEGMENT_SECONDS} 秒，请在字幕校对里拆分。`);
  }
  for (let i = 1; i < segments.length; i++)
    if (segments[i].start < segments[i - 1].end)
      fail(`第 ${i + 1} 段字幕与上一段重叠，请先调整时间轴。`);
  return segments.map((s) => ({ ...s, end: Math.min(s.end, duration), words: [] as WordTiming[] }));
}

/** Reads SubRip files. Cue numbers are optional in practice, so they are skipped when found. */
export function parseSrt(text: string, duration: number): SubtitleSegment[] {
  const blocks = text
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n/);
  const cues = blocks.map((block) => {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => line.includes('-->'));
    if (at < 0) fail('没有找到有效的 SRT 时间轴。');
    const [from, to] = lines[at].split('-->');
    if (!from || !to) fail('字幕时间格式无效。');
    const split = splitBilingual(lines.slice(at + 1));
    return {
      start: parseTimestamp(from),
      end: parseTimestamp(to),
      reference: split.reference,
      translation: split.translation,
    };
  });
  return validate(cues, duration);
}

/** Reads WebVTT: `WEBVTT` header, optional cue ids, and `align:`/NOTE lines to ignore. */
export function parseVtt(text: string, duration: number): SubtitleSegment[] {
  const body = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  if (!/^WEBVTT[\s\n]/.test(body)) fail('不是有效的 WebVTT 文件（缺少 WEBVTT 头）。');
  const cues = body
    .split(/\n\s*\n/)
    .filter((block) => block.trim() && !block.startsWith('WEBVTT') && !block.startsWith('NOTE'))
    .map((block) => {
      const lines = block.split('\n');
      const at = lines.findIndex((line) => line.includes('-->'));
      if (at < 0) fail('没有找到有效的 WebVTT 时间轴。');
      // Drop VTT cue settings such as `align:start position:10%`.
      const [from, rest] = lines[at].split('-->');
      const to = rest.trim().split(/\s+/)[0];
      if (!from || !to) fail('字幕时间格式无效。');
      const split = splitBilingual(lines.slice(at + 1));
      return {
        start: parseTimestamp(from),
        end: parseTimestamp(to),
        reference: split.reference,
        translation: split.translation,
      };
    });
  return validate(cues, duration);
}

/**
 * Turns recognised sentences into segments. Recognition never produces a translation,
 * so `translation` stays absent rather than being invented.
 */
export function sentencesToSegments(
  sentences: RecognizedSentence[],
  duration: number,
): SubtitleSegment[] {
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

const pad = (value: number, length = 2) => value.toString().padStart(length, '0');

function srtTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:${pad(
    Math.floor(total / 1000) % 60,
  )},${pad(total % 1000, 3)}`;
}

/**
 * SubRip text for segments that carry reference text. Translations are intentionally
 * dropped: SubRip has nowhere to put them, and writing them inline would corrupt the
 * English track on re-import.
 */
export function toSrt(segments: SubtitleSegment[]): string {
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
