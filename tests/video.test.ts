import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  clearPlaybackPath,
  clipDuration,
  defaultClipEnd,
  toClipTime,
  toSourceTime,
} from '../src/domain/video';
import { closeDatabase, loadMaterials, saveMaterial } from '../src/storage/db';
import { materialize } from './fixtures/material';

describe('video clip time helpers', () => {
  const video = {
    originalName: 'a.mp4',
    sourcePath: 'D:/videos/a.mp4',
    clipStart: 10,
    clipEnd: 40,
    selectedAudioStream: 1,
  };

  it('keeps clip-relative and source times consistent', () => {
    expect(clipDuration(video)).toBe(30);
    expect(toSourceTime(video, 5)).toBe(15);
    expect(toClipTime(video, 15)).toBe(5);
  });

  it('caps the default clip at 20 minutes', () => {
    expect(defaultClipEnd(60)).toBe(60);
    expect(defaultClipEnd(3600)).toBe(20 * 60);
  });
});

describe('video metadata persistence', () => {
  beforeEach(async () => {
    await closeDatabase();
    Object.assign(globalThis, { indexedDB: new IDBFactory() });
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('round-trips optional video fields without a schema bump', async () => {
    const material = materialize({
      audio: new Blob(['wav-bytes'], { type: 'audio/wav' }),
      video: {
        originalName: 'lesson.mp4',
        sourcePath: 'D:/media/lesson.mp4',
        playbackPath: 'D:/app/media/m1/playback.mp4',
        clipStart: 0,
        clipEnd: 120,
        selectedAudioStream: 1,
        selectedSubtitleStream: 2,
        subtitleOrigin: 'embedded',
      },
    });
    await saveMaterial(material);
    await closeDatabase();
    const [loaded] = await loadMaterials();
    expect(loaded.video).toEqual(material.video);
    expect(loaded.displayName).toBe(material.displayName);
    expect(loaded.segments).toHaveLength(3);
  });

  it('keeps pure audio materials working (no video field)', async () => {
    const material = materialize({ audio: new Blob(['a'], { type: 'audio/wav' }) });
    await saveMaterial(material);
    await closeDatabase();
    const [loaded] = await loadMaterials();
    expect(loaded.video).toBeUndefined();
    expect(loaded.audio.size).toBe(1);
  });
});

describe('clearPlaybackPath', () => {
  it('drops playbackPath but keeps other video fields', () => {
    const material = {
      id: 'm1',
      video: {
        originalName: 'a.mp4',
        sourcePath: 'D:/videos/a.mp4',
        playbackPath: 'D:/app/media/m1/playback.mp4',
        clipStart: 0,
        clipEnd: 10,
      },
    };
    const next = clearPlaybackPath(material);
    expect(next.video?.playbackPath).toBeUndefined();
    expect(next.video?.sourcePath).toBe('D:/videos/a.mp4');
    expect(material.video?.playbackPath).toBe('D:/app/media/m1/playback.mp4');
  });

  it('is a no-op for audio-only materials', () => {
    const material = { id: 'a1', video: undefined as { playbackPath?: string } | undefined };
    expect(clearPlaybackPath(material)).toBe(material);
  });
});
