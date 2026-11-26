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

test('choosing 快捷键 closes the menu at once and keeps the sentence row clear', async ({
  page,
}) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '快捷键' }).click();
  await expect(page.locator('.study__menu')).toHaveCount(0);
  await expect(page.locator('.study__menu[data-motion="leaving"]')).toHaveCount(0);
  const banner = page.locator('.banner').first();
  await expect(banner).toBeVisible();
  await expect(page.getByRole('button', { name: '← 返回' })).toBeVisible();
  await expect(page.locator('.study__count')).toBeVisible();
  const audit = await page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
    };
    const intersects = (
      a: NonNullable<ReturnType<typeof box>>,
      b: NonNullable<ReturnType<typeof box>>,
    ) => {
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return width > 1 && height > 1;
    };
    const banner = box(document.querySelector('.banner'));
    const head = box(document.querySelector('.study__head'));
    const status = box(document.querySelector('.study__status'));
    const count = box(document.querySelector('.study__count'));
    return {
      banner,
      head,
      status,
      count,
      overlapsHead: !!(banner && head && intersects(banner, head)),
      overlapsStatus: !!(banner && status && intersects(banner, status)),
      overlapsCount: !!(banner && count && intersects(banner, count)),
    };
  });
  expect(audit.overlapsHead).toBe(false);
  expect(audit.overlapsStatus).toBe(false);
  expect(audit.overlapsCount).toBe(false);

  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(banner).toBeVisible();
  const after = await page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
    };
    const intersects = (
      a: NonNullable<ReturnType<typeof box>>,
      b: NonNullable<ReturnType<typeof box>>,
    ) => {
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return width > 1 && height > 1;
    };
    const banner = box(document.querySelector('.banner'));
    const topbar = box(document.querySelector('.topbar'));
    const back = box(
      [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('返回')) ??
        null,
    );
    const heading = box([...document.querySelectorAll('h1')].find((el) => el.textContent) ?? null);
    return {
      banner,
      topbar,
      back,
      heading,
      overlapsTopbar: !!(banner && topbar && intersects(banner, topbar)),
      overlapsBack: !!(banner && back && intersects(banner, back)),
      overlapsHeading: !!(banner && heading && intersects(banner, heading)),
    };
  });
  expect(after.overlapsTopbar).toBe(false);
  expect(after.overlapsBack).toBe(false);
  expect(after.overlapsHeading).toBe(false);
});
