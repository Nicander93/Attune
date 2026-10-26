import { useEffect, useMemo, useState } from 'react';
import type { Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { defaultClipEnd } from '../../domain/video';
import { parseSrt } from '../../domain/subtitles';
import { applySubtitleTimeline, hasProtectedSubtitles } from '../../domain/subtitle-edits';
import {
  isBitmapSubtitleCodec,
  isTextSubtitleCodec,
  toClipRelativeSegments,
} from '../../domain/subtitle-source';
import { isDesktop } from '../../desktop';
import {
  extractClipAudio,
  extractEmbeddedSubtitles,
  ffmpegStatus,
  loadSrtText,
  ocrBurnedInSubtitles,
  ocrStatus,
  pickAndProbeVideo,
  pickDefaultAudioStream,
  pickDefaultSubtitleStream,
  preparePlayback,
  type FfmpegStatus,
  type MediaProbe,
  type OcrStatus,
} from '../../media';

type Props = {
  material: Material;
  update: (transform: (material: Material) => Material) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  /** Called after video apply when no embedded text track was applied (ASR fallback). */
  onNeedAsr?: () => void;
};

function fileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Desktop-only video import: probe → pick audio/range → extract Whisper-friendly audio
 * and a managed H.264 playback copy. Does not change study UX (P2).
 * P3: text subtitle extract. P4: optional burned-in/bitmap OCR (does not alter the text→ASR path).
 */
export function VideoImportPanel({ material, update, onNotice, onError, onNeedAsr }: Props) {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [ocr, setOcr] = useState<OcrStatus | null>(null);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [audioStream, setAudioStream] = useState<number | undefined>();
  const [subtitleStream, setSubtitleStream] = useState<number | undefined>();
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(0);
  const [busy, setBusy] = useState(false);
  /** Prefer burned-in/bitmap OCR over ASR when no text track was applied. */
  const [wantOcr, setWantOcr] = useState(false);

  useEffect(() => {
    void ffmpegStatus()
      .then(setStatus)
      .catch((err) => setStatus({ available: false, source: 'error', hint: String(err) }));
    void ocrStatus()
      .then(setOcr)
      .catch((err) =>
        setOcr({
          available: false,
          backend: 'winrt',
          languages: [],
          hint: String(err),
        }),
      );
  }, []);

  const audioStreams = useMemo(
    () => probe?.streams.filter((s) => s.codecType === 'audio') ?? [],
    [probe],
  );
  const subtitleStreams = useMemo(
    () =>
      probe?.streams.filter(
        (s) => s.codecType === 'subtitle' && isTextSubtitleCodec(s.codecName),
      ) ?? [],
    [probe],
  );
  const bitmapSubtitleCount = useMemo(
    () =>
      probe?.streams.filter(
        (s) => s.codecType === 'subtitle' && isBitmapSubtitleCodec(s.codecName),
      ).length ?? 0,
    [probe],
  );

  async function chooseVideo() {
    onError('');
    setBusy(true);
    try {
      const next = await pickAndProbeVideo();
      setProbe(next);
      setAudioStream(pickDefaultAudioStream(next));
      setSubtitleStream(pickDefaultSubtitleStream(next));
      setClipStart(0);
      setClipEnd(defaultClipEnd(next.duration));
      const hasBitmap = next.streams.some(
        (s) => s.codecType === 'subtitle' && isBitmapSubtitleCodec(s.codecName),
      );
      setWantOcr(hasBitmap);
      onNotice(`\u5df2\u63a2\u6d4b\uff1a${fileName(next.path)}`);
    } catch (err) {
      const message = String(err);
      if (!message.includes('\u53d6\u6d88')) onError(message);
    } finally {
      setBusy(false);
    }
  }

  async function applyVideo() {
    if (!probe) return;
    if (audioStream === undefined) {
      onError('\u8fd9\u8def\u89c6\u9891\u6ca1\u6709\u53ef\u7528\u97f3\u8f68\u3002');
      return;
    }
    if (clipEnd <= clipStart) {
      onError('\u65f6\u95f4\u8303\u56f4\u65e0\u6548\u3002');
      return;
    }
    onError('');
    setBusy(true);
    try {
      const extracted = await extractClipAudio({
        sourcePath: probe.path,
        materialId: material.id,
        audioStream,
        clipStart,
        clipEnd,
      });
      let playbackPath: string | undefined;
      let playbackNote = '';
      try {
        const playback = await preparePlayback({
          sourcePath: probe.path,
          materialId: material.id,
          forceTranscode: probe.needsTranscode,
        });
        playbackPath = playback.playbackPath;
        playbackNote = playback.transcoded
          ? '\u5df2\u8f6c\u7801\u4e3a H.264 \u64ad\u653e\u526f\u672c\u3002'
          : '\u5df2\u7f13\u5b58\u53ef\u64ad\u653e\u526f\u672c\u3002';
      } catch (err) {
        playbackNote = `\u97f3\u9891\u5df2\u63d0\u53d6\uff0c\u4f46\u64ad\u653e\u526f\u672c\u5931\u8d25\uff1a${String(err)}`;
      }

      const originalName = fileName(probe.path);
      const clipDuration = clipEnd - clipStart;
      update((m) => ({
        ...m,
        audio: extracted.blob,
        duration: extracted.duration,
        displayName: m.originalFileName ? m.displayName : originalName.replace(/\.[^.]+$/, ''),
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

      let embeddedApplied = false;
      if (subtitleStream !== undefined && !hasProtectedSubtitles(material)) {
        try {
          const sub = await extractEmbeddedSubtitles({
            sourcePath: probe.path,
            materialId: material.id,
            subtitleStream,
            clipStart,
            clipEnd,
          });
          const srtText = await loadSrtText(sub.srtPath);
          const segments = toClipRelativeSegments(
            parseSrt(srtText, clipDuration),
            clipStart,
            clipDuration,
          );
          if (segments.length > 0) {
            update((m) => applySubtitleTimeline(m, segments, 'embedded', 'unreviewed'));
            onNotice(
              `\u89c6\u9891\u5df2\u5199\u5165\uff08\u7247\u6bb5 ${formatTime(clipStart)}\u2013${formatTime(clipEnd)}\uff09\u3002${playbackNote} \u5df2\u4ece\u5185\u5d4c\u5b57\u5e55\u8f68\u63d0\u53d6 ${segments.length} \u53e5\uff08${sub.codecName}\uff09\uff0c\u8bf7\u6821\u5bf9\u540e\u518d\u542c\u5199\u3002 ${probe.compatibilityNote}`,
            );
            embeddedApplied = true;
          }
        } catch (err) {
          onNotice(
            `\u89c6\u9891\u5df2\u5199\u5165\u3002${playbackNote} \u5185\u5d4c\u5b57\u5e55\u63d0\u53d6\u5931\u8d25\uff0c\u5c06\u5c1d\u8bd5\u8bed\u97f3\u8bc6\u522b\uff1a${String(err)}`,
          );
        }
      }

      if (!embeddedApplied) {
        if (hasProtectedSubtitles(material)) {
          onNotice(
            `\u89c6\u9891\u5df2\u5199\u5165\uff08\u7247\u6bb5 ${formatTime(clipStart)}\u2013${formatTime(clipEnd)}\uff09\u3002${playbackNote} \u5df2\u6709\u7528\u6237\u6821\u5bf9/\u7ec3\u4e60\u8bb0\u5f55\uff0c\u672a\u8986\u76d6\u5b57\u5e55\u3002 ${probe.compatibilityNote}`,
          );
        } else if (wantOcr) {
          try {
            const ocrResult = await ocrBurnedInSubtitles({
              sourcePath: probe.path,
              materialId: material.id,
              clipStart,
              clipEnd,
            });
            const srtText = await loadSrtText(ocrResult.srtPath);
            const segments = toClipRelativeSegments(
              parseSrt(srtText, clipDuration),
              clipStart,
              clipDuration,
            );
            if (segments.length === 0) {
              throw new Error('\u672a\u5f97\u5230\u53ef\u7528 OCR \u5b57\u5e55\u53e5');
            }
            update((m) => applySubtitleTimeline(m, segments, 'ocr', 'unreviewed'));
            onNotice(
              `\u89c6\u9891\u5df2\u5199\u5165\uff08\u7247\u6bb5 ${formatTime(clipStart)}\u2013${formatTime(clipEnd)}\uff09\u3002${playbackNote} OCR\uff08${ocrResult.backend}\uff09\u8bc6\u522b ${segments.length} \u53e5\uff08${ocrResult.sampleCount} \u5e27\uff09\uff0c\u8bf7\u6821\u5bf9\u540e\u518d\u542c\u5199\u3002 ${probe.compatibilityNote}`,
            );
          } catch (err) {
            onNotice(
              `\u89c6\u9891\u5df2\u5199\u5165\u3002${playbackNote} OCR \u5931\u8d25\uff0c\u5c06\u5c1d\u8bd5\u8bed\u97f3\u8bc6\u522b\uff1a${String(err)}`,
            );
            onNeedAsr?.();
          }
        } else {
          onNotice(
            `\u89c6\u9891\u7d20\u6750\u5df2\u7ecf\u5199\u5165\uff08\u7247\u6bb5 ${formatTime(clipStart)}\u2013${formatTime(clipEnd)}\uff09\u3002${playbackNote} ${probe.compatibilityNote}`,
          );
          onNeedAsr?.();
        }
      }
      setProbe(null);
    } catch (err) {
      onError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function reassociate() {
    onError('');
    setBusy(true);
    try {
      const next = await pickAndProbeVideo();
      if (!material.video) {
        setProbe(next);
        setAudioStream(pickDefaultAudioStream(next));
        setSubtitleStream(pickDefaultSubtitleStream(next));
        setClipStart(0);
        setClipEnd(defaultClipEnd(next.duration));
        return;
      }
      update((m) =>
        m.video
          ? {
              ...m,
              video: {
                ...m.video,
                sourcePath: next.path,
                originalName: fileName(next.path) || m.video.originalName,
              },
            }
          : m,
      );
      onNotice(
        '\u5df2\u91cd\u65b0\u5173\u8054\u89c6\u9891\u6e90\u6587\u4ef6\u3002\u5982\u9700\u91cd\u65b0\u63d0\u53d6\u97f3\u8f68\uff0c\u8bf7\u518d\u8d70\u4e00\u904d\u5bfc\u5165\u3002',
      );
    } catch (err) {
      const message = String(err);
      if (!message.includes('\u53d6\u6d88')) onError(message);
    } finally {
      setBusy(false);
    }
  }

  if (!isDesktop()) {
    return (
      <article className="prep__section">
        <div className="prep__summary">
          <h2>{'\u89c6\u9891'}</h2>
          <p className="muted">
            {
              '\u89c6\u9891\u5bfc\u5165\u3001\u63a2\u6d4b\u4e0e\u62bd\u8f68\u4ec5\u684c\u9762\u7248\u652f\u6301\uff1b\u6d4f\u89c8\u5668\u8bf7\u7ee7\u7eed\u7528\u97f3\u9891\u6587\u4ef6\u3002'
            }
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className="prep__section prep__section--video">
      <div className="prep__summary">
        <h2>{'\u89c6\u9891'}</h2>
        <p className="muted">
          {material.video
            ? `${material.video.originalName} \u00b7 \u7247\u6bb5 ${formatTime(material.video.clipStart)}\u2013${formatTime(material.video.clipEnd)}`
            : '\u53ef\u9009\uff1a\u4ece\u672c\u5730\u89c6\u9891\u63d0\u53d6\u97f3\u8f68\uff0c\u6cbf\u7528\u73b0\u6709\u542c\u5199\u6d41\u7a0b'}
        </p>
        {status && !status.available && (
          <p className="banner banner--error" role="alert">
            {status.hint || '\u672a\u627e\u5230 ffmpeg/ffprobe'}
          </p>
        )}
        {status?.available && (
          <p className="muted prep__hint">ffmpeg\uff1a{status.source}</p>
        )}
        {ocr && (
          <p className="muted prep__hint">
            OCR\uff08{ocr.backend}\uff09\uff1a
            {ocr.available
              ? `\u53ef\u7528 \u00b7 ${ocr.preferredLanguage ?? (ocr.languages.join(', ') || '\u8bed\u8a00\u5305\u5df2\u88c5')}`
              : ''}
            {ocr.hint ? ` — ${ocr.hint}` : ''}
          </p>
        )}
      </div>
      <div className="prep__actions">
        <button disabled={busy || status?.available === false} onClick={() => void chooseVideo()}>
          {busy
            ? '\u5904\u7406\u4e2d\u2026'
            : material.video
              ? '\u91cd\u65b0\u5bfc\u5165\u89c6\u9891'
              : '\u5bfc\u5165\u89c6\u9891'}
        </button>
        {material.video && (
          <button className="quiet" disabled={busy} onClick={() => void reassociate()}>
            {'\u91cd\u65b0\u5173\u8054\u6e90\u6587\u4ef6'}
          </button>
        )}
      </div>

      {probe && (
        <div className="video-probe">
          <p className="muted">{probe.compatibilityNote}</p>
          <p className="muted">
            {'\u5bb9\u5668'} {probe.formatName || 'unknown'} \u00b7 {'\u603b\u65f6\u957f'}{' '}
            {formatTime(probe.duration)}
          </p>
          <label className="video-probe__field">
            {'\u97f3\u8f68'}
            <select
              value={audioStream ?? ''}
              onChange={(event) => setAudioStream(Number(event.target.value))}
            >
              {audioStreams.map((s) => (
                <option key={s.index} value={s.index}>
                  #{s.index} {s.codecName}
                  {s.channels ? ` \u00b7 ${s.channels}ch` : ''}
                  {s.language ? ` \u00b7 ${s.language}` : ''}
                </option>
              ))}
            </select>
          </label>
          {bitmapSubtitleCount > 0 && (
            <p className="muted prep__hint">
              {'\u8fd8\u6709 '}
              {bitmapSubtitleCount}
              {
                ' \u6761\u56fe\u5f62\u5b57\u5e55\u8f68\uff08PGS/DVD\uff09\uff1b\u6587\u672c\u8f68\u4ecd\u8d70 P3\uff0c\u56fe\u5f62/\u70e7\u5f55\u53ef\u7528\u4e0b\u65b9 OCR\u3002'
              }
            </p>
          )}
          {subtitleStreams.length > 0 && (
            <label className="video-probe__field">
              {
                '\u5b57\u5e55\u8f68\uff08\u6587\u672c\u8f68\u63d0\u53d6\uff1b\u65e0\u6587\u672c\u8f68\u65f6\u53ef\u6539\u7528 OCR\uff09'
              }
              <select
                value={subtitleStream ?? ''}
                onChange={(event) =>
                  setSubtitleStream(
                    event.target.value === '' ? undefined : Number(event.target.value),
                  )
                }
              >
                <option value="">{'\u4e0d\u9009'}</option>
                {subtitleStreams.map((s) => (
                  <option key={s.index} value={s.index}>
                    #{s.index} {s.codecName}
                    {s.language ? ` \u00b7 ${s.language}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="video-probe__field video-probe__check">
            <input
              type="checkbox"
              checked={wantOcr}
              disabled={ocr?.available === false}
              onChange={(event) => setWantOcr(event.target.checked)}
            />{' '}
            {
              'OCR \u70e7\u5f55/\u56fe\u5f62\u5b57\u5e55\uff08WinRT\uff1b\u65e0\u6587\u672c\u8f68\u4e14\u672a\u4fdd\u62a4\u65f6\u4f18\u5148\u4e8e ASR\uff09'
            }
          </label>
          <div className="row video-probe__range">
            <label>
              {'\u5f00\u59cb\uff08\u79d2\uff09'}
              <input
                type="number"
                min={0}
                max={probe.duration}
                step={0.1}
                value={clipStart}
                onChange={(event) => setClipStart(Number(event.target.value))}
              />
            </label>
            <label>
              {'\u7ed3\u675f\uff08\u79d2\uff09'}
              <input
                type="number"
                min={0}
                max={probe.duration}
                step={0.1}
                value={clipEnd}
                onChange={(event) => setClipEnd(Number(event.target.value))}
              />
            </label>
          </div>
          <button className="primary" disabled={busy} onClick={() => void applyVideo()}>
            {'\u63d0\u53d6\u97f3\u8f68\u5e76\u5199\u5165\u7d20\u6750'}
          </button>
        </div>
      )}
    </article>
  );
}
