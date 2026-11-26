import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const worktree = 'D:/code/attune-ui-ux1';
const outDir = 'C:/Users/PC/AttuneSmoke/ux1';
const evDir = path.join(worktree, 'docs/evidence/ux-1');
const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
const wav = 'C:\\Users\\PC\\AttuneSmoke\\p3\\speech.wav';
const video = 'C:\\Users\\PC\\AttuneSmoke\\p3\\speech_nosubs.mp4';
const JARGON = /ffmpeg|ffprobe|\bASR\b|\bOCR\b|LGPL|BtbN|抽轨|PGS|ATTUNE_FFMPEG_DIR/i;

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
  branch: 'feat/ux-1-import-delegate',
  when: new Date().toISOString(),
  fixtures: { wav, video, missing: 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\h264_aac_subs.mkv (worktree gone)' },
  item1_audio_auto_prepare: 'FAIL',
  item2_video_same_path: 'FAIL',
  all: 'FAIL',
  evidence_dir: 'docs/evidence/ux-1/',
  detail: {},
};

const log = (m) => {
  notes.push(String(m));
  console.log(m);
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeSummary() {
  const text = notes.join('\n') + '\n\nSUMMARY ' + JSON.stringify(summary, null, 2) + '\n';
  fs.writeFileSync(path.join(outDir, 'cdp-smoke-notes.txt'), text, 'utf8');
  fs.writeFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), text, 'utf8');
  fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2), 'utf8');
}

async function shot(page, name) {
  const dest = path.join(outDir, name);
  await page.screenshot({ path: dest, fullPage: true });
  fs.copyFileSync(dest, path.join(evDir, name));
  log('shot ' + name);
}

async function waitCdp(timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      if (res.ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function connectPage() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const pages = browser.contexts().flatMap((ctx) => ctx.pages());
  const page =
    pages.find((pg) => /1420|localhost|tauri|asset/i.test(pg.url())) || pages[0];
  if (!page) throw new Error('no CDP page');
  await page.bringToFront();
  log('page ' + page.url());
  return { browser, page };
}

async function clickBtn(page, re) {
  await page.getByRole('button', { name: re }).first().click();
}

function fillDialog(filePath) {
  const child = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', filler, '-FilePath', filePath],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return new Promise((resolve) => {
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out: out.trim() }));
    setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve({ code: -1, out: out + ' TIMEOUT' });
    }, 25000);
  });
}

async function pickViaDialog(page, buttonRe, filePath) {
  const pending = fillDialog(filePath);
  await sleep(300);
  await clickBtn(page, buttonRe);
  const result = await pending;
  log('dialog fill ' + JSON.stringify(result));
  return result;
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

function jargonHits(text) {
  const hits = text.match(new RegExp(JARGON.source, 'gi')) || [];
  return [...new Set(hits)];
}

async function waitReadyOrFail(page, { shotProgressName, timeoutMs = 240000 } = {}) {
  const start = Date.now();
  let sawProgress = false;
  let progressText = '';
  let progressShot = false;
  while (Date.now() - start < timeoutMs) {
    const text = await bodyText(page);
    const progress = text.match(/正在(?:准备字幕|下载识别数据|安装本地工具|准备素材|读取字幕|处理视频)[^。\n]{0,24}/);
    if (progress) {
      sawProgress = true;
      progressText = progress[0];
      if (!progressShot && shotProgressName) {
        await shot(page, shotProgressName);
        progressShot = true;
        log('progress ' + progressText);
      }
    }
    if (/已准备好 \d+ 句，可以开始听写/.test(text)) {
      return { ready: true, sawProgress, progressText, text };
    }
    if (/没能自动准备好字幕|还不能准备字幕|没有识别出可用|没能处理完成|无法确定这个视频文件的位置|请在下方视频面板/.test(text)) {
      return { ready: false, failed: true, sawProgress, progressText, text };
    }
    await sleep(80);
  }
  return {
    ready: false,
    timeout: true,
    sawProgress,
    progressText,
    text: await bodyText(page),
  };
}

async function goHome(page) {
  const home = page.getByRole('button', { name: /^首页$/ });
  if (await home.count()) {
    await home.first().click();
    await sleep(600);
    return;
  }
  const back = page.getByRole('button', { name: /返回/ });
  if (await back.count()) {
    await back.first().click();
    await sleep(500);
  }
  if (await page.getByRole('button', { name: /^首页$/ }).count()) {
    await page.getByRole('button', { name: /^首页$/ }).first().click();
    await sleep(600);
  }
}

async function main() {
  log('tip ' + tip);
  log('fixtures wav=' + wav);
  log('fixtures video=' + video + ' (no text track; auto-recognize path)');
  log('missing embedded-subs fixture: attune-video-p0 worktree / h264_aac_subs.mkv');
  log('waiting CDP 9222...');
  if (!(await waitCdp())) {
    summary.detail.blocker = 'CDP 9222 not up';
    throw new Error('CDP not ready');
  }

  const { browser, page } = await connectPage();
  page.on('dialog', async (dialog) => {
    log('dialog [' + dialog.type() + '] ' + dialog.message());
    await dialog.accept();
  });
  await sleep(1000);

  // --- Item 1: home → import subtitle-less audio → auto prepare → start dictation ---
  await goHome(page);
  await shot(page, '01-home.png');
  await clickBtn(page, /导入素材/);
  await sleep(800);
  await shot(page, '02-import-empty.png');
  const empty = await page.evaluate(() => {
    const body = document.body.innerText;
    const more = [...document.querySelectorAll('button')].some((b) =>
      /更多/.test(b.textContent || ''),
    );
    const settingsInMenu = [...document.querySelectorAll('[role=menuitem]')].some((b) =>
      /识别设置|缓存管理|导入视频/.test(b.textContent || ''),
    );
    return {
      heading: !!document.querySelector('h1, h2, .import__heading') && /导入素材/.test(body),
      hasDrop: !!document.querySelector('.dropzone, .import__drop'),
      title: document.querySelector('.import__upload-title')?.textContent?.trim() || '',
      hint: document.querySelector('.import__hint')?.textContent?.trim() || '',
      showsUntitled: /未命名素材/.test(body),
      hasMore: more,
      settingsInMenu,
      bodySlice: body.slice(0, 500),
    };
  });
  summary.detail.empty = empty;
  log('1 empty ' + JSON.stringify(empty));

  const audioWaitPromise = waitReadyOrFail(page, { shotProgressName: '04-audio-preparing.png' });
  const audioPick = await pickViaDialog(page, /选择文件/, wav);
  summary.detail.audioPick = audioPick;
  await shot(page, '03-audio-imported.png').catch(() => null);
  const audioWait = await audioWaitPromise;
  summary.detail.audioWait = {
    ready: audioWait.ready,
    sawProgress: audioWait.sawProgress,
    progressText: audioWait.progressText,
    failed: !!audioWait.failed,
    timeout: !!audioWait.timeout,
    bodySlice: (audioWait.text || '').slice(0, 800),
  };
  await shot(page, '05-audio-ready.png');

  const audioReady = await page.evaluate(() => {
    const body = document.body.innerText;
    const start = [...document.querySelectorAll('button')].find((b) =>
      /开始听写/.test(b.textContent || ''),
    );
    const settingsOpen = /识别设置/.test(body) && !!document.querySelector('.import__advanced');
    return {
      status: document.querySelector('.import__status')?.textContent?.trim() || '',
      readyCopy: /已准备好 \d+ 句，可以开始听写/.test(body),
      gateCopy: /请校对后再开始听写|不应作为最终答案|字幕待校对/.test(body),
      startDisabled: start ? start.disabled : true,
      startVisible: !!start,
      settingsOpen,
      jargon: (body.match(/ffmpeg|ffprobe|\bASR\b|\bOCR\b|LGPL|BtbN|抽轨|PGS|ATTUNE_FFMPEG_DIR/gi) || []).filter(
        (v, i, a) => a.indexOf(v) === i,
      ),
      bodySlice: body.slice(0, 800),
    };
  });
  summary.detail.audioReady = audioReady;
  log('1 ready ' + JSON.stringify(audioReady));

  let enteredDictation = false;
  if (audioReady.readyCopy && !audioReady.startDisabled) {
    await clickBtn(page, /开始听写/);
    await sleep(1500);
    await shot(page, '06-audio-dictation.png');
    const study = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasStudy: !!document.querySelector('.study, [class*="study"]'),
        hasPlay: [...document.querySelectorAll('button')].some((b) =>
          /播放|暂停/.test(b.textContent || ''),
        ),
        hasBack: [...document.querySelectorAll('button')].some((b) => /返回/.test(b.textContent || '')),
        bodySlice: body.slice(0, 400),
      };
    });
    summary.detail.audioStudy = study;
    enteredDictation = !!(study.hasStudy || study.hasPlay || study.hasBack);
    log('1 dictation ' + JSON.stringify(study));
  }

  const item1Pass =
    !empty.showsUntitled &&
    empty.hasDrop &&
    audioWait.ready &&
    audioWait.sawProgress &&
    /正在准备字幕|正在下载识别数据/.test(audioWait.progressText || '') &&
    audioReady.readyCopy &&
    !audioReady.startDisabled &&
    !audioReady.gateCopy &&
    !audioReady.settingsOpen &&
    enteredDictation;
  summary.item1_audio_auto_prepare = item1Pass ? 'PASS' : 'FAIL';
  log('1 audio auto prepare => ' + summary.item1_audio_auto_prepare);

  // --- Item 2: video, same path, no second pick, auto-recognize (no text track) ---
  await goHome(page);
  await sleep(500);
  await goHome(page);
  await clickBtn(page, /导入素材/);
  await sleep(800);
  await shot(page, '10-video-import-empty.png');

  const videoWaitPromise = waitReadyOrFail(page, { shotProgressName: '12-video-preparing.png' });
  const videoPick = await pickViaDialog(page, /选择文件/, video);
  summary.detail.videoPick = videoPick;
  await shot(page, '11-video-after-pick.png').catch(() => null);

  const afterPick = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      secondPickPrompt: /请在下方视频面板选择|选择本地视频/.test(body),
      pathMissing: /无法确定这个视频文件的位置/.test(body),
      advancedVideo: !!document.querySelector('.import__advanced--video, [aria-label="导入视频"]'),
      toolsConsent: /本地工具|是否同意安装/.test(body),
      bodySlice: body.slice(0, 800),
    };
  });
  summary.detail.videoAfterPick = afterPick;
  log('2 after pick ' + JSON.stringify(afterPick));

  const videoWait = await videoWaitPromise;
  summary.detail.videoWait = {
    ready: videoWait.ready,
    sawProgress: videoWait.sawProgress,
    progressText: videoWait.progressText,
    failed: !!videoWait.failed,
    timeout: !!videoWait.timeout,
    bodySlice: (videoWait.text || '').slice(0, 900),
  };
  await shot(page, '13-video-ready.png');

  const videoReady = await page.evaluate(() => {
    const body = document.body.innerText;
    const start = [...document.querySelectorAll('button')].find((b) =>
      /开始听写/.test(b.textContent || ''),
    );
    const advancedVideo = !!document.querySelector('.import__advanced--video, [aria-label="导入视频"]');
    const hits = body.match(/ffmpeg|ffprobe|\bASR\b|\bOCR\b|LGPL|BtbN|抽轨|PGS|ATTUNE_FFMPEG_DIR/gi) || [];
    return {
      status: document.querySelector('.import__status')?.textContent?.trim() || '',
      readyCopy: /已准备好 \d+ 句，可以开始听写/.test(body),
      startDisabled: start ? start.disabled : true,
      startVisible: !!start,
      advancedVideo,
      secondPickPrompt: /请在下方视频面板选择|选择本地视频/.test(body),
      jargon: [...new Set(hits)],
      kind: /视频/.test(document.querySelector('.import__file-info')?.textContent || ''),
      bodySlice: body.slice(0, 900),
    };
  });
  summary.detail.videoReady = videoReady;
  log('2 ready ' + JSON.stringify(videoReady));

  const item2Pass =
    !afterPick.secondPickPrompt &&
    !afterPick.pathMissing &&
    !afterPick.advancedVideo &&
    videoWait.ready &&
    videoReady.readyCopy &&
    !videoReady.startDisabled &&
    !videoReady.advancedVideo &&
    !videoReady.secondPickPrompt &&
    videoReady.jargon.length === 0;
  summary.item2_video_same_path = item2Pass ? 'PASS' : 'FAIL';
  log('2 video same path => ' + summary.item2_video_same_path);
  log('2 note: local tools were already installed; consent UI was not expected this run');
  log('2 note: used speech_nosubs.mp4 (no text track) so the automatic path is recognition, not embedded extract');

  summary.all =
    summary.item1_audio_auto_prepare === 'PASS' && summary.item2_video_same_path === 'PASS'
      ? 'PASS'
      : 'FAIL';
  writeSummary();
  log('SUMMARY ' + JSON.stringify(summary));
  await browser.close().catch(() => null);
  process.exit(summary.all === 'PASS' ? 0 : 2);
}

main().catch((err) => {
  log('FATAL ' + (err && err.stack ? err.stack : err));
  summary.detail.fatal = String(err && err.stack ? err.stack : err);
  try {
    writeSummary();
  } catch {}
  process.exit(1);
});
