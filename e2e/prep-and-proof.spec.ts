import { expect, test, type Page } from '@playwright/test';
import { material, openStudy, seed, settled, srt, storedMaterial, vtt, wav } from './support';

const goToPrep = async (page: Page) => {
  await page.getByRole('button', { name: '素材库' }).first().click();
  await page.locator('.materials__row').first().click();
  // Without subtitles the workbench only offers the prep page directly.
  const shortcut = page.getByRole('button', { name: '去准备字幕' });
  if (await shortcut.isVisible().catch(() => false)) await shortcut.click();
  else await page.getByRole('button', { name: '素材设置' }).click();
  await expect(page.getByText('素材准备')).toBeVisible();
};

/** Opens the inline editor for a sentence and returns its textarea. */
const editSentence = async (page: Page, index: number) => {
  const item = page.locator('.proof__list > li').nth(index);
  await item.getByRole('button', { name: '编辑' }).click();
  return item.getByLabel(`编辑第 ${index + 1} 句字幕`);
};

const save = (page: Page) => page.getByRole('button', { name: '保存' }).click();

test.describe('material preparation', () => {
  test('imports audio and subtitles through two separate controls', async ({ page }) => {
    await seed(page, [
      material({
        audio: wav(),
        segments: [],
        duration: 0,
        displayName: '未命名素材',
        originalFileName: '',
      }),
    ]);
    await goToPrep(page);

    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles({
        name: 'lesson.wav',
        mimeType: 'audio/wav',
        buffer: wav(9),
      });
    // A material with no name yet takes the audio file's name.
    await expect(page.getByRole('heading', { name: 'lesson', exact: true })).toBeVisible();

    // A subtitle file is only imported when the user picks it.
    await page
      .locator('input[type=file]')
      .nth(1)
      .setInputFiles({
        name: 'lesson.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from(srt),
      });
    await expect(page.getByRole('status').filter({ hasText: /字幕已导入 2 句/ })).toBeVisible();
    await settled(page);
    expect((await storedMaterial(page, 'm1')).segments).toHaveLength(2);
  });

  test('reads a bilingual VTT into English and Chinese lines', async ({ page }) => {
    await seed(page, [material({ audio: wav(), segments: [], duration: 9 })]);
    await goToPrep(page);
    await page
      .locator('input[type=file]')
      .nth(1)
      .setInputFiles({
        name: 'lesson.vtt',
        mimeType: 'text/vtt',
        buffer: Buffer.from(vtt),
      });
    await expect(page.getByText(/其中 2 句带中文/)).toBeVisible();
    await settled(page);

    const stored = await storedMaterial(page, 'm1');
    expect(stored.segments[0]).toMatchObject({
      reference: 'Hello world',
      translation: '你好，世界',
    });
  });

  test('explains a broken subtitle file instead of silently ignoring it', async ({ page }) => {
    await seed(page, [material({ audio: wav(), segments: [], duration: 9 })]);
    await goToPrep(page);
    await page
      .locator('input[type=file]')
      .nth(1)
      .setInputFiles({
        name: 'broken.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from('not a subtitle at all'),
      });
    await expect(page.getByRole('alert')).toContainText('没有找到有效的 SRT 时间轴');
    expect((await storedMaterial(page, 'm1')).segments).toHaveLength(0);
  });

  test('refuses to replace subtitles once something has been written', async ({ page }) => {
    await seed(page, [
      material({
        audio: wav(),
        rounds: [
          {
            id: 'r1',
            createdAt: '',
            updatedAt: '',
            drafts: {},
            completedSegmentIds: ['s1'],
          },
        ],
        activeRoundId: 'r1',
      }),
    ]);
    await openStudy(page);
    await page.getByRole('button', { name: '素材设置' }).click();
    await page
      .locator('input[type=file]')
      .nth(1)
      .setInputFiles({
        name: 'other.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from(srt),
      });
    await expect(page.getByRole('alert')).toContainText('听写记录');
    expect((await storedMaterial(page, 'm1')).segments).toHaveLength(3);
  });

  test('allows a material with no subtitles but says checking is unavailable', async ({ page }) => {
    await seed(page, [material({ audio: wav(), segments: [] })]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.locator('.materials__row').first().click();
    await expect(page.getByText('这段素材还没有字幕')).toBeVisible();
    await page.getByRole('button', { name: '去准备字幕' }).click();
    await expect(page.getByText('没有字幕时无法核对答案')).toBeVisible();
  });
});

test.describe('subtitle proofing', () => {
  const studied = material({
    audio: wav(),
    rounds: [
      {
        id: 'r1',
        createdAt: '2026-03-02T00:00:00Z',
        updatedAt: '2026-03-02T00:00:00Z',
        drafts: { s1: 'Hello world' },
        completedSegmentIds: ['s1'],
      },
    ],
    activeRoundId: 'r1',
  });

  const openProof = async (page: Page) => {
    await seed(page, [studied]);
    await openStudy(page);
    await page.getByRole('button', { name: '字幕校对' }).click();
    await expect(page.getByText('字幕校对')).toBeVisible();
  };

  test('edits a sentence without changing its id and keeps the draft', async ({ page }) => {
    await openProof(page);
    const field = await editSentence(page, 0);
    await field.fill('Hello there.');
    await save(page);
    await settled(page);

    const stored = await storedMaterial(page, 'm1');
    expect(stored.segments[0]).toMatchObject({ id: 's1', reference: 'Hello there.' });
    expect(stored.rounds[0].drafts.s1).toBe('Hello world');
  });

  test('marks a checked sentence as needing another check after an edit', async ({ page }) => {
    await openProof(page);
    const field = await editSentence(page, 0);
    await field.fill('Something else.');
    await save(page);
    await expect(page.getByText('待重新核对').first()).toBeVisible();
    await expect(page.getByText(/标记为待重新核对/)).toBeVisible();
    await settled(page);

    const stored = await storedMaterial(page, 'm1');
    expect(stored.rounds[0].staleSegmentIds).toContain('s1');
    // The old result is marked, never deleted.
    expect(stored.rounds[0].completedSegmentIds).toContain('s1');
  });

  test('rejects an end time past the audio with a clear message', async ({ page }) => {
    await openProof(page);
    await editSentence(page, 0);
    await page.getByLabel('第 1 句结束时间').fill('99');
    await save(page);
    await expect(page.getByRole('alert')).toContainText('超出了音频时长');
  });

  test('rejects an overlap with the next sentence', async ({ page }) => {
    await openProof(page);
    await editSentence(page, 0);
    await page.getByLabel('第 1 句结束时间').fill('5');
    await save(page);
    await expect(page.getByRole('alert')).toContainText('重叠');
  });

  test('saves with Ctrl+Enter and cancels with Esc', async ({ page }) => {
    await openProof(page);
    await editSentence(page, 0);
    await page.getByLabel('编辑第 1 句字幕').press('Escape');
    await expect(page.getByLabel('编辑第 1 句字幕')).toHaveCount(0);
    expect((await storedMaterial(page, 'm1')).segments[0].reference).toBe('Hello world.');

    const field = await editSentence(page, 0);
    await field.fill('Saved with a shortcut.');
    await field.press('Control+Enter');
    await settled(page);
    expect((await storedMaterial(page, 'm1')).segments[0].reference).toBe('Saved with a shortcut.');
  });

  test('merges with the next sentence and keeps both drafts after confirmation', async ({
    page,
  }) => {
    await seed(page, [
      material({
        audio: wav(),
        rounds: [
          {
            id: 'r1',
            createdAt: '',
            updatedAt: '',
            drafts: { s1: 'one', s2: 'two' },
            completedSegmentIds: ['s1', 's2'],
          },
        ],
        activeRoundId: 'r1',
      }),
    ]);
    await openStudy(page);
    await page.getByRole('button', { name: '字幕校对' }).click();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: '与下一句合并' }).first().click();
    await expect(page.getByText(/标记为待重新核对/)).toBeVisible();
    await settled(page);

    const stored = await storedMaterial(page, 'm1');
    expect(stored.segments).toHaveLength(2);
    expect(stored.segments[0].reference).toBe('Hello world. Nice to meet you.');
    // Nothing dangles against the id that disappeared.
    expect(stored.rounds[0].drafts.s2).toBeUndefined();
    expect(stored.rounds[0].drafts.s1).toBe('one two');
    expect(stored.rounds[0].completedSegmentIds).toEqual(['s1']);
    expect(stored.rounds[0].staleSegmentIds).toContain('s1');
  });
});

test.describe('transcript and rounds', () => {
  test('shows every sentence in 完整原文 and returns without losing the draft', async ({
    page,
  }) => {
    await seed(page, [material({ audio: wav() })]);
    await openStudy(page);
    await page.getByLabel('第 1 句听写').click();
    await page.getByLabel('第 1 句听写').pressSequentially('Hello world');
    await page.locator('h1').first().click();

    await page.getByRole('button', { name: '完整原文 ↗' }).click();
    await expect(page.getByText('完整原文')).toBeVisible();
    await expect(page.locator('.transcript__list')).toContainText('See you later.');

    await page.getByRole('button', { name: '← 返回' }).click();
    await expect(page.getByLabel('第 1 句听写')).toHaveValue('Hello world');
  });

  test('starts a new round without clearing the previous one', async ({ page }) => {
    await seed(page, [
      material({
        audio: wav(),
        rounds: [
          {
            id: 'r1',
            createdAt: '2026-03-02T00:00:00Z',
            updatedAt: '2026-03-02T00:00:00Z',
            drafts: {},
            completedSegmentIds: ['s1', 's2'],
          },
        ],
        activeRoundId: 'r1',
      }),
    ]);
    await openStudy(page);
    await expect(page.getByText('已听写 2 / 3 句')).toBeVisible();

    await page.getByRole('button', { name: '轮次' }).click();
    await expect(page.getByRole('heading', { name: '练习轮次' })).toBeVisible();
    await page.getByRole('button', { name: '重新听写' }).click();
    await settled(page);

    const stored = await storedMaterial(page, 'm1');
    expect(stored.rounds).toHaveLength(2);
    expect(stored.activeRoundId).not.toBe('r1');
    // The earlier round keeps its result; the current one starts empty.
    expect(
      stored.rounds.find((r: { id: string }) => r.id === 'r1').completedSegmentIds,
    ).toHaveLength(2);
    await expect(page.getByText('已听写 0 / 3 句')).toBeVisible();
  });

  test('restricts navigation to 难句 when asked', async ({ page }) => {
    await seed(page, [material({ audio: wav(), bookmarkedSegmentIds: ['s2'] })]);
    await openStudy(page);
    await page.getByLabel('只看难句').check();
    await expect(page.getByRole('heading', { name: '第 1 / 1 句' })).toBeVisible();
    await expect(page.locator('.dictation__head')).toContainText('00:03');
  });
});

test.describe('player navigation', () => {
  test('previous lands on the previous sentence start, not this one', async ({ page }) => {
    await seed(page, [material({ audio: wav() })]);
    await openStudy(page);
    await page.getByRole('button', { name: '下一句' }).click();
    await expect(page.getByRole('heading', { name: '第 2 / 3 句' })).toBeVisible();

    // One press goes straight back a sentence; there is no intermediate
    // "rewind to this sentence's start" step.
    await expect(page.getByRole('button', { name: '上一句' })).toBeEnabled();
    await page.getByRole('button', { name: '上一句' }).click();
    await expect(page.getByRole('heading', { name: '第 1 / 3 句' })).toBeVisible();

    // At the first sentence there is nowhere further back to go.
    await expect(page.getByRole('button', { name: '上一句' })).toBeDisabled();
  });

  test('disables sentence navigation when there are no subtitles', async ({ page }) => {
    await seed(page, [material({ audio: wav(), segments: [] })]);
    await page.getByRole('button', { name: '素材库' }).first().click();
    await page.locator('.materials__row').first().click();
    await expect(page.getByRole('button', { name: '下一句' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '重听本句' })).toBeDisabled();
  });
});
