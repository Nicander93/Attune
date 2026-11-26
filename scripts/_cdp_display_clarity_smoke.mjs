import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const worktree = 'D:/code/attune-ui-display-fix';
const outDir = 'C:/Users/PC/AttuneSmoke/display-clarity';
const evDir = path.join(worktree, 'docs/evidence/ui-display-clarity');
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
  evidence_dir: 'docs/evidence/ui-display-clarity/',
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


function boxes(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 160),
        hidden: style.visibility === 'hidden' || Number(style.opacity) === 0,
        opacity: style.opacity,
        background: style.backgroundColor,
        motion: el.getAttribute('data-motion'),
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
    const intersects = (a, b) => {
      if (!a || !b || a.hidden || b.hidden) return null;
      const w = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left));
      const h = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));
      if (w > 1 && h > 1) return { width: w, height: h };
      return null;
    };
    const menu = box(document.querySelector('.study__menu'));
    const check = box(document.querySelector('[aria-label="核对答案"]'));
    const banner = box(document.querySelector('.banner'));
    const head = box(document.querySelector('.study__head'));
    const status = box(document.querySelector('.study__status'));
    const count = box(document.querySelector('.study__count'));
    const topbar = box(document.querySelector('.topbar'));
    const heading = box(document.querySelector('h1, .import__heading, .page-heading h1'));
    const back = box(
      [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('返回')) ||
        null,
    );
    return {
      menu,
      check,
      banner,
      head,
      status,
      count,
      topbar,
      heading,
      back,
      menuOverlapsCheck: intersects(menu, check),
      bannerOverlapsHead: intersects(banner, head),
      bannerOverlapsStatus: intersects(banner, status),
      bannerOverlapsCount: intersects(banner, count),
      bannerOverlapsTopbar: intersects(banner, topbar),
      bannerOverlapsHeading: intersects(banner, heading),
      bannerOverlapsBack: intersects(banner, back),
    };
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(evDir, { recursive: true });
  try {
    summary.tip = execSync('git rev-parse HEAD', { cwd: worktree }).toString().trim();
    summary.branch = execSync('git branch --show-current', { cwd: worktree }).toString().trim();
  } catch (err) {
    log(String(err));
  }
  log('tip ' + summary.tip);
  log('waiting CDP 9222...');
  if (!(await waitCdp())) {
    summary.detail.blocker = 'CDP 9222 not up';
    throw new Error('CDP not ready');
  }

  const { browser, page, client } = await connectPage();
  log('page ' + page.url());
  page.setDefaultTimeout(30000);

  const defaultSize = await setInnerSize(page, client, 1180, 800);
  summary.viewports.default = defaultSize;

  await goHome(page);
  await sleep(400);
  await shot(page, '01-home.png');
  const homeAudit = await layoutAudit(page);
  log('1 home ' + JSON.stringify({ overflowX: homeAudit.overflowX, clipped: homeAudit.clipped.length, size: defaultSize.innerWidth + 'x' + defaultSize.innerHeight }));

  const midPromise = (async () => {
    await sleep(80);
    await shot(page, '02-home-to-library-mid.png').catch(() => null);
  })();
  await clickBtn(page, /^素材库$/);
  await midPromise;
  await sleep(400);
  await shot(page, '03-library.png');
  const libAudit = await layoutAudit(page);
  log('1 library ' + JSON.stringify({ overflowX: libAudit.overflowX, clipped: libAudit.clipped.length, heading: libAudit.heading?.text }));

  await clickBtn(page, /导入素材/);
  await shot(page, '04-library-to-import-mid.png').catch(() => null);
  await sleep(400);
  await shot(page, '05-import.png');
  const importAudit = await layoutAudit(page);
  log('1 import ' + JSON.stringify({ overflowX: importAudit.overflowX, clipped: importAudit.clipped.length, heading: importAudit.heading?.text }));

  await clickBtn(page, /返回/);
  await sleep(300);
  await shot(page, '06-back-library.png');
  await clickBtn(page, /^首页$/);
  await sleep(300);
  await shot(page, '07-back-home.png');

  const item1Overflow = homeAudit.overflowX || libAudit.overflowX || importAudit.overflowX;
  summary.item1_page_switch = item1Overflow ? 'FAIL' : 'PASS';
  log('1 page switch => ' + summary.item1_page_switch);

  const viewportResults = [];
  for (const vp of VIEWPORTS.filter((v) => v.id !== 'default')) {
    const size = await setInnerSize(page, client, vp.width, vp.height);
    summary.viewports[vp.id] = size;
    await goHome(page);
    await sleep(250);
    await shot(page, `10-${vp.id}-home.png`);
    const home = await layoutAudit(page);
    await clickBtn(page, /^素材库$/);
    await sleep(250);
    await shot(page, `11-${vp.id}-library.png`);
    const library = await layoutAudit(page);
    await clickBtn(page, /导入素材/);
    await sleep(250);
    await shot(page, `12-${vp.id}-import.png`);
    const importing = await layoutAudit(page);
    const fail = [home, library, importing].some((audit) => audit.overflowX);
    viewportResults.push({ id: vp.id, fail, size });
    log(`3 ${vp.label} overflow=${fail} inner=${size.innerWidth}x${size.innerHeight}`);
  }
  summary.item3_viewports = viewportResults.some((row) => row.fail) ? 'FAIL' : 'PASS';
  log('3 viewports => ' + summary.item3_viewports);

  const studySize = await setInnerSize(page, client, 1024, 640);
  summary.viewports.study = studySize;
  await goHome(page);
  await clickBtn(page, /^素材库$/);
  await sleep(400);

  let inStudy = false;
  const startStudy = async () => {
    const start = page.getByRole('button', { name: /开始听写/ }).first();
    if (await start.count()) {
      await domClick(start);
      await sleep(500);
      return true;
    }
    return false;
  };

  if (await startStudy()) inStudy = true;
  if (!inStudy) {
    log('no ready study material; importing ' + wav);
    await goHome(page);
    await clickBtn(page, /导入素材/);
    await sleep(400);
    const choose = page.getByRole('button', { name: /选择文件/ }).first();
    const { spawn } = await import('node:child_process');
    const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
    const pending = new Promise((resolve) => {
      const child = spawn('powershell', ['-NoProfile', '-File', filler, wav], { windowsHide: true });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.on('close', (code) => resolve({ code, out: out.trim() }));
    });
    await sleep(400);
    await domClick(choose);
    const pick = await pending;
    log('import dialog ' + JSON.stringify(pick));
    const startWait = Date.now();
    let ready = false;
    while (Date.now() - startWait < 120000) {
      const text = await page.evaluate(() => document.body.innerText);
      if (/已准备好|可以开始听写/.test(text)) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    log('import ready=' + ready);
    await shot(page, '39-imported-ready.png');
    if (ready) inStudy = await startStudy();
  }

  if (!inStudy) {
    await shot(page, '40-study-failed.png');
    throw new Error('could not enter study');
  }

  await shot(page, '40-study-entered.png');

  const more = page.getByRole('button', { name: '更多', exact: true });
  await domClick(more);
  await sleep(80);
  await shot(page, '41-menu-opening.png');
  await sleep(250);
  await shot(page, '42-menu-open.png');
  const menuOpen = await boxes(page);
  const menuOpaque = menuOpen.menu && menuOpen.menu.opacity === '1' && /rgb\(\s*255,\s*255,\s*255/i.test(menuOpen.menu.background || '');
  const checkFullyVisible = !!(
    menuOpen.check &&
    !menuOpen.check.hidden &&
    menuOpen.check.rect.top >= 0 &&
    menuOpen.check.rect.bottom <= studySize.innerHeight + 1
  );
  const item2Pass = !!(menuOpen.menu && !menuOpen.menuOverlapsCheck && menuOpaque && checkFullyVisible);
  summary.item2_menu_open = item2Pass ? 'PASS' : 'FAIL';
  summary.detail.menuOpen = menuOpen;
  log(
    '2 menu open overlapCheck=' +
      JSON.stringify(menuOpen.menuOverlapsCheck) +
      ' opaque=' +
      menuOpaque +
      ' checkVisible=' +
      checkFullyVisible +
      ' => ' +
      summary.item2_menu_open,
  );

  const shortcut = page.getByRole('menuitem', { name: '快捷键' });
  const midShot = shot(page, '50-notice-appearing.png');
  await shortcut.evaluate((el) => el.click());
  const midState = await page.evaluate(() => {
    const menu = document.querySelector('.study__menu');
    const style = menu ? getComputedStyle(menu) : null;
    const check = document.querySelector('[aria-label="核对答案"]');
    const mixed = (() => {
      if (!menu || !check || !style) return false;
      const opacity = Number(style.opacity);
      if (!(opacity > 0 && opacity < 1)) return false;
      const a = menu.getBoundingClientRect();
      const b = check.getBoundingClientRect();
      const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return w > 1 && h > 1;
    })();
    return {
      menuPresent: !!menu,
      motion: menu?.getAttribute('data-motion') || null,
      opacity: style?.opacity || null,
      mixedText: mixed,
    };
  });
  await midShot;
  summary.detail.midClick = midState;
  const item1Motion = !midState.menuPresent && !midState.mixedText;
  summary.item1_no_mixed_text = item1Motion ? 'PASS' : 'FAIL';
  log('1 mid-frame ' + JSON.stringify(midState) + ' => ' + summary.item1_no_mixed_text);

  await sleep(300);
  await shot(page, '51-notice-study.png');
  const noticeStudy = await boxes(page);
  const chromeClickable = await page.evaluate(() => {
    const names = ['← 返回', '听读', '更多'];
    const hits = {};
    for (const name of names) {
      const el = [...document.querySelectorAll('button')].find((btn) =>
        (btn.getAttribute('aria-label') || btn.textContent || '').includes(name.replace('← ', '')),
      );
      if (!el) {
        hits[name] = false;
        continue;
      }
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      hits[name] = !!(top && (el === top || el.contains(top) || top.contains?.(el)));
    }
    const count = document.querySelector('.study__count');
    if (count) {
      const r = count.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      hits['01/02'] = !!(top && (count === top || count.contains(top)));
    }
    return hits;
  });
  const item3Study =
    !!noticeStudy.banner &&
    !noticeStudy.bannerOverlapsHead &&
    !noticeStudy.bannerOverlapsStatus &&
    !noticeStudy.bannerOverlapsCount &&
    Object.values(chromeClickable).every(Boolean);
  summary.item3_banner_study = item3Study ? 'PASS' : 'FAIL';
  summary.detail.noticeStudy = noticeStudy;
  summary.detail.chromeClickable = chromeClickable;
  log(
    '3 study banner overlaps ' +
      JSON.stringify({
        head: noticeStudy.bannerOverlapsHead,
        status: noticeStudy.bannerOverlapsStatus,
        count: noticeStudy.bannerOverlapsCount,
        banner: noticeStudy.banner?.rect,
        headBox: noticeStudy.head?.rect,
        statusBox: noticeStudy.status?.rect,
        clickable: chromeClickable,
      }) +
      ' => ' +
      summary.item3_banner_study,
  );

  await domClick(page.getByRole('button', { name: '← 返回' }));
  await sleep(400);
  await shot(page, '52-notice-after-leave.png');
  const after = await boxes(page);
  const item3Leave =
    !!after.banner &&
    !after.bannerOverlapsTopbar &&
    !after.bannerOverlapsHeading &&
    !after.bannerOverlapsBack &&
    after.heading &&
    !after.heading.hidden &&
    after.back &&
    !after.back.hidden;
  summary.item3_banner_after_leave = item3Leave ? 'PASS' : 'FAIL';
  summary.detail.noticeAfterLeave = after;
  log(
    '3 after leave overlaps ' +
      JSON.stringify({
        topbar: after.bannerOverlapsTopbar,
        heading: after.bannerOverlapsHeading,
        back: after.bannerOverlapsBack,
        banner: after.banner?.rect,
        topbarBox: after.topbar?.rect,
        headingBox: after.heading?.rect,
        backBox: after.back?.rect,
      }) +
      ' => ' +
      summary.item3_banner_after_leave,
  );

  const regression =
    summary.item1_page_switch === 'PASS' && summary.item3_viewports === 'PASS' ? 'PASS' : 'FAIL';
  summary.regression_shell = regression;

  const all = [
    summary.item1_page_switch,
    summary.item1_no_mixed_text,
    summary.item2_menu_open,
    summary.item3_banner_study,
    summary.item3_banner_after_leave,
    summary.item3_viewports,
  ].every((v) => v === 'PASS');
  summary.all = all ? 'PASS' : 'FAIL';
  log('ALL ' + summary.all);

  writeSummary();
  await browser.close();
}

main().catch((err) => {
  log('ERROR ' + err.stack);
  writeSummary();
  process.exitCode = 1;
});
