import { describe, expect, it } from 'vitest';
import { MOTION_MS, nextPresence, type Presence } from '../src/app/motion';

describe('motion tokens', () => {
  it('keeps one set of durations inside the agreed ranges', () => {
    expect(MOTION_MS.micro).toBeGreaterThanOrEqual(80);
    expect(MOTION_MS.micro).toBeLessThanOrEqual(120);
    expect(MOTION_MS.short).toBeGreaterThanOrEqual(160);
    expect(MOTION_MS.short).toBeLessThanOrEqual(200);
    expect(MOTION_MS.page).toBeGreaterThanOrEqual(220);
    expect(MOTION_MS.page).toBeLessThanOrEqual(280);
  });
});

describe('presence', () => {
  it('opens from rest by entering, and closes by leaving', () => {
    expect(nextPresence('exited', true, false)).toBe('entering');
    expect(nextPresence('entering', true, false)).toBe('entering');
    expect(nextPresence('entered', false, false)).toBe('leaving');
    expect(nextPresence('leaving', false, false)).toBe('leaving');
    expect(nextPresence('exited', false, false)).toBe('exited');
  });

  it('interrupts a leave by returning to entered instead of queuing', () => {
    expect(nextPresence('leaving', true, false)).toBe('entered');
  });

  it('collapses to entered or exited when motion is reduced', () => {
    const states: Presence[] = ['exited', 'entering', 'entered', 'leaving'];
    for (const state of states) {
      expect(nextPresence(state, true, true)).toBe('entered');
      expect(nextPresence(state, false, true)).toBe('exited');
    }
  });
});
