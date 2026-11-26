import type { Material } from '../../domain/types';
import { parseSrt } from '../../domain/subtitles';
import { applySubtitleTimeline, hasProtectedSubtitles } from '../../domain/subtitle-edits';
import { isTextSubtitleCodec, toClipRelativeSegments } from '../../domain/subtitle-source';
import {
  downloadFfmpeg,
  extractClipAudio,
  extractEmbeddedSubtitles,
  ffmpegBundle,
  ffmpegStatus,
  loadSrtText,
  ocrBurnedInSubtitles,
  pickDefaultAudioStream,
  pickDefaultSubtitleStream,
  preparePlayback,
  type FfmpegStatus,
  type MediaProbe,
  type MediaStreamInfo,
} from '../../media';
import {
  COPY,
  toUserFacingError,
  toolsConsentMessage,
  toolsProgressLabel,
  type UserFacingError,
} from './import-messages';
import { fileNameFromPath, probeVideoPath } from './local-media';

/** Auto-import uses the full file; the older 20-minute cap stays only as a helper elsewhere. */
export function fullClipEnd(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return duration;
}

export interface VideoPreparePlan {
  audioStream?: number;
  subtitleStream?: number;
  clipStart: number;
  clipEnd: number;
  audioStreams: MediaStreamInfo[];
  textSubtitleStreams: MediaStreamInfo[];
  needsAudioChoice: boolean;
}

export function planVideoPrepare(probe: MediaProbe): VideoPreparePlan {
  const audioStreams = probe.streams.filter((stream) => stream.codecType === 'audio');
  const textSubtitleStreams = probe.streams.filter(
    (stream) => stream.codecType === 'subtitle' && isTextSubtitleCodec(stream.codecName),
  );
  return {
    audioStream: pickDefaultAudioStream(probe),
    subtitleStream: pickDefaultSubtitleStream(probe),
    clipStart: 0,
    clipEnd: fullClipEnd(probe.duration),
    audioStreams,
    textSubtitleStreams,
    needsAudioChoice: audioStreams.length > 1,
  };
}

export function shouldAutoPrepareSubtitles(input: {
  desktop: boolean;
  hasAudio: boolean;
  hasSubtitles: boolean;
  processing: boolean;
}): boolean {
  return input.desktop && input.hasAudio && !input.hasSubtitles && !input.processing;
}

export type ToolsEnsureResult =
  | { status: 'ready'; toolsStatus: FfmpegStatus }
  | { status: 'cancelled' }
  | ({ status: 'failed' } & UserFacingError);

export async function ensureLocalMediaTools(options: {
  onProgress: (label: string) => void;
  confirm?: (message: string) => boolean;
}): Promise<ToolsEnsureResult> {
  const confirm = options.confirm ?? ((message) => window.confirm(message));
  const status = await ffmpegStatus();
  if (status.available) return { status: 'ready', toolsStatus: status };

  const info = await ffmpegBundle().catch(() => null);
  const sizeMb = info?.sizeBytes ? Math.max(1, Math.round(info.sizeBytes / 1_048_576)) : 79;
  if (!confirm(toolsConsentMessage(sizeMb))) return { status: 'cancelled' };

  options.onProgress(toolsProgressLabel());
  try {
    const next = await downloadFfmpeg((progress) => {
      const percent = progress.totalBytes
        ? Math.min(100, Math.floor((progress.downloadedBytes / progress.totalBytes) * 100))
        : undefined;
      options.onProgress(toolsProgressLabel(percent));
    });
    if (next.available) return { status: 'ready', toolsStatus: next };
    return { status: 'failed', ...toUserFacingError(next.hint, COPY.toolsStillMissing) };
  } catch (err) {
    if (String(err).includes('取消')) return { status: 'cancelled' };
    return { status: 'failed', ...toUserFacingError(err, COPY.toolsInstallFailed) };
  }
}

export type ApplyVideoResult =
  | { status: 'ready'; segmentCount: number }
  | { status: 'need-recognition' }
  | { status: 'protected' }
  | { status: 'subtitle-failed'; detail: string; remainingSubtitleStreams: MediaStreamInfo[] }
  | ({ status: 'failed' } & UserFacingError);

export interface ApplyVideoInput {
  probe: MediaProbe;
  material: Material;
  update: (transform: (material: Material) => Material) => void;
  audioStream: number;
  subtitleStream?: number;
  clipStart: number;
  clipEnd: number;
  onProgress: (label: string) => void;
}

export async function applyVideoImport(input: ApplyVideoInput): Promise<ApplyVideoResult> {
  const { probe, material, update, audioStream, subtitleStream, clipStart, clipEnd, onProgress } =
    input;
  onProgress(COPY.preparingMedia);
  try {
    const extracted = await extractClipAudio({
      sourcePath: probe.path,
      materialId: material.id,
      audioStream,
      clipStart,
      clipEnd,
    });
    let playbackPath: string | undefined;
    try {
      const playback = await preparePlayback({
        sourcePath: probe.path,
        materialId: material.id,
        forceTranscode: probe.needsTranscode,
      });
      playbackPath = playback.playbackPath;
    } catch {
      // The picture copy is optional; dictation can still use the extracted audio.
    }

    const originalName = fileNameFromPath(probe.path);
    update((current) => ({
      ...current,
      audio: extracted.blob,
      duration: extracted.duration,
      displayName: current.originalFileName
        ? current.displayName
        : originalName.replace(/\.[^.]+$/, ''),
      originalFileName: originalName,
      playbackPosition: 0,
      video: {
        originalName,
        sourcePath: probe.path,
        playbackPath,
        clipStart,
        clipEnd,
        selectedAudioStream: audioStream,
        selectedSubtitleStream: subtitleStream,
        subtitleOrigin: subtitleStream !== undefined ? 'embedded' : undefined,
      },
    }));

    if (subtitleStream !== undefined && !hasProtectedSubtitles(material)) {
      try {
        onProgress(COPY.readingSubtitles);
        const duration = clipEnd - clipStart;
        const extractedSubs = await extractEmbeddedSubtitles({
          sourcePath: probe.path,
          materialId: material.id,
          subtitleStream,
          clipStart,
          clipEnd,
        });
        const srtText = await loadSrtText(extractedSubs.srtPath);
        const segments = toClipRelativeSegments(parseSrt(srtText, duration), clipStart, duration);
        if (segments.length > 0) {
          update((current) => applySubtitleTimeline(current, segments, 'embedded', 'unreviewed'));
          return { status: 'ready', segmentCount: segments.length };
        }
        return {
          status: 'subtitle-failed',
          detail: '自动选择的字幕里没有可用的句子。',
          remainingSubtitleStreams: otherTextSubtitleStreams(probe, subtitleStream),
        };
      } catch (err) {
        return {
          status: 'subtitle-failed',
          detail: String(err),
          remainingSubtitleStreams: otherTextSubtitleStreams(probe, subtitleStream),
        };
      }
    }

    if (
      hasProtectedSubtitles(material) &&
      material.segments.some((segment) => segment.reference.trim())
    ) {
      return { status: 'protected' };
    }
    return { status: 'need-recognition' };
  } catch (err) {
    return { status: 'failed', ...toUserFacingError(err, COPY.videoProcessFailed) };
  }
}

export async function applyOcrSubtitles(input: {
  sourcePath: string;
  material: Material;
  update: (transform: (material: Material) => Material) => void;
  clipStart: number;
  clipEnd: number;
}): Promise<{ status: 'ready'; segmentCount: number } | ({ status: 'failed' } & UserFacingError)> {
  try {
    const duration = input.clipEnd - input.clipStart;
    const result = await ocrBurnedInSubtitles({
      sourcePath: input.sourcePath,
      materialId: input.material.id,
      clipStart: input.clipStart,
      clipEnd: input.clipEnd,
    });
    const srtText = await loadSrtText(result.srtPath);
    const segments = toClipRelativeSegments(parseSrt(srtText, duration), input.clipStart, duration);
    if (segments.length === 0) {
      return { status: 'failed', message: COPY.pictureTextFailed };
    }
    input.update((current) => applySubtitleTimeline(current, segments, 'ocr', 'unreviewed'));
    return { status: 'ready', segmentCount: segments.length };
  } catch (err) {
    return { status: 'failed', ...toUserFacingError(err, COPY.pictureTextFailed) };
  }
}

export async function probeAndPlanVideo(path: string): Promise<{
  probe: MediaProbe;
  plan: VideoPreparePlan;
}> {
  const probe = await probeVideoPath(path);
  return { probe, plan: planVideoPrepare(probe) };
}

function otherTextSubtitleStreams(probe: MediaProbe, usedIndex: number): MediaStreamInfo[] {
  return probe.streams.filter(
    (stream) =>
      stream.codecType === 'subtitle' &&
      isTextSubtitleCodec(stream.codecName) &&
      stream.index !== usedIndex,
  );
}
