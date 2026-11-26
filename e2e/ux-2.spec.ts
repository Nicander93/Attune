import { expect, test } from '@playwright/test';
import { expectSentenceIndex, material, openStudy, seed, wav } from './support';

test('the study menu keeps a single speed control and does not clip 核对答案', async ({ page }) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /语速 · / })).toHaveCount(0);
  const speed = page.getByLabel('播放速度');
  await expect(speed).toBeVisible();
  const speedLabel = await page
    .locator('.study__menu-volume')
    .evaluate((el) => el.childNodes[0]?.textContent ?? '');
  expect(speedLabel.trim()).toBe('语速');
  await expect(page.locator('.study__menu')).not.toHaveText('语速 · 1×');
  await expect(speed).toHaveCount(1);
  const check = page.getByRole('button', { name: '核对答案' });
  await expect(check).toBeVisible();
  const overlap = await page.evaluate(() => {
    const menu = document.querySelector('.study__menu');
    const button = document.querySelector('[aria-label="核对答案"]');
    if (!(menu instanceof HTMLElement) || !(button instanceof HTMLElement)) return true;
    const a = menu.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return width > 1 && height > 1;
  });
  expect(overlap).toBe(false);
});

test('the focus player uses an icon replay control and a single sentence index', async ({
  page,
}) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  const replay = page.getByRole('button', { name: '重听本句' });
  const loop = page.getByRole('button', { name: '单句循环' });
  await expect(replay).toBeVisible();
  await expect(loop).toBeVisible();
  await expect(replay.locator('.player__icon')).toBeVisible();
  await expect(loop.locator('.player__icon')).toBeVisible();
  const replayPath = await replay.locator('svg').innerHTML();
  const loopPath = await loop.locator('svg').innerHTML();
  expect(replayPath).not.toEqual(loopPath);
  await expect(replay).not.toHaveText(/重听本句|↺|↻/);
  await expect(page.locator('.player--focus')).not.toContainText('重听本句');
  await expectSentenceIndex(page, 1, 3);
  await expect(page.getByText('第 1 / 3 句')).toHaveCount(0);
});

test('dictation can switch to reading and Esc returns from a check to editing', async ({
  page,
}) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '听读', exact: true }).click();
  await expect(page.getByRole('button', { name: '听写', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '听写', exact: true }).click();
  const field = page.getByLabel('第 1 句听写');
  await field.fill('Hello world');
  await field.press('Enter');
  await expect(page.locator('.diff')).toBeVisible();
  await field.press('Escape');
  await expect(page.locator('.diff')).toHaveCount(0);
  await expect(field).toBeVisible();
});

test('home does not show an empty recent-study row when there is only a last session', async ({
  page,
}) => {
  await seed(page, [
    material({
      displayName: '已听的.mp3',
      lastStudiedAt: '2026-05-02T10:00:00Z',
      rounds: [
        {
          id: 'r1',
          createdAt: '2026-05-01T10:00:00Z',
          updatedAt: '2026-05-02T10:00:00Z',
          drafts: {},
          completedSegmentIds: ['s1'],
        },
      ],
      activeRoundId: 'r1',
    }),
  ]);
  await expect(page.locator('.home__current')).toContainText('上次学习');
  await expect(page.locator('.home-recent')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '最近学习' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '全部素材 →' })).toHaveCount(0);
  await expect(page.getByText('暂无更多最近学习')).toHaveCount(0);
});

test('the library folder filter appears only after a folder exists', async ({ page }) => {
  await seed(page, [material({ audio: wav() })]);
  await page.getByRole('button', { name: '素材库' }).first().click();
  await expect(page.locator('select[aria-label="文件夹"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建文件夹' })).toBeVisible();
  await page.getByRole('button', { name: '新建文件夹' }).click();
  await page.getByLabel('新文件夹名称').fill('播客');
  await page.getByLabel('新文件夹名称').press('Enter');
  const folder = page.locator('select[aria-label="文件夹"]');
  await expect(folder).toBeVisible();
  await expect(folder).toContainText('播客');
});
