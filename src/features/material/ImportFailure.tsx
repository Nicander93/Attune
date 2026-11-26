import type { UserFacingError } from './import-messages';

type Props = UserFacingError & { onClose?: () => void };

export function ImportFailure({ message, detail, onClose }: Props) {
  return (
    <div className="banner banner--error import__failure" role="alert">
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
