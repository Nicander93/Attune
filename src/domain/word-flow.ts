import type { DiffWord } from './types';

/** One visual word in the editor, with the character range it covers in the source text. */
export interface WordToken {
  text: string;
  start: number;
  end: number;
  /** True for the gap between two words, which carries no text of its own. */
  space: boolean;
}

const isSpace = (char: string) => /\s/.test(char);

/**
 * Splits source text into alternating word and space tokens.
 *
 * The character ranges are exact and always cover the whole string, so a caret
 * position in the textarea maps straight onto a token. That is what lets the editor
 * stay a single native text model instead of a pile of inputs.
 */
export function tokenizeForDisplay(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  let index = 0;
  while (index < text.length) {
    const space = isSpace(text[index]);
    let end = index;
    while (end < text.length && isSpace(text[end]) === space) end += 1;
    tokens.push({ text: text.slice(index, end), start: index, end, space });
    index = end;
  }
  return tokens;
}

/**
 * Typing punctuation alone must not create an underlined "word", so a trailing
 * punctuation run rides along with the word before it. `sorry ,` and `sorry,` render
 * the same way, which is the visual normalisation the spec asks for - the source text
 * itself is never rewritten, so undo and the caret stay intact.
 */
export function groupTokens(tokens: WordToken[]): WordToken[] {
  const out: WordToken[] = [];
  for (const token of tokens) {
    if (!token.space && /^[\p{P}\p{S}]+$/u.test(token.text)) {
      // Look past any spaces: `sorry ,` and `sorry,` should draw the same way.
      const previousWord = out.filter((t) => !t.space).at(-1);
      if (previousWord) {
        previousWord.text += token.text;
        previousWord.end = token.end;
        continue;
      }
    }
    out.push({ ...token });
  }
  return out;
}

/**
 * Words the user wrote that are not in the reference at all, and reference words they
 * never wrote. Grouped so the panel can say what happened without listing everything.
 */
export function summarizeDiff(diff: DiffWord[]) {
  return {
    missing: diff.filter((w) => w.kind === 'missing').map((w) => w.text),
    extra: diff.filter((w) => w.kind === 'extra').map((w) => w.text),
  };
}
