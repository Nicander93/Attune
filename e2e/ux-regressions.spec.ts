import { expect, test } from '@playwright/test';
import { material, openStudy, seed, settled, storedMaterial, wav } from './support';

test('reopening a material resumes audio rather than persisting the initial unloaded zero', async ({
  page,
}) => {
  await seed(page, [material({ audio: wav(9), playbackPosition: 4 })]);
  await openStudy(page);
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBe(4);
  await page.getByRole('button', { name: '← 返回' }).click();
  await page.locator('.materials__row').first().click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBe(4);
});

test('new material opens preparation directly and returns to its actual source', async ({
  page,
}) => {
  await seed(page, []);
  await page.getByRole('button', { name: /新建素材/ }).click();
  await expect(page.getByText('素材准备')).toBeVisible();
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.getByRole('heading', { name: '继续学习' })).toBeVisible();
});

test('preserves sentence, checked state, view and player preferences through secondary pages', async ({
  page,
}) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '下一句', exact: true }).click();
  await page.getByLabel('第 2 句听写').fill('Nice to meet you');
  await page.getByLabel('第 2 句听写').press('Enter');
  await page.getByLabel('播放速度').selectOption('1.25');
  await page.getByLabel('单句循环').check();
  await page.getByRole('button', { name: '完整原文 ↗' }).click();
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.getByLabel('第 2 句听写')).toHaveValue('Nice to meet you');
  await expect(page.locator('.diff')).toBeVisible();
  await expect(page.getByLabel('播放速度')).toHaveValue('1.25');
  await expect(page.getByLabel('单句循环')).toBeChecked();
  await page.getByRole('tab', { name: '听读' }).click();
  await page.getByRole('button', { name: '素材设置' }).click();
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.getByRole('tab', { name: '听读' })).toHaveAttribute('aria-selected', 'true');
});

test('real playback updates transport state, stops at sentence end and loops', async ({ page }) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.3);
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused), {
      timeout: 6000,
    })
    .toBe(true);
  const end = await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime);
  expect(end).toBeGreaterThan(2.9);
  expect(end).toBeLessThanOrEqual(3);
  await page.getByLabel('单句循环').check();
  await page.getByRole('button', { name: '重听本句' }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(2);
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeLessThan(1);
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
});

test('continuous playback leaves the draft in its sentence and transcript clicks really play', async ({
  page,
}) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByLabel('第 1 句听写').fill('unfinished first sentence');
  await page.getByLabel('连续', { exact: true }).check();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime), {
      timeout: 6000,
    })
    .toBeGreaterThan(3);
  await expect(page.getByLabel('第 1 句听写')).toHaveValue('unfinished first sentence');
  await page.getByRole('button', { name: '完整原文 ↗' }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.locator('.transcript__jump').nth(2).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThanOrEqual(6);
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.getByLabel('第 1 句听写')).toHaveValue('unfinished first sentence');
});

test('rechecking clears stale state without double-counting completion', async ({ page }) => {
  await seed(page, [
    material({
      audio: wav(9),
      activeRoundId: 'r1',
      rounds: [
        {
          id: 'r1',
          createdAt: '',
          updatedAt: '',
          drafts: { s1: 'Hello world' },
          completedSegmentIds: ['s1'],
          staleSegmentIds: ['s1'],
        },
      ],
    }),
  ]);
  await openStudy(page);
  await expect(page.locator('.dictation__head')).toContainText('待重新核对');
  await page.getByLabel('第 1 句听写').press('Enter');
  await expect(page.locator('.dictation__head')).not.toContainText('待重新核对');
  await settled(page);
  const stored = await storedMaterial(page, 'm1');
  expect(stored.rounds[0].staleSegmentIds).toEqual([]);
  expect(stored.rounds[0].completedSegmentIds).toEqual(['s1']);
});

test('Escape releases input focus and modifier arrows keep native behavior', async ({ page }) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByLabel('第 1 句听写').press('Escape');
  await expect(page.getByLabel('第 1 句听写')).not.toBeFocused();
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.getByLabel('第 1 句听写')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('第 3 句听写')).toBeVisible();
  await expect(page.getByLabel('第 3 句听写')).not.toBeFocused();
});

test('composition Enter cannot check an answer and the native mirror preserves punctuation spacing', async ({
  page,
}) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  const field = page.getByLabel('第 1 句听写');
  await field.fill('Hello , world');
  await field.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
  await expect(page.locator('.diff')).toHaveCount(0);
  await expect(page.locator('.flow__mirror')).toHaveText('Hello , world');
  await field.press('Enter');
  await expect(page.locator('.diff')).toContainText('和原文一致');
});

test('splits at the text caret and an explicit time after confirming existing records', async ({
  page,
}) => {
  await seed(page, [
    material({
      audio: wav(9),
      activeRoundId: 'r1',
      rounds: [
        {
          id: 'r1',
          createdAt: '',
          updatedAt: '',
          drafts: { s1: 'Hello world' },
          completedSegmentIds: ['s1'],
        },
      ],
    }),
  ]);
  await openStudy(page);
  await page.getByRole('button', { name: '字幕校对' }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).first().click();
  const field = page.getByLabel('编辑第 1 句字幕');
  await page.getByLabel('拆分时间').fill('1.5');
  await field.evaluate((node: HTMLTextAreaElement) => {
    node.focus();
    node.setSelectionRange(6, 6);
  });
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '在文字光标处拆分' }).click();
  await settled(page);
  const stored = await storedMaterial(page, 'm1');
  expect(stored.segments).toHaveLength(4);
  expect(stored.segments[0]).toMatchObject({ id: 's1', reference: 'Hello', end: 1.5 });
  expect(stored.segments[1]).toMatchObject({ reference: 'world.', start: 1.5 });
  expect(stored.rounds[0].drafts.s1).toBe('Hello world');
  expect(stored.rounds[0].staleSegmentIds).toContain('s1');
});

test('replacement audio persists after reload and reading starts in reading mode', async ({
  page,
}) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await page.getByRole('button', { name: '素材设置' }).click();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'replacement.wav', mimeType: 'audio/wav', buffer: wav(12) });
  await expect(page.getByText('音频已导入：replacement.wav')).toBeVisible();
  await settled(page);
  await page.getByRole('button', { name: '开始听读' }).click();
  await expect(page.getByRole('tab', { name: '听读' })).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await page.getByRole('button', { name: '素材库' }).first().click();
  await page.locator('.materials__row').first().click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.duration))
    .toBe(12);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
]) {
  test(`core controls stay visible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seed(page, [material({ audio: wav(9) })]);
    await openStudy(page);
    await page.getByLabel('第 1 句听写').fill('Hello world');
    await page.getByLabel('第 1 句听写').press('Enter');
    const assertFits = async () => {
      const layout = await page.evaluate(() => {
        const main = document.querySelector('.page');
        const controls = [
          ...document.querySelectorAll('.player, .study__foot, .flow, .prep__foot'),
        ];
        return {
          scroll: main.scrollHeight > main.clientHeight + 1,
          fits: controls.every((node) => {
            const rect = node.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight;
          }),
        };
      });
      expect(layout).toEqual({ scroll: false, fits: true });
    };
    await assertFits();
    await page.screenshot({
      path: `screenshots/dictation-checked-${viewport.width}x${viewport.height}.png`,
    });
    await page.getByRole('tab', { name: '听读' }).click();
    await assertFits();
    await page.getByRole('button', { name: '素材设置' }).click();
    await assertFits();
  });
}
