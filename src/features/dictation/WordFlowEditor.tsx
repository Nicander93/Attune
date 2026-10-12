import { useEffect, useMemo, useRef, useState } from 'react';
import { tokenizeForDisplay } from '../../domain/word-flow';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onCheck: () => void;
  /** Esc after a check returns to editing; otherwise it releases input focus. */
  onEscape: () => void;
  /** Reference text is never rendered before 核对答案 - it would give the answer away. */
  checked: boolean;
  ariaLabel: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
};

/**
 * Dictation input as a word flow.
 *
 * Under the hood it is one plain textarea holding the real text, with a mirror layer
 * drawing the underlines. Keeping a single native text model is deliberate: selection,
 * Ctrl+A/C/V/X/Z/Y, click-to-place and IME composition all keep working, which a
 * screen full of inputs would break.
 */
export function WordFlowEditor({
  value,
  onChange,
  onCheck,
  onEscape,
  checked,
  ariaLabel,
  inputRef,
}: Props) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? localRef;
  const [caret, setCaret] = useState({ start: 0, end: 0 });

  // Mirror the exact editable string so punctuation spaces, selection and the caret
  // keep the same coordinates as the native textarea.
  const tokens = useMemo(() => tokenizeForDisplay(value), [value]);
  const collapsed = caret.start === caret.end;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onSelect = () =>
      setCaret({ start: node.selectionStart ?? 0, end: node.selectionEnd ?? 0 });
    node.addEventListener('select', onSelect);
    node.addEventListener('keyup', onSelect);
    node.addEventListener('click', onSelect);
    return () => {
      node.removeEventListener('select', onSelect);
      node.removeEventListener('keyup', onSelect);
      node.removeEventListener('click', onSelect);
    };
  }, [ref]);

  return (
    <div className={`flow${checked ? ' flow--checked' : ''}`}>
      {/* The mirror draws the underlines underneath; the textarea sits on top with
          transparent text so it stays the only real editor. Both share the same box
          metrics, so the underlines land exactly under each word. */}
      <div className="flow__mirror" aria-hidden="true">
        {tokens.map((token, i) =>
          token.space ? (
            <span key={i}>{token.text}</span>
          ) : (
            <span
              key={i}
              className={`flow__word${
                collapsed && caret.start >= token.start && caret.start < token.end
                  ? ' flow__word--active'
                  : ''
              }`}
            >
              {token.text}
            </span>
          ),
        )}
        {tokenizeForDisplay(value).length === 0 && (
          <span className="flow__placeholder">听完这句，写下来…</span>
        )}
      </div>
      <textarea
        ref={ref}
        className="flow__input"
        aria-label={ariaLabel}
        value={value}
        rows={2}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          const mirror = event.currentTarget.previousElementSibling;
          if (mirror) mirror.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onCheck();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            if (checked) onEscape();
            else event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
