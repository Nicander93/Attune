import { useRef, useState } from 'react';
import type { Material, SubtitleSegment } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { parseSrt, parseVtt } from '../../domain/subtitles';
import { replaceTimeline } from '../../domain/subtitle-edits';
import { isDesktop } from '../../desktop';
import { RecognitionSettings } from '../../RecognitionSettings';
import { useRecognition } from '../../useRecognition';

type Props = {
  material: Material;
  update: (transform: (material: Material) => Material) => void;
  onBack: () => void;
  onStudy: () => void;
  onNotice: (message: string) => void;
};

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

const dropHint = '点击选择，或把文件拖到这里';

export function MaterialPrepPage({ material, update, onBack, onStudy, onNotice }: Props) {
  const audioInput = useRef<HTMLInputElement>(null);
  const subtitleInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState<'audio' | 'subtitle' | null>(null);

  const recognition = useRecognition({
    onRecognized: (_id, segments) => {
      try {
        update((m) => replaceTimeline(m, segments));
        onNotice(`识别完成，共 ${segments.length} 句。原文在核对前保持隐藏。`);
      } catch (err) {
        setError(String(err));
      }
    },
    onError: setError,
    onNotice,
  });

  const hasSubtitles = material.segments.some((s) => s.reference.trim());

  async function importAudio(file?: File) {
    if (!file) return;
    setError('');
    setAudioBusy(true);
    try {
      const duration = await readAudioDuration(file);
      update((m) => ({
        ...m,
        audio: file,
        duration,
        // A material created empty takes the audio's name; a rename the user already
        // made is left alone.
        displayName: m.originalFileName ? m.displayName : file.name,
        originalFileName: file.name,
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
      update((m) => replaceTimeline(m, segments));
      const translated = segments.filter((s) => s.translation?.trim()).length;
      onNotice(
        `字幕已导入 ${segments.length} 句${translated ? `，其中 ${translated} 句带中文` : '（没有中文译文）'}。`,
      );
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <section className="prep">
      <header className="prep__head">
        <button className="quiet back" onClick={onBack}>
          ← 返回
        </button>
        <div>
          <p className="eyebrow">素材准备</p>
          <h1>{material.displayName}</h1>
        </div>
        <span className="muted">
          {formatTime(material.duration)} · {material.segments.length} 句
        </span>
      </header>

      {error && (
        <p className="banner banner--error" role="alert">
          {error}
          <button className="quiet" onClick={() => setError('')}>
            关闭
          </button>
        </p>
      )}

      <div className="prep__panes">
        {/* Audio and subtitles are chosen independently: a matching file name is not a
            reason to import anything the user did not pick. */}
        <article
          className={`dropzone${dragging === 'audio' ? ' is-dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging('audio');
          }}
          onDragLeave={() => setDragging(null)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(null);
            void importAudio(event.dataTransfer.files[0]);
          }}
        >
          <h2>
            音频 <span className="caption">必需</span>
          </h2>
          <p className="muted">{material.originalFileName || '还没有音频'}</p>
          <p className="muted">{formatTime(material.duration)}</p>
          <button
            className="primary"
            disabled={audioBusy}
            onClick={() => audioInput.current?.click()}
          >
            {audioBusy ? '正在读取…' : '选择音频'}
          </button>
          <p className="muted prep__hint">{dropHint} · MP3 / WAV / M4A</p>
          <input
            ref={audioInput}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
            hidden
            onChange={(event) => {
              void importAudio(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </article>

        <article
          className={`dropzone${dragging === 'subtitle' ? ' is-dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging('subtitle');
          }}
          onDragLeave={() => setDragging(null)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(null);
            void importSubtitles(event.dataTransfer.files[0]);
          }}
        >
          <h2>
            字幕 <span className="caption">可选</span>
          </h2>
          <p className="muted">
            {hasSubtitles ? `已导入 ${material.segments.length} 句` : '还没有字幕'}
          </p>
          <p className="muted">
            {hasSubtitles ? '可以随时换成别的字幕文件。' : '没有字幕也能听，但无法核对答案。'}
          </p>
          <div className="row">
            <button onClick={() => subtitleInput.current?.click()}>选择字幕文件</button>
            <button
              disabled={!isDesktop() || !!recognition.task}
              title={isDesktop() ? undefined : '语音识别需要桌面版'}
              onClick={() => {
                setSettingsOpen(true);
                void recognition.refreshModels();
              }}
            >
              本地识别原文
            </button>
          </div>
          <p className="muted prep__hint">
            {dropHint} · SRT / VTT，双语字幕会自动分成英文和中文两行
          </p>
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
        </article>
      </div>

      {recognition.task && (
        <p className="banner" role="status">
          {recognition.task.label}
          {recognition.task.percent !== undefined && (
            <progress max={100} value={recognition.task.percent} />
          )}
          {recognition.task.cancel && (
            <button className="quiet" onClick={recognition.task.cancel}>
              取消
            </button>
          )}
        </p>
      )}

      {settingsOpen && (
        <RecognitionSettings
          settings={recognition.settings}
          models={recognition.models}
          busy={!!recognition.task}
          onChange={recognition.changeSettings}
          onDownload={recognition.downloadSelected}
          onImport={recognition.importLocal}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <footer className="prep__foot">
        <p className="muted">
          {hasSubtitles ? '准备完成，可以开始听写。' : '没有字幕时无法核对答案，但可以先听音频。'}
        </p>
        <div className="row">
          <button onClick={onStudy} disabled={!material.duration}>
            开始听写
          </button>
          <button className="primary" onClick={onStudy} disabled={!material.duration}>
            开始听读
          </button>
        </div>
      </footer>
    </section>
  );
}
