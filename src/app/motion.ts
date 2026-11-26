/** Motion tokens. Keep the millisecond values in sync with `--motion-*` in styles.css. */
import { useEffect, useRef, useState } from 'react';

export const MOTION_MS = {
  micro: 100,
  short: 180,
  page: 240,
} as const;

export type Presence = 'exited' | 'entering' | 'entered' | 'leaving';

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

/** Pure step used by `usePresence`. Leaving + open interrupts back to entered. */
export function nextPresence(current: Presence, open: boolean, reduced: boolean): Presence {
  if (reduced) return open ? 'entered' : 'exited';
  if (open) {
    if (current === 'entered' || current === 'entering') return current;
    if (current === 'leaving') return 'entered';
    return 'entering';
  }
  if (current === 'exited') return 'exited';
  return 'leaving';
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return reduced;
}

/**
 * Keeps a layer mounted through its leave transition and can be interrupted
 * mid-way instead of queuing a second animation.
 */
export function usePresence(open: boolean, durationMs: number = MOTION_MS.short): Presence {
  const reduced = useReducedMotion();
  const [presence, setPresence] = useState<Presence>(() => (open ? 'entered' : 'exited'));
  const presenceRef = useRef(presence);
  presenceRef.current = presence;

  useEffect(() => {
    const next = nextPresence(presenceRef.current, open, reduced);
    if (reduced) {
      setPresence(next);
      return;
    }
    let frame = 0;
    let timeout = 0;
    if (open) {
      if (presenceRef.current === 'entered') return;
      if (next === 'entered') {
        setPresence('entered');
        return;
      }
      setPresence('entering');
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setPresence('entered'));
      });
    } else {
      if (presenceRef.current === 'exited') return;
      setPresence('leaving');
      timeout = window.setTimeout(() => setPresence('exited'), durationMs);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [open, durationMs, reduced]);

  return presence;
}
