import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(__dirname, '../fixtures/video-p0/webview2-harness.html');
const url = 'file:///' + html.replace(/\\/g, '/');
const browser = await chromium.launch({
  channel: 'msedge',
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
await page.goto(url);
await page.waitForTimeout(5000);
const dump = await page.evaluate(() => ({
  ua: navigator.userAgent,
  results: window.__P0_RESULTS || null,
  hide: window.__P0_HIDE || null,
  hidePass: window.__P0_HIDE_PASS ?? null,
  title: document.title,
  videos: [...document.querySelectorAll('video')].map(v => ({
    src: v.currentSrc || v.getAttribute('src'),
    readyState: v.readyState,
    networkState: v.networkState,
    error: v.error ? { code: v.error.code, message: v.error.message } : null,
    paused: v.paused,
    currentTime: v.currentTime,
    duration: v.duration,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
  })),
}));
const out = path.resolve(__dirname, '../fixtures/video-p0/p0-edge-results.json');
fs.writeFileSync(out, JSON.stringify(dump, null, 2));
console.log(JSON.stringify(dump, null, 2));
await browser.close();
