import type { RefObject, SyntheticEvent } from 'react';
import type { Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { PLAYBACK_RATES, useMediaPlayer } from './useMediaPlayer';

type Props = {
  material: Material;
  player: ReturnType<typeof useMediaPlayer>;
  /** Shown next to the transport, e.g. 第 3 / 6 句. */
  status?: string;
  /**
   * Takes over sentence stepping when the page also has a sentence cursor to move.
   * Without it the buttons only move the audio, which is right on 字幕校对.
   */
  onStepSentence?: (delta: 1 | -1) => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
};

/**
 * The transport shared by 听写, 听读 and 字幕校对.
 *
 * It renders no title and no labels beyond the controls themselves: the sentence it
 * acts on is already stated by the page above it.
 */
export function Player({ material, player, status, onStepSentence, hasPrevious, hasNext }: Props) {
  return (
    <div className="player">
      <div
        className="player__controls"
        onMouseDown={(event) => {
          if (
            document.activeElement instanceof HTMLTextAreaElement &&
            (event.target as HTMLElement).closest('button')
          )
            event.preventDefault();
        }}
      >
        <div className="player__track">
          <strong title={material.displayName}>{material.displayName}</strong>
          <span className="caption">{status ?? `${material.segments.length} 句 · 英语听写`}</span>
        </div>
        <button
          className="quiet"
          aria-label="上一句"
          disabled={!player.canStep || !(hasPrevious ?? player.hasPrevious)}
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
          disabled={!player.canStep || !(hasNext ?? player.hasNext)}
          onClick={() => (onStepSentence ? onStepSentence(1) : player.next())}
        >
          ⏭
        </button>
        <button className="quiet" disabled={!player.canStep} onClick={player.replay}>
          ↻ 重听本句
        </button>
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
          {material.video
            ? '播放副本无法读取。请回准备页「重建播放副本」或「重新关联源文件」；仍可用片段音频继续听写。'
            : '本素材的音频无法读取，请重新导入。'}
        </p>
      )}
    </div>
  );
}

const mediaEvents = (player: ReturnType<typeof useMediaPlayer>) => ({
  onPlay: player.handlePlay,
  onPause: player.handlePause,
  onEnded: player.handlePause,
  onError: player.handleError,
  onLoadedMetadata: player.handleMetadata,
  onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) =>
    player.handleTimeUpdate(event.currentTarget.currentTime),
});

/**
 * One sounding media element lives above the pages so navigation cannot restart playback.
 * Video materials use a managed asset-protocol URL; audio materials keep a blob `<audio>`.
 * Hiding the video surface only toggles visibility — the element and clock stay alive.
 */
export function MediaOutput({ player }: { player: ReturnType<typeof useMediaPlayer> }) {
  const events = mediaEvents(player);
  if (player.kind === 'video' && player.videoSrc) {
    const hidden = player.videoSurface === 'hidden';
    return (
      <div className={`media-output${hidden ? ' media-output--hidden' : ''}`} aria-hidden={hidden}>
        <video
          ref={player.mediaRef as RefObject<HTMLVideoElement>}
          className="media-output__video"
          src={player.videoSrc}
          playsInline
          {...events}
        />
      </div>
    );
  }
  return (
    <audio
      ref={player.mediaRef as RefObject<HTMLAudioElement>}
      src={player.src || undefined}
      {...events}
    />
  );
}

/** @deprecated Use MediaOutput. */
export const AudioOutput = MediaOutput;
