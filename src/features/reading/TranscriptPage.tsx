import { useMemo } from 'react';
import type { Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { roundProgress } from '../../domain/progress';
import { Player } from '../player/Player';
import type { AudioPlayer } from '../player/useAudioPlayer';

type Props = {
  material: Material;
  onBack: () => void;
  /** Jumps the shared player; the workbench keeps whatever was being typed. */
  player: AudioPlayer;
};

/**
 * 完整原文 as its own page.
 *
 * Everything is shown here, including sentences never dictated - that is what the page
 * is for. Going back returns to the workbench with the draft and sentence intact,
 * because the workbench owns that state and this page never touched it.
 */
export function TranscriptPage({ material, onBack, player }: Props) {
  const translated = useMemo(
    () => material.segments.some((s) => s.translation?.trim()),
    [material.segments],
  );

  return (
    <section className="transcript">
      <header className="prep__head">
        <button className="quiet back" onClick={onBack}>
          ← 返回
        </button>
        <div>
          <p className="eyebrow">完整原文</p>
          <h1>{material.displayName}</h1>
        </div>
        <span className="muted">{material.segments.length} 句</span>
      </header>

      <Player material={material} player={player} />

      {!translated && <p className="muted">这份字幕没有中文译文，只显示英文。</p>}

      <ol className="transcript__list">
        {material.segments.map((segment, index) => (
          <li key={segment.id}>
            <button
              className="transcript__jump muted"
              onClick={() => player.goToSegment(segment.id, { play: true })}
            >
              {index + 1} · {formatTime(segment.start)}
            </button>
            <div>
              <p className="reading__en">{segment.reference}</p>
              {segment.translation && <p className="reading__zh">{segment.translation}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

type HistoryProps = {
  material: Material;
  onStartRound: () => void;
  onContinueRound: (roundId: string) => void;
};

/**
 * Rounds show how far the user got, not how well they did. There is deliberately no
 * accuracy score and no archive of every mistake - the spec rules both out.
 */
export function HistoryPanel({ material, onStartRound, onContinueRound }: HistoryProps) {
  return (
    <section className="history">
      <div className="page-heading">
        <div>
          <p className="eyebrow">练习轮次</p>
          <h1>{material.displayName}</h1>
        </div>
        <button className="primary" onClick={onStartRound}>
          重新听写
        </button>
      </div>

      <ol className="history__rounds">
        {material.rounds.map((round, index) => {
          const progress = roundProgress(round, material.segments.length);
          const active = round.id === material.activeRoundId;
          return (
            <li key={round.id} className={active ? 'is-active' : ''}>
              <div>
                <strong>
                  第 {material.rounds.length - index} 轮{active ? ' · 当前' : ''}
                </strong>
                <span className="muted">
                  {new Date(round.createdAt).toLocaleDateString()} · 已听写 {progress.completed} /{' '}
                  {progress.total} 句{progress.stale > 0 ? ` · ${progress.stale} 句待重新核对` : ''}
                </span>
              </div>
              {!active && (
                <button className="quiet" onClick={() => onContinueRound(round.id)}>
                  继续这轮
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
