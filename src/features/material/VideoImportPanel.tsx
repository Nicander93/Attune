import { useEffect, useMemo, useState } from 'react';
import type { Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { clearPlaybackPath } from '../../domain/video';
import { isBitmapSubtitleCodec, isTextSubtitleCodec } from '../../domain/subtitle-source';
import { isDesktop } from '../../desktop';
import {
  authorizeMediaPath,
  cancelFfmpegDownload,
  clearMediaCache,
  ffmpegStatus,
  ocrStatus,
  pickAndProbeVideo,
  pickDefaultAudioStream,
  pickDefaultSubtitleStream,
  preparePlayback,
  type FfmpegStatus,
  type MediaProbe,
  type OcrStatus,
} from '../../media';
import { COPY, toUserFacingError } from './import-messages';
import { fileNameFromPath } from './local-media';
import {
  applyOcrSubtitles,
  applyVideoImport,
  ensureLocalMediaTools,
  fullClipEnd,
} from './prepare-video';
import { useConsent } from '../../app/ConfirmPanel';

type Props = {
  material: Material;
  update: (transform: (material: Material) => Material) => void;
  onNotice: (message: string) => void;
  onError: (message: string, detail?: string) => void;
  /** Called after video apply when no embedded text track was applied. */
  onNeedAsr?: () => void;
};

/**
 * Advanced video tools under「更多」: re-import, reassociate, rebuild playback, and
 * exception controls. The main import path does not open this panel.
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
  const [wantPictureText, setWantPictureText] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState('');
  const consent = useConsent();

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
    () => probe?.streams.filter((stream) => stream.codecType === 'audio') ?? [],
    [probe],
  );
  const subtitleStreams = useMemo(
    () =>
      probe?.streams.filter(
        (stream) => stream.codecType === 'subtitle' && isTextSubtitleCodec(stream.codecName),
      ) ?? [],
    [probe],
  );
  const bitmapSubtitleCount = useMemo(
    () =>
      probe?.streams.filter(
        (stream) => stream.codecType === 'subtitle' && isBitmapSubtitleCodec(stream.codecName),
      ).length ?? 0,
    [probe],
  );

  async function installTools() {
    onError('');
    const result = await ensureLocalMediaTools({
      onProgress: (label) => {
        setBusy(true);
        setDownloadLabel(label);
      },
      confirm: (message) => consent.confirm(message, '同意安装'),
    });
    if (result.status === 'cancelled') {
      onNotice(COPY.toolsCancelled);
    } else if (result.status === 'failed') {
      onError(result.message, result.detail);
    } else {
      setStatus(result.toolsStatus);
      onNotice('本地工具已安装，可以继续处理视频。');
    }
    setDownloadLabel('');
    setBusy(false);
  }

  async function rebuildPlayback() {
    if (!material.video?.sourcePath) {
      onError('找不到原来的视频文件，请先重新选择。');
      return;
    }
    onError('');
    setBusy(true);
    try {
      const sourcePath = await authorizeMediaPath(material.video.sourcePath);
      const playback = await preparePlayback({
        sourcePath,
        materialId: material.id,
      });
      update((current) =>
        current.video
          ? { ...current, video: { ...current.video, playbackPath: playback.playbackPath } }
          : current,
      );
      onNotice(playback.transcoded ? '已重新准备可播放的画面。' : '已重新准备可播放的画面。');
    } catch (err) {
      const failed = toUserFacingError(err, '没能重新准备画面。若文件已移动，请先重新选择。');
      onError(failed.message, failed.detail);
    } finally {
      setBusy(false);
    }
  }

  async function clearThisCache() {
    const ok = await consent.confirm(
      '清理本条素材的临时文件？音频和字幕会保留。需要画面时可以再准备一次。',
      '清理',
    );
    if (!ok) return;
    onError('');
    setBusy(true);
    try {
      await clearMediaCache(material.id);
      update((current) => clearPlaybackPath(current));
      onNotice('已清理本条素材的临时文件。需要画面时请再准备一次。');
    } catch (err) {
      const failed = toUserFacingError(err, '清理缓存失败。');
      onError(failed.message, failed.detail);
    } finally {
      setBusy(false);
    }
  }

  async function chooseVideo() {
    onError('');
    setBusy(true);
    try {
      const next = await pickAndProbeVideo();
      setProbe(next);
      setAudioStream(pickDefaultAudioStream(next));
      setSubtitleStream(pickDefaultSubtitleStream(next));
      setClipStart(0);
      setClipEnd(fullClipEnd(next.duration));
      setWantPictureText(false);
      onNotice(`已选中：${fileNameFromPath(next.path)}`);
    } catch (err) {
      const message = String(err);
      if (!message.includes('取消')) {
        const failed = toUserFacingError(err, '没能打开这个视频。');
        onError(failed.message, failed.detail);
      }
    } finally {
      setBusy(false);
    }
  }

  async function applyVideo() {
    if (!probe) return;
    if (audioStream === undefined) {
      onError(COPY.noAudioTrack);
      return;
    }
    if (clipEnd <= clipStart) {
      onError('时间范围无效。');
      return;
    }
    onError('');
    setBusy(true);
    try {
      const result = await applyVideoImport({
        probe,
        material,
        update,
        audioStream,
        subtitleStream,
        clipStart,
        clipEnd,
        onProgress: () => undefined,
      });
      if (result.status === 'ready') {
        onNotice(`已准备好 ${result.segmentCount} 句，可以开始听写`);
        setProbe(null);
        return;
      }
      if (result.status === 'protected') {
        onNotice('视频已写入。已有听写记录，未覆盖现有字幕。');
        setProbe(null);
        return;
      }
      if (result.status === 'failed') {
        onError(result.message, result.detail);
        return;
      }
      if (wantPictureText) {
        const ocrResult = await applyOcrSubtitles({
          sourcePath: probe.path,
          material,
          update,
          clipStart,
          clipEnd,
        });
        if (ocrResult.status === 'ready') {
          onNotice(`已准备好 ${ocrResult.segmentCount} 句，可以开始听写`);
          setProbe(null);
          return;
        }
        onNotice(ocrResult.message);
        onNeedAsr?.();
        setProbe(null);
        return;
      }
      onNeedAsr?.();
      setProbe(null);
    } catch (err) {
      const failed = toUserFacingError(err, COPY.videoProcessFailed);
      onError(failed.message, failed.detail);
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
        setClipEnd(fullClipEnd(next.duration));
        return;
      }
      update((current) =>
        current.video
          ? {
              ...current,
              video: {
                ...current.video,
                sourcePath: next.path,
                originalName: fileNameFromPath(next.path) || current.video.originalName,
              },
            }
          : current,
      );
      onNotice('已重新关联视频文件。如需重新提取声音，请再导入一次。');
    } catch (err) {
      const message = String(err);
      if (!message.includes('取消')) {
        const failed = toUserFacingError(err, '没能重新关联这个文件。');
        onError(failed.message, failed.detail);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!isDesktop()) {
    return (
      <article className="prep__section">
        <div className="prep__summary">
          <h2>视频</h2>
          <p className="muted">{COPY.videoNeedsDesktop}</p>
        </div>
      </article>
    );
  }

  const toolsMissing = status && !status.available;
  const toolsDetail = toolsMissing
    ? toUserFacingError(status.hint, '这台电脑还没有安装处理视频所需的本地工具。')
    : null;

  return (
    <article className="prep__section prep__section--video">
      <div className="prep__summary">
        <h2>视频</h2>
        <p className="muted">
          {material.video
            ? `${material.video.originalName} · 片段 ${formatTime(material.video.clipStart)}–${formatTime(material.video.clipEnd)}`
            : '可从本机视频提取声音，沿用现有听写流程'}
        </p>
        {toolsMissing && toolsDetail && (
          <div className="banner banner--error import__failure" role="alert">
            <div className="import__failure-body">
              <p>{toolsDetail.message}</p>
              {toolsDetail.detail ? (
                <details>
                  <summary>详情</summary>
                  <pre>{toolsDetail.detail}</pre>
                </details>
              ) : status.hint && status.hint !== toolsDetail.message ? (
                <details>
                  <summary>详情</summary>
                  <pre>{status.hint}</pre>
                </details>
              ) : null}
            </div>
          </div>
        )}
        {downloadLabel && (
          <p className="banner" role="status">
            {downloadLabel}{' '}
            <button className="quiet" type="button" onClick={() => void cancelFfmpegDownload()}>
              取消
            </button>
          </p>
        )}
        {material.video && !material.video.playbackPath && (
          <p className="banner banner--error" role="alert">
            这段视频的画面暂时无法播放。可以「重新准备画面」；若文件已移动，请先重新选择。
          </p>
        )}
      </div>
      {consent.panel}
      <div className="prep__actions">
        {toolsMissing && (
          <button className="primary" disabled={busy} onClick={() => void installTools()}>
            {downloadLabel ? '安装中…' : '安装本地工具'}
          </button>
        )}
        <button disabled={busy || status?.available === false} onClick={() => void chooseVideo()}>
          {busy && !downloadLabel ? '处理中…' : material.video ? '重新导入视频' : '导入视频'}
        </button>
        {material.video && (
          <button className="quiet" disabled={busy} onClick={() => void reassociate()}>
            重新选择源文件
          </button>
        )}
        {material.video && (
          <button
            className="quiet"
            disabled={busy || status?.available === false}
            onClick={() => void rebuildPlayback()}
          >
            重新准备画面
          </button>
        )}
        {material.video && (
          <button className="quiet" disabled={busy} onClick={() => void clearThisCache()}>
            清理本条素材缓存
          </button>
        )}
      </div>

      {probe && (
        <div className="video-probe">
          {probe.compatibilityNote ? (
            <details className="import__probe-detail">
              <summary>详情</summary>
              <p className="muted">{probe.compatibilityNote}</p>
              <p className="muted">
                容器 {probe.formatName || 'unknown'} · 总时长 {formatTime(probe.duration)}
              </p>
            </details>
          ) : null}
          <label className="video-probe__field">
            音轨
            <select
              value={audioStream ?? ''}
              onChange={(event) => setAudioStream(Number(event.target.value))}
            >
              {audioStreams.map((stream, index) => (
                <option key={stream.index} value={stream.index}>
                  第 {index + 1} 条{stream.language ? ` · ${stream.language}` : ''}
                </option>
              ))}
            </select>
          </label>
          {bitmapSubtitleCount > 0 && (
            <p className="muted prep__hint">
              还有 {bitmapSubtitleCount} 条画面字幕；文本字幕会优先使用，画面识别放在下方备选。
            </p>
          )}
          {subtitleStreams.length > 0 && (
            <label className="video-probe__field">
              字幕
              <select
                value={subtitleStream ?? ''}
                onChange={(event) =>
                  setSubtitleStream(
                    event.target.value === '' ? undefined : Number(event.target.value),
                  )
                }
              >
                <option value="">不选</option>
                {subtitleStreams.map((stream, index) => (
                  <option key={stream.index} value={stream.index}>
                    字幕 {index + 1}
                    {stream.language ? ` · ${stream.language}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="video-probe__field video-probe__check">
            <input
              type="checkbox"
              checked={wantPictureText}
              disabled={ocr?.available === false}
              onChange={(event) => setWantPictureText(event.target.checked)}
            />{' '}
            {COPY.tryPictureText}
          </label>
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
            写入素材
          </button>
        </div>
      )}
    </article>
  );
}
