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
import { ImportFailure } from './ImportFailure';
import {
  COPY,
  readyToDictate,
  toUserFacingError,
  type UserFacingError,
  audioTrackLabel,
  subtitleTrackLabel,
} from './import-messages';
import {
  droppedFilePath,
  fileFromLocalPath,
  isVideoFileName,
  isVideoMedia,
  listenDesktopMediaDrop,
  pickLocalMediaPath,
} from './local-media';
import { shouldAutoPrepareSubtitles } from './prepare-video';
import { useAutoVideoImport } from './useAutoVideoImport';
import { MotionPop } from '../../app/MotionPop';
import { useConsent } from '../../app/ConfirmPanel';

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
  const pendingPrepare = useRef(false);
  const handledNativeDrop = useRef(0);
  const importFromPathRef = useRef<(path: string) => Promise<void>>(async () => undefined);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedPanel>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(material.displayName);
  const [dragging, setDragging] = useState(false);
  const [audioChoice, setAudioChoice] = useState<number | undefined>();
  const [subtitleChoice, setSubtitleChoice] = useState<number | undefined>();
  const consent = useConsent();

  const recognition = useRecognition({
    onRecognized: (_id, segments) => {
      try {
        update((current) => applySubtitleTimeline(current, segments, 'asr', 'unreviewed'));
      } catch (err) {
        setError(toUserFacingError(err, COPY.recognitionFailed));
        setAdvanced('settings');
      }
    },
    onError: (message) => {
      setError(toUserFacingError(message, COPY.recognitionFailed));
      setAdvanced('settings');
    },
    onNotice,
    confirm: (message) => consent.confirm(message, '同意'),
  });

  const videoImport = useAutoVideoImport({
    material,
    update,
    onNotice,
    confirm: (message) => consent.confirm(message, '同意安装'),
    onNeedRecognition: () => {
      pendingPrepare.current = true;
    },
  });

  const hasAudio = material.duration > 0;
  const hasSubtitles = material.segments.some((segment) => segment.reference.trim());
  const sentenceCount = material.segments.filter((segment) => segment.reference.trim()).length;
  const processing = audioBusy || !!recognition.task || videoImport.busy || !!videoImport.progress;
  const kind = material.video ? 'video' : 'audio';
  const progressLabel =
    recognition.task?.label || videoImport.progress || (processing ? COPY.preparingMedia : '');
  const statusText = processing
    ? progressLabel || COPY.preparingSubtitles
    : !hasAudio
      ? ''
      : hasSubtitles
        ? readyToDictate(sentenceCount)
        : COPY.noSubtitlesYet;
  const shownError = error || videoImport.error;

  useEffect(() => {
    if (!pendingPrepare.current) return;
    if (
      !shouldAutoPrepareSubtitles({
        desktop: isDesktop(),
        hasAudio,
        hasSubtitles,
        processing: !!recognition.task,
      })
    )
      return;
    pendingPrepare.current = false;
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

  useEffect(() => {
    return listenDesktopMediaDrop({
      onHover: setDragging,
      onDrop: (path) => {
        handledNativeDrop.current = Date.now();
        void importFromPathRef.current(path);
      },
    });
  }, []);

  async function importAudioFile(file: File) {
    setError(null);
    setAudioBusy(true);
    try {
      const duration = await readAudioDuration(file);
      if (material.segments.some((segment) => segment.end > duration + 0.01))
        throw new Error('新音频短于现有字幕时间轴，请新建素材再导入。');
      update((current) => ({
        ...current,
        audio: file,
        duration,
        displayName: current.originalFileName
          ? current.displayName
          : file.name.replace(/\.[^.]+$/, ''),
        originalFileName: file.name,
        playbackPosition: 0,
      }));
      onNotice(`音频已导入：${file.name}`);
      if (isDesktop() && !material.segments.some((segment) => segment.reference.trim())) {
        pendingPrepare.current = true;
      }
    } catch (err) {
      setError(toUserFacingError(err, '这个音频没能导入。'));
    } finally {
      setAudioBusy(false);
    }
  }

  async function importPickedFile(file?: File) {
    if (!file) return;
    if (isVideoMedia(file)) {
      if (!isDesktop()) {
        setError({ message: COPY.videoNeedsDesktop });
        return;
      }
      const path = droppedFilePath(file);
      if (!path) {
        setError({ message: COPY.videoPathMissing });
        return;
      }
      await videoImport.startFromPath(path);
      return;
    }
    await importAudioFile(file);
  }

  async function importFromPath(path: string) {
    if (isVideoFileName(path)) {
      if (!isDesktop()) {
        setError({ message: COPY.videoNeedsDesktop });
        return;
      }
      await videoImport.startFromPath(path);
      return;
    }
    try {
      const file = await fileFromLocalPath(path, material.id);
      await importAudioFile(file);
    } catch (err) {
      setError(toUserFacingError(err, '这个文件没能导入。'));
    }
  }
  importFromPathRef.current = importFromPath;

  async function chooseFile() {
    if (isDesktop()) {
      try {
        const path = await pickLocalMediaPath();
        if (path) await importFromPath(path);
      } catch (err) {
        setError(toUserFacingError(err, '没能打开文件选择。'));
      }
      return;
    }
    audioInput.current?.click();
  }

  async function importSubtitles(file?: File) {
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const segments: SubtitleSegment[] = file.name.toLowerCase().endsWith('.vtt')
        ? parseVtt(text, material.duration)
        : parseSrt(text, material.duration);
      update((current) => applySubtitleTimeline(current, segments, 'external', 'reviewed'));
      const translated = segments.filter((segment) => segment.translation?.trim()).length;
      onNotice(
        `字幕已导入 ${segments.length} 句${translated ? `，其中 ${translated} 句带中文` : '（没有中文译文）'}。`,
      );
    } catch (err) {
      setError(toUserFacingError(err, '这个字幕文件没能导入。'));
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
      setError({ message: '素材名称不能为空。' });
      renameInput.current?.focus();
      return;
    }
    update((current) => ({ ...current, displayName: name }));
    setError(null);
    setRenaming(false);
  }

  function cancelRename() {
    setRenameValue(material.displayName);
    setError(null);
    setRenaming(false);
  }

  function openAdvanced(panel: Exclude<AdvancedPanel, 'more' | null>) {
    setAdvanced(panel);
    if (panel === 'settings') {
      void recognition
        .refreshModels()
        .catch((err) => setError(toUserFacingError(err, COPY.recognitionFailed)));
    }
  }

  async function clearAllCache() {
    const ok = await consent.confirm(
      '清理全部媒体缓存？需要画面时，可以在「更多」里重新准备这段视频。听写记录和字幕会保留。',
      '清理',
    );
    if (!ok) return;
    void clearAllMediaCache()
      .then(() => {
        update((current) => clearPlaybackPath(current));
        onNotice('已清理全部媒体缓存。');
        setAdvanced(null);
      })
      .catch((err) => setError(toUserFacingError(err, '清理缓存失败。')));
  }

  const moreItems = hasAudio
    ? [
        hasSubtitles ? (
          <button
            type="button"
            role="menuitem"
            key="proof"
            onClick={() => {
              setAdvanced(null);
              onSubtitles();
            }}
          >
            校对字幕
          </button>
        ) : null,
        <button
          type="button"
          role="menuitem"
          key="import-subs"
          onClick={() => {
            setAdvanced(null);
            subtitleInput.current?.click();
          }}
        >
          导入字幕文件
        </button>,
        <button
          type="button"
          role="menuitem"
          key="settings"
          onClick={() => openAdvanced('settings')}
        >
          识别设置
        </button>,
        isDesktop() ? (
          <button type="button" role="menuitem" key="video" onClick={() => openAdvanced('video')}>
            导入视频
          </button>
        ) : null,
        isDesktop() ? (
          <button type="button" role="menuitem" key="cache" onClick={() => openAdvanced('cache')}>
            缓存管理
          </button>
        ) : null,
        <button type="button" role="menuitem" key="rename" onClick={beginRename}>
          重命名
        </button>,
        <button
          type="button"
          role="menuitem"
          key="reading"
          onClick={() => {
            setAdvanced(null);
            onStudy('reading');
          }}
        >
          开始听读
        </button>,
      ].filter(Boolean)
    : [];

  const moreMenu =
    moreItems.length === 0 ? null : (
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
        <MotionPop
          open={advanced === 'more'}
          className="menu menu--right"
          role="menu"
          origin="top-right"
        >
          {moreItems}
        </MotionPop>
      </div>
    );

  const choice = videoImport.choice;

  return (
    <section className="prep import">
      <div className="import__body">
        <button type="button" className="quiet back import__back" onClick={onBack}>
          ← 返回
        </button>
        <h1 className="import__heading">导入素材</h1>

        {shownError && (
          <ImportFailure
            message={shownError.message}
            detail={shownError.detail}
            onClose={() => {
              setError(null);
              videoImport.clearError();
            }}
          />
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
              if (Date.now() - handledNativeDrop.current < 800) return;
              void importPickedFile(event.dataTransfer.files[0]);
            }}
          >
            <svg
              className="import__upload-icon"
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 16V3m0 0L7.7 7.3M12 3l4.3 4.3M4 15.5v4A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-4" />
            </svg>
            <div className="import__upload-title">{COPY.dropTitle}</div>
            <button
              type="button"
              className="secondary"
              disabled={processing}
              onClick={() => void chooseFile()}
            >
              {audioBusy ? COPY.readingFile : COPY.chooseFile}
            </button>
            <p className="muted import__hint">{COPY.dropHint}</p>
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
                disabled={processing}
                onClick={() => void chooseFile()}
              >
                更换
              </button>
            </div>

            {statusText && <p className="import__status">{statusText}</p>}

            {choice?.kind === 'audio' && (
              <div className="import__choice">
                <p>{COPY.multipleAudioTracks}</p>
                <label>
                  音轨
                  <select
                    value={audioChoice ?? choice.plan.audioStream ?? ''}
                    onChange={(event) => setAudioChoice(Number(event.target.value))}
                  >
                    {choice.plan.audioStreams.map((stream, index) => (
                      <option key={stream.index} value={stream.index}>
                        {audioTrackLabel(stream.language, index)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={videoImport.busy}
                  onClick={() =>
                    void videoImport.confirmAudioStream(
                      audioChoice ?? choice.plan.audioStream ?? choice.plan.audioStreams[0].index,
                    )
                  }
                >
                  {COPY.continueWithTrack}
                </button>
              </div>
            )}

            {choice?.kind === 'subtitle' && (
              <div className="import__choice">
                <p>{COPY.subtitlePickAfterFailure}</p>
                <label>
                  字幕
                  <select
                    value={subtitleChoice ?? choice.remaining[0]?.index ?? ''}
                    onChange={(event) => setSubtitleChoice(Number(event.target.value))}
                  >
                    {choice.remaining.map((stream, index) => (
                      <option key={stream.index} value={stream.index}>
                        {subtitleTrackLabel(stream.language, index)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="import__choice-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={videoImport.busy || !choice.remaining.length}
                    onClick={() =>
                      void videoImport.confirmSubtitleStream(
                        subtitleChoice ?? choice.remaining[0].index,
                      )
                    }
                  >
                    {COPY.continueWithTrack}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={videoImport.recognizeInstead}
                  >
                    {COPY.recognizeInstead}
                  </button>
                </div>
              </div>
            )}

            <div className="import__actions">
              {moreMenu}
              <div className="import__actions-right">
                <button
                  type="button"
                  className="primary"
                  disabled={!hasSubtitles || !hasAudio || processing}
                  title={!hasSubtitles ? COPY.startDictationNeedsText : undefined}
                  onClick={() => onStudy('dictation')}
                >
                  开始听写 →
                </button>
              </div>
            </div>
          </>
        )}

        {consent.panel}

        {(recognition.task || (videoImport.busy && videoImport.progress)) && (
          <p className="banner" role="status">
            {progressLabel}
            {recognition.task?.percent !== undefined && (
              <progress max={100} value={recognition.task.percent} />
            )}
            {recognition.task?.cancel && (
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
            <RecognitionSettings
              settings={recognition.settings}
              models={recognition.models}
              busy={!!recognition.task}
              onChange={recognition.changeSettings}
              onDownload={recognition.downloadSelected}
              onImport={recognition.importLocal}
              onClose={() => setAdvanced(null)}
            />
            <div className="import__settings-actions">
              <button
                type="button"
                className="primary"
                disabled={!isDesktop() || !!recognition.task || !hasAudio}
                title={isDesktop() ? undefined : '语音识别需要桌面版'}
                onClick={() => recognition.start(material)}
              >
                开始识别
              </button>
              {material.video?.sourcePath && (
                <button
                  type="button"
                  className="secondary"
                  disabled={processing}
                  onClick={() => void videoImport.tryPictureText()}
                >
                  {COPY.tryPictureText}
                </button>
              )}
            </div>
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
            <p className="muted">清理本机为播放和导入准备的临时文件。听写记录和字幕会保留。</p>
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
              onError={(message, detail) => setError(message ? { message, detail } : null)}
              onNeedAsr={() => {
                pendingPrepare.current = true;
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
            void importPickedFile(event.target.files?.[0]);
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
