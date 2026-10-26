import { afterEach, describe, expect, it, vi } from 'vitest';
import { materialize } from './fixtures/material';

vi.mock('../src/desktop', () => ({
  isDesktop: vi.fn(() => true),
}));

vi.mock('../src/media', async () => {
  const actual = await vi.importActual<typeof import('../src/media')>('../src/media');
  return {
    ...actual,
    playbackAssetUrl: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  };
});

import { isDesktop } from '../src/desktop';
import { resolveMediaSource } from '../src/features/player/useMediaPlayer';

describe('resolveMediaSource', () => {
  afterEach(() => {
    vi.mocked(isDesktop).mockReturnValue(true);
  });

  it('uses asset-protocol video when playbackPath is set on desktop', () => {
    const material = materialize({
      audio: new Blob(['wav'], { type: 'audio/wav' }),
      video: {
        originalName: 'lesson.mp4',
        sourcePath: 'D:/videos/lesson.mp4',
        playbackPath: 'D:/app/media/m1/playback.mp4',
        clipStart: 0,
        clipEnd: 60,
        selectedAudioStream: 1,
      },
    });
    const resolved = resolveMediaSource(material);
    expect(resolved.kind).toBe('video');
    expect(resolved.videoSrc).toContain('playback.mp4');
    expect(resolved.videoSrc).not.toContain('D:/videos/lesson.mp4');
  });

  it('falls back to audio when playbackPath is missing', () => {
    const material = materialize({
      audio: new Blob(['wav'], { type: 'audio/wav' }),
      video: {
        originalName: 'lesson.mp4',
        sourcePath: 'D:/videos/lesson.mp4',
        clipStart: 0,
        clipEnd: 60,
      },
    });
    expect(resolveMediaSource(material).kind).toBe('audio');
  });

  it('never treats raw sourcePath as video src (browser or no playback copy)', () => {
    vi.mocked(isDesktop).mockReturnValue(false);
    const material = materialize({
      audio: new Blob(['wav'], { type: 'audio/wav' }),
      video: {
        originalName: 'lesson.mp4',
        sourcePath: 'D:/videos/lesson.mp4',
        playbackPath: 'D:/app/media/m1/playback.mp4',
        clipStart: 0,
        clipEnd: 60,
      },
    });
    const resolved = resolveMediaSource(material);
    expect(resolved.kind).toBe('audio');
    expect(resolved.videoSrc).toBeUndefined();
  });

  it('keeps pure audio materials on the audio path', () => {
    const material = materialize({ audio: new Blob(['a'], { type: 'audio/wav' }) });
    expect(resolveMediaSource(material)).toEqual({ kind: 'audio' });
  });
});
