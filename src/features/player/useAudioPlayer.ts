import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Material, SubtitleSegment } from '../../domain/types';

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;

/** What the player can be told to do, independent of who is listening. */
export type PlayerMode = 'segment' | 'continuous';

export type AudioPlayer = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  src: string;
  playing: boolean;
  position: number;
  speed: number;
  loop: boolean;
  mode: PlayerMode;
  /** Sentence the audio is inside. Null when there are no subtitles or we are between them. */
  playbackSegment: SubtitleSegment | undefined;
  /** False when there is nothing to navigate by, e.g. audio without subtitles. */
  canStep: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  unreadable: boolean;
  setSpeed: (rate: number) => void;
  setLoop: (loop: boolean) => void;
  setMode: (mode: PlayerMode) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  playFrom: (seconds: number) => void;
  seek: (seconds: number) => void;
  /** Moves to a sentence start. Never decides which sentence the user is typing into. */
  goToSegment: (id: string, options?: { play?: boolean }) => void;
  previous: () => void;
  next: () => void;
  replay: () => void;
};

/**
 * Owns the audio element and sentence navigation.
 *
 * Deliberately separate from whatever sentence the user is editing: during continuous
 * playback the audio walks forward on its own, and forcing the input field to follow
 * would throw away the draft. Callers read `playbackSegment` when they want to follow
 * along, and keep their own cursor for typing.
 */
export function useAudioPlayer(
  material: Material,
  onPositionChange?: (seconds: number) => void,
): AudioPlayer {
  const segments = material.segments;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(material.playbackPosition);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [mode, setMode] = useState<PlayerMode>('segment');
  const [src, setSrc] = useState('');
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    if (!(material.audio instanceof Blob)) {
      setSrc('');
      setUnreadable(true);
      return;
    }
    const objectUrl = URL.createObjectURL(material.audio);
    setSrc(objectUrl);
    setUnreadable(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [material.audio]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, src]);

  const index = useMemo(
    () => segments.findIndex((s) => position >= s.start && position < s.end),
    [segments, position],
  );
  const playbackSegment = index >= 0 ? segments[index] : undefined;

  const play = useCallback(() => void audioRef.current?.play().catch(() => setPlaying(false)), []);

  /** Stopping is the point where the playback position becomes worth writing down. */
  const pause = useCallback(() => {
    const player = audioRef.current;
    if (player && !player.paused) onPositionChange?.(player.currentTime);
    player?.pause();
  }, [onPositionChange]);

  const playFrom = useCallback((seconds: number) => {
    const player = audioRef.current;
    if (!player) return;
    player.currentTime = seconds;
    setPosition(seconds);
    void player.play().catch(() => setPlaying(false));
  }, []);

  /**
   * Moves the audio without persisting. `timeupdate` fires several times a second, so
   * routing it through storage would rewrite the material on every tick.
   */
  const seek = useCallback((seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setPosition(seconds);
  }, []);

  const goToSegment = useCallback(
    (id: string, options?: { play?: boolean }) => {
      const target = segments.find((s) => s.id === id);
      if (!target) return;
      pause();
      if (options?.play) playFrom(target.start);
      else seek(target.start);
      onPositionChange?.(target.start);
    },
    [segments, pause, playFrom, seek, onPositionChange],
  );

  /**
   * Always lands on the previous sentence's start, even when already part way into the
   * current one. The two-step "back to sentence start first" behaviour makes rehearsing
   * a single line need one extra keypress every time.
   */
  const previous = useCallback(() => {
    if (!segments.length) return;
    const current = playbackSegment ?? segments[segments.length - 1];
    const at = segments.findIndex((s) => s.id === current.id);
    if (at > 0) goToSegment(segments[at - 1].id);
  }, [segments, playbackSegment, goToSegment]);

  const next = useCallback(() => {
    if (!playbackSegment) return;
    const at = segments.findIndex((s) => s.id === playbackSegment.id);
    if (at >= 0 && at < segments.length - 1) goToSegment(segments[at + 1].id);
  }, [segments, playbackSegment, goToSegment]);

  const replay = useCallback(() => {
    if (playbackSegment) playFrom(playbackSegment.start);
  }, [playbackSegment, playFrom]);

  const toggle = useCallback(() => {
    if (audioRef.current?.paused) play();
    else pause();
  }, [play, pause]);

  return {
    audioRef,
    src,
    playing,
    position,
    speed,
    loop,
    mode,
    playbackSegment,
    canStep: segments.length > 0,
    hasPrevious: index > 0,
    hasNext: index >= 0 && index < segments.length - 1,
    unreadable,
    setSpeed,
    setLoop,
    setMode,
    toggle,
    play,
    pause,
    playFrom,
    seek,
    goToSegment,
    previous,
    next,
    replay,
  };
}

/**
 * Stops at the end of the current sentence unless looping, and wraps in continuous mode.
 * Returns the time handler to put on the <audio> element.
 */
export function useSentenceStop(player: AudioPlayer): (time: number) => void {
  const { loop, mode, playbackSegment } = player;
  return useCallback(
    (time: number) => {
      if (!playbackSegment) return;
      if (time < playbackSegment.end - 0.03) return;
      if (loop) {
        player.seek(playbackSegment.start);
        return;
      }
      if (mode === 'segment') player.pause();
    },
    [player, loop, mode, playbackSegment],
  );
}
