import { useEffect, useRef, useState } from 'react';
import type { Material, SubtitleSegment } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { parseSrt, parseVtt } from '../../domain/subtitles';
import { applySubtitleTimeline } from '../../domain/subtitle-edits';
import { isDesktop } from '../../desktop';
import { RecognitionSettings } from '../../RecognitionSettings';
import { useRecognition } from '../../useRecognition';
import { clearPlaybackPath } from '../../domain/video';
import { clearAllMediaCache } from '../../media';
import { VideoImportPanel } from './VideoImportPanel';

type Props = {
  material: Material;
  update: (transform: (material: Material) => Material) => void;
  onBack: () => void;
  onStudy: (view: 'dictation' | 'reading') => void;
  onSubtitles: () => void;
  onNotice: (message: string) => void;
};

type AdvancedPanel = 'more' | 'settings' | 'cache' | 'video' | null;

/** Reads the real duration so a material is never created without knowing its length. */
async function readAudioDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  const audio = new Audio(url);
  try {
    return await new Promise<number>((resolve, reject) => {
      audio.onloadedmetadata = () =>
        Number.isFinite(audio.duration) && audio.duration > 0
          ? resolve(audio.duration)
          : reject(new Error('无法读取音频时长。'));
      audio.onerror = () => reject(new Error('这个音频格式无法播放，请换成 MP3 或 WAV。'));
    });
  } finally {
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
}

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  return /\.(mp4|mkv|mov|webm|avi|m4v)$/i.test(file.name);
}

/**
 * S2 import converge (V2): drag/choose → ready → 校对字幕 / 开始听写.
 * Advanced items (字幕文件、识别、缓存、视频/ffmpeg) live under「更多」, not parallel prep panes.
 */
export function MaterialPrepPage({
  material,
  update,
  onBack,
  onStudy,
  onSubtitles,
  onNotice,
}: Props) {
  const audioInput = useRef<HTMLInputElement>(null);
  const subtitleInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const moreWrap = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedPanel>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(material.displayName);
  const [dragging, setDragging] = useState(false);
  const pendingAsr = useRef(false);

  const recognition = useRecognition({
    onRecognized: (_id, segments) => {
      try {
        update((m) => applySubtitleTimeline(m, segments, 'asr', 'unreviewed'));
        onNotice(
          `识别完成，共 ${segments.length} 句。ASR 结果仅供参考，请校对后再开始听写。`,
        );
      } catch (err) {
        setError(String(err));
      }
    },
    onError: setError,
    onNotice,
  });

  const hasAudio = material.duration > 0;
  const hasSubtitles = material.segments.some((s) => s.reference.trim());
  const needsReview =
    !hasSubtitles || material.subtitleReviewStatus === 'unreviewed';
  const processing = audioBusy || !!recognition.task;
  const kind = material.video ? 'video' : 'audio';
  const statusText = processing
    ? recognition.task?.label || '正在准备…'
    : !hasAudio
      ? ''
      : needsReview
        ? '字幕待校对'
        : '已就绪';

  useEffect(() => {
    if (!pendingAsr.current) return;
    if (!hasAudio || hasSubtitles || recognition.task || !isDesktop()) return;
    pendingAsr.current = false;
    recognition.start(material);
  }, [material, hasAudio, hasSubtitles, recognition]);

  useEffect(() => {
    if (advanced !== 'more') return;
    function onDocClick(event: MouseEvent) {
      if (!moreWrap.current?.contains(event.target as Node)) setAdvanced(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setAdvanced(null);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [advanced]);

  async function importAudio(file?: File) {
    if (!file) return;
    if (isVideoFile(file)) {
      if (!isDesktop()) {
        setError('视频导入需要桌面版；请用「更多 → 导入视频」或改用音频文件。');
        return;
      }
      setAdvanced('video');
      onNotice('请在下方视频面板选择本地视频（桌面版走 ffmpeg 探测与抽轨）。');
      return;
    }
    setError('');
    setAudioBusy(true);
    try {
      const duration = await readAudioDuration(file);
      if (material.segments.some((s) => s.end > duration + 0.01))
        throw new Error('新音频短于现有字幕时间轴，请新建素材再导入。');
      update((m) => ({
        ...m,
        audio: file,
        duration,
        // A material created empty takes the audio's name; a rename the user already
        // made is left alone.
        displayName: m.originalFileName ? m.displayName : file.name.replace(/\.[^.]+$/, ''),
        originalFileName: file.name,
        playbackPosition: 0,
      }));
      onNotice(`音频已导入：${file.name}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setAudioBusy(false);
    }
  }

  async function importSubtitles(file?: File) {
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const segments: SubtitleSegment[] = file.name.toLowerCase().endsWith('.vtt')
        ? parseVtt(text, material.duration)
        : parseSrt(text, material.duration);
      update((m) => applySubtitleTimeline(m, segments, 'external', 'reviewed'));
      const translated = segments.filter((s) => s.translation?.trim()).length;
      onNotice(
        `字幕已导入 ${segments.length} 句${translated ? `，其中 ${translated} 句带中文` : '（没有中文译文）'}。`,
      );
    } catch (err) {
      setError(String(err));
    }
  }

  function beginRename() {
    setRenameValue(material.displayName);
    setRenaming(true);
    setAdvanced(null);
    requestAnimationFrame(() => {
      renameInput.current?.focus();
      renameInput.current?.select();
    });
  }

  function saveRename() {
    const name = renameValue.trim();
    if (!name) {
      setError('素材名称不能为空。');
      renameInput.current?.focus();
      return;
    }
    update((m) => ({ ...m, displayName: name }));
    setError('');
    setRenaming(false);
  }

  function cancelRename() {
    setRenameValue(material.displayName);
    setError('');
    setRenaming(false);
  }

  function openAdvanced(panel: Exclude<AdvancedPanel, 'more' | null>) {
    setAdvanced(panel);
    if (panel === 'settings') {
      void recognition.refreshModels().catch((err) => setError(String(err)));
    }
  }

  function clearAllCache() {
    if (!window.confirm('清理全部媒体缓存？视频素材需要时请在「更多 → 导入视频」中重建播放副本。'))
      return;
    void clearAllMediaCache()
      .then(() => {
        update((m) => clearPlaybackPath(m));
        onNotice('已清理全部媒体缓存。');
        setAdvanced(null);
      })
      .catch((err) => setError(String(err)));
  }

  const moreMenu = (
    <div className="menu-wrap" ref={moreWrap}>
      <button
        type="button"
        className="quiet"
        aria-expanded={advanced === 'more'}
        aria-haspopup="menu"
        onClick={() => setAdvanced(advanced === 'more' ? null : 'more')}
      >
        更多 ···
      </button>
      {advanced === 'more' && (
        <div className="menu menu--right" role="menu">
          {hasSubtitles && (
            <button type="button" role="menuitem" onClick={() => { setAdvanced(null); onSubtitles(); }}>
              校对字幕
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAdvanced(null);
              subtitleInput.current?.click();
            }}
          >
            导入字幕文件
          </button>
          <button type="button" role="menuitem" onClick={() => openAdvanced('settings')}>
            识别设置
          </button>
          {isDesktop() && (
            <button type="button" role="menuitem" onClick={() => openAdvanced('video')}>
              导入视频
            </button>
          )}
          {isDesktop() && (
            <button type="button" role="menuitem" onClick={() => openAdvanced('cache')}>
              缓存管理
            </button>
          )}
          {hasAudio && (
            <button type="button" role="menuitem" onClick={beginRename}>
              重命名
            </button>
          )}
          {hasAudio && (
            <button
              type="button"
              role="menuitem"
              disabled={!hasAudio}
              onClick={() => {
                setAdvanced(null);
                onStudy('reading');
              }}
            >
              开始听读
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className="prep import">
      <div className="import__body">
        <button type="button" className="quiet back import__back" onClick={onBack}>
          ← 返回
        </button>
        <h1 className="import__heading">导入素材</h1>

        {error && (
          <p className="banner banner--error" role="alert">
            {error}
            <button type="button" className="quiet" onClick={() => setError('')}>
              关闭
            </button>
          </p>
        )}

        {!hasAudio && (
          <div
            className={`dropzone import__drop${dragging ? ' is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void importAudio(event.dataTransfer.files[0]);
            }}
          >
            <div className="import__upload-title">音频或视频</div>
            <button
              type="button"
              className="secondary"
              disabled={audioBusy}
              onClick={() => audioInput.current?.click()}
            >
              {audioBusy ? '正在读取…' : '选择文件'}
            </button>
            <p className="muted import__hint">或拖入文件 · MP3 / WAV / M4A；视频请用「更多 → 导入视频」</p>
            <div className="import__empty-more">{moreMenu}</div>
          </div>
        )}

        {hasAudio && (
          <>
            <div className="import__file">
              <span className="import__file-icon" aria-hidden="true">
                {kind === 'video' ? '▣' : '♫'}
              </span>
              <div className="import__file-info">
                {renaming ? (
                  <div className="prep__rename-form">
                    <input
                      ref={renameInput}
                      className="prep__rename"
                      aria-label="素材名称"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                        if (event.key === 'Enter') saveRename();
                        if (event.key === 'Escape') cancelRename();
                      }}
                    />
                    <button type="button" onClick={saveRename}>
                      保存
                    </button>
                    <button type="button" className="quiet" onClick={cancelRename}>
                      取消
                    </button>
                  </div>
                ) : (
                  <strong>{material.displayName}</strong>
                )}
                <span>
                  {formatTime(material.duration)} · {kind === 'video' ? '视频' : '音频'}
                  {material.originalFileName ? ` · ${material.originalFileName}` : ''}
                </span>
              </div>
              <button
                type="button"
                className="quiet"
                disabled={audioBusy}
                onClick={() => audioInput.current?.click()}
              >
                更换
              </button>
            </div>

            {statusText && (
              <p className={`import__status${needsReview && !processing ? ' import__status--warn' : ''}`}>
                {statusText}
              </p>
            )}

            {material.subtitleOrigin &&
              material.subtitleReviewStatus === 'unreviewed' &&
              hasSubtitles && (
                <p className="banner" role="status">
                  {material.subtitleOrigin === 'asr'
                    ? '当前字幕来自语音识别（ASR），尚未校对，不应作为最终答案。'
                    : material.subtitleOrigin === 'embedded'
                      ? '当前字幕来自内嵌轨，尚未校对。'
                      : material.subtitleOrigin === 'ocr'
                        ? '当前字幕来自 OCR（烧录/图形），尚未校对，不应作为最终答案。'
                        : '字幕尚未校对。'}
                  <button type="button" onClick={onSubtitles}>
                    去校对
                  </button>
                </p>
              )}

            <div className="import__actions">
              {moreMenu}
              <div className="import__actions-right">
                {needsReview && hasSubtitles && !processing && (
                  <button type="button" className="secondary" onClick={onSubtitles}>
                    校对字幕
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={!hasSubtitles || !hasAudio || processing}
                  title={!hasSubtitles ? '请先导入字幕或完成识别' : undefined}
                  onClick={() => onStudy('dictation')}
                >
                  开始听写 →
                </button>
              </div>
            </div>
          </>
        )}

        {recognition.task && (
          <p className="banner" role="status">
            {recognition.task.label}
            {recognition.task.percent !== undefined && (
              <progress max={100} value={recognition.task.percent} />
            )}
            {recognition.task.cancel && (
              <button type="button" className="quiet" onClick={recognition.task.cancel}>
                取消
              </button>
            )}
          </p>
        )}

        {advanced === 'settings' && (
          <section className="import__advanced" aria-label="识别设置">
            <div className="import__advanced-head">
              <h2>识别设置</h2>
              <button type="button" className="quiet" onClick={() => setAdvanced(null)}>
                收起
              </button>
            </div>
            <p className="muted">仅在默认识别失败时才需要调整音轨、OCR 或语音识别选项。</p>
            <RecognitionSettings
              settings={recognition.settings}
              models={recognition.models}
              busy={!!recognition.task}
              onChange={recognition.changeSettings}
              onDownload={recognition.downloadSelected}
              onImport={recognition.importLocal}
              onClose={() => setAdvanced(null)}
            />
            <button
              type="button"
              className="primary"
              disabled={!isDesktop() || !!recognition.task || !hasAudio}
              title={isDesktop() ? undefined : '语音识别需要桌面版'}
              onClick={() => recognition.start(material)}
            >
              开始识别
            </button>
          </section>
        )}

        {advanced === 'cache' && isDesktop() && (
          <section className="import__advanced" aria-label="缓存管理">
            <div className="import__advanced-head">
              <h2>缓存管理</h2>
              <button type="button" className="quiet" onClick={() => setAdvanced(null)}>
                收起
              </button>
            </div>
            <p className="muted">
              清理应用数据目录下 media/ 中的播放副本与抽轨临时文件。IndexedDB 中的音频 Blob、字幕与练习记录不受影响。
            </p>
            <button type="button" className="quiet" onClick={clearAllCache}>
              清理全部媒体缓存
            </button>
          </section>
        )}

        {advanced === 'video' && (
          <section className="import__advanced import__advanced--video" aria-label="导入视频">
            <div className="import__advanced-head">
              <h2>导入视频</h2>
              <button type="button" className="quiet" onClick={() => setAdvanced(null)}>
                收起
              </button>
            </div>
            <VideoImportPanel
              material={material}
              update={update}
              onNotice={onNotice}
              onError={setError}
              onNeedAsr={() => {
                pendingAsr.current = true;
              }}
            />
          </section>
        )}

        <input
          ref={audioInput}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.mkv,.mov,.webm"
          hidden
          onChange={(event) => {
            void importAudio(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <input
          ref={subtitleInput}
          type="file"
          accept=".srt,.vtt"
          hidden
          onChange={(event) => {
            void importSubtitles(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
    </section>
  );
}
