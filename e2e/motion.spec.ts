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

test('shortcut banner sits below the study head and leaves the toolbar clickable', async ({
  page,
}) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '快捷键' }).click();
  const banner = page.locator('.banner').first();
  await expect(banner).toBeVisible();
  const back = page.getByRole('button', { name: '← 返回' });
  const more = page.getByRole('button', { name: '更多', exact: true });
  await expect(back).toBeVisible();
  await expect(more).toBeVisible();
  const overlap = await page.evaluate(() => {
    const notice = document.querySelector('.banner');
    const head = document.querySelector('.study__head');
    if (!notice || !head) return true;
    const a = notice.getBoundingClientRect();
    const b = head.getBoundingClientRect();
    const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return width > 2 && height > 2;
  });
  expect(overlap).toBe(false);
  await back.click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
});
