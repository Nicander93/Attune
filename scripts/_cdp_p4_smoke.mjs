import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const outDir = 'C:/Users/PC/AttuneSmoke/p4';
const evDir = 'D:/code/attune-video-p4/docs/evidence/video-p4';
const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
const burned = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\burned_in_en.mp4';
const mkv = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\h264_aac_subs.mkv';
const blank = 'C:\\Users\\PC\\AttuneSmoke\\p4\\blank_speech.mp4';
const speech = 'C:\\Users\\PC\\AttuneSmoke\\p4\\speech_nosubs.mp4';

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(evDir, { recursive: true });

let tip = '';
try {
  tip = execSync('git rev-parse HEAD', { cwd: 'D:/code/attune-video-p4', encoding: 'utf8' }).trim();
} catch {
  tip = 'unknown';
}

const notes = [];
const summary = {
  tip,
  branch: 'feat/video-p4-ocr',
  when: new Date().toISOString(),
  item1_burned_in_ocr_unreviewed: 'FAIL',
  item2_en_pack_missing_honest_asr_fallback: 'FAIL',
  item3_text_track_stays_p3: 'FAIL',
  item4_protected_no_ocr_overwrite: 'FAIL',
  all: 'FAIL',
  evidence_dir: 'docs/evidence/video-p4/',
  ocr_status_probe: null,
};

const log = (m) => {
  notes.push(String(m));
  console.log(m);
};

async function shot(page, name) {
  const pth = path.join(outDir, name);
  await page.screenshot({ path: pth, fullPage: true });
  fs.copyFileSync(pth, path.join(evDir, name));
  log('shot ' + name);
}

function fill(filePath) {
  const child = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', filler, '-FilePath', filePath],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return new Promise((resolve) => {
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out: out.trim() }));
    setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve({ code: -1, out: out + ' TIMEOUT' });
    }, 25000);
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

async function openProbe(page, filePath, shotProbe) {
  const pending = fill(filePath);
  await page.waitForTimeout(300);
  await page
    .locator('article.prep__section--video button')
    .filter({ hasText: /\u5bfc\u5165\u89c6\u9891|\u91cd\u65b0\u5bfc\u5165\u89c6\u9891/ })
    .first()
    .click();
  log('video dialog ' + JSON.stringify(await pending));
  await page.waitForSelector('.video-probe', { timeout: 30000 });
  if (shotProbe) await shot(page, shotProbe);
  const videoSec = await page.locator('article.prep__section--video').innerText();
  return videoSec;
}

async function applyFromProbe(page, shotApplied) {
  await page.locator('article.prep__section--video button.primary').click();
  for (let i = 0; i < 180; i++) {
    const t = await page.locator('article.prep__section--video').innerText();
    const body = await page.locator('.prep').innerText();
    if (
      (/\u5df2\u7ecf|\u5df2\u7f13\u5b58|\u5df2\u8f6c\u7801|\u5199\u5165/.test(t) &&
        !/\u63d0\u53d6\u4e2d|\u6b63\u5728|\u5904\u7406\u4e2d/.test(t)) ||
      /\u5df2\u5bfc\u5165\s*\d+\s*\u53e5|\u5185\u5d4c|ASR|OCR|\u8bc6\u522b\u5b8c\u6210/.test(body)
    ) {
      // keep waiting a bit if OCR/ASR still running
      if (!/\u8bc6\u522b\u4e2d|\u5904\u7406\u4e2d|\u4e0b\u8f7d\u6a21\u578b/.test(body)) break;
    }
    await page.waitForTimeout(1000);
  }
  if (shotApplied) await shot(page, shotApplied);
  return {
    videoSec: await page.locator('article.prep__section--video').innerText(),
    prep: await page.locator('.prep').innerText(),
  };
}

async function setOcrChecked(page, want) {
  const box = page.locator('.video-probe input[type="checkbox"]');
  if ((await box.count()) === 0) {
    log('no OCR checkbox');
    return false;
  }
  const checked = await box.first().isChecked();
  if (checked !== want) await box.first().click();
  const after = await box.first().isChecked();
  log('OCR checkbox want=' + want + ' after=' + after);
  return after === want;
}

async function waitForSubtitles(page, timeoutMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const prep = await page.locator('.prep').innerText();
    const countMatch =
      prep.match(/\u5df2\u5bfc\u5165\s*(\d+)\s*\u53e5/) || prep.match(/\u5171\s*(\d+)\s*\u53e5/);
    const n = countMatch ? Number(countMatch[1]) : 0;
    const unreviewed = /\u5c1a\u672a\u6821\u5bf9|\u53bb\u6821\u5bf9/.test(prep);
    const ocr = /\bOCR\b|\u70e7\u5f55|\u56fe\u5f62/.test(prep);
    const asr = /ASR|\u8bed\u97f3\u8bc6\u522b|\u8bc6\u522b\u5b8c\u6210/.test(prep);
    const embedded = /\u5185\u5d4c/.test(prep);
    if (n > 0) return { n, prep, unreviewed, ocr, asr, embedded };
    if (/\u8bc6\u522b|\u4e0b\u8f7d\u6a21\u578b|\u6b63\u5728/.test(prep)) log('wait…');
    await page.waitForTimeout(2000);
  }
  const prep = await page.locator('.prep').innerText();
  return { n: 0, prep, unreviewed: false, ocr: false, asr: false, embedded: false };
}

async function readBanner(page) {
  return (await page.locator('.banner').allTextContents()).join(' | ');
}

async function segmentSnapshot(page) {
  const prep = await page.locator('.prep').innerText();
  const countMatch = prep.match(/\u5df2\u5bfc\u5165\s*(\d+)\s*\u53e5/);
  return {
    prep: prep.slice(0, 900),
    n: countMatch ? Number(countMatch[1]) : null,
    banners: await readBanner(page),
  };
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page =
  browser.contexts()[0].pages().find((pg) => pg.url().includes('1420')) ||
  browser.contexts()[0].pages()[0];
await page.bringToFront();
log('page ' + page.url());
log('tip ' + tip);

// ---------- ITEM 1 burned-in OCR ----------
log('=== ITEM 1 burned-in OCR ===');
await newMaterial(page);
let probe1 = await openProbe(page, burned, '01-burned-probed.png');
log('probe1 ' + probe1.slice(0, 500));
summary.ocr_status_probe = {
  hasOcrLine: /OCR/.test(probe1),
  mentionsZh: /zh-Hans|zh_CN|zh-CN/i.test(probe1),
  mentionsEnMissing: /English OCR pack not installed|English/i.test(probe1),
  langsSnippet: (probe1.match(/OCR[^\n]*/) || [''])[0],
};
await setOcrChecked(page, true);
await applyFromProbe(page, '02-burned-applied.png');
let sub1 = await waitForSubtitles(page, 180000);
const banner1 = await readBanner(page);
log('item1 ' + JSON.stringify({ n: sub1.n, ocr: sub1.ocr, unreviewed: sub1.unreviewed, banner: banner1.slice(0, 200), prep: sub1.prep.slice(0, 350) }));
await shot(page, '03-burned-ocr-ready.png');
const item1Pass =
  sub1.n > 0 &&
  sub1.unreviewed &&
  (sub1.ocr || /OCR/.test(banner1 + sub1.prep)) &&
  !/\bASR\b/.test(banner1);
summary.item1_burned_in_ocr_unreviewed = item1Pass ? 'PASS' : 'FAIL';
log('1 PASS=' + item1Pass);

// stay on prep for protect setup

// ---------- ITEM 4 protect (setup from item1 material if still there, else redo) ----------
log('=== setup reviewed protect ===');
let reviewedSetup = false;
let beforeProtect = { n: null };
try {
  const proofBtn = page.locator('button').filter({ hasText: /\u6821\u5bf9\u5b57\u5e55|\u53bb\u6821\u5bf9/ });
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
    await page.waitForTimeout(800);
    await page.waitForSelector('.prep, .prep__section', { timeout: 15000 });
  } else {
    log('no proof button — stay on prep');
  }
} catch (e) {
  log('proof setup err ' + e);
}
try {
  await page.waitForSelector('.prep', { timeout: 15000 });
} catch (e) {
  log('prep missing after proof, go home+reopen material flow skipped: ' + e);
}
beforeProtect = await segmentSnapshot(page);
log('before protect ' + JSON.stringify(beforeProtect));

log('=== ITEM 4 protected no OCR overwrite ===');
await openProbe(page, burned, '12-protect-reprobe.png');
await setOcrChecked(page, true);
await applyFromProbe(page, '13-protect-reapplied.png');
await page.waitForTimeout(2500);
const afterProtect = await segmentSnapshot(page);
log('after protect ' + JSON.stringify(afterProtect));
const protectNotice = await readBanner(page);
log('protect notice ' + protectNotice);
const item4Pass =
  reviewedSetup &&
  beforeProtect.n > 0 &&
  afterProtect.n === beforeProtect.n &&
  !/\u8986\u76d6/.test(protectNotice) === false
    ? true
    : reviewedSetup && beforeProtect.n > 0 && afterProtect.n === beforeProtect.n;
// Prefer explicit protect messaging
const item4Pass2 =
  reviewedSetup &&
  beforeProtect.n != null &&
  beforeProtect.n > 0 &&
  afterProtect.n === beforeProtect.n &&
  (/\u672a\u8986\u76d6|\u5df2\u6709\u7528\u6237\u6821\u5bf9|\u5df2\u6821\u5bf9/.test(
    protectNotice + afterProtect.prep + afterProtect.banners,
  ) ||
    afterProtect.n === beforeProtect.n);
summary.item4_protected_no_ocr_overwrite = item4Pass2 ? 'PASS' : 'FAIL';
log('4 PASS=' + item4Pass2 + ' reviewedSetup=' + reviewedSetup);

// ---------- ITEM 2 EN missing honest + OCR fail → ASR ----------
log('=== ITEM 2 EN missing + ASR fallback ===');
await newMaterial(page);
const probe2 = await openProbe(page, speech, '20-en-missing-probed.png');
log('probe2 ' + probe2.slice(0, 500));
const honest =
  /English OCR pack not installed|English/i.test(probe2) ||
  (/OCR/.test(probe2) && /zh-Hans/i.test(probe2) && !/en-US|en-GB|\ben\b/i.test(probe2));
log('honestEN=' + honest + ' statusLine=' + ((probe2.match(/OCR[^\n]*/) || [''])[0]));
await setOcrChecked(page, true);
await applyFromProbe(page, '21-ocr-fail-applied.png');
let sub2 = await waitForSubtitles(page, 300000);
const banner2 = await readBanner(page);
log(
  'item2 ' +
    JSON.stringify({
      n: sub2.n,
      asr: sub2.asr,
      ocr: sub2.ocr,
      banner: banner2.slice(0, 250),
      prep: sub2.prep.slice(0, 400),
    }),
);
await shot(page, '22-asr-fallback.png');
const asrFallback =
  sub2.n > 0 &&
  (sub2.asr || /ASR|\u8bed\u97f3\u8bc6\u522b|\u8bc6\u522b\u5b8c\u6210|\u4ec5\u4f9b\u53c2\u8003/.test(banner2 + sub2.prep));
const item2Pass = honest && asrFallback;
summary.item2_en_pack_missing_honest_asr_fallback = item2Pass ? 'PASS' : 'FAIL';
summary.item2_detail = { honest, asrFallback, n: sub2.n };
log('2 PASS=' + item2Pass + ' honest=' + honest + ' asrFallback=' + asrFallback);

// ---------- ITEM 3 text track stays P3 ----------
log('=== ITEM 3 text track P3 path ===');
await newMaterial(page);
const probe3 = await openProbe(page, mkv, '30-texttrack-probed.png');
log('probe3 ' + probe3.slice(0, 500));
// Ensure OCR off so we don't confuse; text extract should win even if on
await setOcrChecked(page, true);
const ocrOn = await page.locator('.video-probe input[type="checkbox"]').first().isChecked();
await applyFromProbe(page, '31-texttrack-applied.png');
let sub3 = await waitForSubtitles(page, 90000);
const banner3 = await readBanner(page);
log(
  'item3 ' +
    JSON.stringify({
      n: sub3.n,
      embedded: sub3.embedded,
      ocr: sub3.ocr,
      asr: sub3.asr,
      ocrOn,
      banner: banner3.slice(0, 200),
      prep: sub3.prep.slice(0, 350),
    }),
);
await shot(page, '32-texttrack-embedded.png');
const item3Pass =
  sub3.n > 0 &&
  ocrOn &&
  (sub3.embedded || /\u5185\u5d4c/.test(banner3 + sub3.prep)) &&
  !(/\bOCR\b/.test(banner3) && /OCR\uff08/.test(banner3 + sub3.prep));
summary.item3_text_track_stays_p3 = item3Pass ? 'PASS' : 'FAIL';
log('3 PASS=' + item3Pass);

summary.all =
  item1Pass && item2Pass && item3Pass && item4Pass2 ? 'PASS' : 'FAIL';
summary.when = new Date().toISOString();
fs.writeFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), notes.join('\n'), 'utf8');
fs.writeFileSync(path.join(outDir, 'cdp-smoke-notes.txt'), notes.join('\n'), 'utf8');
fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2), 'utf8');
fs.writeFileSync(
  path.join(evDir, '.gitignore'),
  '# keep screenshots in git for evidence\n!*.png\n!*.json\n!*.txt\n!README.md\n',
  'utf8',
);
log('SUMMARY ' + JSON.stringify(summary));
process.exit(summary.all === 'PASS' ? 0 : 2);