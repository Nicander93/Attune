import { useEffect } from 'react';
import { usePresence } from './motion';
import type { NoticeAction, NoticeKind } from './notice';

export interface ToastItem {
  id: string;
  message: string;
  kind?: NoticeKind;
  action?: NoticeAction;
  open: boolean;
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const presence = usePresence(toast.open);
  if (!toast.open && presence === 'exited') return null;
  const motion = toast.open && presence === 'exited' ? 'entering' : presence;
  const error = toast.kind === 'error';
  return (
    <div
      className={error ? 'toast toast--error' : 'toast'}
      data-motion={motion}
      role={error ? 'alert' : 'status'}
    >
      <p className="toast__message">{toast.message}</p>
      <div className="toast__actions">
        {toast.action && (
          <button type="button" className="quiet" onClick={toast.action.onClick}>
            {toast.action.label}
          </button>
        )}
        <button
          type="button"
          className="toast__close quiet"
          aria-label="关闭提示"
          onClick={() => onDismiss(toast.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [role="menu"]')) return;
      // Leave Esc to the study page when a check result is on screen.
      if (document.querySelector('.study--focus .diff')) return;
      const top = [...toasts].reverse().find((toast) => toast.open);
      if (!top) return;
      event.preventDefault();
      onDismiss(top.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toasts, onDismiss]);

  if (!toasts.length) return null;
  return (
    <div className="toast-host">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
