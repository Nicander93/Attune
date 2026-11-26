import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';

const worktree = 'D:/code/attune-ui-ux2';
const outDir = 'C:/Users/PC/AttuneSmoke/ux-2';
const evDir = path.join(worktree, 'docs/evidence/ux-2');
const wav = 'C:\\Users\\PC\\AttuneSmoke\\p3\\speech.wav';
const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';

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
  branch: 'feat/ux-2-study-declutter',
  when: new Date().toISOString(),
  all: 'FAIL',
  checks: {},
  detail: {},
  evidence_dir: 'docs/evidence/ux-2/',
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
  await page.screenshot({ path: dest, fullPage: false });
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

async function domClick(locator) {
  await locator.evaluate((el) => el.click());
}

async function clickBtn(page, re) {
  await page
    .getByRole('button', { name: re })
    .first()
    .evaluate((el) => el.click());
}

async function goHome(page) {
  const back = page.getByRole('button', { name: '返回' });
  if (await back.count()) await domClick(back.first());
  const home = page.getByRole('button', { name: '首页' });
  if (await home.count()) await domClick(home.first());
  await sleep(300);
}

async function setInnerSize(page, client, width, height) {
  const { windowId } = await client.send('Browser.getWindowForTarget');
  for (let i = 0; i < 6; i++) {
    const inner = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    }));
    const { bounds } = await client.send('Browser.getWindowBounds', { windowId });
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
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));
}

function idbEval(page, fn, arg) {
  return page.evaluate(fn, arg);
}

async function readStore(page, name) {
  return idbEval(
    page,
    async (storeName) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('attune', 3);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const rows = await new Promise((resolve, reject) => {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return rows;
    },
    name,
  );
}

async function putStore(page, name, rows) {
  await idbEval(
    page,
    async ({ storeName, rows }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('attune', 3);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        for (const row of rows) store.put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { storeName: name, rows },
  );
}

async function reloadApp(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);
}

function overlap(a, b) {
  if (!a || !b) return null;
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  if (width <= 1 || height <= 1) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

async function studyAudit(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        text: (el.innerText || '').trim().slice(0, 160),
        aria: el.getAttribute('aria-label') || el.getAttribute('title') || '',
        hidden:
          style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0,
        opacity: style.opacity,
        background: style.backgroundColor,
        rect: {
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
        },
      };
    };
    const menu = document.querySelector('.study__menu');
    const check = document.querySelector('[aria-label="核对答案"]');
    const count = document.querySelector('.study__count');
    const head = document.querySelector('.study__head');
    const status = document.querySelector('.study__status');
    const banner = document.querySelector('.banner, .shell-banner, [class*="banner"]');
    const topbar = document.querySelector('.topbar');
    const title = document.querySelector('.dictation__head h1');
    const heading = Array.from(document.querySelectorAll('h1')).map((el) =>
      (el.innerText || '').trim(),
    );
    const speedCycle = Array.from(document.querySelectorAll('[role="menuitem"]')).filter((el) =>
      /语速 ·/.test(el.textContent || ''),
    ).length;
    const speedSelect = document.querySelector(
      '.study__menu select[aria-label="播放速度"], select[aria-label="播放速度"]',
    );
    const focus = document.querySelector('.player--focus');
    const replay = document.querySelector('.player--focus .player__replay');
    const loop = document.querySelector('.player--focus .player__loop');
    const overlapOf = (a, b) => {
      if (!a || !b) return null;
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (width <= 1 || height <= 1) return null;
      return { width: Math.round(width), height: Math.round(height) };
    };
    return {
      menu: box(menu),
      check: box(check),
      count: box(count),
      head: box(head),
      status: box(status),
      banner: box(banner),
      topbar: box(topbar),
      title: box(title),
      headings: heading,
      speedCycle,
      speedSelect: box(speedSelect),
      focusText: (focus?.innerText || '').replace(/\s+/g, ' ').trim(),
      replay: box(replay),
      loop: box(loop),
      menuOverlapsCheck: overlapOf(box(menu)?.rect, box(check)?.rect),
      bannerOverlapsCount: overlapOf(box(banner)?.rect, box(count)?.rect),
      bannerOverlapsHead: overlapOf(box(banner)?.rect, box(head)?.rect),
      bannerOverlapsTopbar: overlapOf(box(banner)?.rect, box(topbar)?.rect),
      emptyRecent: (document.body.innerText || '').includes('暂无更多最近学习'),
      folderSelect: !!document.querySelector('select[aria-label="文件夹"]'),
    };
  });
}

async function enterStudy(page) {
  const start = page.getByRole('button', { name: /开始听写/ }).first();
  if (await start.count()) {
    await domClick(start);
    await sleep(600);
    if (await page.locator('.study__count').count()) return true;
  }
  return false;
}

async function importWav(page) {
  log('importing ' + wav);
  await goHome(page);
  await clickBtn(page, /导入素材/);
  await sleep(400);
  const choose = page.getByRole('button', { name: /选择文件/ }).first();
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
  return ready;
}

async function main() {
  if (!(await waitCdp())) throw new Error('CDP 9222 not up');
  const { browser, page, client } = await connectPage();
  let folderBackup = [];
  let materialBackup = [];
  let restored = false;
  const restore = async () => {
    if (restored) return;
    if (folderBackup.length || materialBackup.length) {
      if (materialBackup.length) await putStore(page, 'materials', materialBackup);
      if (folderBackup.length || true) await putStore(page, 'folders', folderBackup);
      restored = true;
      log('restored folders=' + folderBackup.length + ' materials=' + materialBackup.length);
    }
  };

  try {
    const size = await setInnerSize(page, client, 1024, 640);
    summary.detail.size = size;
    log('size ' + JSON.stringify(size));

    folderBackup = await readStore(page, 'folders');
    materialBackup = await readStore(page, 'materials');
    fs.writeFileSync(
      path.join(outDir, 'idb-backup-meta.json'),
      JSON.stringify(
        {
          folders: folderBackup,
          materials: materialBackup.map(({ audio, ...rest }) => rest),
        },
        null,
        2,
      ),
      'utf8',
    );
    log('backup folders=' + folderBackup.length + ' materials=' + materialBackup.length);

    await goHome(page);
    let primed = await enterStudy(page);
    if (!primed) {
      const ready = await importWav(page);
      if (ready) primed = await enterStudy(page);
    }
    if (!primed) {
      await shot(page, '40-study-failed.png');
      throw new Error('could not enter study');
    }
    await goHome(page);
    folderBackup = await readStore(page, 'folders');
    materialBackup = await readStore(page, 'materials');
    restored = false;
    fs.writeFileSync(
      path.join(outDir, 'idb-backup-meta.json'),
      JSON.stringify(
        {
          folders: folderBackup,
          materials: materialBackup.map(({ audio, ...rest }) => rest),
        },
        null,
        2,
      ),
      'utf8',
    );
    log('primed backup folders=' + folderBackup.length + ' materials=' + materialBackup.length);

    // Isolated home / library shots: one last-studied item, no user folders.
    const studied = [...materialBackup]
      .filter((row) => row.lastStudiedAt)
      .sort((a, b) => String(b.lastStudiedAt).localeCompare(String(a.lastStudiedAt)));
    const keepId = studied[0]?.id || materialBackup[0]?.id;
    const homeRows = materialBackup.map((row) => {
      if (row.id === keepId) return row;
      const next = { ...row };
      delete next.lastStudiedAt;
      return next;
    });
    await putStore(page, 'folders', []);
    await putStore(page, 'materials', homeRows);
    await reloadApp(page);
    await goHome(page);
    await sleep(400);
    await shot(page, '10-home-one-recent.png');
    const homeText = await page.evaluate(() => document.body.innerText);
    const emptyRecent = homeText.includes('暂无更多最近学习');
    const hasLast = /上次学习/.test(homeText);
    summary.checks.home_no_empty_recent = !emptyRecent ? 'PASS' : 'FAIL';
    summary.detail.home = { emptyRecent, hasLast, keepId };
    log(
      'home emptyRecent=' +
        emptyRecent +
        ' hasLast=' +
        hasLast +
        ' => ' +
        summary.checks.home_no_empty_recent,
    );

    await clickBtn(page, /^素材库$/);
    await sleep(400);
    await shot(page, '20-library-no-folders.png');
    const lib = await page.evaluate(() => ({
      folderSelect: !!document.querySelector('select[aria-label="文件夹"]'),
      newFolder: !!document.querySelector('[aria-label="新建文件夹"]'),
      text: document.body.innerText.slice(0, 400),
    }));
    summary.checks.library_folder_select_hidden = !lib.folderSelect ? 'PASS' : 'FAIL';
    summary.detail.library = lib;
    log(
      'library folderSelect=' +
        lib.folderSelect +
        ' newFolder=' +
        lib.newFolder +
        ' => ' +
        summary.checks.library_folder_select_hidden,
    );

    await restore();
    await reloadApp(page);

    await goHome(page);
    let inStudy = await enterStudy(page);
    if (!inStudy) {
      await shot(page, '40-study-reenter-failed.png');
      throw new Error('could not re-enter study');
    }

    await shot(page, '40-study-entered.png');
    const more = page.getByRole('button', { name: '更多', exact: true });
    await domClick(more);
    await sleep(350);
    await shot(page, '42-menu-open.png');
    const open = await studyAudit(page);
    summary.detail.menuOpen = open;
    const checkVisible = !!(
      open.check &&
      !open.check.hidden &&
      open.check.rect.top >= 0 &&
      open.check.rect.bottom <= size.innerHeight + 1
    );
    const oneSpeed = open.speedCycle === 0 && !!open.speedSelect;
    const replayIcon = !!(
      open.replay &&
      !open.replay.hidden &&
      open.replay.aria.includes('重听本句') &&
      !/重听本句/.test(open.focusText)
    );
    const oneIndex =
      !!open.count &&
      !open.title &&
      !open.headings.some((text) => /第\s*\d+\s*\/\s*\d+\s*句/.test(text));
    const menuOk = !!open.menu && !open.menuOverlapsCheck && checkVisible;
    summary.checks.one_speed_control = oneSpeed ? 'PASS' : 'FAIL';
    summary.checks.replay_icon = replayIcon ? 'PASS' : 'FAIL';
    summary.checks.one_sentence_index = oneIndex ? 'PASS' : 'FAIL';
    summary.checks.menu_keeps_check = menuOk ? 'PASS' : 'FAIL';
    log(
      'dictation speedCycle=' +
        open.speedCycle +
        ' select=' +
        !!open.speedSelect +
        ' replay=' +
        JSON.stringify(open.replay) +
        ' focusText=' +
        open.focusText +
        ' count=' +
        open.count?.text +
        ' headings=' +
        JSON.stringify(open.headings) +
        ' overlapCheck=' +
        JSON.stringify(open.menuOverlapsCheck) +
        ' checkVisible=' +
        checkVisible,
    );

    await clickBtn(page, /^听读$/);
    await sleep(400);
    await shot(page, '43-listen-read.png');
    const reading = await page.evaluate(() => ({
      listenWrite: !!Array.from(document.querySelectorAll('button')).some(
        (el) => el.textContent?.trim() === '听写',
      ),
      hasDiff: !!document.querySelector('.diff'),
    }));
    await clickBtn(page, /^听写$/);
    await sleep(400);
    await shot(page, '44-back-to-dictation.png');
    const backDictation = await page.locator('textarea, [aria-label$="听写"]').first().count();
    summary.checks.view_switch = reading.listenWrite && backDictation ? 'PASS' : 'FAIL';
    summary.detail.viewSwitch = { reading, backDictation };
    log('view switch => ' + summary.checks.view_switch);

    const field = page.getByLabel(/第 \d+ 句听写/).first();
    await field.click();
    await field.fill('hello');
    await field.press('Enter');
    await sleep(400);
    await shot(page, '45-checked.png');
    const checked = await page.locator('.diff').count();
    await field.press('Escape');
    await sleep(400);
    await shot(page, '46-esc-back-to-edit.png');
    const afterEsc = await page.evaluate(() => ({
      diff: !!document.querySelector('.diff'),
      field: !!document.querySelector('[aria-label$="听写"]'),
    }));
    summary.checks.esc_from_check =
      checked > 0 && !afterEsc.diff && afterEsc.field ? 'PASS' : 'FAIL';
    summary.detail.esc = { checked, afterEsc };
    log('esc => ' + summary.checks.esc_from_check);

    await domClick(more);
    await sleep(200);
    const shortcut = page.getByRole('menuitem', { name: '快捷键' });
    const midShot = shot(page, '50-notice-appearing.png');
    await shortcut.evaluate((el) => el.click());
    const mid = await page.evaluate(() => {
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
      return { menuPresent: !!menu, opacity: style?.opacity || null, mixedText: mixed };
    });
    await midShot;
    await sleep(400);
    await shot(page, '51-notice-study.png');
    const banner = await studyAudit(page);
    summary.detail.midClick = mid;
    summary.detail.banner = {
      banner: banner.banner,
      count: banner.count,
      head: banner.head,
      overlaps: {
        count: banner.bannerOverlapsCount,
        head: banner.bannerOverlapsHead,
        topbar: banner.bannerOverlapsTopbar,
      },
    };
    const noMixed = !mid.menuPresent && !mid.mixedText;
    const bannerClear =
      !banner.bannerOverlapsCount && !banner.bannerOverlapsHead && !banner.bannerOverlapsTopbar;
    summary.checks.no_mixed_text = noMixed ? 'PASS' : 'FAIL';
    summary.checks.banner_clear = bannerClear ? 'PASS' : 'FAIL';
    log('mid ' + JSON.stringify(mid) + ' banner ' + JSON.stringify(summary.detail.banner));

    const results = Object.values(summary.checks);
    summary.all = results.length && results.every((v) => v === 'PASS') ? 'PASS' : 'FAIL';
    log('ALL ' + summary.all);
    writeSummary();
  } catch (err) {
    log('ERROR ' + (err && err.stack ? err.stack : err));
    summary.all = 'FAIL';
    summary.detail.error = String(err);
    writeSummary();
    try {
      await restore();
      await reloadApp(page);
    } catch (restoreErr) {
      log('RESTORE FAILED ' + restoreErr);
    }
    throw err;
  }
  await restore();
  await browser.close().catch(() => {});
}

main().catch((err) => {
  console.error(err);
  writeSummary();
  process.exit(1);
});
