import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { isDesktop } from './desktop';
import { isTextSubtitleCodec } from './domain/subtitle-source';

export interface MediaStreamInfo {
  index: number;
  codecType: string;
  codecName: string;
  channels?: number;
  width?: number;
  height?: number;
  language?: string;
}

export interface MediaProbe {
  path: string;
  duration: number;
  formatName: string;
  streams: MediaStreamInfo[];
  videoCompatible: boolean;
  needsTranscode: boolean;
  compatibilityNote: string;
}

export interface FfmpegStatus {
  available: boolean;
  ffmpeg?: string;
  ffprobe?: string;
  source: string;
  hint: string;
}

export interface ExtractAudioResult {
  wavPath: string;
  duration: number;
  sampleRate: number;
}

export interface PlaybackCopyResult {
  playbackPath: string;
  transcoded: boolean;
}

export interface ExtractSubtitlesResult {
  srtPath: string;
  streamIndex: number;
  codecName: string;
}

export async function ffmpegStatus(): Promise<FfmpegStatus> {
  if (!isDesktop()) {
    return {
      available: false,
      source: 'browser',
      hint: '视频导入与探测仅桌面版支持。',
    };
  }
  return invoke<FfmpegStatus>('media_ffmpeg_status');
}

/** Ask the user for a video file, authorize it for media commands, then probe. */
export async function pickAndProbeVideo(): Promise<MediaProbe> {
  if (!isDesktop()) throw new Error('视频导入仅桌面版支持。');
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'webm', 'm4v'] }],
  });
  if (!selected || Array.isArray(selected)) throw new Error('已取消选择视频。');
  const path = await invoke<string>('media_authorize_path', { path: selected });
  return invoke<MediaProbe>('media_probe', { path });
}

export async function probeAuthorizedPath(path: string): Promise<MediaProbe> {
  return invoke<MediaProbe>('media_probe', { path });
}

export async function extractClipAudio(input: {
  sourcePath: string;
  materialId: string;
  audioStream: number;
  clipStart: number;
  clipEnd: number;
}): Promise<{ blob: Blob; duration: number; wavPath: string }> {
  const result = await invoke<ExtractAudioResult>('media_extract_audio', { request: input });
  const bytes = await readFile(result.wavPath);
  return {
    blob: new Blob([bytes], { type: 'audio/wav' }),
    duration: result.duration,
    wavPath: result.wavPath,
  };
}

export async function preparePlayback(input: {
  sourcePath: string;
  materialId: string;
  forceTranscode?: boolean;
}): Promise<PlaybackCopyResult> {
  return invoke<PlaybackCopyResult>('media_prepare_playback', {
    request: {
      sourcePath: input.sourcePath,
      materialId: input.materialId,
      forceTranscode: !!input.forceTranscode,
    },
  });
}

export async function loadSrtText(srtPath: string): Promise<string> {
  const bytes = await readFile(srtPath);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function extractEmbeddedSubtitles(input: {
  sourcePath: string;
  materialId: string;
  subtitleStream: number;
  clipStart: number;
  clipEnd: number;
}): Promise<ExtractSubtitlesResult> {
  return invoke<ExtractSubtitlesResult>('media_extract_subtitles', {
    request: {
      sourcePath: input.sourcePath,
      materialId: input.materialId,
      subtitleStream: input.subtitleStream,
      clipStart: input.clipStart,
      clipEnd: input.clipEnd,
    },
  });
}

export async function clearMediaCache(materialId: string): Promise<void> {
  if (!isDesktop()) return;
  await invoke('media_clear_cache', { materialId });
}

/** Asset-protocol URL for a managed playback file (must be under app media cache). */
export function playbackAssetUrl(playbackPath: string): string {
  return convertFileSrc(playbackPath);
}

export function pickDefaultAudioStream(probe: MediaProbe): number | undefined {
  const audio = probe.streams.filter((s) => s.codecType === 'audio');
  if (!audio.length) return undefined;
  const eng = audio.find((s) => (s.language || '').toLowerCase().startsWith('en'));
  return (eng ?? audio[0]).index;
}

export function pickDefaultSubtitleStream(probe: MediaProbe): number | undefined {
  const subs = probe.streams.filter(
    (s) => s.codecType === 'subtitle' && isTextSubtitleCodec(s.codecName),
  );
  if (!subs.length) return undefined;
  const eng = subs.find((s) => (s.language || '').toLowerCase().startsWith('en'));
  return (eng ?? subs[0]).index;
}
