import type { RefObject, SyntheticEvent } from 'react';
import { MOTION_MS, usePresence } from '../../app/motion';
import type { Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { PLAYBACK_RATES, useMediaPlayer } from './useMediaPlayer';
import { LoopIcon, ReplayIcon } from './TransportIcons';

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
  /** Focus study chrome: loop as icon, no speed/mode cluster beside the transport. */
  variant?: 'default' | 'focus';
};

/**
 * The transport shared by 听写, 听读 and 字幕校对.
 *
 * It renders no title and no labels beyond the controls themselves: the sentence it
 * acts on is already stated by the page above it.
 */
export function Player({
  material,
  player,
  status,
  onStepSentence,
  hasPrevious,
  hasNext,
  variant = 'default',
}: Props) {
  const focus = variant === 'focus';
  const replayButton = (
    <button
      type="button"
      className="quiet player__replay"
      disabled={!player.canStep}
      onClick={player.replay}
      aria-label="重听本句"
      title="重听本句"
    >
      <ReplayIcon />
    </button>
  );
  return (
    <div className={`player${focus ? ' player--focus' : ''}`}>
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
        {!focus && (
          <div className="player__track">
            <strong title={material.displayName}>{material.displayName}</strong>
            <span className="caption">{status ?? `${material.segments.length} 句 · 英语听写`}</span>
          </div>
        )}
        <button
          className="quiet"
          aria-label="上一句"
          disabled={!player.canStep || !(hasPrevious ?? player.hasPrevious)}
          onClick={() => (onStepSentence ? onStepSentence(-1) : player.previous())}
        >
          ⏮
        </button>
        <button
          className={`player__play${player.playing ? ' is-playing' : ''}`}
          aria-label={player.playing ? '暂停' : '播放'}
          aria-pressed={player.playing}
          onClick={player.toggle}
        >
          <span className="player__glyph" key={player.playing ? 'pause' : 'play'}>
            {player.playing ? '❚❚' : '▶'}
          </span>
        </button>
        <button
          className="quiet"
          aria-label="下一句"
          disabled={!player.canStep || !(hasNext ?? player.hasNext)}
          onClick={() => (onStepSentence ? onStepSentence(1) : player.next())}
        >
          ⏭
        </button>
        {!focus && replayButton}
        <span className="muted player__time">
          {formatTime(player.position)} / {formatTime(material.duration)}
        </span>
        <button
          type="button"
          className={`quiet player__loop${player.loop ? ' is-active' : ''}`}
          aria-label="单句循环"
          aria-pressed={player.loop}
          title="单句循环"
          onClick={() => player.setLoop(!player.loop)}
        >
          <LoopIcon />
        </button>
        {!focus && (
          <>
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
          </>
        )}
        {focus && replayButton}
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
  const showVideo = player.kind === 'video' && Boolean(player.videoSrc);
  const presence = usePresence(showVideo && player.videoSurface === 'visible', MOTION_MS.short);
  if (showVideo) {
    const hidden = presence === 'exited';
    return (
      <div
        className={`media-output${hidden ? ' media-output--hidden' : ''}`}
        data-motion={hidden ? undefined : presence}
        aria-hidden={hidden || presence === 'leaving' || undefined}
      >
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
