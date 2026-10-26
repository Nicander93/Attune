/** Clip-relative time helpers for video materials. */

import type { VideoSource } from './types';

export function clipDuration(video: VideoSource): number {
  return Math.max(0, video.clipEnd - video.clipStart);
}

/** Absolute time in the source file. */
export function toSourceTime(video: VideoSource, relativeSeconds: number): number {
  return video.clipStart + Math.max(0, relativeSeconds);
}

/** Clip-relative time from an absolute source timestamp. */
export function toClipTime(video: VideoSource, sourceSeconds: number): number {
  return Math.max(0, sourceSeconds - video.clipStart);
}

export function defaultClipEnd(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(duration, 20 * 60);
}

/** Drop managed playbackPath after cache wipe; keep source association. */
export function clearPlaybackPath<T extends { video?: { playbackPath?: string } }>(
  material: T,
): T {
  if (!material.video?.playbackPath) return material;
  const { playbackPath: _removed, ...video } = material.video;
  return { ...material, video };
}

