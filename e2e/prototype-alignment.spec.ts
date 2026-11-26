import { expect, test } from '@playwright/test';
import { material, openStudy, openStudyMenu, seed, storedMaterial, wav } from './support';

test('prepared material uses ready row, supports rename and opens subtitle proofing', async ({
  page,
}) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await openStudyMenu(page, '素材设置');
  await expect(page.locator('.dropzone')).toHaveCount(0);
  await expect(page.locator('.import__file')).toBeVisible();
  await expect(page.getByRole('button', { name: '开始听写 →' })).toHaveClass(/primary/);
  await page.getByRole('button', { name: '更多 ···' }).click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  await page.getByLabel('素材名称').fill('');
  await page.getByLabel('素材名称').press('Enter');
  await expect(page.getByRole('alert')).toContainText('素材名称不能为空');
  await page.getByLabel('素材名称').fill('Daily English');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.import__file-info strong')).toHaveText('Daily English');
  await page.getByRole('button', { name: '更多 ···' }).click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  await page.getByLabel('素材名称').fill('discard');
  await page.getByLabel('素材名称').press('Escape');
  await expect(page.locator('.import__file-info strong')).toHaveText('Daily English');
  await expect
    .poll(async () => (await storedMaterial(page, 'm1')).displayName)
    .toBe('Daily English');
  await page.getByRole('button', { name: '更多 ···' }).click();
  await page.getByRole('menuitem', { name: '校对字幕' }).click();
  await expect(page.locator('.proof')).toBeVisible();
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.locator('.prep')).toBeVisible();
  await page.getByRole('button', { name: '更多 ···' }).click();
  await page.getByRole('menuitem', { name: '识别设置' }).click();
  await expect(page.getByLabel('模型下载地址')).toBeVisible();
  await page.locator('.import__advanced-head').getByRole('button', { name: '收起' }).click();
  await expect(page.getByLabel('模型下载地址')).toHaveCount(0);
});

test('new material shows one dropzone then ready CTAs after audio import', async ({ page }) => {
  await seed(page, []);
  await page
    .getByRole('button', { name: /导入素材/ })
    .first()
    .click();
  await expect(page.locator('.dropzone')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '导入素材' })).toBeVisible();
  await expect(page.getByText('选择或拖入文件')).toBeVisible();
  await expect(page.getByText('未命名素材')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更多 ···' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始听写 →' })).toHaveCount(0);
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'lesson.wav', mimeType: 'audio/wav', buffer: wav(9) });
  await expect(page.locator('.dropzone')).toHaveCount(0);
  await expect(page.locator('.import__file-info strong')).toHaveText('lesson');
  await expect(page.getByRole('button', { name: '开始听写 →' })).toBeDisabled();
  await page.getByRole('button', { name: '更多 ···' }).click();
  await expect(page.getByRole('menuitem', { name: '开始听读' })).toBeEnabled();
});

test('ready subtitles use plain success copy and keep proofing under more', async ({ page }) => {
  await seed(page, [material({ audio: wav(9) })]);
  await openStudy(page);
  await openStudyMenu(page, '素材设置');
  await expect(page.getByText('已准备好 3 句，可以开始听写')).toBeVisible();
  await expect(page.getByText('请校对后再开始听写')).toHaveCount(0);
  await expect(page.getByText('不应作为最终答案')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始听写 →' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '校对字幕' })).toHaveCount(0);
  await page.getByRole('button', { name: '更多 ···' }).click();
  await expect(page.getByRole('menuitem', { name: '校对字幕' })).toBeVisible();
});

test('browser choose-file button opens the hidden file input', async ({ page }) => {
  await seed(page, []);
  await page
    .getByRole('button', { name: /导入素材/ })
    .first()
    .click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '选择文件' }).click(),
  ]);
  await chooser.setFiles({ name: 'lesson.wav', mimeType: 'audio/wav', buffer: wav(9) });
  await expect(page.locator('.import__file-info strong')).toHaveText('lesson');
});
