import { useEffect, useRef, useState, type RefObject } from 'react';
import { compareWords, draftWords } from './domain';

type Props = {
  text: string;
  onChange: (text: string) => void;
  onKeySound: (kind?: 'key' | 'correct' | 'wrong') => void;
  reference: string;
  onCheck: () => void;
  label: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
};

export function SentenceEditor({
  text,
  onChange,
  onKeySound,
  onCheck,
  label,
  inputRef,
  reference,
}: Props) {
  const [feedback, setFeedback] = useState('');
  const [mode, setMode] = useState('word');
  const [composing, setComposing] = useState(false);
  const composition = useRef(false);
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? localRef;

  function handleChange(value: string) {
    if (composition.current) return;
    onChange(value);
    if (value.length <= text.length) {
      setFeedback('');
      return;
    }
    if (mode === 'blind' || !reference.trim()) {
      setFeedback('');
      onKeySound();
      return;
    }
    if (mode === 'word' && !/\s$/.test(value)) {
      onKeySound();
      return;
    }
    const words = draftWords(value);
    const correct =
      mode === 'letter'
        ? reference.toLowerCase().startsWith(value.toLowerCase())
        : compareWords(words, draftWords(reference).slice(0, words.length).join(' ')).every(
            (word) => word.kind === 'same',
          );
    setFeedback(correct ? '输入正确' : '请检查输入');
    onKeySound(correct ? 'correct' : 'wrong');
  }

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = '0px';
    node.style.height = `${Math.max(120, node.scrollHeight)}px`;
  }, [text, ref]);

  return (
    <div className="sentence-editor" role="group" aria-label={label}>
      <label>
        打字反馈{' '}
        <select
          aria-label="打字反馈"
          value={mode}
          onChange={(event) => {
            setMode(event.target.value);
            setFeedback('');
          }}
        >
          <option value="letter">逐字母</option>
          <option value="word">逐词</option>
          <option value="blind">盲写</option>
        </select>
      </label>
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
        onChange={(event) => handleChange(event.target.value)}
        onCompositionStart={() => {
          composition.current = true;
          setComposing(true);
        }}
        onCompositionEnd={(event) => {
          composition.current = false;
          setComposing(false);
          event.currentTarget.value = text;
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || composition.current || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onCheck();
          }
        }}
      />
      <span role="status" className="sentence-editor__feedback" key={feedback + text}>
        {composing
          ? '请切换到英文输入法；组合输入不会保存到听写内容。'
          : mode === 'blind'
            ? '盲写：核对后查看结果'
            : feedback}
      </span>
    </div>
  );
}
