import { expect, test } from '@playwright/test';
import { material, openStudy, seed, settled, storedMaterial, wav } from './support';
test.describe('home', () => {
  test('shows an empty state when nothing has been studied', async ({ page }) => {
    await seed(page, [material({ audio: wav() })]);
    await expect(page.getByRole('heading', { name: '继续学习' })).toBeVisible();
    // An imported-but-never-opened material must not pretend to be a study session.
    await expect(page.getByText('还没有开始听写')).toBeVisible();
    await expect(page.getByText('podcast.mp3')).toHaveCount(0);
  });

  test('offers the last studied material with real progress', async ({ page }) => {
    await seed(page, [
      material({
        id: 'm1',
        displayName: '已听的.mp3',
        lastStudiedAt: '2026-05-02T10:00:00Z',
        rounds: [
          {
            id: 'r1',
            createdAt: '2026-05-01T10:00:00Z',
            updatedAt: '2026-05-02T10:00:00Z',
            drafts: {},
            completedSegmentIds: ['s1', 's2'],
          },
        ],
        activeRoundId: 'r1',
      }),
      material({ id: 'm2', displayName: '只导入的.mp3' }),
    ]);
    await expect(page.getByRole('heading', { name: '继续学习' })).toBeVisible();
    const resume = page.locator('.home__current');
    await expect(resume).toContainText('已听的.mp3');
    await expect(resume).toContainText('听写 · 2 / 3 句');
    await expect(page.locator('.home__title')).toContainText('已听的.mp3');
    // Resume is outside .home-recent; with only one studied item .recent is empty.
    await expect(page.locator('.home-recent')).not.toContainText('已听的.mp3');
    await expect(page.locator('.home-recent')).not.toContainText('只导入的.mp3');
  });
});

test.describe('library', () => {
  test('lists materials with duration, progress and subtitle status', async ({ page }) => {
    await seed(page, [material({ audio: wav() })]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    const row = page.locator('.materials__row');
    await expect(row).toContainText('podcast.mp3');
    await expect(row).toContainText('00:09');
    await expect(row).toContainText('未开始');
  });

  test('renames the display name without touching the audio or subtitles', async ({ page }) => {
    await seed(page, [material({ audio: wav() })]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.getByLabel('podcast.mp3 的更多操作').click();
    await page.getByRole('menuitem', { name: '重命名' }).click();
    await page.getByLabel('重命名 podcast.mp3').fill('我的播客');
    await page.getByLabel('重命名 podcast.mp3').press('Enter');
    await expect(page.locator('.materials__row')).toContainText('我的播客');
    await settled(page);

    // The original file name and every segment survive the rename.
    const stored = await storedMaterial(page, 'm1');
    expect(stored.displayName).toBe('我的播客');
    expect(stored.originalFileName).toBe('podcast.mp3');
    expect(stored.segments).toHaveLength(3);
  });

  test('keeps a material when its folder is deleted', async ({ page }) => {
    await seed(page, [material({ audio: wav() })]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.getByLabel('新建文件夹').click();
    await page.getByLabel('新文件夹名称').fill('播客');
    await page.getByLabel('新文件夹名称').press('Enter');
    // Creating a folder selects it; return to all materials so the row stays visible.
    await page.locator('.library-tools select.select').first().selectOption('all');
    await settled(page);
    // Move the material in first, then delete the folder it lives in.
    await page.getByLabel('podcast.mp3 的更多操作').click();
    await page.getByRole('menuitem', { name: '移动到文件夹' }).click();
    await page.locator('.menu').getByRole('menuitem', { name: '播客' }).click();
    await settled(page);
    await page.getByLabel('文件夹').selectOption({ label: '播客' });
    await expect(page.locator('.materials__row')).toContainText('podcast.mp3');

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByLabel('删除文件夹 播客').click();

    // The folder is gone; the material falls back to 未分类 and keeps its audio.
    await page.getByLabel('文件夹').selectOption({ label: '未分类' });
    await expect(page.locator('.materials__row')).toContainText('podcast.mp3');
    const kept = await storedMaterial(page, 'm1');
    expect(kept.displayName).toBe('podcast.mp3');
    expect(kept.segments).toHaveLength(3);
  });

  test('searches across every folder and says so', async ({ page }) => {
    await seed(page, [material({ id: 'm1', displayName: '英语课程.mp3', folderId: 'f1' })]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.getByLabel('搜索素材').fill('英语');
    await expect(page.locator('.library__count')).toContainText('已忽略文件夹');
    await expect(page.locator('.materials__row')).toContainText('英语课程.mp3');
  });

  test('sorts by a chosen order from the toolbar menu', async ({ page }) => {
    await seed(page, [
      material({
        id: 'm1',
        displayName: 'bbb.mp3',
        duration: 30,
        createdAt: '2026-01-01T00:00:00Z',
        lastStudiedAt: '2026-06-01T00:00:00Z',
      }),
      material({
        id: 'm2',
        displayName: 'aaa.mp3',
        duration: 10,
        createdAt: '2026-02-01T00:00:00Z',
      }),
    ]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    // 最近学习 is the default and puts the only studied material first.
    await expect(page.locator('.materials__row').first()).toContainText('bbb.mp3');
    await page.getByLabel('排序').selectOption('name');
    await expect(page.locator('.materials__row').first()).toContainText('aaa.mp3');
    await page.getByLabel('排序').selectOption('duration');
    await expect(page.locator('.materials__row').first()).toContainText('bbb.mp3');
    await page.getByLabel('排序').selectOption('recent');
    await expect(page.locator('.materials__row')).toHaveCount(2);
  });

  test('binds Ctrl+F to search and F2 to rename', async ({ page }) => {
    await seed(page, [material({ audio: wav() })]);
    await page.getByRole('button', { name: '素材库' }).first().click();

    await page.keyboard.press('Control+f');
    await expect(page.getByLabel('搜索素材')).toBeFocused();
    await page.keyboard.press('Escape');

    // Opening a material keeps it selected, so F2 works once the user comes back.
    await page.locator('.materials__row').first().click();
    await expect(page.getByRole('heading', { name: '第 1 / 3 句' })).toBeVisible();
    await page.getByRole('button', { name: '← 返回' }).click();
    await page.keyboard.press('F2');
    await expect(page.getByLabel('重命名 podcast.mp3')).toBeFocused();
  });
});

test.describe('dictation', () => {
  const study = async (page: Page) => {
    await seed(page, [material({ audio: wav() })]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.locator('.materials__row').first().click();
    await expect(page.getByRole('heading', { name: '第 1 / 3 句' })).toBeVisible();
  };

  test('moves between sentences with the arrow keys only when not typing', async ({ page }) => {
    await study(page);
    const field = page.getByLabel('第 1 句听写');
    await field.click();
    await field.press('ArrowRight');
    await field.press('ArrowRight');
    // Inside the textarea the arrows still move the caret, not the sentence.
    await expect(page.getByRole('heading', { name: '第 1 / 3 句' })).toBeVisible();
    await field.press('Escape');
    await page.locator('h1').first().click();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('heading', { name: '第 2 / 3 句' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('heading', { name: '第 1 / 3 句' })).toBeVisible();
  });

  test('reveals nothing about correctness before 核对答案', async ({ page }) => {
    await study(page);
    const field = page.getByLabel('第 1 句听写');
    await field.click();
    await field.pressSequentially('Hello');
    await field.pressSequentially(' wrong');
    // No "correct" or "wrong" verdict may appear while typing.
    await expect(page.locator('.diff')).toHaveCount(0);
    await expect(page.getByText('输入正确')).toHaveCount(0);
    await expect(page.getByText('请检查输入')).toHaveCount(0);
  });

  test('checks on Enter, shows the diff, and moves on with Enter again', async ({ page }) => {
    await study(page);
    const field = page.getByLabel('第 1 句听写');
    await field.click();
    await field.pressSequentially('Hello world');
    await field.press('Enter');
    await expect(page.locator('.diff')).toBeVisible();
    await expect(page.locator('.diff')).toContainText('和原文一致');
    await field.press('Enter');
    await expect(page.getByRole('heading', { name: '第 2 / 3 句' })).toBeVisible();
  });

  test('marks a missing word without turning the whole sentence into errors', async ({ page }) => {
    await study(page);
    const field = page.getByLabel('第 1 句听写');
    await field.click();
    await field.pressSequentially('Hello');
    await field.press('Enter');
    await expect(page.locator('.diff__word--missing')).toHaveCount(1);
    await expect(page.locator('.diff__word--missing')).toHaveText('world.');
    await expect(page.locator('.diff__word--extra')).toHaveCount(0);
  });

  test('goes back to editing with Esc after checking', async ({ page }) => {
    await study(page);
    const field = page.getByLabel('第 1 句听写');
    await field.click();
    await field.pressSequentially('Hello world');
    await field.press('Enter');
    await expect(page.locator('.diff')).toBeVisible();
    await field.press('Escape');
    await expect(page.locator('.diff')).toHaveCount(0);
    // Esc must never clear what was typed.
    await expect(field).toHaveValue('Hello world');
  });

  test('counts a sentence as 已听写 only after 核对答案', async ({ page }) => {
    await study(page);
    await expect(page.getByText('已听写 0 / 3 句')).toBeVisible();
    const field = page.getByLabel('第 1 句听写');
    await field.click();
    await field.pressSequentially('Hello world');
    // A draft on its own is in progress, not dictated.
    await page.locator('h1').first().click();
    await page.locator('h1').first().click();
    await page.getByLabel('第 1 句听写').click();
    await page.getByLabel('第 1 句听写').press('Enter');
    await expect(page.getByText('已听写 1 / 3 句')).toBeVisible();
  });

  test('keeps a draft across a reload', async ({ page }) => {
    await study(page);
    const field = page.getByLabel('第 1 句听写');
    await field.click();
    await field.pressSequentially('Hello world');
    await page.locator('h1').first().click();
    await settled(page);
    await page.reload();
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.locator('.materials__row').first().click();
    await expect(page.getByLabel('第 1 句听写')).toHaveValue('Hello world');
  });
});

test.describe('player and views', () => {
  test('switches between 听写 and 听读 without losing the draft', async ({ page }) => {
    await seed(page, [material({ audio: wav() })]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.locator('.materials__row').first().click();
    const field = page.getByLabel('第 1 句听写');
    await field.click();
    await field.pressSequentially('Hello world');
    await page.getByRole('tab', { name: '听读' }).click();
    // Undictated sentences stay hidden until the reader asks to see them.
    await expect(page.locator('.reading__text')).toContainText('原文已隐藏');
    await page.getByLabel('显示未听写的原文').check();
    await expect(page.locator('.reading__text')).toContainText('Nice to meet you.');
    await page.getByRole('tab', { name: '听写' }).click();
    await expect(page.getByLabel('第 1 句听写')).toHaveValue('Hello world');
  });

  test('marks a 难句 and keeps it on the material', async ({ page }) => {
    await seed(page, [material({ audio: wav() })]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.locator('.materials__row').first().click();
    await page.getByRole('button', { name: '☆ 标记难句' }).click();
    await expect(page.getByRole('button', { name: '★ 难句' })).toBeVisible();
    await settled(page);
    await page.reload();
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.locator('.materials__row').first().click();
    await expect(page.getByRole('button', { name: '★ 难句' })).toBeVisible();
  });

  test('refuses to check a sentence with no reference text', async ({ page }) => {
    await seed(page, [
      material({
        audio: wav(),
        segments: [{ id: 's1', start: 0, end: 3, reference: '', words: [] }],
      }),
    ]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.locator('.materials__row').first().click();
    const field = page.getByLabel('第 1 句听写');
    await field.click();
    await field.pressSequentially('anything');
    await field.press('Enter');
    await expect(page.getByText('这句还没有参考原文')).toBeVisible();
  });
});
