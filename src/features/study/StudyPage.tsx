import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Material, SubtitleSegment } from '../../domain/types';
import { displayTime, ensureRound, newRound } from '../../domain/types';
import { activeRound, compareWords, countKinds, tokenize, toggleBookmark } from '../../domain';

const RATES = [0.5, 0.75, 1, 1.25, 1.5];

type Props = {
  material: Material;
  onBack: () => void;
  onPrepare: () => void;
  onTranscript: () => void;
  onSubtitles: () => void;
  onNotice: (message: string) => void;
  update: (transform: (material: Material) => Material) => void;
  markStudied: (patch?: Partial<Material>) => void;
};

export function StudyPage(props: Props) {
  const { material } = props;
  const [view, setView] = useState<'dictation' | 'reading'>('dictation');
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(material.playbackPosition);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [draft, setDraft] = useState('');
  const [checked, setChecked] = useState(false);
  const [editingSegmentId, setEditingSegmentId] = useState<string>(material.segments[0]?.id ?? '');
  const audio = useRef<HTMLAudioElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [url, setUrl] = useState('');

  const round = activeRound(material);
  const segments = material.segments;
  const index = segments.findIndex((s) => s.id === editingSegmentId);
  const segment = segments[index];

  // The sentence the audio is inside is deliberately tracked separately from the
  // sentence being typed into, so playback can move on without stealing the draft.
  const playbackIndex = useMemo(
    () => segments.findIndex((s) => position >= s.start && position < s.end),
    [segments, position],
  );

  useEffect(() => {
    // A row whose audio is missing or corrupt must not take the whole window down with
    // it - the user can still fix the material from 素材设置.
    if (!(material.audio instanceof Blob)) {
      setUrl('');
      props.onNotice('这段素材的音频无法读取，请重新导入。');
      return;
    }
    const objectUrl = URL.createObjectURL(material.audio);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material.audio]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, url]);

  useEffect(() => {
    setDraft(round?.drafts[editingSegmentId] ?? '');
    setChecked(false);
  }, [editingSegmentId, round?.id]);

  const completed = useMemo(
    () => new Set(round?.completedSegmentIds ?? []),
    [round?.completedSegmentIds],
  );

  const bookmarked = useMemo(
    () => new Set(material.bookmarkedSegmentIds),
    [material.bookmarkedSegmentIds],
  );

  const saveDraft = useCallback(
    (value: string) => {
      setDraft(value);
      props.update((m) => {
        const withOne = ensureRound(m);
        const current = activeRound(withOne)!;
        const rounds = withOne.rounds.map((r) =>
          r.id === current.id
            ? {
                ...r,
                updatedAt: new Date().toISOString(),
                drafts: value.trim()
                  ? { ...r.drafts, [editingSegmentId]: value }
                  : without(r.drafts, editingSegmentId),
              }
            : r,
        );
        return { ...withOne, rounds };
      });
    },
    [props, editingSegmentId],
  );

  /**
   * 核对答案 is the only thing that marks a sentence as 已听写. There is deliberately
   * no per-letter or per-word correctness hint before this point: it would leak the
   * answer, which is the whole point of dictation.
   */
  function check() {
    if (!segment || !round) return;
    if (!segment.reference.trim()) {
      props.onNotice('这句还没有参考原文，请先在素材准备里导入字幕或识别。');
      return;
    }
    if (!draft.trim()) {
      props.onNotice('先写一点内容，再核对。');
      field.current?.focus();
      return;
    }
    props.update((m) => {
      const withOne = ensureRound(m);
      const current = activeRound(withOne)!;
      if (current.completedSegmentIds.includes(segment.id)) return withOne;
      return {
        ...withOne,
        lastStudiedAt: new Date().toISOString(),
        rounds: withOne.rounds.map((r) =>
          r.id === current.id
            ? {
                ...r,
                updatedAt: new Date().toISOString(),
                completedSegmentIds: [...r.completedSegmentIds, segment.id],
              }
            : r,
        ),
      };
    });
    setChecked(true);
  }

  function startNewRound() {
    const next = newRound();
    props.update((m) => ({ ...m, rounds: [next, ...m.rounds], activeRoundId: next.id }));
    setEditingSegmentId(material.segments[0]?.id ?? '');
    props.onNotice('已开启新一轮练习，上一轮的进度保留在历史里。');
  }

  function goTo(target: number, play = false) {
    const next = segments[target];
    if (!next) return;
    setEditingSegmentId(next.id);
    if (audio.current) {
      audio.current.pause();
      audio.current.currentTime = next.start;
      setPosition(next.start);
      props.update((m) => ({ ...m, playbackPosition: next.start }));
    }
    if (play) void playFrom(next.start);
  }

  async function playFrom(start?: number) {
    const player = audio.current;
    if (!player) return;
    if (start !== undefined) player.currentTime = start;
    try {
      await player.play();
    } catch {
      props.onNotice('无法播放这段音频，请确认文件仍可解码。');
    }
  }

  function togglePlay() {
    const player = audio.current;
    if (!player) return;
    if (player.paused) void playFrom();
    else player.pause();
  }

  // Sentence navigation. Skipped entirely while a text field has focus, so ← and →
  // still move the caret while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
      if (typing) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === ' ') {
        event.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const diff = useMemo(
    () => (checked && segment ? compareWords(tokenize(draft), segment.reference) : []),
    [checked, draft, segment],
  );
  const { missing, extra } = useMemo(() => countKinds(diff), [diff]);

  if (!segments.length) {
    return (
      <section className="study">
        <button className="quiet back" onClick={props.onBack}>
          ← 返回
        </button>
        <h1>{material.displayName}</h1>
        <p className="muted">这段素材还没有字幕。没有参考字幕无法核对答案，但可以先听音频。</p>
        <button className="primary" onClick={props.onPrepare}>
          去准备字幕
        </button>
      </section>
    );
  }

  return (
    <section className="study">
      <header className="study__head">
        <button className="quiet back" onClick={props.onBack}>
          ← 返回
        </button>
        <div>
          <p className="eyebrow">{material.displayName}</p>
          <h1>
            第 {index + 1} / {segments.length} 句
          </h1>
        </div>
        <span className="muted">
          已听写 {round?.completedSegmentIds.length ?? 0} / {segments.length} 句
        </span>
      </header>

      <Player
        audioRef={audio}
        url={url}
        position={position}
        duration={material.duration}
        playing={playing}
        speed={speed}
        loop={loop}
        hasPrevious={index > 0}
        hasNext={index < segments.length - 1}
        onToggle={togglePlay}
        onPrevious={() => goTo(index - 1)}
        onNext={() => goTo(index + 1)}
        onReplay={() => segment && goTo(index, true)}
        onSeek={(seconds) => {
          if (!audio.current) return;
          audio.current.currentTime = seconds;
          setPosition(seconds);
          props.update((m) => ({ ...m, playbackPosition: seconds }));
        }}
        onSpeed={setSpeed}
        onLoop={setLoop}
        onPlaying={setPlaying}
        onTime={setPosition}
        onSegmentEnd={
          loop
            ? undefined
            : () => {
                audio.current?.pause();
              }
        }
        segment={segment}
      />

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={view === 'dictation'}
          onClick={() => setView('dictation')}
        >
          听写
        </button>
        <button role="tab" aria-selected={view === 'reading'} onClick={() => setView('reading')}>
          听读
        </button>
        <span className="tabs__spacer" />
        <button className="quiet" onClick={props.onTranscript}>
          完整原文 ↗
        </button>
      </div>

      {view === 'dictation' ? (
        <div className="dictation">
          <div className="dictation__head">
            <span className="muted">
              {segment ? `${displayTime(segment.start)} — ${displayTime(segment.end)}` : ''}
            </span>
            <button
              className="quiet"
              aria-pressed={segment ? bookmarked.has(segment.id) : false}
              onClick={() => {
                if (!segment) return;
                props.update((m) => toggleBookmark(m, segment.id));
              }}
            >
              {segment && bookmarked.has(segment.id) ? '★ 难句' : '☆ 标记难句'}
            </button>
          </div>
          <textarea
            ref={field}
            className="dictation__field"
            aria-label={`第 ${index + 1} 句听写`}
            value={draft}
            spellCheck={false}
            autoComplete="off"
            placeholder="听完这句，写下来…"
            onChange={(event) => saveDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (checked) goTo(index + 1);
                else check();
              }
              if (event.key === 'Escape' && checked) {
                event.preventDefault();
                setChecked(false);
              }
            }}
          />
          {checked ? (
            <div className="diff" role="status">
              <p className="diff__text">
                {diff.map((word, i) => (
                  <span key={i} className={`diff__word diff__word--${word.kind}`}>
                    {word.text}{' '}
                  </span>
                ))}
              </p>
              <p className="muted">
                {missing === 0 && extra === 0
                  ? '与原文一致。'
                  : `漏写 ${missing} 词 · 多写或写错 ${extra} 词`}
                {' · '}Enter 下一句 · Esc 回到修改
              </p>
            </div>
          ) : (
            <div className="dictation__actions">
              <span className="muted">
                {round?.completedSegmentIds.includes(segment?.id ?? '')
                  ? '本句已核对'
                  : 'Enter 核对'}{' '}
                · Esc 退出输入后可用 ← → 切句
              </span>
              <button className="primary" onClick={check} disabled={!draft.trim()}>
                核对答案
              </button>
            </div>
          )}
        </div>
      ) : (
        <ul className="reading">
          {segments.map((s, i) => (
            <li key={s.id} className={playbackIndex === i ? 'is-current' : ''}>
              <button onClick={() => goTo(i, true)}>{s.reference}</button>
              {s.translation && <span className="muted">{s.translation}</span>}
            </li>
          ))}
        </ul>
      )}

      <footer className="study__foot">
        <button className="quiet" onClick={props.onSubtitles}>
          字幕校对
        </button>
        <button className="quiet" onClick={props.onPrepare}>
          素材设置
        </button>
        <span className="tabs__spacer" />
        <button className="quiet" onClick={startNewRound}>
          重新听写
        </button>
      </footer>
    </section>
  );
}

const without = (record: Record<string, string>, key: string) => {
  const next = { ...record };
  delete next[key];
  return next;
};

function Player(props: {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  url: string;
  position: number;
  duration: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  segment?: SubtitleSegment;
  hasPrevious: boolean;
  hasNext: boolean;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onReplay: () => void;
  onSeek: (seconds: number) => void;
  onSpeed: (rate: number) => void;
  onLoop: (loop: boolean) => void;
  onPlaying: (playing: boolean) => void;
  onTime: (seconds: number) => void;
  onSegmentEnd?: () => void;
}) {
  return (
    <div className="player">
      <audio
        ref={props.audioRef}
        src={props.url || undefined}
        onPlay={() => props.onPlaying(true)}
        onPause={() => props.onPlaying(false)}
        onTimeUpdate={(event) => {
          const player = event.currentTarget;
          props.onTime(player.currentTime);
          if (!props.loop || !props.segment) return;
          if (player.currentTime >= props.segment.end - 0.02) {
            player.currentTime = props.segment.start;
          }
        }}
        onLoadedMetadata={(event) => {
          event.currentTarget.currentTime = props.position;
        }}
      />
      <div className="player__controls">
        <button
          className="quiet"
          aria-label="上一句"
          disabled={!props.hasPrevious}
          onClick={props.onPrevious}
        >
          ⏮
        </button>
        <button
          className="player__play"
          aria-label={props.playing ? '暂停' : '播放'}
          onClick={props.onToggle}
        >
          {props.playing ? '❚❚' : '▶'}
        </button>
        <button
          className="quiet"
          aria-label="下一句"
          disabled={!props.hasNext}
          onClick={props.onNext}
        >
          ⏭
        </button>
        <button className="quiet" onClick={props.onReplay}>
          ↻ 重听本句
        </button>
        <span className="tabs__spacer" />
        <label className="muted">
          <select
            aria-label="播放速度"
            value={props.speed}
            onChange={(event) => props.onSpeed(Number(event.target.value))}
          >
            {RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </label>
        <label className="muted">
          <input
            type="checkbox"
            checked={props.loop}
            onChange={(event) => props.onLoop(event.target.checked)}
          />{' '}
          单句循环
        </label>
        <span className="muted">
          {displayTime(props.position)} / {displayTime(props.duration)}
        </span>
      </div>
      <input
        className="player__timeline"
        type="range"
        aria-label="播放进度"
        min={0}
        max={Math.max(1, props.duration)}
        step={0.01}
        value={props.position}
        onChange={(event) => props.onSeek(Number(event.target.value))}
      />
    </div>
  );
}
