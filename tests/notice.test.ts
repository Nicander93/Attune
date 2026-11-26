import { afterEach, describe, expect, it } from 'vitest';
import {
  INFO_TOAST_MS,
  UNDO_WINDOW_MS,
  setUndoWindowForTests,
  undoWindowMs,
} from '../src/app/notice';

describe('notice timings', () => {
  afterEach(() => setUndoWindowForTests(undefined));

  it('uses a short default for info toasts and a longer undo window', () => {
    expect(INFO_TOAST_MS).toBe(5000);
    expect(UNDO_WINDOW_MS).toBe(8000);
    expect(undoWindowMs()).toBe(8000);
  });

  it('can shorten the undo window for tests', () => {
    setUndoWindowForTests(200);
    expect(undoWindowMs()).toBe(200);
  });
});
