import type { CSSProperties, ReactNode } from 'react';
import { MOTION_MS, usePresence, type Presence } from './motion';

interface Props {
  open: boolean;
  className?: string;
  role?: string;
  origin?: 'top-right' | 'top-center' | 'top-left';
  style?: CSSProperties;
  'aria-label'?: string;
  children: ReactNode;
}

const hidden: Presence[] = ['exited'];

export function MotionPop({
  open,
  className,
  role,
  origin = 'top-right',
  style,
  children,
  ...rest
}: Props) {
  const presence = usePresence(open, MOTION_MS.short, true);
  if (hidden.includes(presence)) return null;
  const leaving = presence === 'leaving';
  return (
    <div
      className={className}
      data-motion={presence}
      data-origin={origin}
      role={role}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}
