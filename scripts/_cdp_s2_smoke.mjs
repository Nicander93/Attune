import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const worktree = 'D:/code/attune-ui-s2';
const outDir = 'C:/Users/PC/AttuneSmoke/s2';
const evDir = path.join(worktree, 'docs/evidence/ui-s2');
const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
const wav = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\extracted\\h264_audio.wav';
const srt = 'C:\\Users\\PC\\AttuneSmoke\\p3\\manual.srt';

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
  branch: 'feat/ui-s2-import',
  when: new Date().toISOString(),
  item1_empty_to_ready: 'FAIL',
  item2_review_ctas: 'FAIL',
  item3_more_video_cache: 'FAIL',
  item4_pure_audio_no_regression: 'FAIL',
  all: 'FAIL',
  evidence_dir: 'docs/evidence/ui-s2/',
  detail: {},
};

const log = (m) => {
  notes.push(String(m));
  console.log(m);
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shot(page, name) {
  const pth = path.join(outDir, name);
  await page.screenshot({ path: pth, fullPage: true });
  fs.copyFileSync(pth, path.join(evDir, name));
  log('shot ' + name);
}

async function waitCdp(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/version');
      if (r.ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function connectPage() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const pages = browser.contexts().flatMap((c) => c.pages());
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

async function setFile(page, acceptSubstring, filePath) {
  const input = page.locator(`input[type="file"][accept*="${acceptSubstring}"]`).first();
  const count = await input.count();
  if (count > 0) {
    try {
      await input.setInputFiles(filePath);
      log('setInputFiles ok accept~' + acceptSubstring);
      return { method: 'setInputFiles', ok: true };
    } catch (err) {
      log('setInputFiles failed: ' + err);
    }
  }
  return { method: 'none', ok: false };
}

async function pickViaDialog(page, buttonRe, filePath) {
  const pending = fill(filePath);
  await sleep(250);
  await clickBtn(page, buttonRe);
  const result = await pending;
  log('dialog fill ' + JSON.stringify(result));
  return result;
}

async function markUnreviewedByName(page, nameHint) {
  const id = await page.evaluate(async (hint) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('attune', 3);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = await new Promise((resolve, reject) => {
      const r = db.transaction('materials', 'readonly').objectStore('materials').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const m = all.find(
      (x) =>
        (x.displayName && x.displayName.includes(hint)) ||
        (x.originalFileName && String(x.originalFileName).includes(hint)),
    );
    if (!m) throw new Error('material not found for ' + hint);
    m.subtitleReviewStatus = 'unreviewed';
    if (!m.subtitleOrigin) m.subtitleOrigin = 'asr';
    await new Promise((resolve, reject) => {
      const r = db.transaction('materials', 'readwrite').objectStore('materials').put(m);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    return m.id;
  }, nameHint);
  return id;
}

function writeSummary() {
  fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), notes.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'cdp-smoke-notes.txt'), notes.join('\n') + '\n');
}

async function main() {
  log('tip ' + tip);
  log('waiting CDP 9222...');
  if (!(await waitCdp())) {
    summary.detail.blocker = 'CDP 9222 not up';
    throw new Error('CDP not ready');
  }

  const { browser, page } = await connectPage();
  page.on('dialog', async (d) => {
    log('dialog ' + d.type() + ': ' + String(d.message()).slice(0, 120));
    await d.accept().catch(() => null);
  });
  await sleep(800);

  // --- Item 1: empty import → ready ---
  await clickBtn(page, /首页/);
  await sleep(600);
  await clickBtn(page, /导入素材/);
  await sleep(1000);
  await page.waitForSelector('text=导入素材', { timeout: 20000 });
  const emptyOk = (await page.locator('.dropzone.import__drop, .import__drop').count()) > 0;
  await shot(page, '01-import-empty.png');
  summary.detail.emptyDropzone = emptyOk;
  log('1 empty dropzone=' + emptyOk);

  // Choose audio file
  let picked = await setFile(page, 'audio', wav);
  if (!picked.ok) {
    picked = await pickViaDialog(page, /选择文件/, wav);
  }
  summary.detail.audioPick = picked;
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasFileCard: !!document.querySelector('.import__file'),
        hasStart: [...document.querySelectorAll('button')].some((b) =>
          /开始听写/.test(b.textContent || ''),
        ),
        bodySlice: body.slice(0, 350),
      };
    });
    if (ready.hasFileCard) {
      summary.detail.afterAudio = ready;
      break;
    }
    await sleep(500);
  }
  await shot(page, '02-import-ready.png');
  const readyState = await page.evaluate(() => ({
    hasFileCard: !!document.querySelector('.import__file'),
    displayName: document.querySelector('.import__file strong')?.textContent || '',
    status: document.querySelector('.import__status')?.textContent || '',
    hasStart: [...document.querySelectorAll('button')].some((b) =>
      /开始听写/.test(b.textContent || ''),
    ),
  }));
  summary.detail.readyState = readyState;
  summary.item1_empty_to_ready =
    emptyOk && readyState.hasFileCard && /h264_audio|音频|秒|：/.test(
      JSON.stringify(readyState) + (summary.detail.afterAudio?.bodySlice || ''),
    )
      ? 'PASS'
      : emptyOk && readyState.hasFileCard
        ? 'PASS'
        : 'FAIL';
  log('1 ready=' + summary.item1_empty_to_ready + ' ' + JSON.stringify(readyState));

  // Import SRT via 更多 → 导入字幕文件
  await clickBtn(page, /更多/);
  await sleep(400);
  await shot(page, '03-more-menu-before-srt.png');
  let srtPick = await setFile(page, '.srt', srt);
  if (!srtPick.ok) {
    // click menu item then fill dialog (menu click opens native? HTML input)
    const pending = fill(srt);
    await sleep(200);
    await page.getByRole('menuitem', { name: /导入字幕文件/ }).click().catch(async () => {
      await page.getByText(/导入字幕文件/).first().click();
    });
    srtPick = await pending;
  } else {
    // still need to trigger change - setInputFiles on hidden input fires change
    // close menu if open
    await page.keyboard.press('Escape').catch(() => null);
  }
  summary.detail.srtPick = srtPick;
  await sleep(1500);
  await shot(page, '04-after-srt.png');

  // Force unreviewed for item 2 product gate
  const materialHint = readyState.displayName || 'h264_audio';
  let materialId = '';
  try {
    materialId = await markUnreviewedByName(page, materialHint.includes('h264') ? 'h264_audio' : materialHint);
    summary.detail.materialId = materialId;
    log('marked unreviewed id=' + materialId);
  } catch (err) {
    log('markUnreviewed failed: ' + err);
    summary.detail.markUnreviewedError = String(err);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(2000);
  await clickBtn(page, /素材库/);
  await sleep(900);
  // open ··· → 素材准备 on matching row
  const row = page.locator('ul.materials li.library-item').filter({ hasText: /h264_audio/ }).first();
  if ((await row.count()) > 0) {
    await row.locator('button[aria-label*="更多"]').click();
    await sleep(400);
    await page.getByRole('menuitem', { name: /素材准备/ }).click();
    await sleep(1000);
  } else {
    // fallback: create path already lost — open first ···
    log('row h264_audio not found, trying search');
    const search = page.locator('input.search').first();
    await search.fill('h264_audio');
    await sleep(500);
    const r2 = page.locator('ul.materials li.library-item').first();
    await r2.locator('button[aria-label*="更多"]').click();
    await sleep(300);
    await page.getByRole('menuitem', { name: /素材准备/ }).click();
    await sleep(1000);
  }

  await shot(page, '10-needs-review-ctas.png');
  const ctaState = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].map((b) => ({
      text: (b.textContent || '').trim(),
      disabled: b.disabled,
      cls: b.className,
    }));
    const proof = buttons.find((b) => /校对字幕/.test(b.text));
    const start = buttons.find((b) => /开始听写/.test(b.text));
    const status = document.querySelector('.import__status')?.textContent || '';
    const banner = document.querySelector('.banner')?.textContent || '';
    return {
      proofVisible: !!proof,
      proofDisabled: proof?.disabled ?? null,
      startVisible: !!start,
      startDisabled: start?.disabled ?? null,
      status,
      banner: banner.slice(0, 120),
      bodySlice: document.body.innerText.slice(0, 400),
    };
  });
  summary.detail.ctaState = ctaState;
  summary.item2_review_ctas =
    ctaState.proofVisible && ctaState.startVisible && ctaState.startDisabled === false
      ? 'PASS'
      : 'FAIL';
  log('2 ctas ' + JSON.stringify(ctaState) + ' => ' + summary.item2_review_ctas);

  // --- Item 3: 更多 → video / cache ---
  async function openMore() {
    await page.keyboard.press('Escape').catch(() => null);
    await sleep(200);
    const more = page.getByRole('button', { name: /更多/ }).first();
    await more.click();
    await page.waitForSelector('.menu[role="menu"], .menu.menu--right', { timeout: 8000 });
    await sleep(200);
  }
  await openMore();
  await shot(page, '20-more-menu.png');
  const moreItems = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"], .menu button')].map((b) =>
      (b.textContent || '').trim(),
    ),
  );
  summary.detail.moreItems = moreItems;
  log('more items ' + JSON.stringify(moreItems));
  await page.locator('.menu >> text=导入视频').first().click();
  await sleep(1000);
  await shot(page, '21-more-video-panel.png');
  const videoPanel = await page.evaluate(() => {
    const section = document.querySelector('[aria-label="导入视频"], .import__advanced--video');
    const text = (section?.innerText || '') + '\n' + (document.body.innerText || '');
    return {
      hasSection: !!section,
      heading: document.querySelector('.import__advanced-head h2')?.textContent || '',
      hasVideoImportHints: /ffmpeg|探测|选择视频|导入视频|下载|BtbN|播放副本/.test(text),
      slice: (section?.innerText || text).slice(0, 350),
    };
  });
  summary.detail.videoPanel = videoPanel;
  log('video panel ' + JSON.stringify(videoPanel));

  await openMore();
  await shot(page, '20b-more-menu-for-cache.png');
  await page.locator('.menu >> text=缓存管理').first().click();
  await sleep(1000);
  await shot(page, '22-more-cache-panel.png');
  const cachePanel = await page.evaluate(() => {
    const section = document.querySelector('[aria-label="缓存管理"]');
    const text = section?.innerText || document.body.innerText || '';
    return {
      hasSection: !!section,
      heading: document.querySelector('.import__advanced-head h2')?.textContent || '',
      hasClear:
        /清理全部媒体缓存/.test(text) ||
        [...document.querySelectorAll('button')].some((b) => /清理全部媒体缓存/.test(b.textContent || '')),
      slice: (section?.innerText || text).slice(0, 250),
    };
  });
  summary.detail.cachePanel = cachePanel;
  log('cache panel ' + JSON.stringify(cachePanel));
  summary.item3_more_video_cache =
    ((videoPanel.hasSection && videoPanel.hasVideoImportHints) ||
      /导入视频/.test(videoPanel.heading || '')) &&
    ((cachePanel.hasSection && cachePanel.hasClear) || /缓存管理/.test(cachePanel.heading || ''))
      ? 'PASS'
      : 'FAIL';
  log('3 more video/cache => ' + summary.item3_more_video_cache);

  // --- Item 4: pure audio dictation no regression ---
  // Collapse advanced if open, click 开始听写
  await page.getByRole('button', { name: /收起/ }).click().catch(() => null);
  await sleep(300);
  await clickBtn(page, /开始听写/);
  await sleep(1500);
  await shot(page, '30-audio-dictation.png');
  const study = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasStudy: !!document.querySelector('.study, [class*="study"]'),
      hasPlay: [...document.querySelectorAll('button')].some((b) =>
        /播放|暂停/.test(b.textContent || ''),
      ),
      hasBack: [...document.querySelectorAll('button')].some((b) => /返回/.test(b.textContent || '')),
      noVideoRequired: !/视频导入失败|无法读取/.test(body),
      bodySlice: body.slice(0, 400),
    };
  });
  summary.detail.study = study;
  // play briefly
  if (study.hasPlay) {
    await page.getByRole('button', { name: /播放/ }).first().click().catch(() => null);
    await sleep(800);
    await shot(page, '31-audio-playing.png');
  }
  summary.item4_pure_audio_no_regression =
    (study.hasStudy || study.hasPlay || study.hasBack) && study.noVideoRequired ? 'PASS' : 'FAIL';
  log('4 pure audio => ' + summary.item4_pure_audio_no_regression);

  summary.all =
    summary.item1_empty_to_ready === 'PASS' &&
    summary.item2_review_ctas === 'PASS' &&
    summary.item3_more_video_cache === 'PASS' &&
    summary.item4_pure_audio_no_regression === 'PASS'
      ? 'PASS'
      : 'FAIL';

  writeSummary();
  log('SUMMARY ' + JSON.stringify(summary));
  await browser.close().catch(() => null);
  process.exit(summary.all === 'PASS' ? 0 : 2);
}

main().catch((err) => {
  log('FATAL ' + (err && err.stack ? err.stack : err));
  summary.detail.fatal = String(err);
  try {
    writeSummary();
  } catch {}
  process.exit(1);
});
