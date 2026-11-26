/** Shared notice / toast types and timings for UX-3. */
export interface NoticeAction {
  label: string;
  onClick: () => void;
}

export type NoticeKind = 'info' | 'error';

export interface NoticeOptions {
  kind?: NoticeKind;
  action?: NoticeAction;
  /** Defaults to INFO_TOAST_MS for plain info, or UNDO_WINDOW_MS when an action is present. */
  durationMs?: number;
}

export type ShowNotice = (message: string, options?: NoticeOptions) => void;

export const INFO_TOAST_MS = 5000;
export const UNDO_WINDOW_MS = 8000;

declare global {
  interface Window {
    /** Playwright and smoke scripts may shorten the undo window. */
    __ATTUNE_UNDO_MS?: number;
  }
}

let undoWindowOverride: number | undefined;

export function setUndoWindowForTests(ms: number | undefined): void {
  undoWindowOverride = ms;
}

export function undoWindowMs(): number {
  if (typeof undoWindowOverride === 'number') return undoWindowOverride;
  if (typeof window !== 'undefined' && typeof window.__ATTUNE_UNDO_MS === 'number') {
    return window.__ATTUNE_UNDO_MS;
  }
  return UNDO_WINDOW_MS;
}
