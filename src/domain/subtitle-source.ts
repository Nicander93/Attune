import type { SubtitleSegment } from './types';

/** Text codecs ffmpeg can convert to SRT. Bitmap/PGS is P4 (OCR). */
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'mov_text',
  'text',
  'webvtt',
  'wvtt',
  'ttml',
  'subtitle',
]);

export function isTextSubtitleCodec(codec: string): boolean {
  return TEXT_SUBTITLE_CODECS.has(codec.trim().toLowerCase());
}

/**
 * Normalize extracted cues into clip-relative seconds.
 * When ffmpeg left absolute source times (start >= clipStart), subtract the clip origin.
 */
export function toClipRelativeSegments(
  segments: SubtitleSegment[],
  clipStart: number,
  clipDuration: number,
): SubtitleSegment[] {
  const looksAbsolute =
    clipStart > 0.5 && segments.some((s) => s.start >= clipStart - 0.01);
  return segments
    .map((s) => {
      const start = looksAbsolute ? s.start - clipStart : s.start;
      const end = looksAbsolute ? s.end - clipStart : s.end;
      return {
        ...s,
        start: Math.max(0, start),
        end: Math.min(clipDuration, Math.max(0, end)),
      };
    })
    .filter((s) => s.end > s.start + 0.05)
    .map((s) => ({ ...s, end: Math.min(s.end, clipDuration) }));
}
