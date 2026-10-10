import { useEffect, useRef, type RefObject } from 'react';

type Props = {
  text: string;
  onChange: (text: string) => void;
  onKeySound: () => void;
  onCheck: () => void;
  label: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
};

export function SentenceEditor({ text, onChange, onKeySound, onCheck, label, inputRef }: Props) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? localRef;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = '0px';
    node.style.height = `${Math.max(120, node.scrollHeight)}px`;
  }, [text, ref]);

  return (
    <div className="sentence-editor" role="group" aria-label={label}>
      <textarea
        ref={ref}
        className="sentence-editor__field"
        aria-label={label}
        value={text}
        rows={3}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="听完本句后，在这里整句听写…"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1)
            onKeySound();
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onCheck();
          }
        }}
      />
    </div>
  );
}
