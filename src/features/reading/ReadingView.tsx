import { useEffect, useMemo, useRef, useState } from 'react';
import type { Material } from '../../domain/types';
import { activeWordIndex } from '../../domain/timing';

type Props = {
  material: Material;
  /** Sentence the audio is inside right now. */
  currentId: string | undefined;
  /** Word index inside `currentId`, or -1 when there are no word timings. */
  activeWord: number;
  /** Revealed only for sentences already checked, or when the user asks for them. */
  revealAll: boolean;
  completed: Set<string>;
  onRevealAll: (reveal: boolean) => void;
  onSeekWord: (segmentId: string, wordIndex: number) => void;
  onSettingsChange: (settings: NonNullable<Material['studySettings']>) => void;
};

type Lang = 'en' | 'zh' | 'both';

const LANG_LABELS: { value: Lang; label: string }[] = [
  { value: 'en', label: '英文' },
  { value: 'zh', label: '中文' },
  { value: 'both', label: '双语' },
];

/**
 * 听读 reads as continuous prose with the current sentence highlighted, not as a stack
 * of sentence cards. Auto-follow is a separate switch from showing the original text,
 * so someone reading along can turn following off without losing the text.
 */
export function ReadingView(props: Props) {
  const { material } = props;
  const [lang, setLang] = useState<Lang>(material.studySettings?.language ?? 'en');
  const [following, setFollowing] = useState(material.studySettings?.following ?? true);
  const list = useRef<HTMLOListElement>(null);
  const suppressedUntil = useRef(0);
  const [suppressed, setSuppressed] = useState(false);

  const translated = useMemo(
    () => material.segments.some((s) => s.translation?.trim()),
    [material.segments],
  );

  useEffect(() => {
    if (!following || !props.currentId) return;
    const follow = () => {
      setSuppressed(false);
      const node = list.current?.querySelector(`[data-segment="${props.currentId}"]`);
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    const delay = suppressedUntil.current - Date.now();
    if (delay <= 0) {
      follow();
      return;
    }
    const timer = setTimeout(follow, delay);
    return () => clearTimeout(timer);
  }, [following, props.currentId, suppressed]);

  // Scrolling by hand takes over for a while; then following resumes on its own.
  const onManualScroll = () => {
    if (!following) return;
    suppressedUntil.current = Date.now() + 4000;
    setSuppressed(true);
  };

  const showEnglish = lang !== 'zh' || !translated;
  const showChinese = lang !== 'en';

  return (
    <div className="reading">
      <div className="reading__bar">
        <div className="mode" role="group" aria-label="显示语言">
          {LANG_LABELS.map(({ value, label }) => (
            <button
              key={value}
              aria-pressed={lang === value}
              onClick={() => {
                setLang(value);
                props.onSettingsChange({ language: value });
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="muted">
          <input
            type="checkbox"
            checked={following}
            onChange={(event) => {
              setFollowing(event.target.checked);
              props.onSettingsChange({ following: event.target.checked });
            }}
          />{' '}
          自动跟随
        </label>
        <label className="muted">
          <input
            type="checkbox"
            checked={props.revealAll}
            onChange={(event) => props.onRevealAll(event.target.checked)}
          />{' '}
          显示未听写的原文
        </label>
        {(!following || suppressed) && props.currentId && (
          <button
            className="quiet"
            onClick={() => {
              suppressedUntil.current = 0;
              setSuppressed(false);
              setFollowing(true);
              props.onSettingsChange({ following: true });
            }}
          >
            回到当前句
          </button>
        )}
      </div>

      {!translated && lang !== 'en' && (
        <p className="muted reading__note">这份字幕没有中文译文，导入双语字幕后这里会显示中文。</p>
      )}

      <ol
        className="reading__text"
        ref={list}
        onWheel={onManualScroll}
        onTouchMove={onManualScroll}
      >
        {material.segments.map((segment, index) => {
          const isCurrent = segment.id === props.currentId;
          const checked = props.completed.has(segment.id);
          const visible = checked || props.revealAll;
          const wordTimings = segment.words;
          return (
            <li
              key={segment.id}
              data-segment={segment.id}
              className={`reading__line${isCurrent ? ' is-current' : ''}`}
            >
              <span className="reading__index muted">{index + 1}</span>
              <div className="reading__pair">
                {showEnglish &&
                  (visible ? (
                    wordTimings.length ? (
                      <p className="reading__en">
                        {wordTimings.map((word, i) => (
                          <button
                            key={i}
                            className={`reading__word${
                              isCurrent && i === props.activeWord ? ' is-active' : ''
                            }`}
                            onClick={() => props.onSeekWord(segment.id, i)}
                          >
                            {word.text}
                          </button>
                        ))}
                      </p>
                    ) : (
                      <p className="reading__en">{segment.reference}</p>
                    )
                  ) : (
                    <p className="reading__en muted">（这句还没听写，原文已隐藏）</p>
                  ))}
                {showChinese && visible && segment.translation && (
                  <p className="reading__zh">{segment.translation}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Word index inside the current sentence, or -1 when it has no word timings. */
export function useActiveWord(material: Material, segmentId: string | undefined, position: number) {
  return useMemo(() => {
    const segment = material.segments.find((s) => s.id === segmentId);
    if (!segment?.words.length) return -1;
    return activeWordIndex(segment.words, position);
  }, [material.segments, segmentId, position]);
}
