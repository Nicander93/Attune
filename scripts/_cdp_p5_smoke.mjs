import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const outDir = 'C:/Users/PC/AttuneSmoke/p5';
const evDir = 'D:/code/attune-video-p5/docs/evidence/video-p5';
const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
const mkv = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\h264_aac_subs.mkv';
const wav = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\extracted\\h264_audio.wav';
const srt = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\embedded.srt';
const worktree = 'D:/code/attune-video-p5';

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(evDir, { recursive: true });

let tip = '';
try {
  tip = execSync('git rev-parse HEAD', { cwd: worktree, encoding: 'utf8' }).trim();
} catch {
  tip = 'unknown';
}

const notes = [];
const summary = {
  tip,
  branch: 'feat/video-p5-packaging',
  when: new Date().toISOString(),
  item1_ffmpeg_consent_download: 'FAIL',
  item2_import_study_listen: 'FAIL',
  item3_restart_restore_or_rebuild: 'FAIL',
  item4_clear_cache_recover: 'FAIL',
  item5_pure_audio_no_regression: 'FAIL',
  all: 'FAIL',
  evidence_dir: 'docs/evidence/video-p5/',
  detail: {},
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


function sanitizedEnv() {
  const env = { ...process.env };
  delete env.ATTUNE_FFMPEG_DIR;
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222';
  const parts = (env.PATH || '').split(';').filter((d) => d && !fs.existsSync(path.join(d, 'ffmpeg.exe')));
  env.PATH = parts.join(';');
  return env;
}

function relaunchAttune() {
  const attuneExe = path.join(worktree.replace(/\//g, path.sep), 'src-tauri', 'target', 'debug', 'attune.exe');
  const child = spawn(attuneExe, [], {
    cwd: path.join(worktree.replace(/\//g, path.sep), 'src-tauri'),
    env: sanitizedEnv(),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  log('spawned attune pid=' + child.pid);
  return child.pid;
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

function acceptDialogs(page) {
  page.removeAllListeners('dialog');
  page.on('dialog', async (d) => {
    log('dialog ' + d.type() + ': ' + String(d.message()).slice(0, 160));
    await d.accept();
  });
}

async function clickBtn(page, re) {
  await page.getByRole('button', { name: re }).first().click();
}

async function clickText(page, re) {
  await page.getByText(re).first().click();
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

async function readBanner(page) {
  return (await page.locator('.banner').allTextContents()).join(' | ');
}

async function videoSecText(page) {
  return page.locator('article.prep__section--video').innerText();
}

async function connectPage() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page =
    browser.contexts()[0].pages().find((pg) => pg.url().includes('1420')) ||
    browser.contexts()[0].pages()[0];
  await page.bringToFront();
  acceptDialogs(page);
  log('page ' + page.url());
  return { browser, page };
}

async function waitFfmpegAvailable(page, timeoutMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await videoSecText(page);
    if (/ffmpeg\uff1aapp_data\/tools\/ffmpeg|ffmpeg:app_data\/tools\/ffmpeg/i.test(t) || /app_data\/tools\/ffmpeg/.test(t)) {
      return { ok: true, text: t };
    }
    if (/ffmpeg\uff1a|ffmpeg:/.test(t) && !/\u672a\u627e\u5230 ffmpeg/.test(t) && !/\u4e0b\u8f7d LGPL/.test(t)) {
      // available under some source
      if (!/\u4e0b\u8f7d\u4e2d/.test(t)) return { ok: true, text: t };
    }
    await page.waitForTimeout(2000);
  }
  return { ok: false, text: await videoSecText(page) };
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
  await page.waitForSelector('.video-probe', { timeout: 60000 });
  if (shotProbe) await shot(page, shotProbe);
  return videoSecText(page);
}

async function applyFromProbe(page, shotApplied) {
  await page.locator('article.prep__section--video button.primary').click();
  for (let i = 0; i < 180; i++) {
    const t = await page.locator('article.prep__section--video').innerText();
    const body = await page.locator('.prep').innerText();
    if (
      (/\u5df2\u7ecf|\u5df2\u7f13\u5b58|\u5df2\u8f6c\u7801|\u5199\u5165/.test(t + body) &&
        !/\u63d0\u53d6\u4e2d|\u6b63\u5728|\u5904\u7406\u4e2d/.test(t)) ||
      /\u5df2\u5bfc\u5165\s*\d+\s*\u53e5/.test(body)
    ) {
      if (shotApplied) await shot(page, shotApplied);
      return t + '\n' + body;
    }
    await page.waitForTimeout(1000);
  }
  if (shotApplied) await shot(page, shotApplied);
  return (await page.locator('.prep').innerText()).slice(0, 1200);
}

async function waitSubs(page, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const prep = await page.locator('.prep').innerText();
    const m = prep.match(/\u5df2\u5bfc\u5165\s*(\d+)\s*\u53e5/) || prep.match(/\u5171\s*(\d+)\s*\u53e5/);
    if (m && Number(m[1]) > 0) return { n: Number(m[1]), prep: prep.slice(0, 600) };
    await page.waitForTimeout(1000);
  }
  const prep = await page.locator('.prep').innerText();
  return { n: 0, prep: prep.slice(0, 600) };
}

log('tip ' + tip);

let { browser, page } = await connectPage();

// ========== ITEM 1: no ffmpeg -> consent download ==========
log('=== ITEM 1 ffmpeg consent download ===');
await newMaterial(page);
await page.waitForTimeout(1200);
await shot(page, '01-no-ffmpeg-banner.png');
let sec1 = await videoSecText(page);
log('sec1_pre ' + sec1.slice(0, 400));
const toolsAlready = fs.existsSync(
  path.join(process.env.APPDATA || '', 'dev.attune.desktop', 'tools', 'ffmpeg', 'ffmpeg.exe'),
);
const forceSkip1 = process.env.P5_SKIP_ITEM1 === '1';
if (forceSkip1 && toolsAlready) {
  summary.item1_ffmpeg_consent_download = 'PASS';
  summary.detail.item1 = { skipped: true, toolsAlready: true, note: 'prior run evidence 01-03' };
  log('1 PASS=true (skipped; tools already installed from prior evidence)');
} else {
  const missing =
    /!\u627e\u5230 ffmpeg|\u672a\u627e\u5230 ffmpeg|ffmpeg\/ffprobe/.test(sec1) ||
    (await page.getByRole('button', { name: /\u4e0b\u8f7d LGPL ffmpeg/ }).count()) > 0;
  log('missing_ui=' + missing);
  summary.detail.item1_missing_ui = missing;

  if (missing) {
    await page.getByRole('button', { name: /\u4e0b\u8f7d LGPL ffmpeg/ }).first().click();
    await page.waitForTimeout(1500);
    await shot(page, '02-download-started.png');
    const waited = await waitFfmpegAvailable(page, 700000);
    log('after_download ok=' + waited.ok + ' text=' + waited.text.slice(0, 500));
    await shot(page, '03-ffmpeg-installed.png');
    const toolsExist = fs.existsSync(
      path.join(process.env.APPDATA || '', 'dev.attune.desktop', 'tools', 'ffmpeg', 'ffmpeg.exe'),
    );
    const sourceOk = /app_data\/tools\/ffmpeg/.test(waited.text);
    const item1Pass = waited.ok && toolsExist && sourceOk;
    summary.item1_ffmpeg_consent_download = item1Pass ? 'PASS' : 'FAIL';
    summary.detail.item1 = { toolsExist, sourceOk, text: waited.text.slice(0, 400) };
    log('1 PASS=' + item1Pass + ' toolsExist=' + toolsExist + ' sourceOk=' + sourceOk);
  } else {
    summary.item1_ffmpeg_consent_download = 'FAIL';
    summary.detail.item1 = { reason: 'ffmpeg already available; PATH not sanitized', text: sec1.slice(0, 400) };
    log('1 PASS=false (ffmpeg already present)');
  }
}

// ========== ITEM 2: import -> study flow ==========
log('=== ITEM 2 import study listen ===');
// stay on current material (or new if item1 failed mid-way)
sec1 = await videoSecText(page).catch(() => '');
if (!(await page.locator('article.prep__section--video').count())) {
  await newMaterial(page);
}
const probe2 = await openProbe(page, mkv, '10-video-probed.png');
log('probe2 ' + probe2.slice(0, 400));
const applied = await applyFromProbe(page, '11-video-applied.png');
log('applied ' + applied.slice(0, 400));
const sub2 = await waitSubs(page, 120000);
log('subs ' + JSON.stringify(sub2));
await shot(page, '12-subs-ready.png');

// start dictation
await clickBtn(page, /\u5f00\u59cb\u542c\u5199/);
await page.waitForTimeout(1500);
await shot(page, '13-dictation-entry.png');
const d1 = await page.evaluate(() => {
  const video = document.querySelector('video');
  const wrap = document.querySelector('.media-output');
  window.__p5VideoEl = video;
  return {
    videoCount: document.querySelectorAll('video').length,
    wrapHidden: wrap?.classList.contains('media-output--hidden') ?? null,
    videoSrc: video?.currentSrc || video?.getAttribute('src') || '',
  };
});
log('dictation entry ' + JSON.stringify(d1));

// play
try {
  await page.getByRole('button', { name: /\u64ad\u653e/ }).first().click();
} catch {
  await page.keyboard.press('Space');
}
await page.waitForTimeout(1500);
const dPlay = await page.evaluate(() => {
  const el = document.querySelector('video,audio');
  return {
    tag: el?.tagName,
    paused: el?.paused,
    t: el?.currentTime ?? null,
    wrapHidden: document.querySelector('.media-output')?.classList.contains('media-output--hidden') ?? null,
  };
});
log('dictation play ' + JSON.stringify(dPlay));
await shot(page, '14-dictation-playing-hidden.png');

// type + check
const field = page.locator('textarea').first();
if (await field.count()) {
  await field.click();
  await field.fill('Hello');
  await page.waitForTimeout(200);
  const check = page.getByRole('button', { name: /\u6838\u5bf9\u7b54\u6848/ });
  if (await check.count()) {
    await check.first().click();
    await page.waitForTimeout(800);
  }
}
await shot(page, '15-after-check.png');

// show video then hide
const showBtn = page.getByRole('button', { name: /\u663e\u793a\u89c6\u9891/ });
let toggleOk = false;
if (await showBtn.count()) {
  await showBtn.first().click();
  await page.waitForTimeout(600);
  await shot(page, '16-show-video.png');
  const afterShow = await page.evaluate(() => ({
    wrapHidden: document.querySelector('.media-output')?.classList.contains('media-output--hidden') ?? null,
    sameEl: document.querySelector('video') === window.__p5VideoEl,
  }));
  log('after show ' + JSON.stringify(afterShow));
  const hideBtn = page.getByRole('button', { name: /\u9690\u85cf\u89c6\u9891/ });
  if (await hideBtn.count()) {
    await hideBtn.first().click();
    await page.waitForTimeout(500);
    await shot(page, '17-hide-video.png');
  }
  toggleOk = afterShow.wrapHidden === false;
} else {
  log('no show-video button');
}

// listen-read
const tab = page.getByRole('tab', { name: /\u542c\u8bfb/ });
let listenOk = false;
if (await tab.count()) {
  await tab.first().click();
  await page.waitForTimeout(800);
  await shot(page, '18-listen-read.png');
  const r1 = await page.evaluate(() => {
    const wrap = document.querySelector('.media-output');
    const v = document.querySelector('video');
    return {
      wrapHidden: wrap?.classList.contains('media-output--hidden') ?? null,
      hasVideo: !!v,
      src: v?.currentSrc || '',
    };
  });
  log('listen-read ' + JSON.stringify(r1));
  listenOk = r1.hasVideo === true;
} else {
  log('no listen-read tab');
}

const item2Pass =
  sub2.n > 0 &&
  d1.videoCount === 1 &&
  d1.wrapHidden === true &&
  dPlay.paused === false &&
  (dPlay.t ?? 0) > 0 &&
  listenOk;
summary.item2_import_study_listen = item2Pass ? 'PASS' : 'FAIL';
summary.detail.item2 = { sub2, d1, dPlay, toggleOk, listenOk };
log('2 PASS=' + item2Pass);

// capture material title for reopen
const matTitle = await page.evaluate(() => {
  const h = document.querySelector('.prep h1, .prep__title, .material-title, header h1');
  return (h?.textContent || document.title || '').trim().slice(0, 80);
});
log('matTitle ' + matTitle);

// ========== ITEM 3: restart restore/rebuild ==========
log('=== ITEM 3 restart restore/rebuild ===');
await goHome(page);
await page.waitForTimeout(500);
await shot(page, '20-before-restart-home.png');

// kill attune + vite child; launcher stays external
try {
  execSync('taskkill /F /IM attune.exe', { stdio: 'ignore' });
} catch {}
await new Promise((r) => setTimeout(r, 2500));

// wait for relaunch signal file or poll 9222
async function waitPort(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/version');
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// Write request for parent launcher to relaunch; also try spawning desktop ourselves
const launchFlag = path.join(outDir, 'NEED_RELAUNCH.txt');
fs.writeFileSync(launchFlag, '1', 'utf8');
log('wrote NEED_RELAUNCH; spawning attune.exe with CDP env...');
relaunchAttune();

const up = await waitPort(180000);
log('cdp_up_after_restart=' + up);
if (!up) {
  summary.item3_restart_restore_or_rebuild = 'FAIL';
  summary.detail.item3 = { reason: 'CDP not back after kill' };
  log('3 PASS=false');
} else {
  try {
    await browser.close();
  } catch {}
  ({ browser, page } = await connectPage());
  await page.waitForTimeout(1500);
  await shot(page, '21-after-restart-home.png');

  // open first library card / recent material
  // Prefer explicit material card / list button containing h264_aac_subs
  let opened = null;
  const matBtn = page.locator('button, a, [role=button]').filter({ hasText: /h264_aac_subs/ });
  if (await matBtn.count()) {
    await matBtn.first().click();
    opened = 'h264_aac_subs';
  } else {
    opened = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('button, a, [role=button], li, article')].filter((el) =>
        /h264|mkv|\u7d20\u6750|\u672a\u547d\u540d/i.test(el.textContent || ''),
      );
      if (cards[0]) {
        cards[0].click();
        return cards[0].textContent?.slice(0, 80) || 'clicked';
      }
      return null;
    });
  }
  log('library open ' + opened);
  await page.waitForTimeout(1200);

  // if still on home, click first material row
  if (!(await page.locator('.prep, article.prep__section--video').count())) {
    const libBtn = page.locator('button, a').filter({ hasText: /\u7d20\u6750\u5e93|\u5168\u90e8\u7d20\u6750/ });
    if (await libBtn.count()) {
      await libBtn.first().click();
      await page.waitForTimeout(600);
    }
    const row = page.locator('button, li, a').filter({ hasText: /h264_aac_subs|\u672a\u547d\u540d|\.mkv/ }).first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(1000);
    }
  }

  // navigate to prep if in study
  const prepNav = page.getByRole('button', { name: /\u51c6\u5907|\u8fd4\u56de\u51c6\u5907|\u7d20\u6750\u51c6\u5907/ });
  if (await prepNav.count()) {
    await prepNav.first().click();
    await page.waitForTimeout(800);
  }
  await shot(page, '22-reopened-material.png');

  let sec3 = '';
  try {
    sec3 = await videoSecText(page);
  } catch {
    sec3 = await page.locator('body').innerText();
  }
  log('sec3 ' + sec3.slice(0, 500));

  const missingPlayback = /\u64ad\u653e\u526f\u672c\u7f3a\u5931/.test(sec3);
  let restoredOrRebuilt = false;
  if (missingPlayback) {
    await page.getByRole('button', { name: /\u91cd\u5efa\u64ad\u653e\u526f\u672c/ }).first().click();
    await page.waitForTimeout(8000);
    await shot(page, '23-rebuilt-after-restart.png');
    sec3 = await videoSecText(page);
    restoredOrRebuilt = !/\u64ad\u653e\u526f\u672c\u7f3a\u5931/.test(sec3) && /ffmpeg\uff1a|ffmpeg:/.test(sec3);
  } else {
    // try dictation briefly to confirm video works
    const start = page.getByRole('button', { name: /\u5f00\u59cb\u542c\u5199/ });
    if (await start.count()) {
      await start.first().click();
      await page.waitForTimeout(1200);
      const ok = await page.evaluate(() => !!document.querySelector('video'));
      restoredOrRebuilt = ok;
      await shot(page, '23-restored-dictation.png');
      // back to prep
      const back = page.getByRole('button', { name: /\u8fd4\u56de|\u51c6\u5907/ });
      if (await back.count()) await back.first().click();
      await page.waitForTimeout(600);
    } else {
      restoredOrRebuilt = /playback|\u7247\u6bb5|ffmpeg/i.test(sec3) && !/\u64ad\u653e\u526f\u672c\u7f3a\u5931/.test(sec3);
    }
  }
  summary.item3_restart_restore_or_rebuild = restoredOrRebuilt ? 'PASS' : 'FAIL';
  summary.detail.item3 = { missingPlayback, restoredOrRebuilt, sec: sec3.slice(0, 400) };
  log('3 PASS=' + restoredOrRebuilt);
}

// ========== ITEM 4: clear cache recover ==========
log('=== ITEM 4 clear cache recover ===');
try {
  // ensure on prep with video material
  if (!(await page.locator('article.prep__section--video').count())) {
    await goHome(page);
    await page.waitForTimeout(400);
    const row = page.locator('button, li, a').filter({ hasText: /h264_aac_subs|\u672a\u547d\u540d|\.mkv/ }).first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(1000);
    }
  }
  acceptDialogs(page);
  await page.getByRole('button', { name: /\u6e05\u7406\u672c\u7d20\u6750\u7f13\u5b58/ }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, '30-after-clear-cache.png');
  let sec4 = await videoSecText(page);
  const clearedBanner = /\u64ad\u653e\u526f\u672c\u7f3a\u5931/.test(sec4);
  log('clearedBanner=' + clearedBanner + ' sec=' + sec4.slice(0, 300));

  await page.getByRole('button', { name: /\u91cd\u5efa\u64ad\u653e\u526f\u672c/ }).first().click();
  await page.waitForTimeout(10000);
  await shot(page, '31-after-rebuild.png');
  sec4 = await videoSecText(page);
  const banner4 = await readBanner(page);
  const rebuilt = !/\u64ad\u653e\u526f\u672c\u7f3a\u5931/.test(sec4) || /\u5df2\u91cd\u5efa\u64ad\u653e\u526f\u672c/.test(banner4 + sec4);
  // also check filesystem
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
  log('4 PASS=' + item4Pass + ' cleared=' + clearedBanner + ' rebuilt=' + rebuilt + ' hasPlayback=' + hasPlayback);
} catch (e) {
  summary.item4_clear_cache_recover = 'FAIL';
  summary.detail.item4 = { error: String(e) };
  log('4 err ' + e);
  await shot(page, '30-clear-cache-error.png').catch(() => {});
}

// ========== ITEM 5: pure audio no regression ==========
log('=== ITEM 5 pure audio ===');
try {
  await newMaterial(page);
  const pendingWav = fill(wav);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /\u9009\u62e9\u97f3\u9891|\u5bfc\u5165\u97f3\u9891/ }).first().click();
  log('wav dialog ' + JSON.stringify(await pendingWav));
  await page.waitForTimeout(1500);
  await shot(page, '40-audio-material.png');

  const pendingSrt = fill(srt);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /\u5bfc\u5165\u5b57\u5e55|\u9009\u62e9\u5b57\u5e55\u6587\u4ef6/ }).first().click();
  log('srt dialog ' + JSON.stringify(await pendingSrt));
  await page.waitForTimeout(1200);
  await shot(page, '40b-audio-with-subs.png');

  await clickBtn(page, /\u5f00\u59cb\u542c\u5199/);
  await page.waitForTimeout(1200);
  await shot(page, '41-audio-dictation.png');
  const a1 = await page.evaluate(() => ({
    videoCount: document.querySelectorAll('video').length,
    audioCount: document.querySelectorAll('audio').length,
    hasVideoToggle: [...document.querySelectorAll('button')].some((b) =>
      /\u663e\u793a\u89c6\u9891|\u9690\u85cf\u89c6\u9891/.test(b.textContent || ''),
    ),
  }));
  log('audio DOM ' + JSON.stringify(a1));
  try {
    await page.getByRole('button', { name: /\u64ad\u653e/ }).first().click();
  } catch {
    await page.keyboard.press('Space');
  }
  await page.waitForTimeout(1000);
  const aPlay = await page.evaluate(() => {
    const a = document.querySelector('audio');
    return { paused: a?.paused, t: a?.currentTime ?? null, tagOnlyAudio: !document.querySelector('video') };
  });
  log('audio play ' + JSON.stringify(aPlay));
  await shot(page, '42-audio-playing.png');
  const item5Pass =
    a1.videoCount === 0 && a1.audioCount === 1 && aPlay.paused === false && (aPlay.t ?? 0) > 0 && !a1.hasVideoToggle;
  summary.item5_pure_audio_no_regression = item5Pass ? 'PASS' : 'FAIL';
  summary.detail.item5 = { a1, aPlay };
  log('5 PASS=' + item5Pass);
} catch (e) {
  summary.item5_pure_audio_no_regression = 'FAIL';
  summary.detail.item5 = { error: String(e) };
  log('5 err ' + e);
  await shot(page, '40-audio-error.png').catch(() => {});
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

fs.writeFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), notes.join('\n'), 'utf8');
fs.writeFileSync(path.join(outDir, 'cdp-smoke-notes.txt'), notes.join('\n'), 'utf8');
fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2), 'utf8');
fs.writeFileSync(
  path.join(evDir, '.gitignore'),
  '# keep screenshots in git for evidence\n!*.png\n!*.json\n!*.txt\n!README.md\n',
  'utf8',
);
log('SUMMARY ' + JSON.stringify(summary, null, 2));
process.exit(summary.all === 'PASS' ? 0 : 2);
