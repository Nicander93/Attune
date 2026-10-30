import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const worktree = 'D:/code/attune-ui-s3';
const outDir = 'C:/Users/PC/AttuneSmoke/s3';
const evDir = path.join(worktree, 'docs/evidence/ui-s3');
const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
const h264 = 'D:\\code\\attune-video-p0\\fixtures\\video-p0\\h264_aac.mp4';
const srt = 'C:\\Users\\PC\\AttuneSmoke\\p2\\clip.srt';

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
  branch: 'feat/ui-s3-focus',
  when: new Date().toISOString(),
  item1_no_global_nav: 'FAIL',
  item2_video_show_hide_after_check: 'FAIL',
  item3_mode_switch: 'FAIL',
  item4_keyboard_no_regression: 'FAIL',
  all: 'FAIL',
  evidence_dir: 'docs/evidence/ui-s3/',
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

async function waitCdp(timeoutMs = 180000) {
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

function writeSummary() {
  fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), notes.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'cdp-smoke-notes.txt'), notes.join('\n') + '\n');
}

async function findVideoMaterial(page) {
  return page.evaluate(async () => {
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
    const withVideo = all.filter(
      (m) => m.video && (m.video.playbackPath || m.video.sourcePath) && (m.segments?.length ?? 0) > 0,
    );
    const withSegs = all.filter((m) => (m.segments?.length ?? 0) > 0);
    return {
      video: withVideo.map((m) => ({
        id: m.id,
        name: m.displayName,
        segs: m.segments.length,
        playback: !!m.video?.playbackPath,
      })),
      withSegs: withSegs.slice(0, 12).map((m) => ({
        id: m.id,
        name: m.displayName,
        segs: m.segments.length,
        hasVideo: !!(m.video && m.video.playbackPath),
      })),
    };
  });
}

async function openStudyFromLibrary(page, nameHint) {
  // Leave focus study shell (no global nav) before navigating.
  const back = page.getByRole('button', { name: /返回/ }).first();
  if ((await back.count()) > 0 && (await page.locator('section.study').count()) > 0) {
    await back.click().catch(() => null);
    await sleep(700);
  }
  await clickBtn(page, /首页/).catch(() => null);
  await sleep(500);
  await clickBtn(page, /素材库/);
  await sleep(800);
  const search = page.locator('input.search').first();
  if ((await search.count()) > 0 && nameHint) {
    await search.fill(nameHint);
    await sleep(500);
  }
  const row = page.locator('ul.materials li.library-item').first();
  if ((await row.count()) === 0) return false;
  const main = row.locator('button.materials__row, button.item-main').first();
  if ((await main.count()) > 0) await main.click();
  else await row.click();
  await sleep(1200);
  return true;
}

async function importVideoAndStart(page) {
  await clickBtn(page, /首页/).catch(() => null);
  await sleep(400);
  await clickBtn(page, /导入素材/);
  await sleep(900);
  await clickBtn(page, /更多/);
  await sleep(350);
  await page
    .getByRole('menuitem', { name: /导入视频/ })
    .click()
    .catch(async () => {
      await page.getByText(/导入视频/).first().click();
    });
  await sleep(800);
  await shot(page, '00-video-import-panel.png');

  let picked = await setFile(page, 'video', h264);
  if (!picked.ok) {
    const pending = fill(h264);
    await sleep(250);
    await page.getByRole('button', { name: /导入视频|选择视频|重新导入/ }).first().click();
    picked = await pending;
  }
  summary.detail.videoPick = picked;
  log('video pick ' + JSON.stringify(picked));

  for (let i = 0; i < 100; i++) {
    const t = await page.evaluate(() => document.body.innerText.slice(0, 1000));
    if (/已抽取|已缓存|已生成|音轨就绪|提取完成|开始听写|字幕待校对/.test(t) && !/提取中|探测中|处理中/.test(t)) {
      log('video ready text slice: ' + t.slice(0, 200));
      break;
    }
    if (i === 3 || i === 8) {
      const apply = page.locator('button.primary').filter({ hasText: /应用|提取|确认|使用|导入/ });
      if ((await apply.count()) > 0) await apply.first().click().catch(() => null);
    }
    await sleep(1000);
  }
  await shot(page, '00b-after-video.png');

  await clickBtn(page, /更多/).catch(() => null);
  await sleep(300);
  let srtPick = await setFile(page, '.srt', srt);
  if (!srtPick.ok) {
    const pending = fill(srt);
    await sleep(200);
    await page
      .getByRole('menuitem', { name: /导入字幕文件/ })
      .click()
      .catch(async () => {
        await page.getByText(/导入字幕文件/).first().click();
      });
    srtPick = await pending;
  }
  summary.detail.srtPick = srtPick;
  await sleep(1500);
  await shot(page, '00c-after-srt.png');

  await page.getByRole('button', { name: /开始听写/ }).first().click();
  await sleep(1400);
  return { mode: 'imported', name: 'h264_aac' };
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
  await sleep(1000);

  // If a prior smoke left us on focus study, return to shell first.
  if ((await page.locator('section.study').count()) > 0) {
    await page.getByRole('button', { name: /返回/ }).first().click().catch(() => null);
    await sleep(800);
  }

  const catalog = await findVideoMaterial(page);
  summary.detail.catalog = catalog;
  log('catalog ' + JSON.stringify(catalog));

  let entry = null;
  if (catalog.video.length > 0) {
    const pick =
      catalog.video.find((v) => v.playback && v.segs >= 2) ||
      catalog.video.find((v) => v.playback) ||
      catalog.video[0];
    const opened = await openStudyFromLibrary(page, pick.name);
    summary.detail.openedExisting = { pick, opened };
    if (opened) {
      const start = page.getByRole('button', { name: /开始听写/ });
      if ((await start.count()) > 0) {
        await start.first().click();
        await sleep(1200);
      }
      const onStudy = (await page.locator('section.study').count()) > 0;
      if (onStudy) entry = { mode: 'existing', name: pick.name };
    }
  }

  if (!entry) {
    log('no usable video material; importing');
    entry = await importVideoAndStart(page);
  }

  summary.detail.entry = entry;
  log('entry ' + JSON.stringify(entry));

  // Wait for study focus shell
  await page.waitForSelector('section.study', { timeout: 20000 });
  await sleep(500);

  // ===== Item 1 =====
  await shot(page, '01-dictation-no-global-nav.png');
  const navState = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar');
    const nav = document.querySelector('nav.topbar__nav, nav[aria-label="主导航"]');
    const homeBtns = [...document.querySelectorAll('button')].filter((b) =>
      /^首页$/.test((b.textContent || '').trim()),
    );
    const libBtns = [...document.querySelectorAll('button')].filter((b) =>
      /^素材库$/.test((b.textContent || '').trim()),
    );
    const focus = !!document.querySelector(
      'section.study--focus, section.study.study--focus, .study__head--focus',
    );
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) =>
      (t.textContent || '').trim(),
    );
    const back = [...document.querySelectorAll('button')].some((b) =>
      /返回/.test(b.textContent || ''),
    );
    const dataFocus = document.querySelector('.app')?.getAttribute('data-focus');
    return {
      topbarCount: topbar ? 1 : 0,
      navCount: nav ? 1 : 0,
      homeBtnCount: homeBtns.length,
      libBtnCount: libBtns.length,
      focus,
      tabs,
      back,
      dataFocus,
      bodySlice: document.body.innerText.slice(0, 350),
    };
  });
  summary.detail.navState = navState;
  const item1 =
    navState.topbarCount === 0 &&
    navState.navCount === 0 &&
    navState.homeBtnCount === 0 &&
    navState.libBtnCount === 0 &&
    (navState.focus || navState.dataFocus === 'study') &&
    navState.tabs.some((t) => /听写/.test(t || ''));
  summary.item1_no_global_nav = item1 ? 'PASS' : 'FAIL';
  log('1 no-global-nav=' + summary.item1_no_global_nav + ' ' + JSON.stringify(navState));

  // ===== Item 2 =====
  const d1 = await page.evaluate(() => {
    const video = document.querySelector('video');
    const wrap = document.querySelector('.media-output');
    window.__s3VideoEl = video;
    return {
      videoCount: document.querySelectorAll('video').length,
      hasWrap: !!wrap,
      wrapHidden: wrap?.classList.contains('media-output--hidden') ?? null,
      hasToggleEarly: [...document.querySelectorAll('button')].some((b) =>
        /显示画面|收起画面/.test(b.textContent || ''),
      ),
      videoSrc: video?.currentSrc || video?.getAttribute('src') || '',
    };
  });
  summary.detail.dictationEntry = d1;
  await shot(page, '10-dictation-video-hidden.png');
  log('2 entry ' + JSON.stringify(d1));

  const field = page.locator('textarea').first();
  if ((await field.count()) > 0) {
    await field.click();
    await field.fill('Hello world');
    await sleep(200);
    await page
      .getByRole('button', { name: /核对答案/ })
      .click()
      .catch(async () => {
        await page.keyboard.press('Enter');
      });
    await sleep(900);
  }
  await shot(page, '11-after-check.png');

  const showBtn = page.getByRole('button', { name: /显示画面/ });
  const showCount = await showBtn.count();
  summary.detail.showBtnCount = showCount;
  let item2 = false;
  if (showCount > 0 && d1.videoCount >= 1 && d1.wrapHidden === true) {
    const beforeShow = await page.evaluate(() => {
      const v = document.querySelector('video');
      return {
        sameEl: v === window.__s3VideoEl,
        hidden:
          document.querySelector('.media-output')?.classList.contains('media-output--hidden') ??
          null,
      };
    });
    await showBtn.click();
    await sleep(600);
    await shot(page, '12-show-video.png');
    const afterShow = await page.evaluate(() => {
      const v = document.querySelector('video');
      return {
        sameEl: v === window.__s3VideoEl,
        hidden:
          document.querySelector('.media-output')?.classList.contains('media-output--hidden') ??
          null,
        videoCount: document.querySelectorAll('video').length,
      };
    });
    await page.getByRole('button', { name: /收起画面/ }).click();
    await sleep(500);
    await shot(page, '13-hide-video.png');
    const afterHide = await page.evaluate(() => {
      const v = document.querySelector('video');
      return {
        sameEl: v === window.__s3VideoEl,
        hidden:
          document.querySelector('.media-output')?.classList.contains('media-output--hidden') ??
          null,
        videoCount: document.querySelectorAll('video').length,
      };
    });
    summary.detail.videoToggle = { beforeShow, afterShow, afterHide };
    item2 =
      beforeShow.sameEl &&
      afterShow.sameEl &&
      afterHide.sameEl &&
      afterShow.hidden === false &&
      afterHide.hidden === true &&
      afterShow.videoCount === 1 &&
      afterHide.videoCount === 1;
    log('2 toggle ' + JSON.stringify(summary.detail.videoToggle));
  } else {
    summary.detail.item2Blocker = {
      showCount,
      wrapHidden: d1.wrapHidden,
      videoCount: d1.videoCount,
    };
    log('2 FAIL gate ' + JSON.stringify(summary.detail.item2Blocker));
  }
  summary.item2_video_show_hide_after_check = item2 ? 'PASS' : 'FAIL';
  log('2 video show/hide=' + summary.item2_video_show_hide_after_check);

  // ===== Item 3 =====
  const dictTab = page.getByRole('tab', { name: /听写/ });
  const readTab = page.getByRole('tab', { name: /听读/ });
  await readTab.click();
  await sleep(700);
  await shot(page, '20-listen-read.png');
  const reading = await page.evaluate(() => ({
    readSelected:
      document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() || '',
    hasReading: !!document.querySelector('.reading, .reading__text, [class*="reading"]'),
    bodySlice: document.body.innerText.slice(0, 250),
    stillNoTopbar: !document.querySelector('.topbar'),
  }));
  await dictTab.click();
  await sleep(700);
  await shot(page, '21-back-dictation.png');
  const dictation = await page.evaluate(() => ({
    dictSelected:
      document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() || '',
    hasTextarea: !!document.querySelector('textarea'),
    stillNoTopbar: !document.querySelector('.topbar'),
  }));
  summary.detail.modeSwitch = { reading, dictation };
  const item3 =
    /听读/.test(reading.readSelected) &&
    /听写/.test(dictation.dictSelected) &&
    reading.stillNoTopbar &&
    dictation.stillNoTopbar &&
    (reading.hasReading || /听读|原文|隐藏/.test(reading.bodySlice) || dictation.hasTextarea);
  summary.item3_mode_switch = item3 ? 'PASS' : 'FAIL';
  log('3 mode switch=' + summary.item3_mode_switch + ' ' + JSON.stringify(summary.detail.modeSwitch));

  // ===== Item 4 =====
  await dictTab.click().catch(() => null);
  await sleep(400);
  await page.evaluate(() => {
    const a = document.activeElement;
    if (a && a instanceof HTMLElement) a.blur();
  });
  await page
    .locator('h1, .study__file, .study__head')
    .first()
    .click({ force: true })
    .catch(() => null);
  await sleep(200);

  // Rewind so Space has a playable window (media at EOF looks paused both sides).
  await page
    .getByRole('button', { name: /重听本句|重听/ })
    .first()
    .click()
    .catch(() => null);
  await sleep(400);
  await page.evaluate(() => {
    const el = document.querySelector('video,audio');
    if (el) {
      el.pause();
      try {
        el.currentTime = 0;
      } catch {}
    }
    const a = document.activeElement;
    if (a && a instanceof HTMLElement) a.blur();
  });
  await page
    .locator('h1, .study__file, .study__head')
    .first()
    .click({ force: true })
    .catch(() => null);
  await sleep(200);

  const beforeArrow = await page.evaluate(() => {
    const h = document.querySelector('h1')?.textContent || '';
    const m = h.match(/第\s*(\d+)/);
    return { h, index: m ? Number(m[1]) : null };
  });

  const beforeSpace = await page.evaluate(() => document.querySelector('video,audio')?.paused);
  await page.keyboard.press('Space');
  await sleep(500);
  const afterSpace = await page.evaluate(() => document.querySelector('video,audio')?.paused);
  await page.keyboard.press('Space');
  await sleep(400);
  const afterSpace2 = await page.evaluate(() => document.querySelector('video,audio')?.paused);

  await page.keyboard.press('ArrowRight');
  await sleep(400);
  const afterRight = await page.evaluate(() => {
    const h = document.querySelector('h1')?.textContent || '';
    const m = h.match(/第\s*(\d+)/);
    return { h, index: m ? Number(m[1]) : null };
  });
  await page.keyboard.press('ArrowLeft');
  await sleep(400);
  const afterLeft = await page.evaluate(() => {
    const h = document.querySelector('h1')?.textContent || '';
    const m = h.match(/第\s*(\d+)/);
    return { h, index: m ? Number(m[1]) : null };
  });

  const ta = page.locator('textarea').first();
  let enterOk = false;
  let escOk = false;
  if ((await ta.count()) > 0) {
    await ta.click();
    await ta.fill('Hello world');
    await ta.press('Enter');
    await sleep(700);
    const afterEnter = await page.evaluate(() => ({
      hasDiff: !!document.querySelector('.diff'),
      showVideo: [...document.querySelectorAll('button')].some((b) =>
        /显示画面|收起画面/.test(b.textContent || ''),
      ),
      checkedHint: /下一句|和原文|漏写|多写|一致/.test(document.body.innerText),
    }));
    enterOk = afterEnter.hasDiff || afterEnter.checkedHint || afterEnter.showVideo;
    await page.keyboard.press('Escape');
    await sleep(400);
    const afterEsc = await page.evaluate(() => ({
      hasDiff: !!document.querySelector('.diff'),
      focused: document.activeElement?.tagName,
      hasTextarea: !!document.querySelector('textarea'),
    }));
    escOk = afterEsc.hasDiff === false && afterEsc.hasTextarea;
    summary.detail.enterEsc = { afterEnter, afterEsc };
  }
  await shot(page, '30-keyboard.png');

  const arrowOk =
    beforeArrow.index != null &&
    afterRight.index != null &&
    afterLeft.index != null &&
    afterRight.index !== beforeArrow.index &&
    afterLeft.index === beforeArrow.index;

  const spaceOk = typeof beforeSpace === 'boolean' && afterSpace !== beforeSpace;

  summary.detail.keyboard = {
    beforeArrow,
    afterRight,
    afterLeft,
    beforeSpace,
    afterSpace,
    afterSpace2,
    spaceOk,
    arrowOk,
    enterOk,
    escOk,
  };
  const item4 = spaceOk && arrowOk && enterOk && escOk;
  summary.item4_keyboard_no_regression = item4 ? 'PASS' : 'FAIL';
  log('4 keyboard=' + summary.item4_keyboard_no_regression + ' ' + JSON.stringify(summary.detail.keyboard));

  summary.all =
    summary.item1_no_global_nav === 'PASS' &&
    summary.item2_video_show_hide_after_check === 'PASS' &&
    summary.item3_mode_switch === 'PASS' &&
    summary.item4_keyboard_no_regression === 'PASS'
      ? 'PASS'
      : 'FAIL';

  writeSummary();
  const readme = `# UI S3 focus evidence

Branch: \`feat/ui-s3-focus\` · tip recorded in \`SUMMARY.json\`.

Desktop smoke on Windows LM via CDP WebView2 (\`scripts/_cdp_s3_smoke.mjs\`), app from this worktree (\`npm run desktop\` + \`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222\`).

Product gate (human/screenshot):

| # | Item | Result | Key shots |
| --- | --- | --- | --- |
| 1 | Study page has no 首页/素材库 global nav | ${summary.item1_no_global_nav} | 01 |
| 2 | Video: hidden by default; after check show/hide picture (same clock) | ${summary.item2_video_show_hide_after_check} | 10–13 |
| 3 | 听写 ↔ 听读 mode switch in same shell | ${summary.item3_mode_switch} | 20–21 |
| 4 | Enter / Space / ←→ / Esc no regression | ${summary.item4_keyboard_no_regression} | 30 |

See \`SUMMARY.json\` and \`cdp-smoke-notes.txt\`.
`;
  fs.writeFileSync(path.join(evDir, 'README.md'), readme);
  fs.writeFileSync(path.join(outDir, 'README.md'), readme);
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
