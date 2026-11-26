import { useEffect, useState } from 'react';
import { MOTION_MS, usePresence } from '../../app/motion';
import type { UserFacingError } from './import-messages';

type Props = UserFacingError & { onClose?: () => void };

export function ImportFailure({ message, detail, onClose }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  const presence = usePresence(open, MOTION_MS.short);
  return (
    <div
      className="banner banner--error import__failure"
      data-motion={presence === 'exited' ? 'entering' : presence}
      role="alert"
    >
      <div className="import__failure-body">
        <p>{message}</p>
        {detail ? (
          <details>
            <summary>详情</summary>
            <pre>{detail}</pre>
          </details>
        ) : null}
      </div>
      {onClose ? (
        <button type="button" className="quiet" onClick={onClose}>
          关闭
        </button>
      ) : null}
    </div>
  );
}
