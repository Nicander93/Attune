// Exercises the built Windows WebView2 app in a disposable profile. No user DB is
// opened or modified. Native file-dialog interaction and physical IME need a person.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';

const output = resolve('test-results/native-smoke');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(resolve(output, 'profile-'));
const portProbe = createServer();
await new Promise((done) => portProbe.listen(0, '127.0.0.1', done));
const port = portProbe.address().port;
await new Promise((done) => portProbe.close(done));
const endpoint = `http://127.0.0.1:${port}`;
const app = spawn(resolve('src-tauri/target/release/attune.exe'), [], {
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: profile,
  },
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* WebView2 is still starting. */
    }
    if (app.exitCode !== null) throw new Error(`Native app exited: ${app.exitCode}`);
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) throw new Error('WebView2 debug endpoint did not open.');
  browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts()[0].pages()[0];
  await expect(page.getByRole('heading', { name: '继续学习' })).toBeVisible();
  expect(await page.evaluate(() => '__TAURI_INTERNALS__' in window)).toBe(true);
  // The fresh profile must be empty; abort before writing if isolation did not work.
  await page.getByRole('button', { name: '素材库' }).first().click();
  await expect(page.locator('.materials__row')).toHaveCount(0);
  const models = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_models'));
  expect(models.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: /新建素材/ }).click();
  await expect(page.getByText('素材准备')).toBeVisible();
  const rate = 8000,
    samples = rate * 9;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(Math.sin(i / 12) * 4000), 44 + i * 2);
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'native-smoke.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.getByText('音频已导入：native-smoke.wav')).toBeVisible();
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles({
      name: 'native-smoke.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        '1\n00:00:00,000 --> 00:00:03,000\nHello world.\n\n2\n00:00:03,000 --> 00:00:06,000\nNice to meet you.\n',
      ),
    });
  await expect(page.getByText(/字幕已导入 2 句/)).toBeVisible();
  await page.getByRole('button', { name: '本地识别原文' }).click();
  await expect(page.getByRole('button', { name: '开始识别' })).toBeVisible();
  await expect(page.getByLabel('识别模型')).toBeEnabled();
  await page.getByRole('button', { name: '收起' }).click();
  await page.getByRole('button', { name: '开始听写' }).click();
  const field = page.getByLabel('第 1 句听写');
  await field.fill('Hello world');
  await field.press('Enter');
  await expect(page.locator('.diff')).toContainText('和原文一致');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator('audio').evaluate((audio) => audio.paused), { timeout: 6000 })
    .toBe(true);
  await expect(page.locator('.app')).toHaveAttribute('data-saving', 'false');
  await page.screenshot({ path: resolve(output, 'dictation.png') });
  await page.getByRole('button', { name: '完整原文 ↗' }).click();
  await page.locator('.transcript__jump').nth(1).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(field).toHaveValue('Hello world');
  await expect(page.locator('.diff')).toBeVisible();
  await expect(page.locator('.app')).toHaveAttribute('data-saving', 'false');
  await page.reload();
  await page.getByRole('button', { name: '素材库' }).first().click();
  await page.locator('.materials__row').first().click();
  await expect(field).toHaveValue('Hello world');
  await expect(page.locator('.diff')).toBeVisible();
  console.log(
    `Native WebView2 smoke passed: IPC (${models.length} models), WAV/SRT import, playback, check, transcript, persistence. Profile: ${profile}`,
  );
} finally {
  await browser?.close();
  app.kill();
}
