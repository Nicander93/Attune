import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const worktree = 'D:/code/attune-ui-mot1';
const outDir = 'C:/Users/PC/AttuneSmoke/mot1';
const evDir = path.join(worktree, 'docs/evidence/mot-1');
const wav = 'C:\\Users\\PC\\AttuneSmoke\\p3\\speech.wav';

const VIEWPORTS = [
  { id: 'default', label: 'default-1180x800', width: 1180, height: 800 },
  { id: 'ref', label: '1024x640', width: 1024, height: 640 },
  { id: 'narrow', label: '720x560', width: 720, height: 560 },
  { id: 'wide', label: '1440x900', width: 1440, height: 900 },
];

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
  branch: 'feat/mot-1-motion-language',
  when: new Date().toISOString(),
  viewports: {},
  item1_page_switch: 'FAIL',
  item2_study_chrome: 'FAIL',
  item3_viewports: 'FAIL',
  item4_notice_overlay: 'FAIL',
  notice_blocks_title_or_toolbar: null,
  all: 'FAIL',
  evidence_dir: 'docs/evidence/mot-1/',
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
  const page = pages.find((pg) => /1420|localhost|tauri|asset/i.test(pg.url())) || pages[0];
  if (!page) throw new Error('no CDP page');
  await page.bringToFront();
  log('page ' + page.url());
  const client = await page.context().newCDPSession(page);
  return { browser, page, client };
}

async function clickBtn(page, re) {
  // DOM click avoids hit-testing an overlay notice that sits on the same pixels.
  await page
    .getByRole('button', { name: re })
    .first()
    .evaluate((el) => el.click());
}

async function domClick(locator) {
  await locator.evaluate((el) => el.click());
}

async function setInnerSize(page, client, width, height) {
  const { windowId } = await client.send('Browser.getWindowForTarget');
  let last = { innerWidth: 0, innerHeight: 0, outer: null };
  for (let i = 0; i < 6; i++) {
    const inner = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    }));
    const { bounds } = await client.send('Browser.getWindowBounds', { windowId });
    last = { ...inner, outer: bounds };
    const dw = width - inner.innerWidth;
    const dh = height - inner.innerHeight;
    if (Math.abs(dw) <= 2 && Math.abs(dh) <= 2) break;
    await client.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        windowState: 'normal',
        width: Math.max(200, (bounds.width || width) + dw),
        height: Math.max(200, (bounds.height || height) + dh),
        left: bounds.left,
        top: bounds.top,
      },
    });
    await sleep(250);
  }
  const finalInner = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));
  log(
    'size target=' +
      width +
      'x' +
      height +
      ' inner=' +
      finalInner.innerWidth +
      'x' +
      finalInner.innerHeight,
  );
  return { target: { width, height }, ...finalInner, outer: last.outer };
}

async function layoutAudit(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const app = document.querySelector('.app');
    const appBox = app?.getBoundingClientRect();
    const overflowX = html.scrollWidth > html.clientWidth + 2;
    const overflowYDoc =
      html.scrollHeight > html.clientHeight + 2 && getComputedStyle(html).overflowY !== 'hidden';
    const clipped = [];
    const nodes = document.querySelectorAll(
      'button, a, h1, h2, nav, header, .page-heading, .import__heading, .study__head, .topbar, .banner, .materials__row, .dropzone',
    );
    for (const el of nodes) {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)
        continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // Only horizontal overflow counts as a layout leak; list rows below the
      // fold in a scrolling pane are expected.
      if (r.right > window.innerWidth + 3 || r.left < -3) {
        const text = (el.innerText || el.getAttribute('aria-label') || el.className || '')
          .toString()
          .trim()
          .slice(0, 80);
        clipped.push({
          tag: el.tagName,
          className: String(el.className).slice(0, 80),
          text,
          rect: {
            left: Math.round(r.left),
            top: Math.round(r.top),
            right: Math.round(r.right),
            bottom: Math.round(r.bottom),
          },
        });
      }
    }
    const heading = document.querySelector('h1, .import__heading, .page-heading h1');
    const topbar = document.querySelector('.topbar');
    const banner = document.querySelector('.banner');
    const studyHead = document.querySelector('.study__head');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        text: (el.innerText || '').trim().slice(0, 120),
        hidden: style.visibility === 'hidden' || Number(style.opacity) === 0,
        rect: {
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
      };
    };
    const overlap = (a, b) => {
      if (!a || !b || a.hidden || b.hidden) return null;
      const w = Math.max(
        0,
        Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left),
      );
      const h = Math.max(
        0,
        Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top),
      );
      return w > 2 && h > 2 ? { width: w, height: h } : null;
    };
    const bannerBox = box(banner);
    const headingBox = box(heading);
    const topbarBox = box(topbar);
    const studyBox = box(studyHead);
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: html.scrollWidth,
      scrollHeight: html.scrollHeight,
      overflowX,
      appHeight: appBox ? Math.round(appBox.height) : null,
      clipped: clipped.slice(0, 12),
      heading: headingBox,
      topbar: topbarBox,
      studyHead: studyBox,
      banner: bannerBox,
      bannerOverlapsHeading: overlap(bannerBox, headingBox),
      bannerOverlapsTopbar: overlap(bannerBox, topbarBox),
      bannerOverlapsStudyHead: overlap(bannerBox, studyBox),
      bodySlice: (document.body.innerText || '').slice(0, 600),
    };
  });
}

async function goHome(page) {
  for (let i = 0; i < 5; i++) {
    const focus = await page.evaluate(
      () => document.querySelector('.app')?.getAttribute('data-focus') === 'study',
    );
    if (focus) {
      const back = page.getByRole('button', { name: /返回/ }).first();
      if (await back.count()) await domClick(back);
      await sleep(400);
      continue;
    }
    const home = page.getByRole('button', { name: /^首页$/ }).first();
    if (await home.count()) {
      await domClick(home);
      await sleep(500);
      return;
    }
    break;
  }
}

async function main() {
  log('tip ' + tip);
  log('waiting CDP 9222...');
  if (!(await waitCdp())) {
    summary.detail.blocker = 'CDP 9222 not up';
    throw new Error('CDP not ready');
  }

  const { browser, page, client } = await connectPage();
  page.on('dialog', async (dialog) => {
    log('dialog [' + dialog.type() + '] ' + dialog.message());
    await dialog.accept();
  });
  await sleep(800);

  // --- Item 1: page switches at default size ---
  const defaultSize = await setInnerSize(page, client, 1180, 800);
  summary.viewports.default = defaultSize;
  await goHome(page);
  await sleep(400);
  await shot(page, '01-home.png');
  const homeAudit = await layoutAudit(page);
  summary.detail.home = homeAudit;
  log(
    '1 home ' +
      JSON.stringify({
        overflowX: homeAudit.overflowX,
        clipped: homeAudit.clipped.length,
        size: homeAudit.innerWidth + 'x' + homeAudit.innerHeight,
      }),
  );

  const midPromise = (async () => {
    await sleep(90);
    await shot(page, '02-home-to-library-mid.png').catch(() => null);
  })();
  await clickBtn(page, /素材库/);
  await midPromise;
  await sleep(400);
  await shot(page, '03-library.png');
  const libAudit = await layoutAudit(page);
  summary.detail.library = libAudit;
  log(
    '1 library ' +
      JSON.stringify({
        overflowX: libAudit.overflowX,
        clipped: libAudit.clipped.length,
        heading: libAudit.heading?.text,
      }),
  );

  await clickBtn(page, /导入素材/);
  await sleep(80);
  await shot(page, '04-library-to-import-mid.png').catch(() => null);
  await sleep(400);
  await shot(page, '05-import.png');
  const importAudit = await layoutAudit(page);
  summary.detail.importEmpty = importAudit;
  log(
    '1 import ' +
      JSON.stringify({
        overflowX: importAudit.overflowX,
        clipped: importAudit.clipped.length,
        heading: importAudit.heading?.text,
      }),
  );

  const importHeadingTop = importAudit.heading?.rect?.top;
  await clickBtn(page, /返回/);
  await sleep(500);
  await shot(page, '06-back-library.png');
  await goHome(page);
  await sleep(400);
  await shot(page, '07-back-home.png');

  const item1Overflow =
    homeAudit.overflowX ||
    libAudit.overflowX ||
    importAudit.overflowX ||
    homeAudit.clipped.length > 0 ||
    libAudit.clipped.length > 0 ||
    importAudit.clipped.length > 0;
  const item1Pages =
    /Attune/.test(homeAudit.bodySlice) &&
    /素材库|素材/.test(libAudit.bodySlice) &&
    /导入素材|选择或拖入/.test(importAudit.bodySlice);
  summary.item1_page_switch = !item1Overflow && item1Pages ? 'PASS' : 'FAIL';
  log('1 page switch => ' + summary.item1_page_switch);

  // --- Item 3: 1024x640, narrower, widescreen (settled pages) ---
  const viewportResults = [];
  for (const vp of VIEWPORTS.filter((v) => v.id !== 'default')) {
    const size = await setInnerSize(page, client, vp.width, vp.height);
    summary.viewports[vp.id] = size;
    const shots = {};
    await goHome(page);
    await sleep(350);
    await shot(page, `10-${vp.id}-home.png`);
    shots.home = await layoutAudit(page);
    await clickBtn(page, /素材库/);
    await sleep(400);
    await shot(page, `11-${vp.id}-library.png`);
    shots.library = await layoutAudit(page);
    await clickBtn(page, /导入素材/);
    await sleep(400);
    await shot(page, `12-${vp.id}-import.png`);
    shots.import = await layoutAudit(page);
    await clickBtn(page, /返回/).catch(() => goHome(page));
    await sleep(300);
    const fail = [shots.home, shots.library, shots.import].some(
      (a) => a.overflowX || a.clipped.length > 0,
    );
    viewportResults.push({
      id: vp.id,
      label: vp.label,
      target: size.target,
      inner: { width: size.innerWidth, height: size.innerHeight },
      overflow: fail,
      clipped: {
        home: shots.home.clipped,
        library: shots.library.clipped,
        import: shots.import.clipped,
      },
    });
    log(
      '3 ' + vp.label + ' overflow=' + fail + ' inner=' + size.innerWidth + 'x' + size.innerHeight,
    );
    summary.detail['vp_' + vp.id] = shots;
  }
  summary.detail.viewportResults = viewportResults;
  summary.item3_viewports = viewportResults.every((v) => !v.overflow) ? 'PASS' : 'FAIL';
  log('3 viewports => ' + summary.item3_viewports);

  // Use the reference 1024x640 window for study + notice
  const studySize = await setInnerSize(page, client, 1024, 640);
  summary.viewports.study = studySize;
  await goHome(page);
  await sleep(300);
  await clickBtn(page, /素材库/);
  await sleep(400);

  const libraryText = await page.evaluate(() => document.body.innerText);
  log('library rows text slice ' + libraryText.slice(0, 400));

  let enteredStudy = false;
  const rows = page.locator('.materials__row');
  const rowCount = await rows.count();
  log('library row count ' + rowCount);
  if (rowCount > 0) {
    await rows.first().click();
    await sleep(600);
    const body = await page.evaluate(() => document.body.innerText);
    if (/第\s*\d+\s*\/\s*\d+\s*句|听完这句|核对答案/.test(body)) {
      enteredStudy = true;
    } else if (await page.getByRole('button', { name: /开始听写/ }).count()) {
      const start = page.getByRole('button', { name: /开始听写/ }).first();
      if (await start.isEnabled()) {
        await start.click();
        await sleep(600);
        enteredStudy = /第\s*\d+\s*\/\s*\d+\s*句|听完这句|核对答案/.test(
          await page.evaluate(() => document.body.innerText),
        );
      }
    }
  }

  if (!enteredStudy) {
    log('no ready study material; importing ' + wav);
    await goHome(page);
    await sleep(300);
    await clickBtn(page, /导入素材/);
    await sleep(400);
    const { spawn } = await import('node:child_process');
    const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
    const pending = new Promise((resolve) => {
      const child = spawn(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', filler, '-FilePath', wav],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
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
    await sleep(300);
    await clickBtn(page, /选择文件/);
    const pick = await pending;
    log('import dialog ' + JSON.stringify(pick));
    summary.detail.importPick = pick;
    const startWait = Date.now();
    let ready = false;
    while (Date.now() - startWait < 180000) {
      const text = await page.evaluate(() => document.body.innerText);
      if (/已准备好 \d+ 句，可以开始听写/.test(text)) {
        ready = true;
        break;
      }
      if (/无法确定|没能自动准备好字幕|没能打开文件选择/.test(text)) break;
      await sleep(200);
    }
    log('import ready=' + ready);
    if (ready) {
      await shot(page, '39-imported-ready.png');
      await clickBtn(page, /开始听写/);
      await sleep(600);
      enteredStudy = /第\s*\d+\s*\/\s*\d+\s*句|听完这句|核对答案/.test(
        await page.evaluate(() => document.body.innerText),
      );
    }
  }

  if (!enteredStudy) {
    summary.detail.studyBlocker = 'could not enter dictation';
    await shot(page, '40-study-failed.png');
    log('2 could not enter study');
  } else {
    await sleep(350);
    await shot(page, '40-study-entered.png');
    const enteredAudit = await layoutAudit(page);
    summary.detail.studyEntered = enteredAudit;
    const topbarHidden =
      enteredAudit.topbar?.hidden !== false &&
      (enteredAudit.topbar == null || enteredAudit.topbar.hidden);
    // topbar may still be in DOM; hidden/visibility after transition
    const topbarOk =
      !enteredAudit.topbar || enteredAudit.topbar.hidden || enteredAudit.topbar.rect.height === 0;
    log('2 entered topbarHidden=' + topbarOk + ' studyHead=' + !!enteredAudit.studyHead);

    // Open ··· menu
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await sleep(80);
    await shot(page, '41-menu-opening.png');
    await sleep(200);
    await shot(page, '42-menu-open.png');
    const menuOpen = await page.evaluate(() => {
      const menu = document.querySelector('.study__menu, [role="menu"]');
      const btn = document.querySelector('.study__more, button[aria-label="更多"]');
      if (!menu || !btn) return { present: !!menu };
      const m = menu.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      return {
        present: true,
        nearButton: Math.abs(m.right - b.right) < 80 && m.top >= b.bottom - 12,
        menu: { top: Math.round(m.top), right: Math.round(m.right), width: Math.round(m.width) },
        button: {
          top: Math.round(b.top),
          right: Math.round(b.right),
          bottom: Math.round(b.bottom),
        },
        items: [...menu.querySelectorAll('[role=menuitem]')]
          .map((el) => el.textContent.trim())
          .slice(0, 8),
      };
    });
    summary.detail.menuOpen = menuOpen;
    log('2 menu open ' + JSON.stringify(menuOpen));

    // Interrupt: close then reopen quickly while motion may still be running
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await sleep(70);
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await sleep(70);
    await shot(page, '43-menu-interrupt.png');
    const afterInterrupt = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"]');
      const visible = !!(
        menu &&
        getComputedStyle(menu).opacity !== '0' &&
        getComputedStyle(menu).visibility !== 'hidden'
      );
      return { visible, text: menu?.innerText?.slice(0, 80) || '' };
    });
    summary.detail.menuInterrupt = afterInterrupt;
    log('2 menu interrupt ' + JSON.stringify(afterInterrupt));
    // settle closed or open? we toggled close-open, so should be open (or entered)
    if (afterInterrupt.visible) {
      await page.getByRole('button', { name: '更多', exact: true }).click();
      await sleep(250);
    }
    await shot(page, '44-menu-closed.png');

    // Sentence list if the count button is visible
    const countBtn = page.locator('.study__count');
    let sentenceOk = null;
    if (await countBtn.count()) {
      await countBtn.click();
      await sleep(80);
      await shot(page, '45-sentence-opening.png');
      await sleep(200);
      await shot(page, '46-sentence-open.png');
      sentenceOk = await page.evaluate(() => {
        const pop = document.querySelector('.study__sentence-pop, [role="listbox"]');
        const btn = document.querySelector('.study__count');
        if (!pop || !btn) return { present: !!pop };
        const p = pop.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        return {
          present: true,
          nearButton:
            Math.abs(p.left + p.width / 2 - (b.left + b.width / 2)) < 120 && p.top >= b.top - 8,
          count: pop.querySelectorAll('button, [role=option]').length,
        };
      });
      log('2 sentence list ' + JSON.stringify(sentenceOk));
      summary.detail.sentenceList = sentenceOk;
      // interrupt close/open
      await countBtn.click();
      await sleep(60);
      await countBtn.click();
      await sleep(80);
      await shot(page, '47-sentence-interrupt.png');
      if (await page.locator('.study__sentence-pop, [role="listbox"]').count()) {
        await countBtn.click();
        await sleep(200);
      }
    }

    // --- Item 4: notice overlay via 快捷键 ---
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await sleep(250);
    const shortcut = page.getByRole('menuitem', { name: '快捷键' });
    if (await shortcut.count()) {
      await shortcut.click();
      await sleep(80);
      await shot(page, '50-notice-appearing.png');
      await sleep(200);
      await shot(page, '51-notice-study.png');
      const noticeAudit = await layoutAudit(page);
      summary.detail.noticeStudy = noticeAudit;
      const blocksStudyToolbar = !!noticeAudit.bannerOverlapsStudyHead;
      const blocksHeading = !!noticeAudit.bannerOverlapsHeading;
      summary.notice_blocks_title_or_toolbar = blocksStudyToolbar || blocksHeading;
      summary.detail.noticeOverlap = {
        heading: noticeAudit.bannerOverlapsHeading,
        topbar: noticeAudit.bannerOverlapsTopbar,
        studyHead: noticeAudit.bannerOverlapsStudyHead,
        banner: noticeAudit.banner,
        studyHeadBox: noticeAudit.studyHead,
        headingBox: noticeAudit.heading,
      };
      log('4 notice overlap ' + JSON.stringify(summary.detail.noticeOverlap));
      // Page should not be pushed: study head top should still be near 0
      const studyTop = noticeAudit.studyHead?.rect?.top;
      const pushed = typeof studyTop === 'number' && studyTop > 40;
      summary.detail.noticePushedPage = pushed;
      // Overlay is OK even if it covers the head; "挡住" is a report, not auto-fail
      // unless the page was pushed down.
      const noticeVisible = !!noticeAudit.banner && !noticeAudit.banner.hidden;
      summary.item4_notice_overlay =
        noticeVisible && !pushed && !blocksStudyToolbar && !blocksHeading ? 'PASS' : 'FAIL';
      log(
        '4 notice visible=' +
          noticeVisible +
          ' pushed=' +
          pushed +
          ' blocksStudyToolbar=' +
          blocksStudyToolbar +
          ' => ' +
          summary.item4_notice_overlay,
      );
    } else {
      summary.detail.noticeBlocker = 'no 快捷键 menu item';
      await shot(page, '50-notice-missing.png');
      log('4 no shortcut item');
    }

    // Leave study, topbar should return. The overlay notice may sit on the
    // back button, so use a force click and do not treat that as a script failure.
    await domClick(page.getByRole('button', { name: /返回/ }).first());
    await sleep(400);
    await shot(page, '48-leave-study.png');
    const leftAudit = await layoutAudit(page);
    summary.detail.leftStudy = leftAudit;
    const topbarBack = leftAudit.topbar && !leftAudit.topbar.hidden;
    log('2 left study topbarBack=' + topbarBack);
    // goBack does not clear the notice, so the banner may still be on the
    // previous page (import). Capture whether it covers the title or topbar.
    if (leftAudit.banner && !leftAudit.banner.hidden) {
      await shot(page, '52-notice-after-leave.png');
      summary.detail.noticeAfterLeave = {
        overlapHeading: leftAudit.bannerOverlapsHeading,
        overlapTopbar: leftAudit.bannerOverlapsTopbar,
        banner: leftAudit.banner,
        heading: leftAudit.heading,
        topbar: leftAudit.topbar,
      };
      log('4 notice after leave ' + JSON.stringify(summary.detail.noticeAfterLeave));
    }

    const item2Pass =
      topbarOk &&
      topbarBack &&
      menuOpen.present &&
      menuOpen.nearButton !== false &&
      afterInterrupt.visible &&
      enteredAudit.overflowX !== true &&
      enteredAudit.clipped.length === 0;
    summary.item2_study_chrome = item2Pass ? 'PASS' : 'FAIL';
    log('2 study chrome => ' + summary.item2_study_chrome);
  }

  summary.all =
    summary.item1_page_switch === 'PASS' &&
    summary.item2_study_chrome === 'PASS' &&
    summary.item3_viewports === 'PASS' &&
    summary.item4_notice_overlay === 'PASS'
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
