import { useCallback, useRef, useState, type ReactNode } from 'react';

export function ConfirmPanel({
  message,
  confirmLabel,
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="confirm-panel" role="dialog" aria-modal="false" aria-label={message}>
      <p className="confirm-panel__message">{message}</p>
      <div className="confirm-panel__actions">
        <button type="button" className="primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Holds one in-page confirmation at a time and returns it as a promise,
 * so callers can replace window.confirm without a system dialog.
 */
export function useConsent(): {
  confirm: (message: string, confirmLabel?: string) => Promise<boolean>;
  panel: ReactNode;
  open: boolean;
} {
  const pending = useRef<{ resolve: (ok: boolean) => void } | null>(null);
  const [request, setRequest] = useState<{ message: string; confirmLabel: string } | null>(null);

  const confirm = useCallback((message: string, confirmLabel = '同意') => {
    pending.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = { resolve };
      setRequest({ message, confirmLabel });
    });
  }, []);

  function settle(ok: boolean) {
    pending.current?.resolve(ok);
    pending.current = null;
    setRequest(null);
  }

  const panel = request ? (
    <ConfirmPanel
      message={request.message}
      confirmLabel={request.confirmLabel}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, panel, open: Boolean(request) };
}
