import { useRef } from 'react';
import { tokenize } from './domain';
type Props = {
  words: string[];
  onChange: (words: string[]) => void;
  onKeySound: () => void;
  label: string;
};
export function WordEditor({ words, onChange, onKeySound, label }: Props) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const active = useRef(0);
  const shown = words.length && words.at(-1) === '' ? words : [...words, ''];
  function update(index: number, value: string) {
    const next = [...shown];
    next[index] = value;
    onChange(next);
  }
  function move(index: number) {
    requestAnimationFrame(() => {
      refs.current[index]?.focus();
      refs.current[index]?.setSelectionRange(
        refs.current[index]!.value.length,
        refs.current[index]!.value.length,
      );
    });
  }
  return (
    <div className="word-editor" role="group" aria-label={label}>
      {shown.map((word, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          aria-label={`${label}，第 ${index + 1} 个词`}
          value={word}
          size={Math.max(4, word.length + 1)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onFocus={() => {
            active.current = index;
          }}
          onChange={(event) => {
            const value = event.target.value;
            if (/\s/.test(value)) {
              const added = tokenize(value);
              if (!added.length) return;
              const next = [...shown];
              next.splice(index, 1, ...added);
              if (/\s$/.test(value) && index + added.length === next.length) next.push('');
              onChange(next);
              move(Math.min(index + added.length - (/\s$/.test(value) ? 0 : 1), next.length - 1));
            } else update(index, value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (!event.ctrlKey && !event.metaKey && event.key.length === 1) onKeySound();
            if (event.code === 'Space') {
              event.preventDefault();
              if (!word) return;
              if (index === shown.length - 1) onChange([...shown, '']);
              move(index + 1);
            }
            if (event.key === 'Backspace' && !word && index > 0) {
              event.preventDefault();
              const next = [...shown];
              next.splice(index, 1);
              onChange(next);
              move(index - 1);
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            const pasted = tokenize(event.clipboardData.getData('text'));
            if (!pasted.length) return;
            const target = event.currentTarget,
              start = target.selectionStart ?? word.length,
              end = target.selectionEnd ?? start;
            const added = [...pasted];
            added[0] = word.slice(0, start) + added[0];
            added[added.length - 1] += word.slice(end);
            const next = [...shown];
            next.splice(index, 1, ...added);
            onChange(next);
            move(index + added.length - 1);
          }}
        />
      ))}
      <button
        className="quiet skip-word"
        type="button"
        onClick={() => {
          const index = active.current,
            next = [...shown];
          if (!next[index]) next[index] = '…';
          if (index === next.length - 1) next.push('');
          onChange(next);
          move(index + 1);
        }}
      >
        留空 →
      </button>
    </div>
  );
}
