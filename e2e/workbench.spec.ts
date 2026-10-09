import { expect, test } from '@playwright/test';
function wav(seconds = 4): Buffer {
  const rate = 8000,
    count = rate * seconds,
    buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(count * 2, 40);
  return buffer;
}
test('audio, word input, immutable first draft, persistence and playback modes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '导入第一篇音频' })).toBeEnabled();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'practice.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(page.getByRole('heading', { name: '听写练习', exact: true })).toBeVisible();
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles({
      name: 'practice.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        '1\n00:00:00,000 --> 00:00:01,500\nHello world\n\n2\n00:00:01,500 --> 00:00:04,000\nListen again',
      ),
    });
  const first = page.getByRole('textbox', { name: '片段 1 听写，第 1 个词', exact: true });
  await first.fill('Hello');
  await first.press('Space');
  const second = page.getByRole('textbox', { name: '片段 1 听写，第 2 个词', exact: true });
  await expect(second).toBeFocused();
  await second.press('Backspace');
  await expect(first).toBeFocused();
  await first.press('Space');
  await second.fill('word');
  await page.getByRole('button', { name: '核对原文', exact: true }).click();
  await expect(page.locator('ins')).toContainText('world');
  await second.fill('world');
  await page.getByRole('button', { name: '保存修订稿' }).click();
  await expect(page.locator('header [role=status]').filter({ hasText: '已保存' })).toBeVisible();
  await page.getByRole('button', { name: '练习记录', exact: true }).click();
  await page.getByText('查看首次稿与修订稿').click();
  await expect(page.locator('details')).toContainText('Hello word');
  await expect(page.locator('details')).toContainText('Hello world');
  await page.reload();
  await expect(
    page.getByRole('textbox', { name: '片段 1 听写，第 2 个词', exact: true }),
  ).toHaveValue('world');
  await second.focus();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(second).toBeFocused();
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(true);
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeCloseTo(1.5, 1);
  await page.getByRole('button', { name: '整篇听', exact: true }).click();
  await expect(page.locator('.word-editor')).toHaveCount(2);
  await page.getByRole('button', { name: '重播整篇' }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime), {
      timeout: 6000,
    })
    .toBeGreaterThan(1.7);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '练习记录', exact: true }).click();
  await page.getByRole('button', { name: '重新听写', exact: true }).click();
  await expect(first).toHaveValue('');
  await expect(page.locator('.comparison')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('layout and blank-word input fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '导入第一篇音频' })).toBeEnabled();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'mobile.wav', mimeType: 'audio/wav', buffer: wav() });
  await page.getByRole('button', { name: '留空 →', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: '片段 1 听写，第 1 个词', exact: true }),
  ).toHaveValue('…');
  await expect(
    page.getByRole('textbox', { name: '片段 1 听写，第 2 个词', exact: true }),
  ).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
