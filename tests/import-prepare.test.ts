import { describe, expect, it } from 'vitest';
import {
  COPY,
  MAIN_PATH_JARGON,
  audioTrackLabel,
  containsMainPathJargon,
  modelConsentMessage,
  readyToDictate,
  toUserFacingError,
  toolsConsentMessage,
  toolsProgressLabel,
} from '../src/features/material/import-messages';
import {
  fullClipEnd,
  planVideoPrepare,
  shouldAutoPrepareSubtitles,
} from '../src/features/material/prepare-video';
import type { MediaProbe } from '../src/media';

function probe(streams: MediaProbe['streams'], duration = 3600): MediaProbe {
  return {
    path: 'D:/media/lesson.mp4',
    duration,
    formatName: 'mov,mp4',
    streams,
    videoCompatible: true,
    needsTranscode: false,
    compatibilityNote: '视频编码为 H.264，可作为播放基线。',
  };
}

describe('import main-path copy', () => {
  it('keeps success, progress, and consent wording free of technical jargon', () => {
    const samples = [
      COPY.preparingSubtitles,
      COPY.preparingMedia,
      COPY.noSubtitlesYet,
      COPY.dropTitle,
      COPY.dropHint,
      readyToDictate(12),
      toolsConsentMessage(79),
      toolsProgressLabel(40),
      modelConsentMessage(140),
      COPY.toolsInstallFailed,
      COPY.recognitionFailed,
      COPY.tryPictureText,
      COPY.multipleAudioTracks,
      COPY.subtitlePickAfterFailure,
    ];
    for (const sample of samples) {
      expect(sample, sample).not.toMatch(MAIN_PATH_JARGON);
    }
  });

  it('puts jargon and backend text under 详情, keeping the first sentence plain', () => {
    const error = toUserFacingError(
      '未找到 ffmpeg/ffprobe。可设置 ATTUNE_FFMPEG_DIR。',
      COPY.toolsInstallFailed,
    );
    expect(error.message).toBe(COPY.toolsInstallFailed);
    expect(error.detail).toContain('ffmpeg');
    expect(containsMainPathJargon(error.message)).toBe(false);
  });

  it('keeps an already-plain error as the first sentence', () => {
    expect(toUserFacingError('这个音频格式无法播放，请换成 MP3 或 WAV。', '导入失败')).toEqual({
      message: '这个音频格式无法播放，请换成 MP3 或 WAV。',
    });
  });
});

describe('auto video plan', () => {
  it('uses the full duration and a reasonable default text subtitle track', () => {
    const planned = planVideoPrepare(
      probe([
        { index: 0, codecType: 'video', codecName: 'h264' },
        { index: 1, codecType: 'audio', codecName: 'aac', language: 'jpn' },
        { index: 2, codecType: 'audio', codecName: 'aac', language: 'eng' },
        { index: 3, codecType: 'subtitle', codecName: 'ass', language: 'jpn' },
        { index: 4, codecType: 'subtitle', codecName: 'subrip', language: 'eng' },
        { index: 5, codecType: 'subtitle', codecName: 'hdmv_pgs_subtitle' },
      ]),
    );
    expect(planned.clipStart).toBe(0);
    expect(planned.clipEnd).toBe(3600);
    expect(planned.clipEnd).toBe(fullClipEnd(3600));
    expect(planned.audioStream).toBe(2);
    expect(planned.subtitleStream).toBe(4);
    expect(planned.needsAudioChoice).toBe(true);
    expect(planned.textSubtitleStreams).toHaveLength(2);
  });

  it('does not ask for a track when there is only one audio stream and no text subtitles', () => {
    const planned = planVideoPrepare(
      probe(
        [
          { index: 0, codecType: 'video', codecName: 'h264' },
          { index: 1, codecType: 'audio', codecName: 'aac' },
          { index: 2, codecType: 'subtitle', codecName: 'hdmv_pgs_subtitle' },
        ],
        95,
      ),
    );
    expect(planned.audioStream).toBe(1);
    expect(planned.subtitleStream).toBeUndefined();
    expect(planned.needsAudioChoice).toBe(false);
    expect(planned.clipEnd).toBe(95);
  });

  it('labels audio tracks in plain language', () => {
    expect(audioTrackLabel('eng', 0)).toBe('第 1 条（英语）');
    expect(audioTrackLabel(undefined, 1)).toBe('第 2 条');
  });
});

describe('auto subtitle preparation', () => {
  it('starts only on desktop when audio is ready and no reference text exists yet', () => {
    expect(
      shouldAutoPrepareSubtitles({
        desktop: true,
        hasAudio: true,
        hasSubtitles: false,
        processing: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoPrepareSubtitles({
        desktop: false,
        hasAudio: true,
        hasSubtitles: false,
        processing: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoPrepareSubtitles({
        desktop: true,
        hasAudio: true,
        hasSubtitles: true,
        processing: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoPrepareSubtitles({
        desktop: true,
        hasAudio: false,
        hasSubtitles: false,
        processing: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoPrepareSubtitles({
        desktop: true,
        hasAudio: true,
        hasSubtitles: false,
        processing: true,
      }),
    ).toBe(false);
  });
});
