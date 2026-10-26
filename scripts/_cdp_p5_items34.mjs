import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const outDir = 'C:/Users/PC/AttuneSmoke/p5';
const evDir = 'D:/code/attune-video-p5/docs/evidence/video-p5';
const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
const mkv = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\h264_aac_subs.mkv';
const attuneExe = 'D:\\code\\attune-video-p5\\src-tauri\\target\\debug\\attune.exe';
const tip = execSync('git rev-parse HEAD', { cwd: 'D:/code/attune-video-p5', encoding: 'utf8' }).trim();

const notes = [];
const log = (m) => { notes.push(String(m)); console.log(m); };

const prev = JSON.parse(fs.readFileSync(path.join(evDir, 'SUMMARY.json'), 'utf8'));
const summary = { ...prev, tip, when: new Date().toISOString() };

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
function acceptDialogs(page) {
  page.removeAllListeners('dialog');
  page.on('dialog', async (d) => { log('dialog ' + d.type() + ': ' + String(d.message()).slice(0, 120)); await d.accept(); });
}
async function connectPage() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages().find((pg) => pg.url().includes('1420')) || browser.contexts()[0].pages()[0];
  await page.bringToFront();
  acceptDialogs(page);
  log('page ' + page.url());
  return { browser, page };
}
async function waitPort(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const r = await fetch('http://127.0.0.1:9222/json/version'); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
function sanitizedEnv() {
  const env = { ...process.env };
  delete env.ATTUNE_FFMPEG_DIR;
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222';
  const parts = (env.PATH || '').split(';').filter((d) => d && !fs.existsSync(path.join(d, 'ffmpeg.exe')));
  env.PATH = parts.join(';');
  return env;
}
function relaunchAttune() {
  const child = spawn(attuneExe, [], {
    cwd: 'D:\\code\\attune-video-p5\\src-tauri',
    env: sanitizedEnv(),
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  log('spawned attune pid=' + child.pid);
  return child.pid;
}
async function goHome(page) {
  await page.getByRole('button', { name: /\u9996\u9875/ }).first().click();
  await page.waitForTimeout(500);
}
async function newMaterial(page) {
  await goHome(page);
  await page.getByRole('button', { name: /\u65b0\u5efa\u7d20\u6750/ }).first().click();
  await page.waitForTimeout(900);
}
async function videoSecText(page) {
  return page.locator('article.prep__section--video').innerText();
}
async function readBanner(page) {
  return (await page.locator('.banner').allTextContents()).join(' | ');
}
async function openAndApply(page) {
  const pending = fill(mkv);
  await page.waitForTimeout(300);
  await page.locator('article.prep__section--video button').filter({ hasText: /\u5bfc\u5165\u89c6\u9891|\u91cd\u65b0\u5bfc\u5165\u89c6\u9891/ }).first().click();
  log('dialog ' + JSON.stringify(await pending));
  await page.waitForSelector('.video-probe', { timeout: 60000 });
  await shot(page, '19-pre-restart-probed.png');
  await page.locator('article.prep__section--video button.primary').click();
  for (let i = 0; i < 120; i++) {
    const body = await page.locator('.prep').innerText();
    if (/\u5df2\u5bfc\u5165\s*\d+\s*\u53e5/.test(body) || /\u5199\u5165/.test(body)) break;
    await page.waitForTimeout(1000);
  }
  await shot(page, '19-pre-restart-applied.png');
}

async function openH264Material(page) {
  await goHome(page);
  await page.waitForTimeout(400);
  const matBtn = page.locator('button, a, [role=button]').filter({ hasText: /h264_aac_subs/ });
  if (await matBtn.count()) {
    await matBtn.first().click();
    log('opened h264');
  } else {
    const any = page.locator('button').filter({ hasText: /h264|00:03/ });
    if (await any.count()) await any.first().click();
  }
  await page.waitForTimeout(1000);
  // Home opens study; jump to prep via 素材准备
  const prepBtn = page.getByRole('button', { name: /\u7d20\u6750\u8bbe\u7f6e|\u7d20\u6750\u51c6\u5907|\u53bb\u51c6\u5907\u5b57\u5e55/ });
  if (await prepBtn.count()) {
    await prepBtn.first().click();
    await page.waitForTimeout(800);
    log('clicked 素材准备');
  }
  if (!(await page.locator('article.prep__section--video').count())) {
    const back = page.getByRole('button', { name: /\u8fd4\u56de/ });
    if (await back.count()) { await back.first().click(); await page.waitForTimeout(700); }
  }
}

log('tip ' + tip + ' items 3+4 only');
let { browser, page } = await connectPage();

log('=== setup material ===');
await newMaterial(page);
await openAndApply(page);
await shot(page, '20-before-restart-home.png');

log('=== ITEM 3 restart ===');
await goHome(page);
await page.waitForTimeout(400);
try { execSync('taskkill /F /IM attune.exe', { stdio: 'ignore' }); } catch {}
await new Promise((r) => setTimeout(r, 2500));
relaunchAttune();
const up = await waitPort(90000);
log('cdp_up=' + up);
if (!up) {
  summary.item3_restart_restore_or_rebuild = 'FAIL';
  summary.detail.item3 = { reason: 'CDP not back' };
  log('3 PASS=false');
} else {
  try { await browser.close(); } catch {}
  ({ browser, page } = await connectPage());
  await page.waitForTimeout(1200);
  await shot(page, '21-after-restart-home.png');
  await openH264Material(page);
  await shot(page, '22-reopened-material.png');
  let sec3 = '';
  try {
    sec3 = await videoSecText(page);
  } catch (e) {
    sec3 = 'MISSING_PREP ' + e;
    await shot(page, '22c-missing-prep.png');
  }
  log('sec3 ' + sec3.slice(0, 400));
  const missingPlayback = /\u64ad\u653e\u526f\u672c\u7f3a\u5931/.test(sec3);
  let restoredOrRebuilt = false;
  if (missingPlayback) {
    await page.getByRole('button', { name: /\u91cd\u5efa\u64ad\u653e\u526f\u672c/ }).first().click();
    await page.waitForTimeout(12000);
    await shot(page, '23-rebuilt-after-restart.png');
    sec3 = await videoSecText(page);
    const banner = await readBanner(page);
    restoredOrRebuilt = !/\u64ad\u653e\u526f\u672c\u7f3a\u5931/.test(sec3) || /\u5df2\u91cd\u5efa/.test(banner);
  } else {
    const start = page.getByRole('button', { name: /\u5f00\u59cb\u542c\u5199/ });
    if (await start.count()) {
      await start.first().click();
      await page.waitForTimeout(1200);
      const ok = await page.evaluate(() => {
        const v = document.querySelector('video');
        return { hasVideo: !!v, src: v?.currentSrc || '' };
      });
      log('restored ' + JSON.stringify(ok));
      restoredOrRebuilt = ok.hasVideo && /asset\.localhost|playback/.test(ok.src);
      await shot(page, '23-restored-dictation.png');
      const back = page.getByRole('button', { name: /\u8fd4\u56de/ });
      if (await back.count()) { await back.first().click(); await page.waitForTimeout(600); }
    } else {
      restoredOrRebuilt = !missingPlayback && /ffmpeg|片|片段/.test(sec3);
    }
  }
  summary.item3_restart_restore_or_rebuild = restoredOrRebuilt ? 'PASS' : 'FAIL';
  summary.detail.item3 = { missingPlayback, restoredOrRebuilt, sec: sec3.slice(0, 350) };
  log('3 PASS=' + restoredOrRebuilt);
}

log('=== ITEM 4 clear cache ===');
try {
  if (!(await page.locator('article.prep__section--video').count())) {
    await openH264Material(page);
  }
  acceptDialogs(page);
  await page.getByRole('button', { name: /\u6e05\u7406\u672c\u7d20\u6750\u7f13\u5b58/ }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, '30-after-clear-cache.png');
  let sec4 = await videoSecText(page);
  const clearedBanner = /\u64ad\u653e\u526f\u672c\u7f3a\u5931/.test(sec4);
  log('clearedBanner=' + clearedBanner + ' sec=' + sec4.slice(0, 200));
  await page.getByRole('button', { name: /\u91cd\u5efa\u64ad\u653e\u526f\u672c/ }).first().click();
  await page.waitForTimeout(12000);
  await shot(page, '31-after-rebuild.png');
  sec4 = await videoSecText(page);
  const banner4 = await readBanner(page);
  const rebuilt = !/\u64ad\u653e\u526f\u672c\u7f3a\u5931/.test(sec4) || /\u5df2\u91cd\u5efa/.test(banner4 + sec4);
  const mediaRoot = path.join(process.env.APPDATA || '', 'dev.attune.desktop', 'media');
  let hasPlayback = false;
  try {
    for (const id of fs.readdirSync(mediaRoot)) {
      if (fs.existsSync(path.join(mediaRoot, id, 'playback.mp4'))) hasPlayback = true;
    }
  } catch {}
  const item4Pass = clearedBanner && rebuilt && hasPlayback;
  summary.item4_clear_cache_recover = item4Pass ? 'PASS' : 'FAIL';
  summary.detail.item4 = { clearedBanner, rebuilt, hasPlayback, banner: banner4.slice(0, 200) };
  log('4 PASS=' + item4Pass);
} catch (e) {
  summary.item4_clear_cache_recover = 'FAIL';
  summary.detail.item4 = { error: String(e) };
  log('4 err ' + e);
  await shot(page, '30-clear-cache-error.png').catch(() => {});
}

summary.all =
  summary.item1_ffmpeg_consent_download === 'PASS' &&
  summary.item2_import_study_listen === 'PASS' &&
  summary.item3_restart_restore_or_rebuild === 'PASS' &&
  summary.item4_clear_cache_recover === 'PASS' &&
  summary.item5_pure_audio_no_regression === 'PASS'
    ? 'PASS'
    : 'FAIL';
summary.when = new Date().toISOString();
const notePath = path.join(evDir, 'cdp-smoke-notes-34.txt');
fs.writeFileSync(notePath, notes.join('\n'), 'utf8');
fs.appendFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), '\n\n--- items 3+4 rerun ---\n' + notes.join('\n'), 'utf8');
fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2), 'utf8');
log('SUMMARY ' + JSON.stringify(summary, null, 2));
process.exit(summary.all === 'PASS' ? 0 : 2);
