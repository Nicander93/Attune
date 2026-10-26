import { useEffect, useMemo, useState } from 'react';
import type { Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { defaultClipEnd } from '../../domain/video';
import { parseSrt } from '../../domain/subtitles';
import { applySubtitleTimeline, hasProtectedSubtitles } from '../../domain/subtitle-edits';
import { isTextSubtitleCodec, toClipRelativeSegments } from '../../domain/subtitle-source';
import { isDesktop } from '../../desktop';
import {
  extractClipAudio,
  extractEmbeddedSubtitles,
  ffmpegStatus,
  loadSrtText,
  pickAndProbeVideo,
  pickDefaultAudioStream,
  pickDefaultSubtitleStream,
  preparePlayback,
  type FfmpegStatus,
  type MediaProbe,
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
 */
export function VideoImportPanel({ material, update, onNotice, onError, onNeedAsr }: Props) {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [audioStream, setAudioStream] = useState<number | undefined>();
  const [subtitleStream, setSubtitleStream] = useState<number | undefined>();
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void ffmpegStatus()
      .then(setStatus)
      .catch((err) => setStatus({ available: false, source: 'error', hint: String(err) }));
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
        (s) => s.codecType === 'subtitle' && !isTextSubtitleCodec(s.codecName),
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
      onNotice(`已探测：${fileName(next.path)}`);
    } catch (err) {
      const message = String(err);
      if (!message.includes('取消')) onError(message);
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
        if (!hasProtectedSubtitles(material)) {
          onNotice(
            `\u89c6\u9891\u7d20\u6750\u5df2\u7ecf\u5199\u5165\uff08\u7247\u6bb5 ${formatTime(clipStart)}\u2013${formatTime(clipEnd)}\uff09\u3002${playbackNote} ${probe.compatibilityNote}`,
          );
          onNeedAsr?.();
        } else {
          onNotice(
            `\u89c6\u9891\u5df2\u5199\u5165\uff08\u7247\u6bb5 ${formatTime(clipStart)}\u2013${formatTime(clipEnd)}\uff09\u3002${playbackNote} \u5df2\u6709\u7528\u6237\u6821\u5bf9/\u7ec3\u4e60\u8bb0\u5f55\uff0c\u672a\u8986\u76d6\u5b57\u5e55\u3002 ${probe.compatibilityNote}`,
          );
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
      onNotice('已重新关联视频源文件。如需重新提取音轨，请再走一遍导入。');
    } catch (err) {
      const message = String(err);
      if (!message.includes('取消')) onError(message);
    } finally {
      setBusy(false);
    }
  }

  if (!isDesktop()) {
    return (
      <article className="prep__section">
        <div className="prep__summary">
          <h2>视频</h2>
          <p className="muted">视频导入、探测与抽轨仅桌面版支持；浏览器请继续用音频文件。</p>
        </div>
      </article>
    );
  }

  return (
    <article className="prep__section prep__section--video">
      <div className="prep__summary">
        <h2>视频</h2>
        <p className="muted">
          {material.video
            ? `${material.video.originalName} · 片段 ${formatTime(material.video.clipStart)}–${formatTime(material.video.clipEnd)}`
            : '可选：从本地视频提取音轨，沿用现有听写流程'}
        </p>
        {status && !status.available && (
          <p className="banner banner--error" role="alert">
            {status.hint || '未找到 ffmpeg/ffprobe'}
          </p>
        )}
        {status?.available && <p className="muted prep__hint">ffmpeg：{status.source}</p>}
      </div>
      <div className="prep__actions">
        <button disabled={busy || status?.available === false} onClick={() => void chooseVideo()}>
          {busy ? '处理中…' : material.video ? '重新导入视频' : '导入视频'}
        </button>
        {material.video && (
          <button className="quiet" disabled={busy} onClick={() => void reassociate()}>
            重新关联源文件
          </button>
        )}
      </div>

      {probe && (
        <div className="video-probe">
          <p className="muted">{probe.compatibilityNote}</p>
          <p className="muted">
            容器 {probe.formatName || 'unknown'} · 总时长 {formatTime(probe.duration)}
          </p>
          <label className="video-probe__field">
            音轨
            <select
              value={audioStream ?? ''}
              onChange={(event) => setAudioStream(Number(event.target.value))}
            >
              {audioStreams.map((s) => (
                <option key={s.index} value={s.index}>
                  #{s.index} {s.codecName}
                  {s.channels ? ` · ${s.channels}ch` : ''}
                  {s.language ? ` · ${s.language}` : ''}
                </option>
              ))}
            </select>
          </label>
          {bitmapSubtitleCount > 0 && (
            <p className="muted prep__hint">
              {'\u8fd8\u6709 '}
              {bitmapSubtitleCount}
              {' \u6761\u56fe\u5f62\u5b57\u5e55\u8f68\uff08PGS/DVD\uff09\uff0cP3 \u4e0d\u63d0\u53d6\uff0cOCR \u7559\u5f85 P4\u3002'}
            </p>
          )}
          {subtitleStreams.length > 0 && (
            <label className="video-probe__field">
              字幕轨（P1 仅记录选择；提取在 P3）
              <select
                value={subtitleStream ?? ''}
                onChange={(event) =>
                  setSubtitleStream(
                    event.target.value === '' ? undefined : Number(event.target.value),
                  )
                }
              >
                <option value="">不选</option>
                {subtitleStreams.map((s) => (
                  <option key={s.index} value={s.index}>
                    #{s.index} {s.codecName}
                    {s.language ? ` · ${s.language}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="row video-probe__range">
            <label>
              开始（秒）
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
              结束（秒）
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
            提取音轨并写入素材
          </button>
        </div>
      )}
    </article>
  );
}
