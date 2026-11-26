import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MOTION_MS, prefersReducedMotion, usePresence } from './motion';

interface Props {
  open: boolean;
  /** When this changes while open, replay the short enter so loading / success / failure share one beat. */
  beat?: string;
  className?: string;
  role?: string;
  children: ReactNode;
}

/**
 * Enter and leave for import and study status lines.
 *
 * Loading, success and failure all use the short token and can be interrupted.
 * The previous copy is held through the leave so the text does not snap away.
 */
export function StatusBeat({ open, beat, className, role, children }: Props) {
  const presence = usePresence(open, MOTION_MS.short);
  const [swap, setSwap] = useState(0);
  const prevBeat = useRef(beat);
  const held = useRef(children);
  if (open) held.current = children;

  useLayoutEffect(() => {
    if (open && beat && prevBeat.current && prevBeat.current !== beat && !prefersReducedMotion()) {
      setSwap((n) => n + 1);
    }
    prevBeat.current = beat;
  }, [beat, open]);

  if (presence === 'exited') return null;
  return (
    <div className={className} data-motion={presence} data-swap={swap || undefined} role={role}>
      {held.current}
    </div>
  );
}
