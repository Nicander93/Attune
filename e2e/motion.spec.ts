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

test('shortcut help stays in the menu and does not cover the study chrome', async ({ page }) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '快捷键' })).toBeVisible();
  const fieldTop = await page
    .getByLabel('第 1 句听写')
    .evaluate((el) => el.getBoundingClientRect().top);
  const playerTop = await page
    .locator('.player--focus')
    .evaluate((el) => el.getBoundingClientRect().top);
  await page.getByRole('menuitem', { name: '快捷键' }).click();
  await expect(page.locator('.study__menu')).toBeVisible();
  await expect(page.locator('.study__shortcuts')).toBeVisible();
  await expect(page.locator('.study__shortcuts')).toContainText('Enter');
  await expect(page.locator('.banner')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '← 返回' })).toBeVisible();
  await expect(page.locator('.study__count')).toBeVisible();
  const fieldTopAfter = await page
    .getByLabel('第 1 句听写')
    .evaluate((el) => el.getBoundingClientRect().top);
  const playerTopAfter = await page
    .locator('.player--focus')
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(fieldTopAfter - fieldTop)).toBeLessThan(2);
  expect(Math.abs(playerTopAfter - playerTop)).toBeLessThan(2);
  const audit = await page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const intersects = (
      a: NonNullable<ReturnType<typeof box>>,
      b: NonNullable<ReturnType<typeof box>>,
    ) => {
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return width > 1 && height > 1;
    };
    const help = box(document.querySelector('.study__shortcuts'));
    const menu = box(document.querySelector('.study__menu'));
    const head = box(document.querySelector('.study__head'));
    const count = box(document.querySelector('.study__count'));
    const check = box(document.querySelector('[aria-label="核对答案"]'));
    return {
      overlapsHead: !!(help && head && intersects(help, head)),
      overlapsCount: !!(help && count && intersects(help, count)),
      overlapsCheck: !!(menu && check && intersects(menu, check)),
      checkVisible: !!(check && check.bottom <= window.innerHeight + 1 && check.top >= 0),
    };
  });
  expect(audit.overlapsHead).toBe(false);
  expect(audit.overlapsCount).toBe(false);
  expect(audit.overlapsCheck).toBe(false);
  expect(audit.checkVisible).toBe(true);

  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.locator('.banner')).toHaveCount(0);
});

test('the study menu stays opaque and does not clip the check button', async ({ page }) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const menu = page.locator('.study__menu');
  await expect(menu).toBeVisible();
  await expect(page.getByRole('button', { name: '核对答案' })).toBeVisible();
  const audit = await page.evaluate(() => {
    const menu = document.querySelector('.study__menu');
    const check = document.querySelector('[aria-label="核对答案"]');
    if (!(menu instanceof HTMLElement) || !(check instanceof HTMLElement)) {
      return { ok: false };
    }
    const menuBox = menu.getBoundingClientRect();
    const checkBox = check.getBoundingClientRect();
    const style = getComputedStyle(menu);
    const width = Math.max(
      0,
      Math.min(menuBox.right, checkBox.right) - Math.max(menuBox.left, checkBox.left),
    );
    const height = Math.max(
      0,
      Math.min(menuBox.bottom, checkBox.bottom) - Math.max(menuBox.top, checkBox.top),
    );
    return {
      ok: true,
      overlap: width > 1 && height > 1,
      checkVisible: checkBox.bottom <= window.innerHeight + 1 && checkBox.top >= 0,
      background: style.backgroundColor,
      opacity: style.opacity,
    };
  });
  expect(audit.ok).toBe(true);
  expect(audit.overlap).toBe(false);
  expect(audit.checkVisible).toBe(true);
  expect(audit.opacity).toBe('1');
  expect(audit.background).toMatch(/rgb\(255,\s*255,\s*255\)/);
});
