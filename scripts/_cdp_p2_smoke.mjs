import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const outDir = 'C:/Users/PC/AttuneSmoke/p2';
const evDir = 'D:/code/attune-video-p2/docs/evidence/video-p2';
const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
const h264 = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\h264_aac.mp4';
const srt = 'C:\\Users\\PC\\AttuneSmoke\\p2\\clip.srt';
const wav = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\extracted\\h264_audio.wav';
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(evDir, { recursive: true });
const notes = [];
const log = (m) => { notes.push(String(m)); console.log(m); };
async function shot(page, name) {
  const p = path.join(outDir, name);
  await page.screenshot({ path: p, fullPage: true });
  fs.copyFileSync(p, path.join(evDir, name));
  log('shot ' + name);
}
function fill(filePath) {
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', filler, '-FilePath', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve) => {
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out: out.trim() }));
    setTimeout(() => { try { child.kill(); } catch {} resolve({ code: -1, out: out + ' TIMEOUT' }); }, 25000);
  });
}
async function clickText(page, re, opts = {}) {
  await page.getByRole('button', { name: re }).first().click(opts);
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('1420')) || browser.contexts()[0].pages()[0];
await page.bringToFront();
log('page ' + page.url());

// --- fresh video material ---
await clickText(page, /首页/);
await page.waitForTimeout(400);
await clickText(page, /新建素材/);
await page.waitForTimeout(900);

const pendingVideo = fill(h264);
await page.waitForTimeout(300);
await page.locator('article.prep__section--video button').filter({ hasText: /导入视频|重新导入视频/ }).first().click();
log('video dialog ' + JSON.stringify(await pendingVideo));
await page.waitForSelector('.video-probe', { timeout: 25000 });
await shot(page, '01-video-probed.png');
await page.locator('article.prep__section--video button.primary').click();
for (let i = 0; i < 90; i++) {
  const t = await page.locator('article.prep__section--video').innerText();
  if (/已就绪|已缓存|已生成/.test(t) && !/提取中/.test(t)) break;
  await page.waitForTimeout(1000);
}
await shot(page, '02-video-extracted.png');
log('video sec ' + (await page.locator('article.prep__section--video').innerText()).slice(0, 400));

// import SRT via subtitle file picker (native open dialog)
const pendingSrt = fill(srt);
await page.waitForTimeout(300);
await page.getByRole('button', { name: /导入字幕|选择字幕文件/ }).first().click();
log('srt dialog ' + JSON.stringify(await pendingSrt));
await page.waitForTimeout(1500);
log('after srt ' + (await page.locator('article.prep__section').first().innerText()).slice(0, 200));
await shot(page, '03-subtitles-imported.png');

// ① Dictation: audio plays, video surface hidden
await clickText(page, /开始听写/);
await page.waitForTimeout(1200);
await shot(page, '10-dictation-entry.png');

const d1 = await page.evaluate(() => {
  const video = document.querySelector('video');
  const audio = document.querySelector('audio');
  const wrap = document.querySelector('.media-output');
  window.__p2VideoEl = video;
  return {
    videoCount: document.querySelectorAll('video').length,
    audioCount: document.querySelectorAll('audio').length,
    hasWrap: !!wrap,
    wrapHidden: wrap?.classList.contains('media-output--hidden') ?? null,
    wrapAria: wrap?.getAttribute('aria-hidden'),
    videoSrc: video?.currentSrc || video?.getAttribute('src') || '',
    audioSrc: audio?.currentSrc || audio?.getAttribute('src') || '',
    anyRawDisk: [...document.querySelectorAll('video,audio')].some((el) => {
      const s = el.currentSrc || el.getAttribute('src') || '';
      return /^file:/i.test(s) || /^[A-Za-z]:[\\\\/]/.test(s);
    }),
  };
});
log('① entry DOM ' + JSON.stringify(d1));

await page.getByRole('button', { name: /播放|暂停/ }).first().click();
await page.waitForTimeout(800);
const dPlay = await page.evaluate(() => {
  const el = document.querySelector('video,audio');
  return {
    tag: el?.tagName,
    paused: el?.paused,
    currentTime: el?.currentTime ?? null,
    wrapHidden: document.querySelector('.media-output')?.classList.contains('media-output--hidden') ?? null,
  };
});
log('① after play ' + JSON.stringify(dPlay));
await shot(page, '11-dictation-playing-hidden.png');

const item1Pass =
  d1.videoCount === 1 &&
  d1.wrapHidden === true &&
  dPlay.paused === false &&
  (dPlay.currentTime ?? 0) > 0 &&
  !d1.anyRawDisk &&
  /asset|localhost|http/.test(d1.videoSrc);
log('① PASS=' + item1Pass);

// pause before typing
if (dPlay.paused === false) {
  await page.getByRole('button', { name: /暂停/ }).first().click();
  await page.waitForTimeout(300);
}

// type draft + 核对
const field = page.locator('textarea').first();
await field.click();
await field.fill('Hello world');
await page.waitForTimeout(200);
await page.getByRole('button', { name: /核对答案/ }).click();
await page.waitForTimeout(800);
await shot(page, '20-after-check.png');

const showBtn = page.getByRole('button', { name: /看画面/ });
await showBtn.waitFor({ timeout: 5000 });
const beforeShow = await page.evaluate(() => {
  const v = document.querySelector('video');
  return {
    sameEl: v === window.__p2VideoEl,
    t: v?.currentTime ?? null,
    hidden: document.querySelector('.media-output')?.classList.contains('media-output--hidden') ?? null,
    readyState: v?.readyState ?? null,
  };
});
log('② before 看画面 ' + JSON.stringify(beforeShow));

await showBtn.click();
await page.waitForTimeout(600);
await shot(page, '21-show-video.png');
const afterShow = await page.evaluate(() => {
  const v = document.querySelector('video');
  return {
    sameEl: v === window.__p2VideoEl,
    t: v?.currentTime ?? null,
    hidden: document.querySelector('.media-output')?.classList.contains('media-output--hidden') ?? null,
    videoCount: document.querySelectorAll('video').length,
  };
});
log('② after 看画面 ' + JSON.stringify(afterShow));

await page.getByRole('button', { name: /收起画面/ }).click();
await page.waitForTimeout(500);
await shot(page, '22-hide-video.png');
const afterHide = await page.evaluate(() => {
  const v = document.querySelector('video');
  return {
    sameEl: v === window.__p2VideoEl,
    t: v?.currentTime ?? null,
    hidden: document.querySelector('.media-output')?.classList.contains('media-output--hidden') ?? null,
    videoCount: document.querySelectorAll('video').length,
  };
});
log('② after 收起画面 ' + JSON.stringify(afterHide));

const item2Pass =
  beforeShow.sameEl &&
  afterShow.sameEl &&
  afterHide.sameEl &&
  afterShow.hidden === false &&
  afterHide.hidden === true &&
  afterShow.videoCount === 1 &&
  afterHide.videoCount === 1;
log('② PASS=' + item2Pass);

// ③ Listen-read
await page.getByRole('tab', { name: /听读/ }).click();
await page.waitForTimeout(800);
await shot(page, '30-listen-read.png');
const r1 = await page.evaluate(() => {
  const wrap = document.querySelector('.media-output');
  const v = document.querySelector('video');
  return {
    wrapHidden: wrap?.classList.contains('media-output--hidden') ?? null,
    sameEl: v === window.__p2VideoEl,
    videoSrc: v?.currentSrc || '',
  };
});
log('③ reading surface ' + JSON.stringify(r1));

await page.getByRole('button', { name: /播放/ }).first().click();
await page.waitForTimeout(700);
// speed
await page.locator('select[aria-label=播放速度]').selectOption('1.25');
await page.waitForTimeout(400);
const speedOk = await page.evaluate(() => document.querySelector('video,audio')?.playbackRate === 1.25);
// loop checkbox
const loop = page.locator('label', { hasText: /本句循环|单句循环/ }).locator('input[type=checkbox]');
if (await loop.count()) {
  await loop.check();
  await page.waitForTimeout(200);
}
// keyboard Space toggle
await page.locator('body').click({ position: { x: 10, y: 10 } });
await page.keyboard.press('Space');
await page.waitForTimeout(400);
const afterSpace = await page.evaluate(() => document.querySelector('video,audio')?.paused);
await page.keyboard.press('Space');
await page.waitForTimeout(400);
const afterSpace2 = await page.evaluate(() => document.querySelector('video,audio')?.paused);
await shot(page, '31-listen-read-controls.png');
const sync = await page.evaluate(() => {
  const v = document.querySelector('video');
  const active = document.querySelector('.reading [aria-current], .reading .is-active, .word--active, .reading__word--active');
  return {
    t: v?.currentTime ?? null,
    paused: v?.paused,
    hasActiveHint: !!active || !!document.querySelector('.reading'),
  };
});
log('③ sync/controls ' + JSON.stringify({ speedOk, afterSpace, afterSpace2, sync, r1 }));
const item3Pass = r1.wrapHidden === false && r1.sameEl && speedOk && typeof afterSpace === 'boolean';
log('③ PASS=' + item3Pass);

// ④ Pure audio material
await clickText(page, /首页/);
await page.waitForTimeout(400);
await clickText(page, /新建素材/);
await page.waitForTimeout(900);
const pendingWav = fill(wav);
await page.waitForTimeout(300);
// audio import button in first prep section
await page.getByRole('button', { name: /选择音频|更换音频/ }).first().click();
log('wav dialog ' + JSON.stringify(await pendingWav));
await page.waitForTimeout(1500);
await shot(page, '40-audio-material.png');
// import srt for audio too so study works
const pendingSrt2 = fill(srt);
await page.waitForTimeout(300);
await page.getByRole('button', { name: /导入字幕|选择字幕文件/ }).first().click();
log('srt2 dialog ' + JSON.stringify(await pendingSrt2));
await page.waitForTimeout(1200);
await clickText(page, /开始听写/);
await page.waitForTimeout(1000);
await shot(page, '41-audio-dictation.png');
const a1 = await page.evaluate(() => ({
  videoCount: document.querySelectorAll('video').length,
  audioCount: document.querySelectorAll('audio').length,
  audioSrc: document.querySelector('audio')?.currentSrc || '',
  hasVideoToggle: [...document.querySelectorAll('button')].some((b) => /看画面|收起画面/.test(b.textContent || '')),
}));
log('④ audio DOM ' + JSON.stringify(a1));
await page.getByRole('button', { name: /播放/ }).first().click();
await page.waitForTimeout(700);
const aPlay = await page.evaluate(() => {
  const a = document.querySelector('audio');
  return { paused: a?.paused, t: a?.currentTime ?? null, tagOnlyAudio: !document.querySelector('video') };
});
log('④ audio play ' + JSON.stringify(aPlay));
await shot(page, '42-audio-playing.png');
const item4Pass = a1.videoCount === 0 && a1.audioCount === 1 && aPlay.paused === false && (aPlay.t ?? 0) > 0 && aPlay.tagOnlyAudio;
log('④ PASS=' + item4Pass);

const summary = {
  tip: '629a446',
  item1_dictation_hidden: item1Pass,
  item2_toggle_no_remount: item2Pass,
  item3_listen_read: item3Pass,
  item4_pure_audio: item4Pass,
  all: item1Pass && item2Pass && item3Pass && item4Pass,
};
log('SUMMARY ' + JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), notes.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2), 'utf8');
fs.copyFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), path.join(outDir, 'cdp-smoke-notes.txt'));
console.log('DONE all=' + summary.all);
