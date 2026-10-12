import type { Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { PLAYBACK_RATES, useAudioPlayer, useSentenceStop } from './useAudioPlayer';

type Props = {
  material: Material;
  player: ReturnType<typeof useAudioPlayer>;
  /** Shown next to the transport, e.g. 第 3 / 6 句. */
  status?: string;
  /**
   * Takes over sentence stepping when the page also has a sentence cursor to move.
   * Without it the buttons only move the audio, which is right on 字幕校对.
   */
  onStepSentence?: (delta: 1 | -1) => void;
};

/**
 * The transport shared by 听写, 听读 and 字幕校对.
 *
 * It renders no title and no labels beyond the controls themselves: the sentence it
 * acts on is already stated by the page above it.
 */
export function Player({ material, player, status, onStepSentence }: Props) {
  const stopAtSentenceEnd = useSentenceStop(player);

  return (
    <div className="player">
      <audio
        ref={player.audioRef}
        src={player.src || undefined}
        onPlay={() => player.setMode(player.mode)}
        onTimeUpdate={(event) => {
          const current = event.currentTarget.currentTime;
          stopAtSentenceEnd(current);
          player.seek(current);
        }}
        onLoadedMetadata={(event) => {
          event.currentTarget.currentTime = material.playbackPosition;
          event.currentTarget.playbackRate = player.speed;
        }}
      />
      <div className="player__controls">
        <button
          className="quiet"
          aria-label="上一句"
          disabled={!player.canStep || !player.hasPrevious}
          onClick={() => (onStepSentence ? onStepSentence(-1) : player.previous())}
        >
          ⏮
        </button>
        <button
          className="player__play"
          aria-label={player.playing ? '暂停' : '播放'}
          onClick={player.toggle}
        >
          {player.playing ? '❚❚' : '▶'}
        </button>
        <button
          className="quiet"
          aria-label="下一句"
          disabled={!player.canStep || !player.hasNext}
          onClick={() => (onStepSentence ? onStepSentence(1) : player.next())}
        >
          ⏭
        </button>
        <button className="quiet" disabled={!player.canStep} onClick={player.replay}>
          ↻ 重听本句
        </button>
        {status && <span className="muted">{status}</span>}
        <span className="player__spacer" />
        <label className="muted">
          <select
            aria-label="播放速度"
            value={player.speed}
            onChange={(event) => player.setSpeed(Number(event.target.value))}
          >
            {PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </label>
        <label className="muted">
          <input
            type="checkbox"
            checked={player.loop}
            onChange={(event) => player.setLoop(event.target.checked)}
          />{' '}
          单句循环
        </label>
        <label className="muted">
          <input
            type="radio"
            name="playback-mode"
            checked={player.mode === 'segment'}
            onChange={() => player.setMode('segment')}
          />{' '}
          按句
        </label>
        <label className="muted">
          <input
            type="radio"
            name="playback-mode"
            checked={player.mode === 'continuous'}
            onChange={() => player.setMode('continuous')}
          />{' '}
          连续
        </label>
        <span className="muted">
          {formatTime(player.position)} / {formatTime(material.duration)}
        </span>
      </div>
      <input
        className="player__timeline"
        type="range"
        aria-label="播放进度"
        min={0}
        max={Math.max(1, material.duration)}
        step={0.01}
        value={player.position}
        onChange={(event) => player.seek(Number(event.target.value))}
      />
      {player.unreadable && (
        <p className="player__warning" role="alert">
          这段素材的音频无法读取，请重新导入。
        </p>
      )}
    </div>
  );
}
