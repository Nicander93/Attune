import {
  compareWords,
  type DiffWord,
  type Segment,
  type WordTiming,
  activeWordIndex,
  timingIndexByDiff,
} from './domain';

const RATES = [1, 0.75, 0.5] as const;

type Checked = { first: string[]; reference: string; revision?: string[] };

type Props = {
  segment: Segment;
  checked: Checked;
  position: number;
  rate: number;
  loop: boolean;
  onRateAndReplay: (rate: number) => void;
  onLoopChange: (loop: boolean) => void;
  onReplay: () => void;
  onSeekWord: (start: number) => void;
  onSaveRevision: () => void;
};

function tokenClass(kind: DiffWord['kind'], active: boolean): string {
  const parts = ['intensive__token'];
  if (kind === 'extra') parts.push('intensive__token--extra');
  if (kind === 'missing') parts.push('intensive__token--missing');
  if (active) parts.push('intensive__token--active');
  return parts.join(' ');
}

function renderToken(
  word: DiffWord,
  index: number,
  timingIndex: number | null,
  activeTiming: number,
  words: WordTiming[],
  onSeekWord: (start: number) => void,
) {
  const active = timingIndex !== null && timingIndex === activeTiming;
  const timing = timingIndex !== null ? words[timingIndex] : undefined;
  const className = tokenClass(word.kind, active);

  if (timing) {
    return (
      <button
        type="button"
        key={index}
        className={`${className} intensive__token--seek`}
        onClick={() => onSeekWord(timing.start)}
      >
        {word.kind === 'extra' ? (
          <del>{word.text}</del>
        ) : word.kind === 'missing' ? (
          <ins>{word.text}</ins>
        ) : (
          word.text
        )}{' '}
      </button>
    );
  }

  if (word.kind === 'extra')
    return (
      <del key={index} className={className}>
        {word.text}{' '}
      </del>
    );
  if (word.kind === 'missing')
    return (
      <ins key={index} className={className}>
        {word.text}{' '}
      </ins>
    );
  return (
    <span key={index} className={className}>
      {word.text}{' '}
    </span>
  );
}

/** Comparison panel plus intensive-listening controls for the current checked sentence. */
export function IntensiveListening({
  segment,
  checked,
  position,
  rate,
  loop,
  onRateAndReplay,
  onLoopChange,
  onReplay,
  onSeekWord,
  onSaveRevision,
}: Props) {
  const diff = compareWords(checked.first, checked.reference);
  const words = segment.words;
  const hasTimings = words.length > 0;
  const timingIndexes = timingIndexByDiff(diff, words);
  const activeTiming = hasTimings ? activeWordIndex(words, position) : -1;

  return (
    <div className="comparison">
      <div className="caption">参考原文</div>
      <p className="english">{checked.reference}</p>
      <div className="caption">首次稿对照 · 忽略大小写与标点 · 数字与英文可互认</div>
      <p className="english" aria-label="核对对照">
        {diff.map((word, index) =>
          renderToken(word, index, timingIndexes[index], activeTiming, words, onSeekWord),
        )}
      </p>
      <div className="intensive" aria-label="精听本句">
        <div className="caption">精听本句</div>
        <div className="row intensive__controls">
          <button type="button" className="primary" onClick={onReplay}>
            再听本句
          </button>
          <div className="mode" aria-label="精听速度">
            {RATES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={rate === value}
                onClick={() => onRateAndReplay(value)}
              >
                {value}×
              </button>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={loop}
              onChange={(event) => onLoopChange(event.target.checked)}
            />{' '}
            单句循环
          </label>
        </div>
        <p className="muted intensive__hint">
          {hasTimings
            ? '有词级时间：对照行逐词高亮，点词从该词起播'
            : '无词级时间（如纯 SRT）：整句播放，不编造词时间'}
        </p>
      </div>
      <div className="editor-actions">
        <span className="muted">删除线：多写／不同的词 · 下划线：缺少的词</span>
        <button type="button" onClick={onSaveRevision}>
          保存修订稿
        </button>
      </div>
    </div>
  );
}
