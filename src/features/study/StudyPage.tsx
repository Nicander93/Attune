import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Material } from '../../domain/types';
import { activeRound, ensureRound, formatTime, newRound } from '../../domain/types';
import { compareWords, countKinds, tokenize } from '../../domain/text';
import { summarizeDiff } from '../../domain/word-flow';
import { toggleBookmark } from '../../domain/progress';
import { keySound } from '../../sound';
import { Player } from '../player/Player';
import type { AudioPlayer } from '../player/useAudioPlayer';
import { WordFlowEditor } from '../dictation/WordFlowEditor';
import { ReadingView, useActiveWord } from '../reading/ReadingView';

type Props = {
  material: Material;
  player: AudioPlayer;
  update: (transform: (material: Material) => Material) => void;
  onBack: () => void;
  onPrepare: () => void;
  onSubtitles: () => void;
  onTranscript: () => void;
  onNotice: (message: string) => void;
};

/** The sentences this pass is allowed to move through: all of them, or just 难句. */
function navigationScope(material: Material, bookmarkedOnly: boolean) {
  if (!bookmarkedOnly) return material.segments;
  const marks = new Set(material.bookmarkedSegmentIds);
  return material.segments.filter((s) => marks.has(s.id));
}

export function StudyPage({
  material,
  player,
  update,
  onBack,
  onPrepare,
  onSubtitles,
  onTranscript,
  onNotice,
}: Props) {
  const [view, setView] = useState<'dictation' | 'reading'>(material.lastView ?? 'dictation');
  const [editingId, setEditingId] = useState(
    activeRound(material)?.activeSegmentId ?? material.segments[0]?.id ?? '',
  );
  const [checked, setChecked] = useState(
    Boolean(
      activeRound(material)?.checkedSegmentId &&
      activeRound(material)?.checkedSegmentId === activeRound(material)?.activeSegmentId,
    ),
  );
  const [revealAll, setRevealAll] = useState(material.studySettings?.revealAll ?? false);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(
    material.studySettings?.bookmarkedOnly ?? false,
  );
  const [showHistory, setShowHistory] = useState(false);
  const [keySounds, setKeySounds] = useState(material.studySettings?.keySounds ?? false);
  const [volume, setVolume] = useState(material.studySettings?.volume ?? 0.25);
  const field = useRef<HTMLTextAreaElement>(null);
  function updateStudySettings(settings: NonNullable<Material['studySettings']>) {
    update((m) => ({ ...m, studySettings: { ...m.studySettings, ...settings } }));
  }

  function changeView(next: 'dictation' | 'reading') {
    setView(next);
    update((m) => ({ ...m, lastView: next }));
    if (!material.playbackSettings) player.setMode(next === 'reading' ? 'continuous' : 'segment');
  }

  function selectSentence(id: string, checked = false) {
    setEditingId(id);
    setChecked(checked);
    update((m) => {
      const next = ensureRound(m);
      return {
        ...next,
        rounds: next.rounds.map((r) =>
          r.id === next.activeRoundId
            ? { ...r, activeSegmentId: id, checkedSegmentId: checked ? id : undefined }
            : r,
        ),
      };
    });
  }

  const scope = useMemo(
    () => navigationScope(material, bookmarkedOnly),
    [material, bookmarkedOnly],
  );
  const round = activeRound(material);
  const completed = useMemo(() => new Set(round?.completedSegmentIds ?? []), [round]);
  const stale = useMemo(() => new Set(round?.staleSegmentIds ?? []), [round]);

  const index = scope.findIndex((s) => s.id === editingId);
  const segment = index >= 0 ? scope[index] : undefined;
  const draft = round?.drafts[editingId ?? ''] ?? '';
  const activeWord = useActiveWord(material, player.playbackSegment?.id, player.position);

  const diff = useMemo(
    () => (checked && segment ? compareWords(tokenize(draft), segment.reference) : []),
    [checked, draft, segment],
  );
  const summary = useMemo(() => summarizeDiff(diff), [diff]);
  const { missing, extra } = useMemo(() => countKinds(diff), [diff]);

  const saveDraft = useCallback(
    (value: string) => {
      update((m) => {
        const withRound = ensureRound(m);
        const current = activeRound(withRound)!;
        const drafts = { ...current.drafts };
        if (value.trim()) drafts[editingId] = value;
        else delete drafts[editingId];
        return {
          ...withRound,
          lastStudiedAt: new Date().toISOString(),
          rounds: withRound.rounds.map((r) =>
            r.id === current.id
              ? {
                  ...r,
                  drafts,
                  activeSegmentId: editingId,
                  checkedSegmentId: undefined,
                  updatedAt: new Date().toISOString(),
                }
              : r,
          ),
        };
      });
    },
    [update, editingId],
  );

  /**
   * 核对答案 is the only thing that marks a sentence 已听写. Nothing before this point
   * reveals whether the typing is right - that is the whole point of dictation.
   */
  function check() {
    if (!segment) return;
    if (!segment.reference.trim()) {
      onNotice('这句还没有参考原文，请先在素材准备里导入字幕。');
      field.current?.focus();
      return;
    }
    if (!draft.trim()) {
      onNotice('先写一点内容，再核对。');
      field.current?.focus();
      return;
    }
    try {
      compareWords(tokenize(draft), segment.reference);
    } catch (err) {
      onNotice(String(err));
      return;
    }
    update((m) => {
      const withRound = ensureRound(m);
      const current = activeRound(withRound)!;
      return {
        ...withRound,
        lastStudiedAt: new Date().toISOString(),
        rounds: withRound.rounds.map((r) =>
          r.id === current.id
            ? {
                ...r,
                updatedAt: new Date().toISOString(),
                activeSegmentId: segment.id,
                checkedSegmentId: segment.id,
                staleSegmentIds: r.staleSegmentIds?.filter((id) => id !== segment.id),
                completedSegmentIds: [...new Set([...r.completedSegmentIds, segment.id])],
              }
            : r,
        ),
      };
    });
    setChecked(true);
  }

  function goTo(target: number, play = false) {
    const next = scope[target];
    if (!next) return;
    selectSentence(next.id);
    player.goToSegment(next.id, { play });
  }

  /**
   * The transport's 上一句 / 下一句 move the sentence being studied, not just the
   * audio - on the workbench the two are expected to stay together.
   */
  function stepSentence(delta: 1 | -1) {
    goTo(index + delta);
  }

  // Narrowing to 难句 can leave the current sentence outside the new range.
  useEffect(() => {
    if (scope.length && !scope.some((s) => s.id === editingId)) {
      selectSentence(scope[0].id);
    }
  }, [scope, editingId]);

  // Arrow keys navigate sentences only when nothing is being typed into, so ← and →
  // keep moving the caret while the user is writing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (showHistory || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]',
        )
      )
        return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === ' ') {
        event.preventDefault();
        player.toggle();
      } else if (event.key === 'Enter' && !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
        if (checked) goTo(index + 1);
        else check();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function startNewRound() {
    const next = newRound();
    update((m) => ({ ...m, rounds: [next, ...m.rounds], activeRoundId: next.id }));
    setEditingId(material.segments[0]?.id ?? '');
    setChecked(false);
    setShowHistory(false);
    onNotice('已开启新一轮，上一轮的进度保留在历史里。');
  }

  if (!material.segments.length) {
    return (
      <section className="study">
        <header className="prep__head">
          <button className="quiet back" onClick={onBack}>
            ← 返回
          </button>
          <h1>{material.displayName}</h1>
        </header>
        <Player material={material} player={player} />
        <p className="muted">这段素材还没有字幕，可以先听音频，但无法核对答案。</p>
        <button className="primary" onClick={onPrepare}>
          去准备字幕
        </button>
      </section>
    );
  }

  if (showHistory) {
    return (
      <section className="study">
        <header className="prep__head">
          <button className="quiet back" onClick={() => setShowHistory(false)}>
            ← 返回
          </button>
          <h1>练习轮次</h1>
        </header>
        <ol className="history__rounds">
          {material.rounds.map((r, i) => (
            <li key={r.id} className={r.id === material.activeRoundId ? 'is-active' : ''}>
              <div>
                <strong>
                  第 {material.rounds.length - i} 轮
                  {r.id === material.activeRoundId ? ' · 当前' : ''}
                </strong>
                <span className="muted">
                  {new Date(r.createdAt).toLocaleDateString()} · 已听写{' '}
                  {r.completedSegmentIds.length} 句
                </span>
              </div>
              {r.id !== material.activeRoundId && (
                <button
                  className="quiet"
                  onClick={() => {
                    update((m) => ({ ...m, activeRoundId: r.id }));
                    setEditingId(r.activeSegmentId ?? material.segments[0]?.id ?? '');
                    setChecked(
                      Boolean(r.checkedSegmentId && r.checkedSegmentId === r.activeSegmentId),
                    );
                    setShowHistory(false);
                  }}
                >
                  继续这轮
                </button>
              )}
            </li>
          ))}
        </ol>
        <button className="primary" onClick={startNewRound}>
          重新听写
        </button>
      </section>
    );
  }

  return (
    <section className="study study--workbench">
      <header className="study__head">
        <button className="quiet back" onClick={onBack}>
          ← 返回
        </button>
        <span className="muted">
          已听写 {round?.completedSegmentIds.length ?? 0} / {material.segments.length} 句
        </span>
      </header>

      <Player
        material={material}
        player={player}
        onStepSentence={stepSentence}
        hasPrevious={index > 0}
        hasNext={index >= 0 && index < scope.length - 1}
        status={`第 ${index + 1} / ${scope.length} 句`}
      />

      <div className="tabs">
        <div className="mode" role="tablist">
          <button
            role="tab"
            aria-selected={view === 'dictation'}
            onClick={() => changeView('dictation')}
          >
            听写
          </button>
          <button
            role="tab"
            aria-selected={view === 'reading'}
            onClick={() => changeView('reading')}
          >
            听读
          </button>
        </div>
        <label className="muted">
          <input
            type="checkbox"
            checked={bookmarkedOnly}
            onChange={(event) => {
              setBookmarkedOnly(event.target.checked);
              updateStudySettings({ bookmarkedOnly: event.target.checked });
              setChecked(false);
            }}
          />{' '}
          只看难句（{material.bookmarkedSegmentIds.length}）
        </label>
        <span className="player__spacer" />
        <label className="muted">
          <input
            type="checkbox"
            checked={keySounds}
            onChange={(event) => {
              setKeySounds(event.target.checked);
              updateStudySettings({ keySounds: event.target.checked });
            }}
          />{' '}
          按键音
        </label>
        {keySounds && (
          <input
            type="range"
            aria-label="按键音量"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(event) => {
              setVolume(Number(event.target.value));
              updateStudySettings({ volume: Number(event.target.value) });
            }}
          />
        )}
        <button className="quiet" onClick={() => setShowHistory(true)}>
          轮次
        </button>
      </div>

      {view === 'dictation' ? (
        segment ? (
          <div className="dictation">
            <div className="dictation__head">
              <h1>
                第 {index + 1} / {scope.length} 句
              </h1>
              <span className="muted">
                {formatTime(segment.start)} — {formatTime(segment.end)}
                {stale.has(segment.id) ? ' · 待重新核对' : ''}
              </span>
              <button
                className="quiet"
                aria-pressed={material.bookmarkedSegmentIds.includes(segment.id)}
                onClick={() => update((m) => toggleBookmark(m, segment.id))}
              >
                {material.bookmarkedSegmentIds.includes(segment.id) ? '★ 难句' : '☆ 标记难句'}
              </button>
            </div>

            <WordFlowEditor
              value={draft}
              onChange={(value) => {
                if (keySounds && !player.playing) keySound(volume);
                setChecked(false);
                saveDraft(value);
              }}
              // Enter checks, and once checked Enter moves on to the next sentence.
              onCheck={() => (checked ? goTo(index + 1) : check())}
              onEscape={() => selectSentence(editingId)}
              checked={checked}
              ariaLabel={`第 ${index + 1} 句听写`}
              inputRef={field}
            />

            {checked ? (
              <div className="diff" role="status">
                <p className="caption">核对结果</p>
                <p className="diff__text">
                  {diff.map((word, i) => (
                    <span key={i} className={`diff__word diff__word--${word.kind}`}>
                      {word.text}{' '}
                    </span>
                  ))}
                </p>
                <p className="muted">
                  {missing === 0 && extra === 0 ? '和原文一致。' : null}
                  {missing > 0 && `漏写：${summary.missing.join('、')} `}
                  {extra > 0 && `多写或写错：${summary.extra.join('、')}`}
                  {' · Enter 下一句 · Esc 回到修改'}
                </p>
              </div>
            ) : (
              <div className="dictation__actions">
                <button className="quiet" onClick={onTranscript}>
                  完整原文 ↗
                </button>
                <button
                  className="primary"
                  aria-label="核对答案"
                  onClick={check}
                  disabled={!draft.trim()}
                >
                  核对答案 <kbd>Enter</kbd>
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="muted">这一轮没有标记难句，先去听写时标几句吧。</p>
        )
      ) : (
        <ReadingView
          material={material}
          currentId={player.playbackSegment?.id}
          activeWord={activeWord}
          revealAll={revealAll}
          completed={completed}
          onRevealAll={(value) => {
            setRevealAll(value);
            updateStudySettings({ revealAll: value });
          }}
          onSettingsChange={updateStudySettings}
          onSeekWord={(segmentId, wordIndex) => {
            const target = material.segments.find((s) => s.id === segmentId);
            const word = target?.words[wordIndex];
            if (word) player.playFrom(word.start);
          }}
        />
      )}

      <footer className="study__foot">
        <span className="study__hint muted">
          Enter 核对 / 下一句 · Space 播放 · Esc 退出输入后 ← → 切句
        </span>
        {(view === 'reading' || checked) && (
          <button className="quiet" onClick={onTranscript}>
            完整原文 ↗
          </button>
        )}
        <button className="quiet" onClick={onSubtitles}>
          字幕校对
        </button>
        <button className="quiet" onClick={onPrepare}>
          素材设置
        </button>
      </footer>
    </section>
  );
}
