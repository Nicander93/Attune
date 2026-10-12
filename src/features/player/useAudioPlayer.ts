import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Material, SubtitleSegment } from '../../domain/types';

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
export type PlayerMode = 'segment' | 'continuous';

export function useAudioPlayer(
  material: Material,
  onPositionChange?: (seconds: number) => void,
  onSettingsChange?: (settings: NonNullable<Material['playbackSettings']>) => void,
  onPlay?: () => void,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const callbacks = useRef({ onPositionChange, onSettingsChange, onPlay });
  callbacks.current = { onPositionChange, onSettingsChange, onPlay };
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(material.playbackPosition);
  const [speed, setSpeedState] = useState(material.playbackSettings?.speed ?? 1);
  const [loop, setLoopState] = useState(material.playbackSettings?.loop ?? false);
  const [mode, setModeState] = useState<PlayerMode>(
    material.playbackSettings?.mode ?? (material.lastView === 'reading' ? 'continuous' : 'segment'),
  );
  const [src, setSrc] = useState('');
  const [unreadable, setUnreadable] = useState(false);
  // timeupdate can jump over a boundary. Keep the sentence selected at play/seek
  // time instead of rediscovering it from the next timeupdate.
  const stopSegment = useRef<SubtitleSegment | undefined>(undefined);
  const segmentAt = useCallback(
    (time: number) => material.segments.find((s) => time >= s.start && time < s.end),
    [material.segments],
  );
  useEffect(() => {
    if (!(material.audio instanceof Blob) || !material.audio.size) {
      setUnreadable(true);
      return;
    }
    const url = URL.createObjectURL(material.audio);
    setSrc(url);
    setUnreadable(false);
    return () => URL.revokeObjectURL(url);
  }, [material.audio]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, src]);
  useEffect(() => {
    const node = audioRef.current;
    const savePosition = () => {
      // StrictMode probes cleanup before metadata loads; that zero is not a resume position.
      if (node && node.readyState >= 1 && Number.isFinite(node.currentTime))
        callbacks.current.onPositionChange?.(node.currentTime);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') savePosition();
    };
    window.addEventListener('pagehide', savePosition);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', savePosition);
      document.removeEventListener('visibilitychange', onHide);
      savePosition();
      node?.pause();
    };
  }, []);
  const playbackSegment = useMemo(() => segmentAt(position), [segmentAt, position]);
  const index = material.segments.findIndex((s) => s.id === playbackSegment?.id);
  const persistPosition = () => {
    if (audioRef.current) callbacks.current.onPositionChange?.(audioRef.current.currentTime);
  };
  const play = useCallback(() => {
    const node = audioRef.current;
    if (!node) return;
    stopSegment.current = segmentAt(node.currentTime);
    void node.play().catch(() => setPlaying(false));
  }, [segmentAt]);
  const pause = useCallback(() => audioRef.current?.pause(), []);
  const seek = useCallback(
    (seconds: number) => {
      const node = audioRef.current;
      if (!node) return;
      const time = Math.max(0, Math.min(seconds, material.duration));
      node.currentTime = time;
      setPosition(time);
      stopSegment.current = segmentAt(time);
      callbacks.current.onPositionChange?.(time);
    },
    [material.duration, segmentAt],
  );
  const playFrom = (seconds: number) => {
    seek(seconds);
    play();
  };
  const goToSegment = (id: string, options?: { play?: boolean }) => {
    const target = material.segments.find((s) => s.id === id);
    if (!target) return;
    pause();
    seek(target.start);
    if (options?.play) play();
  };
  const updateSettings = (patch: Partial<NonNullable<Material['playbackSettings']>>) => {
    callbacks.current.onSettingsChange?.({ speed, loop, mode, ...patch });
  };
  return {
    audioRef,
    src,
    playing,
    position,
    speed,
    loop,
    mode,
    playbackSegment,
    canStep: material.segments.length > 0,
    hasPrevious: index > 0,
    hasNext: index >= 0 && index < material.segments.length - 1,
    unreadable,
    setSpeed: (value: number) => {
      setSpeedState(value);
      updateSettings({ speed: value });
    },
    setLoop: (value: boolean) => {
      setLoopState(value);
      updateSettings({ loop: value });
    },
    setMode: (value: PlayerMode) => {
      setModeState(value);
      updateSettings({ mode: value });
    },
    play,
    pause,
    seek,
    playFrom,
    goToSegment,
    toggle: () => (audioRef.current?.paused ? play() : pause()),
    previous: () => {
      if (index > 0) goToSegment(material.segments[index - 1].id);
    },
    next: () => {
      if (index >= 0 && index < material.segments.length - 1)
        goToSegment(material.segments[index + 1].id);
    },
    replay: () => {
      if (playbackSegment) playFrom(playbackSegment.start);
    },
    handlePlay: () => {
      setPlaying(true);
      callbacks.current.onPlay?.();
    },
    handlePause: () => {
      setPlaying(false);
      persistPosition();
    },
    handleError: () => {
      setPlaying(false);
      setUnreadable(true);
    },
    handleTimeUpdate: (time: number) => {
      const target = stopSegment.current;
      if (target && time >= target.end) {
        if (loop) {
          seek(target.start);
          return;
        }
        if (mode === 'segment') {
          pause();
          seek(Math.max(target.start, target.end - 0.001));
          return;
        }
      }
      setPosition(time);
    },
    handleMetadata: () => {
      const node = audioRef.current;
      if (!node) return;
      node.currentTime = Math.min(material.playbackPosition, material.duration);
      node.playbackRate = speed;
      stopSegment.current = segmentAt(node.currentTime);
    },
  };
}
export type AudioPlayer = ReturnType<typeof useAudioPlayer>;
