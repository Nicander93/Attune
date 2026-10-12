import { describe, expect, it } from 'vitest';
import { groupTokens, summarizeDiff, tokenizeForDisplay } from '../src/domain/word-flow';
import { compareWords } from '../src/domain/text';

const words = (text: string) =>
  groupTokens(tokenizeForDisplay(text))
    .filter((t) => !t.space)
    .map((t) => t.text);

describe('display tokens', () => {
  it('covers the whole string with exact character ranges', () => {
    const text = 'Hello  world';
    const tokens = tokenizeForDisplay(text);
    expect(tokens[0]).toMatchObject({ text: 'Hello', start: 0, end: 5, space: false });
    expect(tokens[1]).toMatchObject({ text: '  ', start: 5, end: 7, space: true });
    expect(tokens[2]).toMatchObject({ text: 'world', start: 7, end: 12, space: false });
    expect(tokens.map((t) => t.text).join('')).toBe(text);
  });

  it('handles an empty string and a trailing space', () => {
    expect(tokenizeForDisplay('')).toEqual([]);
    expect(tokenizeForDisplay('a ').map((t) => t.text)).toEqual(['a', ' ']);
  });

  it('marks the exact range of each word so a caret position can be located', () => {
    const tokens = groupTokens(tokenizeForDisplay('Hello world'));
    expect(tokens.filter((t) => !t.space)).toMatchObject([
      { text: 'Hello', start: 0, end: 5 },
      { text: 'world', start: 6, end: 11 },
    ]);
  });
});

describe('punctuation grouping', () => {
  it('renders `sorry ,` the same way as `sorry,`', () => {
    expect(words('sorry ,')).toEqual(['sorry,']);
    expect(words('sorry,')).toEqual(['sorry,']);
  });

  it('never rewrites the source text', () => {
    const source = 'sorry ,';
    expect(
      tokenizeForDisplay(source)
        .map((t) => t.text)
        .join(''),
    ).toBe(source);
  });

  it('keeps a full stop with its word and leaves ellipses alone', () => {
    expect(words('Wait... really')).toEqual(['Wait...', 'really']);
    expect(words('one. two')).toEqual(['one.', 'two']);
  });
});

describe('difference summary', () => {
  it('separates what was missed from what was added', () => {
    const summary = summarizeDiff(
      compareWords(['I', 'really', 'like', 'tea'], 'I like green tea.'),
    );
    expect(summary.missing).toEqual(['green']);
    expect(summary.extra).toEqual(['really']);
  });

  it('never counts punctuation as a difference', () => {
    expect(summarizeDiff(compareWords(['Hello', 'world'], 'Hello, world!'))).toEqual({
      missing: [],
      extra: [],
    });
  });
});
