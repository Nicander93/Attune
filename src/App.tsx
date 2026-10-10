import { useEffect, useRef, useState } from 'react';
import {
  checkSegment,
  compareWords,
  draftText,
  draftWords,
  formatTime,
  hasDictation,
  newAttempt,
  parseSrt,
  toSrt,
  uid,
  type Attempt,
  type Material,
  type Segment,
  type WordTiming,
} from './domain';
import { loadMaterials, saveMaterial } from './storage';
import { SentenceEditor } from './SentenceEditor';
import { IntensiveListening } from './IntensiveListening';
import { keySound } from './sound';
import { isDesktop, saveTextFile } from './desktop';
import { RecognitionSettings } from './RecognitionSettings';
import { useRecognition } from './useRecognition';

const DICTATION_EXISTS = '该材料已有听写记录。请重新导入音频后再替换片段，以免改变旧记录的片段。';
const DESKTOP_ONLY = '识别需要在 Attune 桌面版中使用';

async function audioDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file),
    audio = new Audio(url);
  try {
    return await new Promise((resolve, reject) => {
      audio.onloadedmetadata = () =>
        Number.isFinite(audio.duration) && audio.duration > 0
          ? resolve(audio.duration)
          : reject(new Error('无法读取音频时长。'));
      audio.onerror = () => reject(new Error('音频格式无法播放，请尝试 MP3 或 WAV。'));
    });
  } finally {
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
}
export default function App() {
  const [materials, setMaterials] = useState<Material[]>([]),
    [selected, setSelected] = useState(''),
    [ready, setReady] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [saveStatus, setSaveStatus] = useState(''),
    [history, setHistory] = useState(false);
  const [mode, setMode] = useState<'segment' | 'full'>('segment'),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [speed, setSpeed] = useState(1),
    [loop, setLoop] = useState(false),
    [sound, setSound] = useState(false),
    [recognitionSettings, setRecognitionSettings] = useState(false);
  const [sentenceSidebar, setSentenceSidebar] = useState(true),
    [view, setView] = useState<'dictation' | 'readalong'>('dictation'),
    [revealReference, setRevealReference] = useState(() => {
      try {
        return localStorage.getItem('attune-reveal-reference') === '1';
      } catch {
        return false;
      }
    });
  const [editing, setEditing] = useState(false),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(0),
    [reference, setReference] = useState('');
  const audio = useRef<HTMLAudioElement>(null),
    audioInput = useRef<HTMLInputElement>(null),
    subtitleInput = useRef<HTMLInputElement>(null);
  const sentenceField = useRef<HTMLTextAreaElement>(null);
  const intensivePrev = useRef<{ speed: number; loop: boolean; mode: 'segment' | 'full' } | null>(
    null,
  );
  const lastField = useRef<{ node: HTMLTextAreaElement; start: number; end: number } | undefined>(
    undefined,
  );
  const all = useRef<Material[]>([]),
    pending = useRef(new Map<string, Material>()),
    saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    queue = useRef(Promise.resolve());
  const material = materials.find((m) => m.id === selected),
    attempt = material?.attempts.find((a) => a.id === material.attemptId),
    segment = material?.segments.find((s) => s.id === material.segmentId);
  const materialRef = useRef(material);
  materialRef.current = material;
  const [audioUrl, setAudioUrl] = useState('');
  const recognition = useRecognition({
    onRecognized: (id, segments) => {
      const target = all.current.find((m) => m.id === id);
      if (!target) return;
      if (hasDictation(target)) {
        setError(DICTATION_EXISTS);
        return;
      }
      replaceSegments(segments, id);
      setNotice(`识别完成，共 ${segments.length} 句。原文在核对前保持隐藏。`);
    },
    onError: setError,
    onNotice: setNotice,
  });

  function flush() {
    clearTimeout(saveTimer.current);
    const batch = [...pending.current.values()];
    pending.current.clear();
    if (!batch.length) return;
    queue.current = queue.current.then(async () => {
      try {
        for (const item of batch) await saveMaterial(item);
        if (!pending.current.size) setSaveStatus('已保存');
      } catch (err) {
        for (const item of batch) {
          const latest = all.current.find((m) => m.id === item.id);
          if (latest && !pending.current.has(item.id)) pending.current.set(item.id, latest);
        }
        setSaveStatus('保存失败');
        setError(`保存失败：${String(err)}。请保留窗口并点击重试保存。`);
      }
    });
  }
  function update(transform: (m: Material) => Material, id = selected) {
    const next = all.current.map((m) => (m.id === id ? transform(m) : m));
    all.current = next;
    setMaterials(next);
    const changed = next.find((m) => m.id === id);
    if (changed) {
      pending.current.set(id, changed);
      setSaveStatus('保存中…');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 300);
    }
  }
  function updateAttempt(transform: (a: Attempt) => Attempt) {
    update((m) => ({
      ...m,
      attempts: m.attempts.map((a) => (a.id === m.attemptId ? transform(a) : a)),
    }));
  }
  useEffect(() => {
    let cancelled = false;
    loadMaterials()
      .then((items) => {
        if (cancelled) return;
        all.current = items;
        setMaterials(items);
        setSelected(items[0]?.id || '');
        setReady(true);
      })
      .catch((err) => setError(`本地数据库无法打开：${String(err)}。请重新打开应用。`));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);
  useEffect(() => {
    if (!material) {
      setAudioUrl('');
      return;
    }
    const url = URL.createObjectURL(material.audio);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [material?.id, material?.audio]);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, audioUrl]);
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const node = event.target;
      if (node instanceof HTMLTextAreaElement && node.closest('.sentence-editor'))
        lastField.current = {
          node,
          start: node.selectionStart ?? 0,
          end: node.selectionEnd ?? 0,
        };
    };
    document.addEventListener('focusout', remember);
    return () => document.removeEventListener('focusout', remember);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('attune-reveal-reference', revealReference ? '1' : '0');
    } catch {
      /* ignore quota / private mode */
    }
  }, [revealReference]);
  useEffect(() => {
    audio.current?.pause();
    setPlaying(false);
    setNotice('');
    setEditing(false);
    setHistory(false);
  }, [selected]);

  async function importAudio(file?: File) {
    if (!file) return;
    setError('');
    setNotice('正在导入音频…');
    try {
      const duration = await audioDuration(file),
        id = uid(),
        first = newAttempt(),
        initial: Segment = { id: uid(), start: 0, end: duration, reference: '', words: [] };
      const item: Material = {
        id,
        name: file.name,
        audio: file,
        duration,
        segments: [initial],
        attempts: [first],
        attemptId: first.id,
        segmentId: initial.id,
        position: 0,
        review: [],
      };
      await saveMaterial(item);
      all.current = [item, ...all.current];
      setMaterials(all.current);
      setSelected(id);
      setSaveStatus('已保存');
      setNotice('音频已导入。可识别原文、导入 SRT 字幕，或在“片段与原文”中手动拆分。');
    } catch (err) {
      setError(String(err));
      setNotice('');
    }
  }
  async function importSubtitles(file?: File) {
    if (!file || !material) return;
    try {
      const segments = parseSrt(await file.text(), material.duration);
      if (hasDictation(material)) {
        setError(DICTATION_EXISTS);
        return;
      }
      replaceSegments(segments, material.id);
      setNotice('字幕已导入，原文在核对前保持隐藏。');
    } catch (err) {
      setError(String(err));
    }
  }
  /** Swaps in a complete new timeline in one update, starting a fresh attempt. */
  function replaceSegments(segments: Segment[], id: string) {
    const next = newAttempt();
    update(
      (m) => ({
        ...m,
        segments,
        segmentId: segments[0].id,
        attempts: [next],
        attemptId: next.id,
        review: [],
        position: segments[0].start,
      }),
      id,
    );
    if (materialRef.current?.id === id && audio.current) {
      audio.current.pause();
      audio.current.currentTime = segments[0].start;
    }
    setEditing(false);
  }
  function startRecognition() {
    if (!material) return;
    if (hasDictation(material)) {
      setError(DICTATION_EXISTS);
      return;
    }
    setError('');
    audio.current?.pause();
    recognition.start(material);
  }
  function openRecognitionSettings() {
    setRecognitionSettings(true);
    recognition.refreshModels().catch((err) => setError(`无法读取模型列表：${String(err)}`));
  }
  async function exportSrt() {
    if (!material) return;
    const text = toSrt(material.segments);
    if (!text) {
      setNotice('还没有原文，无法导出 SRT。请先识别原文或导入字幕。');
      return;
    }
    try {
      const name = `${material.name.replace(/\.[^.]+$/, '')}.srt`;
      if (await saveTextFile(name, text, 'application/x-subrip;charset=utf-8'))
        setNotice('SRT 已导出。');
    } catch (err) {
      setError(`导出失败：${String(err)}`);
    }
  }

  function leaveIntensive() {
    const prev = intensivePrev.current;
    if (!prev) return;
    intensivePrev.current = null;
    setSpeed(prev.speed);
    setLoop(prev.loop);
    setMode(prev.mode);
  }
  function enterIntensive(rate?: number, enableLoop?: boolean) {
    if (!intensivePrev.current) intensivePrev.current = { speed, loop, mode };
    setMode('segment');
    if (rate !== undefined) setSpeed(rate);
    if (enableLoop === true) setLoop(true);
    void play(true);
  }
  function handleIntensiveLoop(next: boolean) {
    if (next) enterIntensive(undefined, true);
    else {
      setLoop(false);
      leaveIntensive();
    }
  }
  function seekWord(start: number) {
    if (!intensivePrev.current) intensivePrev.current = { speed, loop, mode };
    setMode('segment');
    seekTo(start);
    void play();
  }

  function selectSegment(s: Segment, seek = true) {
    if (segment && s.id !== segment.id) leaveIntensive();
    if (seek && audio.current) {
      audio.current.pause();
      audio.current.currentTime = s.start;
      setPosition(s.start);
    }
    update((m) => ({ ...m, segmentId: s.id, ...(seek ? { position: s.start } : {}) }));
    setEditing(false);
  }
  function goAdjacent(delta: number) {
    if (!material || !segment) return;
    const index = material.segments.indexOf(segment) + delta;
    const target = material.segments[index];
    if (target) selectSegment(target);
  }
  function seekTo(seconds: number) {
    if (!audio.current) return;
    audio.current.currentTime = seconds;
    setPosition(seconds);
    update((m) => ({ ...m, position: seconds }));
  }
  async function play(restart = false) {
    const player = audio.current;
    if (!player || !material) return;
    const restoreFocus = () => {
      const field = lastField.current;
      if (field?.node.isConnected) {
        field.node.focus({ preventScroll: true });
        field.node.setSelectionRange(field.start, field.end);
      } else {
        sentenceField.current?.focus({ preventScroll: true });
      }
    };
    if (!restart && !player.paused) {
      player.pause();
      restoreFocus();
      return;
    }
    if (restart) player.currentTime = mode === 'segment' && segment ? segment.start : 0;
    else if (
      mode === 'segment' &&
      segment &&
      (player.currentTime < segment.start || player.currentTime >= segment.end - 0.02)
    )
      player.currentTime = segment.start;
    restoreFocus();
    try {
      await player.play();
    } catch (err) {
      setError(`无法播放：${String(err)}`);
    }
  }
  function check(s: Segment) {
    if (!attempt) return;
    if (!s.reference.trim()) {
      setNotice('当前片段还没有参考原文，请先在“片段与原文”中添加。');
      return;
    }
    if (!draftText(attempt.drafts[s.id]).trim()) {
      setNotice('先写一点内容，再核对。');
      return;
    }
    try {
      const words = draftWords(draftText(attempt.drafts[s.id]));
      compareWords(words, s.reference);
      updateAttempt((a) => {
        const withDraft = {
          ...a,
          drafts: { ...a.drafts, [s.id]: words },
        };
        return checkSegment(withDraft, s);
      });
      setNotice('首次稿已保留，可以继续修改并保存修订稿。');
    } catch (err) {
      setError(String(err));
    }
  }
  function editSegment() {
    if (!segment) return;
    setStart(segment.start);
    setEnd(segment.end);
    setReference(segment.reference);
    setEditing(true);
    audio.current?.pause();
  }
  function saveSegment() {
    if (!material || !segment) return;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > material.duration
    ) {
      setError('片段范围应满足：0 ≤ 开始 < 结束 ≤ 音频时长。');
      return;
    }
    if (material.segments.some((s) => s.id !== segment.id && start < s.end && end > s.start)) {
      setError('片段时间不能重叠。');
      return;
    }
    if (material.attempts.some((a) => a.checked[segment.id]) && reference !== segment.reference) {
      setError('已核对片段的原文不能直接改写。请使用新材料，保留历史核对依据。');
      return;
    }
    update((m) => ({
      ...m,
      segments: m.segments
        .map((s) =>
          s.id === segment.id
            ? {
                ...s,
                start,
                end,
                reference,
                // Word timings no longer match once the span or text is edited by hand.
                words:
                  s.start === start && s.end === end && s.reference === reference ? s.words : [],
              }
            : s,
        )
        .sort((a, b) => a.start - b.start),
    }));
    setEditing(false);
    setError('');
  }
  function split() {
    if (!material || !segment) return;
    const point = audio.current?.currentTime ?? 0;
    if (point <= segment.start + 0.1 || point >= segment.end - 0.1) {
      setError('先把播放位置移动到当前片段内部，再拆分。');
      return;
    }
    if (
      material.attempts.some(
        (a) => (a.drafts[segment.id] || []).some(Boolean) || a.checked[segment.id],
      ) ||
      segment.reference.trim()
    ) {
      setError('有原文或听写内容的片段暂不支持拆分。请先在新材料中设置片段。');
      return;
    }
    const second: Segment = {
      id: uid(),
      start: point,
      end: segment.end,
      reference: '',
      words: [],
    };
    update((m) => ({
      ...m,
      segments: m.segments.flatMap((s) =>
        s.id === segment.id ? [{ ...s, end: point }, second] : [s],
      ),
    }));
    setNotice('已在播放位置拆分，两个片段可以分别填写原文。');
  }
  function restartAttempt() {
    const next = newAttempt();
    audio.current?.pause();
    update((m) => ({ ...m, attempts: [next, ...m.attempts], attemptId: next.id }));
    setHistory(false);
    setNotice('已开始新一次练习，旧记录保留。');
  }
  function exportRecords() {
    if (!material) return;
    const data = {
      version: 1,
      name: material.name,
      segments: material.segments,
      attempts: material.attempts,
      review: material.review,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'attune-records.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderDictation(s: Segment, index: number) {
    if (!attempt || !material) return null;
    const checked = attempt.checked[s.id];
    return (
      <section key={s.id} className="segment-editor">
        <div className="section-heading">
          <label>
            第 {index + 1} 句
            <span className="muted">
              {' '}
              · {formatTime(s.start)} — {formatTime(s.end)}
            </span>
          </label>
          <button
            className="quiet"
            aria-pressed={material.review.includes(s.id)}
            onClick={() =>
              update((m) => ({
                ...m,
                review: m.review.includes(s.id)
                  ? m.review.filter((id) => id !== s.id)
                  : [...m.review, s.id],
              }))
            }
          >
            {material.review.includes(s.id) ? '★ 已标记重听' : '☆ 标记重听'}
          </button>
        </div>
        <SentenceEditor
          label={`第 ${index + 1} 句听写`}
          text={draftText(attempt.drafts[s.id])}
          inputRef={sentenceField}
          onChange={(value) =>
            updateAttempt((a) => ({
              ...a,
              // Keep free text as one entry so spaces while typing are preserved;
              // older word-array drafts still render via draftText().
              drafts: { ...a.drafts, [s.id]: value ? [value] : [] },
            }))
          }
          onCheck={() => check(s)}
          onKeySound={() => {
            if (sound && !playing) keySound();
          }}
        />
        <div className="editor-actions">
          <span className="muted">Enter 核对 · Shift+Enter 换行 · 播放快捷键见页脚</span>
          <button onClick={() => check(s)}>核对原文</button>
        </div>
        {checked && (
          <IntensiveListening
            segment={s}
            checked={checked}
            position={position}
            rate={speed}
            loop={loop}
            onReplay={() => enterIntensive()}
            onRateAndReplay={(rate) => enterIntensive(rate)}
            onLoopChange={handleIntensiveLoop}
            onSeekWord={seekWord}
            onSaveRevision={() => {
              updateAttempt((a) => ({
                ...a,
                checked: {
                  ...a.checked,
                  [s.id]: {
                    ...a.checked[s.id],
                    revision: draftWords(draftText(a.drafts[s.id])),
                  },
                },
              }));
              setNotice('修订稿已保存，首次稿保持不变。');
            }}
          />
        )}
      </section>
    );
  }
  function renderReadAlong() {
    if (!material || !attempt) return null;
    return (
      <div className="readalong" aria-label="跟读原文">
        {material.segments.map((s, index) => {
          const active = position >= s.start && position < s.end;
          const dictated = !!attempt.checked[s.id];
          const showText = revealReference || dictated;
          const words = s.words.length
            ? s.words
            : draftWords(s.reference).map((text): WordTiming => ({
                text,
                start: s.start,
                end: s.end,
              }));
          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              className={`readalong__sentence${active ? ' readalong__sentence--active' : ''}${
                showText ? '' : ' readalong__sentence--hidden'
              }`}
              onClick={() => {
                selectSegment(s);
                void play(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectSegment(s);
                  void play(true);
                }
              }}
            >
              <span className="readalong__index">{index + 1}</span>
              <span className="readalong__text">
                {showText
                  ? words.map((w, i) => (
                      <button
                        type="button"
                        key={`${s.id}-${i}`}
                        className="readalong__word quiet"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectSegment(s, false);
                          seekTo(w.start);
                          void play();
                        }}
                      >
                        {w.text}
                      </button>
                    ))
                  : '（尚未听写，原文已隐藏）'}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
  const practicing = !!material && !history;
  return (
    <div
      className={`app${practicing ? ' app--workbench' : ''}`}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || history) return;
        const mod = event.ctrlKey || event.metaKey;
        if (mod && event.shiftKey && event.code === 'Space') {
          event.preventDefault();
          void play(true);
          return;
        }
        if (mod && event.code === 'Space' && !event.shiftKey) {
          event.preventDefault();
          void play();
          return;
        }
        if (mod && event.key === 'ArrowUp') {
          event.preventDefault();
          goAdjacent(-1);
          return;
        }
        if (mod && event.key === 'ArrowDown') {
          event.preventDefault();
          goAdjacent(1);
          return;
        }
        if (
          event.altKey &&
          !mod &&
          segment &&
          view === 'dictation' &&
          attempt?.checked[segment.id]
        ) {
          if (event.code === 'Digit1') {
            event.preventDefault();
            enterIntensive(1);
            return;
          }
          if (event.code === 'Digit2') {
            event.preventDefault();
            enterIntensive(0.75);
            return;
          }
          if (event.code === 'Digit3') {
            event.preventDefault();
            enterIntensive(0.5);
            return;
          }
          if (event.code === 'KeyL') {
            event.preventDefault();
            handleIntensiveLoop(!loop);
            return;
          }
        }
        if (mod && event.key === 'Enter' && segment && view === 'dictation') {
          event.preventDefault();
          check(segment);
        }
      }}
    >
      <header>
        <div className="brand">
          ◉ <span>Attune</span>
          <small>听写工作台</small>
        </div>
        <div className="header-actions">
          <span className="muted" role="status">
            {saveStatus}
          </span>
          <button disabled={!ready} onClick={() => audioInput.current?.click()}>
            ＋ 导入音频
          </button>
        </div>
      </header>
      <input
        ref={audioInput}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
        hidden
        onChange={(e) => {
          void importAudio(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={subtitleInput}
        type="file"
        accept=".srt"
        hidden
        onChange={(e) => {
          void importSubtitles(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className={`shell${practicing ? ' shell--workbench' : ''}`}>
        <aside className="materials-aside">
          <div className="caption">本地材料</div>
          {materials.map((m) => (
            <button
              key={m.id}
              className={`material ${selected === m.id ? 'selected' : ''}`}
              onClick={() => {
                flush();
                audio.current?.pause();
                setSelected(m.id);
              }}
            >
              <span>{m.name}</span>
              <small>
                {formatTime(m.duration)} · {m.segments.length} 个片段
              </small>
            </button>
          ))}
          {material && (
            <nav>
              <button className={!history ? 'selected' : ''} onClick={() => setHistory(false)}>
                听写练习
              </button>
              <button
                className={history ? 'selected' : ''}
                onClick={() => {
                  audio.current?.pause();
                  setHistory(true);
                }}
              >
                练习记录
              </button>
            </nav>
          )}
          <div className="aside-note">
            免登录 · 本地保存
            <br />
            音频和草稿保留在当前应用中
          </div>
        </aside>
        <main>
          {error && (
            <div className="error" role="alert">
              {error}
              <div className="row">
                <button
                  onClick={() => {
                    setError('');
                    flush();
                  }}
                >
                  重试保存
                </button>
                <button onClick={() => setError('')}>关闭提示</button>
              </div>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {!material ? (
            <div className="empty">
              <div className="caption">从一篇你想听懂的材料开始</div>
              <h1>
                听一遍，写下来。
                <br />
                再听一遍。
              </h1>
              <p>
                导入音频后，可整篇播放或划分片段练习。
                <br />
                支持 SRT 字幕，也可以手动填写参考原文。
              </p>
              <button
                className="primary"
                disabled={!ready}
                onClick={() => audioInput.current?.click()}
              >
                {ready ? '导入第一篇音频' : '正在打开本地数据…'}
              </button>
            </div>
          ) : history ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="caption">{material.name}</div>
                  <h1>练习记录</h1>
                </div>
                <div className="row">
                  <button onClick={exportRecords}>导出记录</button>
                  <button className="primary" onClick={restartAttempt}>
                    重新听写
                  </button>
                </div>
              </div>
              {material.attempts.map((a, i) => (
                <article className="attempt" key={a.id}>
                  <div className="section-heading">
                    <h2>第 {material.attempts.length - i} 次练习</h2>
                    <span className="muted">
                      {new Date(a.createdAt).toLocaleString()}{' '}
                      {a.id === material.attemptId ? '· 当前练习' : ''}
                    </span>
                  </div>
                  {!Object.keys(a.checked).length && (
                    <p className="muted">尚未核对，草稿仍可继续练习。</p>
                  )}
                  {Object.entries(a.checked).map(([id, record]) => (
                    <details key={id}>
                      <summary>
                        片段 {material.segments.findIndex((s) => s.id === id) + 1} ·
                        查看首次稿与修订稿
                      </summary>
                      <div className="caption">首次听写</div>
                      <p className="english">{record.first.join(' ')}</p>
                      <div className="caption">参考原文</div>
                      <p className="english">{record.reference}</p>
                      <div className="caption">修订稿</div>
                      <p className="english">{record.revision?.join(' ') || '尚未保存修订稿'}</p>
                    </details>
                  ))}
                  {a.id !== material.attemptId && (
                    <button
                      onClick={() => {
                        update((m) => ({ ...m, attemptId: a.id }));
                        setHistory(false);
                      }}
                    >
                      继续这次练习
                    </button>
                  )}
                </article>
              ))}
            </>
          ) : (
            <>
              <div className="workbench">
                <aside
                  className={`sentence-sidebar${sentenceSidebar ? '' : ' sentence-sidebar--collapsed'}`}
                  aria-label="句子列表"
                >
                  {sentenceSidebar && (
                    <>
                      <div className="sentence-sidebar__head">
                        <span className="caption">句子</span>
                        <button
                          className="quiet"
                          type="button"
                          onClick={() => setSentenceSidebar(false)}
                        >
                          收起
                        </button>
                      </div>
                      <div className="sentence-sidebar__list">
                        {material.segments.map((s, i) => {
                          const active = s.id === material.segmentId;
                          const done = !!attempt?.checked[s.id];
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={`sentence-sidebar__item${active ? ' selected' : ''}`}
                              onClick={() => selectSegment(s)}
                            >
                              <span>
                                {i + 1}. {formatTime(s.start)}
                              </span>
                              <small>
                                {done
                                  ? '已核对'
                                  : draftText(attempt?.drafts[s.id])
                                    ? '草稿'
                                    : '未写'}
                              </small>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {!sentenceSidebar && (
                    <button
                      className="quiet sentence-sidebar__expand"
                      type="button"
                      onClick={() => setSentenceSidebar(true)}
                    >
                      句子
                    </button>
                  )}
                </aside>
                <div className="workbench-main">
                  <div className="page-heading">
                    <div>
                      <div className="caption">{material.name}</div>
                      <h1>听写练习</h1>
                    </div>
                    <div className="row">
                      <div className="mode" aria-label="练习视图">
                        <button
                          aria-pressed={view === 'dictation'}
                          onClick={() => setView('dictation')}
                        >
                          听写
                        </button>
                        <button
                          aria-pressed={view === 'readalong'}
                          onClick={() => setView('readalong')}
                        >
                          跟读
                        </button>
                      </div>
                      <div className="mode" aria-label="播放模式">
                        <button
                          aria-pressed={mode === 'segment'}
                          onClick={() => {
                            setMode('segment');
                            audio.current?.pause();
                          }}
                        >
                          按句
                        </button>
                        <button
                          aria-pressed={mode === 'full'}
                          onClick={() => {
                            setMode('full');
                            audio.current?.pause();
                          }}
                        >
                          连续
                        </button>
                      </div>
                    </div>
                  </div>
                  <audio
                    ref={audio}
                    src={audioUrl}
                    onLoadedMetadata={() => {
                      if (audio.current) {
                        audio.current.currentTime = material.position;
                        audio.current.playbackRate = speed;
                        setPosition(material.position);
                      }
                    }}
                    onPlay={() => setPlaying(true)}
                    onPause={() => {
                      setPlaying(false);
                      const player = audio.current,
                        current = materialRef.current;
                      if (player && current)
                        update((m) => ({ ...m, position: player.currentTime }), current.id);
                    }}
                    onEnded={() => {
                      setPlaying(false);
                      if (mode === 'full' && loop) void play(true);
                    }}
                    onError={() => setError('音频无法解码。请尝试 MP3 或 WAV 格式。')}
                    onTimeUpdate={() => {
                      const player = audio.current;
                      if (!player) return;
                      setPosition(player.currentTime);
                      if (
                        mode === 'segment' &&
                        segment &&
                        !player.paused &&
                        player.currentTime >= segment.end - 0.025
                      ) {
                        if (loop) player.currentTime = segment.start;
                        else {
                          player.pause();
                          player.currentTime = segment.end;
                        }
                      }
                      if (mode === 'full' && !player.paused) {
                        const current = material.segments.find(
                          (s) => player.currentTime >= s.start && player.currentTime < s.end,
                        );
                        if (current && current.id !== material.segmentId)
                          update((m) => ({ ...m, segmentId: current.id }), material.id);
                      }
                    }}
                  />
                  <div className="player player--fixed">
                    <div className="row">
                      <button className="primary" onClick={() => void play()}>
                        {playing ? '暂停' : '播放'}
                      </button>
                      <button onClick={() => void play(true)}>
                        重播{mode === 'segment' ? '本句' : '整篇'}
                      </button>
                      <button
                        disabled={!segment || material.segments.indexOf(segment) === 0}
                        onClick={() => goAdjacent(-1)}
                      >
                        上一句
                      </button>
                      <button
                        disabled={
                          !segment ||
                          material.segments.indexOf(segment) === material.segments.length - 1
                        }
                        onClick={() => goAdjacent(1)}
                      >
                        下一句
                      </button>
                      <label>
                        速度{' '}
                        <select
                          aria-label="播放速度"
                          value={speed}
                          onChange={(e) => setSpeed(Number(e.target.value))}
                        >
                          {[0.5, 0.75, 1, 1.25, 1.5].map((n) => (
                            <option key={n} value={n}>
                              {n}×
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={loop}
                          onChange={(e) => setLoop(e.target.checked)}
                        />{' '}
                        循环
                      </label>
                      <span className="time">
                        {formatTime(position)} / {formatTime(material.duration)}
                      </span>
                    </div>
                    <input
                      className="timeline"
                      aria-label="播放进度"
                      type="range"
                      min="0"
                      max={material.duration}
                      step="0.01"
                      value={position}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (audio.current) audio.current.currentTime = value;
                        setPosition(value);
                        update((m) => ({ ...m, position: value }));
                      }}
                    />
                  </div>
                  <div className="tools">
                    <div className="row">
                      <button className="quiet" onClick={editSegment}>
                        片段与原文
                      </button>
                      <button className="quiet" onClick={() => subtitleInput.current?.click()}>
                        导入 SRT
                      </button>
                      <button
                        className="quiet"
                        disabled={!isDesktop() || !!recognition.task}
                        title={isDesktop() ? undefined : DESKTOP_ONLY}
                        onClick={startRecognition}
                      >
                        识别原文
                      </button>
                      <button
                        className="quiet"
                        disabled={!isDesktop()}
                        title={isDesktop() ? undefined : DESKTOP_ONLY}
                        onClick={openRecognitionSettings}
                      >
                        识别设置
                      </button>
                      <button className="quiet" onClick={exportSrt}>
                        导出 SRT
                      </button>
                      {view === 'readalong' && (
                        <label className="muted">
                          <input
                            type="checkbox"
                            checked={revealReference}
                            onChange={(e) => setRevealReference(e.target.checked)}
                          />{' '}
                          显示未听写原文
                        </label>
                      )}
                    </div>
                    <label className="muted">
                      <input
                        type="checkbox"
                        checked={sound}
                        onChange={(e) => setSound(e.target.checked)}
                      />{' '}
                      输入音效 · 播放时静音
                    </label>
                  </div>
                  {recognition.task && (
                    <div className="notice task" role="status">
                      <span>{recognition.task.label}</span>
                      {recognition.task.percent !== undefined && (
                        <progress max={100} value={recognition.task.percent} />
                      )}
                      {recognition.task.cancel && (
                        <button onClick={recognition.task.cancel}>取消</button>
                      )}
                    </div>
                  )}
                  {recognitionSettings && (
                    <RecognitionSettings
                      settings={recognition.settings}
                      models={recognition.models}
                      busy={!!recognition.task}
                      onChange={recognition.changeSettings}
                      onDownload={recognition.downloadSelected}
                      onImport={recognition.importLocal}
                      onClose={() => setRecognitionSettings(false)}
                    />
                  )}
                  {editing && segment && (
                    <section className="settings">
                      <h2>编辑当前片段</h2>
                      <p className="muted">原文仅用于核对。修改时间或拆分前，先暂停播放。</p>
                      <div className="row">
                        <label>
                          开始（秒）
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={start}
                            onChange={(e) => setStart(Number(e.target.value))}
                          />
                        </label>
                        <label>
                          结束（秒）
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={end}
                            onChange={(e) => setEnd(Number(e.target.value))}
                          />
                        </label>
                      </div>
                      <label>
                        参考原文
                        <textarea
                          aria-label="参考原文"
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                        />
                      </label>
                      <div className="row">
                        <button className="primary" onClick={saveSegment}>
                          保存片段
                        </button>
                        <button onClick={split}>在播放位置拆分</button>
                        <button onClick={() => setEditing(false)}>收起</button>
                      </div>
                    </section>
                  )}
                  <div className="workbench-body">
                    {view === 'dictation'
                      ? segment && renderDictation(segment, material.segments.indexOf(segment))
                      : renderReadAlong()}
                  </div>
                  <footer>
                    <span>
                      Ctrl/⌘+Space 播放暂停 · Ctrl/⌘+Shift+Space 重播 · Ctrl/⌘+↑↓ 上/下一句 · Enter
                      核对 · Alt+1/2/3 精听 1×/0.75×/0.5× · Alt+L 单句循环
                    </span>
                  </footer>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
