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
test('audio, free-text dictation, immutable first draft, persistence and shortcuts', async ({
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
  const field = page.getByRole('textbox', { name: '第 1 句听写', exact: true });
  await field.fill('Hello word');
  await page.getByRole('button', { name: '核对原文', exact: true }).click();
  await expect(page.locator('ins')).toContainText('world');
  await expect(page.locator('del')).toContainText('word');
  await field.fill('Hello world');
  await page.getByRole('button', { name: '保存修订稿' }).click();
  await expect(page.locator('header [role=status]').filter({ hasText: '已保存' })).toBeVisible();
  await page.getByRole('button', { name: '练习记录', exact: true }).click();
  await page.getByText('查看首次稿与修订稿').click();
  await expect(page.locator('details')).toContainText('Hello word');
  await expect(page.locator('details')).toContainText('Hello world');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '第 1 句听写', exact: true })).toHaveValue(
    'Hello world',
  );
  await field.focus();
  await page.keyboard.press('Control+Space');
  await expect(field).toBeFocused();
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => !a.paused))
    .toBe(true);
  await page.keyboard.press('Control+Space');
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(true);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Hello world');
  await page.getByRole('button', { name: '下一句', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '第 2 句听写', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一句', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '第 1 句听写', exact: true })).toHaveValue(
    'Hello world',
  );
  await page.getByRole('button', { name: '跟读', exact: true }).click();
  await expect(page.locator('.readalong__sentence').first()).toContainText('Hello');
  await expect(page.locator('.readalong__sentence').first()).toContainText('world');
  await expect(page.locator('.readalong__sentence').nth(1)).toContainText('尚未听写，原文已隐藏');
  await page.getByRole('button', { name: '听写', exact: true }).click();
  await page.getByRole('button', { name: '练习记录', exact: true }).click();
  await page.getByRole('button', { name: '重新听写', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '第 1 句听写', exact: true })).toHaveValue('');
  await expect(page.locator('.comparison')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('one-screen layout keeps the main area usable with sidebar collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '导入第一篇音频' })).toBeEnabled();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'mobile.wav', mimeType: 'audio/wav', buffer: wav() });
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles({
      name: 'practice.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:00,000 --> 00:00:04,000\nHello world'),
    });
  await expect(page.locator('.app--workbench')).toBeVisible();
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '第 1 句听写', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '第 1 句听写', exact: true }).fill('Hello');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  const noPageScroll = await page.evaluate(
    () => document.documentElement.scrollHeight <= window.innerHeight + 1,
  );
  expect(noPageScroll).toBe(true);
});
test('migrates version 1 data, exports SRT and re-imports it unchanged', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((audio: number[]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const request = indexedDB.open('attune', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('materials', { keyPath: 'id' });
      store.put({
        id: 'old',
        name: 'old lesson.wav',
        audio: new Blob([new Uint8Array(audio)], { type: 'audio/wav' }),
        duration: 4,
        segments: [
          { id: 'same', start: 0, end: 1.5, reference: 'Hello world.' },
          { id: 'same', start: 1.5, end: 3.25, reference: 'Listen again.' },
        ],
        attempts: [{ id: 't', createdAt: new Date(0).toISOString(), drafts: {}, checked: {} }],
        attemptId: 't',
        segmentId: 'same',
        position: 0,
        review: [],
      });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
    };
  }, Array.from(wav()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '听写练习', exact: true })).toBeVisible();
  await expect(page.locator('.sentence-sidebar__item')).toHaveCount(2);
  const stored = await page.evaluate(
    () =>
      new Promise<{ ids: string[]; words: boolean }>((resolve) => {
        const request = indexedDB.open('attune');
        request.onsuccess = () => {
          const get = request.result.transaction('materials').objectStore('materials').get('old');
          get.onsuccess = () =>
            resolve({
              ids: get.result.segments.map((s: { id: string }) => s.id),
              words: get.result.segments.every((s: { words: unknown }) => Array.isArray(s.words)),
            });
        };
      }),
  );
  expect(new Set(stored.ids).size).toBe(2);
  expect(stored.words).toBe(true);
  await expect(page.getByRole('button', { name: '识别原文' })).toBeDisabled();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SRT' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('old lesson.srt');
  const srt = (await (await file.createReadStream()).toArray()).join('');
  expect(srt).toBe(
    '\uFEFF1\r\n00:00:00,000 --> 00:00:01,500\r\nHello world.\r\n\r\n' +
      '2\r\n00:00:01,500 --> 00:00:03,250\r\nListen again.\r\n',
  );
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles({ name: 'old lesson.srt', mimeType: 'text/plain', buffer: Buffer.from(srt) });
  await expect(page.getByText('字幕已导入')).toBeVisible();
  await expect(page.locator('.sentence-sidebar__item')).toHaveCount(2);
  expect(errors).toEqual([]);
});
