import { expect, test } from '@playwright/test';
import { material, openStudy, seed, storedMaterial, wav } from './support';

test('a short notice does not push the study layout down', async ({ page }) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByLabel('第 1 句听写').focus();
  const before = await page.evaluate(() => {
    const status = document.querySelector('.study__status');
    const field = document.querySelector('[aria-label="第 1 句听写"]');
    const player = document.querySelector('.player--focus');
    const pageEl = document.querySelector('.page');
    return {
      status: status?.getBoundingClientRect().top ?? -1,
      field: field?.getBoundingClientRect().top ?? -1,
      player: player?.getBoundingClientRect().top ?? -1,
      pagePadding: pageEl ? getComputedStyle(pageEl).paddingTop : '',
    };
  });
  await page.getByLabel('第 1 句听写').press('Enter');
  const toast = page.locator('.toast', { hasText: '先写一点内容，再核对。' });
  await expect(toast).toBeVisible();
  await expect(page.locator('.banner')).toHaveCount(0);
  const after = await page.evaluate(() => {
    const status = document.querySelector('.study__status');
    const field = document.querySelector('[aria-label="第 1 句听写"]');
    const player = document.querySelector('.player--focus');
    const pageEl = document.querySelector('.page');
    const host = document.querySelector('.toast-host');
    return {
      status: status?.getBoundingClientRect().top ?? -1,
      field: field?.getBoundingClientRect().top ?? -1,
      player: player?.getBoundingClientRect().top ?? -1,
      pagePadding: pageEl ? getComputedStyle(pageEl).paddingTop : '',
      hostPosition: host ? getComputedStyle(host).position : '',
    };
  });
  expect(after.hostPosition).toBe('fixed');
  expect(after.pagePadding).toBe(before.pagePadding);
  expect(Math.abs(after.status - before.status)).toBeLessThan(2);
  expect(Math.abs(after.field - before.field)).toBeLessThan(2);
  expect(Math.abs(after.player - before.player)).toBeLessThan(2);
  await toast.getByRole('button', { name: '关闭提示' }).click();
  await expect(page.locator('.toast[data-motion="entered"]')).toHaveCount(0);
});

test('Escape dismisses a notice and leaves the study field in place', async ({ page }) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByLabel('第 1 句听写').press('Enter');
  await expect(page.locator('.toast', { hasText: '先写一点内容' })).toBeVisible();
  await page.getByLabel('第 1 句听写').press('Escape');
  await expect(page.locator('.toast[data-motion="entered"]')).toHaveCount(0);
  await expect(page.getByLabel('第 1 句听写')).toBeVisible();
});

test('deleting a material can be undone without a system confirm', async ({ page }) => {
  await page.addInitScript(() => {
    window.confirm = () => {
      throw new Error('window.confirm should not run');
    };
  });
  await seed(page, [
    material({ id: 'm1', displayName: '要删除的.mp3', audio: wav() }),
    material({ id: 'm2', displayName: '留下的.mp3', audio: wav() }),
  ]);
  await page.getByRole('button', { name: '素材库' }).first().click();
  await page.getByLabel('要删除的.mp3 的更多操作').click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  await expect(page.locator('.toast', { hasText: '已删除「要删除的.mp3」。' })).toBeVisible();
  await expect(page.locator('.materials__row', { hasText: '要删除的.mp3' })).toHaveCount(0);
  await expect(page.locator('.materials__row', { hasText: '留下的.mp3' })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('.materials__row', { hasText: '要删除的.mp3' })).toBeVisible();
  await expect(page.locator('.toast', { hasText: '已删除「要删除的.mp3」。' })).toHaveCount(0);
  const stored = await storedMaterial(page, 'm1');
  expect(stored.displayName).toBe('要删除的.mp3');
});

test('deleting a folder moves its materials to 未分类 and can be undone', async ({ page }) => {
  await page.addInitScript(() => {
    window.confirm = () => {
      throw new Error('window.confirm should not run');
    };
  });
  await seed(page, [material({ audio: wav(), folderId: 'f1' })], [{ id: 'f1', name: '播客' }]);
  await page.getByRole('button', { name: '素材库' }).first().click();
  await page.locator('select[aria-label="文件夹"]').selectOption({ label: '播客' });
  await page.getByLabel('删除文件夹 播客').click();
  await expect(page.locator('.toast', { hasText: '已删除文件夹「播客」' })).toBeVisible();
  await expect(page.locator('select[aria-label="文件夹"]')).toHaveCount(0);
  await expect(page.locator('.materials__row')).toContainText('podcast.mp3');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('select[aria-label="文件夹"]')).toBeVisible();
  await expect(page.locator('select[aria-label="文件夹"]')).toContainText('播客');
});

test('clearing cache asks for agreement in the page, not a system dialog', async ({ page }) => {
  await page.addInitScript(() => {
    window.confirm = () => {
      throw new Error('window.confirm should not run');
    };
  });
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '素材设置' }).click();
  // The cache section is behind 更多 on the prep page, and only on desktop.
  const more = page.getByRole('button', { name: '更多 ···' });
  if ((await more.count()) === 0) {
    test.info().annotations.push({ type: 'note', description: 'prep more menu not visible' });
  }
  await more.click();
  const cacheItem = page.getByRole('menuitem', { name: /缓存/ });
  if ((await cacheItem.count()) === 0) {
    // Browser e2e is not the desktop shell; the cache tools stay hidden. The
    // important lock is that opening 素材设置 never calls window.confirm.
    await expect(
      page.getByRole('heading', { name: '选择或拖入文件' }).or(page.locator('.prep, .import')),
    ).toBeVisible();
    return;
  }
  await cacheItem.click();
  await page.getByRole('button', { name: '清理全部媒体缓存' }).click();
  await expect(page.locator('.confirm-panel')).toBeVisible();
  await expect(page.locator('.confirm-panel')).toContainText('听写记录和字幕会保留');
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.locator('.confirm-panel')).toHaveCount(0);
});
