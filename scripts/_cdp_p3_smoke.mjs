import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const outDir = 'C:/Users/PC/AttuneSmoke/p3';
const evDir = 'D:/code/attune-video-p3/docs/evidence/video-p3';
const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
const mkv = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\h264_aac_subs.mkv';
const mp4 = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\h264_aac.mp4';
const manualSrt = 'C:\\Users\\PC\\AttuneSmoke\\p3\\manual.srt';

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(evDir, { recursive: true });

const notes = [];
const summary = {
  tip: '',
  branch: 'feat/video-p3-subtitles',
  when: new Date().toISOString(),
  item1_embedded_text_to_dictation: 'FAIL',
  item2_asr_fallback_unreviewed: 'FAIL',
  item3_protected_no_overwrite: 'FAIL',
  item4_manual_srt_import: 'FAIL',
  all: 'FAIL',
  evidence_dir: 'docs/evidence/video-p3/',
};

const log = (m) => { notes.push(String(m)); console.log(m); };

async function shot(page, name) {
  const pth = path.join(outDir, name);
  await page.screenshot({ path: pth, fullPage: true });
  fs.copyFileSync(pth, path.join(evDir, name));
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

async function clickBtn(page, re) {
  await page.getByRole('button', { name: re }).first().click();
}

async function goHome(page) {
  await clickBtn(page, /\u9996\u9875/);
  await page.waitForTimeout(500);
}

async function newMaterial(page) {
  await goHome(page);
  await clickBtn(page, /\u65b0\u5efa\u7d20\u6750/);
  await page.waitForTimeout(900);
}

async function applyVideoFile(page, filePath, shotProbe, shotApplied) {
  const pending = fill(filePath);
  await page.waitForTimeout(300);
  await page.locator('article.prep__section--video button').filter({ hasText: /\u5bfc\u5165\u89c6\u9891|\u91cd\u65b0\u5bfc\u5165\u89c6\u9891/ }).first().click();
  log('video dialog ' + JSON.stringify(await pending));
  await page.waitForSelector('.video-probe', { timeout: 30000 });
  if (shotProbe) await shot(page, shotProbe);
  await page.locator('article.prep__section--video button.primary').click();
  for (let i = 0; i < 120; i++) {
    const t = await page.locator('article.prep__section--video').innerText();
    const body = await page.locator('.prep').innerText();
    if ((/\u5df2\u7ecf|\u5df2\u7f13\u5b58|\u5df2\u8f6c\u7801|\u5199\u5165/.test(t) && !/\u63d0\u53d6\u4e2d|\u6b63\u5728/.test(t)) ||
        /\u5df2\u5bfc\u5165\s*\d+\s*\u53e5|\u5185\u5d4c|ASR|\u8bc6\u522b\u5b8c\u6210/.test(body)) break;
    await page.waitForTimeout(1000);
  }
  if (shotApplied) await shot(page, shotApplied);
  const videoSec = await page.locator('article.prep__section--video').innerText();
  const prep = await page.locator('.prep').innerText();
  log('video sec ' + videoSec.slice(0, 400));
  log('prep body ' + prep.slice(0, 600));
  return { videoSec, prep };
}

async function waitForSubtitles(page, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const prep = await page.locator('.prep').innerText();
    const countMatch = prep.match(/\u5df2\u5bfc\u5165\s*(\d+)\s*\u53e5/) || prep.match(/\u5171\s*(\d+)\s*\u53e5/);
    const n = countMatch ? Number(countMatch[1]) : 0;
    const unreviewed = /\u5c1a\u672a\u6821\u5bf9|ASR|\u5185\u5d4c|\u4ec5\u4f9b\u53c2\u8003|\u53bb\u6821\u5bf9/.test(prep);
    const asr = /ASR|\u8bed\u97f3\u8bc6\u522b|\u8bc6\u522b\u5b8c\u6210|\u8bc6\u522b\u4e2d/.test(prep);
    if (n > 0) return { n, prep, unreviewed, asr };
    if (/\u8bc6\u522b|\u4e0b\u8f7d\u6a21\u578b|\u6b63\u5728/.test(prep)) log('wait…');
    await page.waitForTimeout(2000);
  }
  const prep = await page.locator('.prep').innerText();
  return { n: 0, prep, unreviewed: false, asr: false };
}

async function readBanner(page) {
  return (await page.locator('.banner').allTextContents()).join(' | ');
}

async function segmentSnapshot(page) {
  const prep = await page.locator('.prep').innerText();
  const countMatch = prep.match(/\u5df2\u5bfc\u5165\s*(\d+)\s*\u53e5/);
  return { prep: prep.slice(0, 800), n: countMatch ? Number(countMatch[1]) : null, banners: await readBanner(page) };
}


const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages().find((pg) => pg.url().includes('1420')) || browser.contexts()[0].pages()[0];
await page.bringToFront();
log('page ' + page.url());

log('=== ITEM 1 embedded ===');
await newMaterial(page);
await applyVideoFile(page, mkv, '01-embedded-probed.png', '02-embedded-applied.png');
let sub1 = await waitForSubtitles(page, 90000);
log('item1 subs ' + JSON.stringify({ n: sub1.n, unreviewed: sub1.unreviewed, asr: sub1.asr, prep: sub1.prep.slice(0, 300) }));
await shot(page, '03-embedded-subs-ready.png');
const banner1 = await readBanner(page);
log('item1 banner ' + banner1);

let dictationOk = false;
try {
  const startBtn = page.getByRole('button', { name: /\u5f00\u59cb\u542c\u5199/ });
  const disabled = await startBtn.isDisabled();
  log('start-dictation disabled=' + disabled);
  if (!disabled) {
    await startBtn.click();
    await page.waitForTimeout(1200);
    await shot(page, '04-dictation-no-manual-srt.png');
    const d = await page.evaluate(() => ({
      hasDraft: !!document.querySelector('textarea'),
      body: document.body.innerText.slice(0, 500),
    }));
    log('dictation dom ' + JSON.stringify(d));
    dictationOk = /\u542c\u5199|\u539f\u6587|\u53e5\u5b50|\u6838\u5bf9/.test(d.body) || d.hasDraft;
  }
} catch (e) {
  log('dictation click err ' + e);
}
const item1Pass = sub1.n > 0 && dictationOk;
summary.item1_embedded_text_to_dictation = item1Pass ? 'PASS' : 'FAIL';
log('1 PASS=' + item1Pass + ' n=' + sub1.n);

try {
  const back = page.getByRole('button', { name: /\u8fd4\u56de/ });
  if (await back.count()) { await back.first().click(); await page.waitForTimeout(600); }
} catch {}

log('=== setup protection mark reviewed ===');
let reviewedSetup = false;
try {
  const proofBtn = page.getByRole('button', { name: /\u6821\u5bf9\u5b57\u5e55/ });
  if (await proofBtn.count()) {
    await proofBtn.first().click();
    await page.waitForTimeout(800);
    await shot(page, '10-proof-before-mark.png');
    const mark = page.getByRole('button', { name: /\u6807\u8bb0\u5df2\u6821\u5bf9/ });
    if (await mark.count()) {
      await mark.first().click();
      await page.waitForTimeout(500);
      reviewedSetup = true;
      log('marked reviewed');
    }
    await shot(page, '11-proof-marked.png');
    await page.getByRole('button', { name: /\u8fd4\u56de/ }).first().click();
    await page.waitForTimeout(600);
  }
} catch (e) {
  log('proof setup err ' + e);
}

const beforeProtect = await segmentSnapshot(page);
log('before protect ' + JSON.stringify(beforeProtect));

log('=== ITEM 3 protected ===');
await applyVideoFile(page, mkv, '12-protect-reprobe.png', '13-protect-reapplied.png');
await page.waitForTimeout(2500);
const afterProtect = await segmentSnapshot(page);
log('after protect ' + JSON.stringify(afterProtect));
log('protect notice ' + (await readBanner(page)));
const item3Pass = reviewedSetup && beforeProtect.n > 0 && afterProtect.n === beforeProtect.n;
summary.item3_protected_no_overwrite = item3Pass ? 'PASS' : 'FAIL';
log('3 PASS=' + item3Pass + ' reviewedSetup=' + reviewedSetup);

log('=== ITEM 2 ASR ===');
await newMaterial(page);
await applyVideoFile(page, mp4, '20-nosubs-probed.png', '21-nosubs-applied.png');
let sub2 = await waitForSubtitles(page, 300000);
log('item2 subs ' + JSON.stringify({ n: sub2.n, unreviewed: sub2.unreviewed, asr: sub2.asr, prep: sub2.prep.slice(0, 400) }));
const banner2 = await readBanner(page);
log('item2 banner ' + banner2);
await shot(page, '22-asr-result.png');
const asrTagged = /ASR|\u8bed\u97f3\u8bc6\u522b|\u8bc6\u522b\u5b8c\u6210|\u4ec5\u4f9b\u53c2\u8003/.test(banner2 + sub2.prep) || sub2.asr || sub2.unreviewed;
const item2Pass = sub2.n > 0 && asrTagged;
summary.item2_asr_fallback_unreviewed = item2Pass ? 'PASS' : 'FAIL';
log('2 PASS=' + item2Pass + ' n=' + sub2.n + ' asrTagged=' + asrTagged);

log('=== ITEM 4 manual SRT ===');
await newMaterial(page);
await applyVideoFile(page, mp4, '30-manual-video-probed.png', '31-manual-video-applied.png');
// Give ASR a moment to maybe start; then overwrite with manual SRT (unprotected until drafts)
await page.waitForTimeout(4000);
// If recognition task running, still try import — replaceTimeline ok if no drafts
const pendingSrt = fill(manualSrt);
await page.waitForTimeout(300);
await page.getByRole('button', { name: /\u5bfc\u5165\u5b57\u5e55|\u9009\u62e9\u5b57\u5e55\u6587\u4ef6/ }).first().click();
log('srt dialog ' + JSON.stringify(await pendingSrt));
await page.waitForTimeout(2500);
const afterSrt = await segmentSnapshot(page);
const b4 = await readBanner(page);
log('after manual srt ' + JSON.stringify(afterSrt));
log('manual banner ' + b4);
await shot(page, '32-manual-srt-imported.png');
const item4Pass = (afterSrt.n != null && afterSrt.n >= 2) || /\u5df2\u5bfc\u5165\s*[2-9]|\u5df2\u5bfc\u5165\s*\d+\s*\u53e5/.test(afterSrt.prep + b4);
summary.item4_manual_srt_import = item4Pass ? 'PASS' : 'FAIL';
log('4 PASS=' + item4Pass);

summary.all = item1Pass && item2Pass && item3Pass && item4Pass ? 'PASS' : 'FAIL';
summary.when = new Date().toISOString();
fs.writeFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), notes.join('\n'), 'utf8');
fs.writeFileSync(path.join(outDir, 'cdp-smoke-notes.txt'), notes.join('\n'), 'utf8');
fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2), 'utf8');
log('SUMMARY ' + JSON.stringify(summary));
process.exit(summary.all === 'PASS' ? 0 : 2);
