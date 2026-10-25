import { useEffect, useMemo, useState } from 'react';
import type { Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { defaultClipEnd } from '../../domain/video';
import { isDesktop } from '../../desktop';
import {
  extractClipAudio,
  ffmpegStatus,
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
};

function fileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Desktop-only video import: probe → pick audio/range → extract Whisper-friendly audio
 * and a managed H.264 playback copy. Does not change study UX (P2).
 */
export function VideoImportPanel({ material, update, onNotice, onError }: Props) {
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
    () => probe?.streams.filter((s) => s.codecType === 'subtitle') ?? [],
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
      onError('这个视频没有可用音轨。');
      return;
    }
    if (clipEnd <= clipStart) {
      onError('时间范围无效。');
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
        playbackNote = playback.transcoded ? '已生成 H.264 播放副本。' : '已缓存可播放副本。';
      } catch (err) {
        playbackNote = `音轨已提取，但播放副本失败：${String(err)}`;
      }

      const originalName = fileName(probe.path);
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
      onNotice(
        `视频素材已就绪（片段 ${formatTime(clipStart)}–${formatTime(clipEnd)}）。${playbackNote} ${probe.compatibilityNote}`,
      );
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
