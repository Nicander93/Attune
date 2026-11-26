import { expect, test } from '@playwright/test';
import { material, openStudy, seed, wav } from './support';

test('reduced motion turns off transitions and animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page, []);
  const durations = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'topbar';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const out = {
      transition: style.transitionDuration,
      animation: style.animationName,
    };
    probe.remove();
    return out;
  });
  expect(durations.transition.split(', ').every((value) => value === '0s')).toBe(true);
  expect(durations.animation === 'none' || durations.animation === '').toBe(true);
});

test('opening the study menu still works with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '快捷键' })).toBeVisible();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '快捷键' })).toHaveCount(0);
});
