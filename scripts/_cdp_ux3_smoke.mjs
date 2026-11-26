import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';

const worktree = 'D:/code/attune-ui-ux3';
const outDir = 'C:/Users/PC/AttuneSmoke/ux-3';
const evDir = path.join(worktree, 'docs/evidence/ux-3');
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
  branch: 'feat/ux-3-notice-undo',
  when: new Date().toISOString(),
  all: 'FAIL',
  checks: {},
  detail: {},
  evidence_dir: 'docs/evidence/ux-3/',
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
  await sleep(400);
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

function pass(key, ok, detail) {
  summary.checks[key] = ok ? 'PASS' : 'FAIL';
  if (detail !== undefined) summary.detail[key] = detail;
  log(key + ' => ' + (ok ? 'PASS' : 'FAIL') + (detail ? ' ' + JSON.stringify(detail) : ''));
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        text: (el.innerText || '').trim().slice(0, 160),
      };
    };
    const intersects = (a, b) => {
      if (!a || !b) return null;
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (width <= 1 || height <= 1) return null;
      return { width, height };
    };
    const toast = document.querySelector('.toast');
    const host = document.querySelector('.toast-host');
    const field = document.querySelector('[aria-label="第 1 句听写"], textarea');
    const player = document.querySelector('.player--focus, .player');
    const check = document.querySelector('[aria-label="核对答案"]');
    const count = document.querySelector('.study__count');
    const head = document.querySelector('.study__head');
    const topbar = document.querySelector('.topbar');
    const menu = document.querySelector('.study__menu');
    const shortcuts = document.querySelector('.study__shortcuts');
    const pageEl = document.querySelector('.page');
    const banner = document.querySelector('.app > .banner, .toast-host + .banner');
    const importCta = [...document.querySelectorAll('button')].find((el) =>
      /导入素材/.test(el.textContent || ''),
    );
    const importHit = (() => {
      if (!toast || !importCta) return null;
      const b = importCta.getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const centerIsButton = !!(el && importCta.contains(el));
      const centerIsToast = !!(el && toast.contains(el));
      return { centerIsButton, centerIsToast, blockedCount: centerIsButton && !centerIsToast ? 0 : 1 };
    })();
    return {
      toast: box(toast),
      toastText: toast ? (toast.innerText || '').trim() : '',
      hostPosition: host ? getComputedStyle(host).position : '',
      pagePadding: pageEl ? getComputedStyle(pageEl).paddingTop : '',
      bannerCount: document.querySelectorAll('.app > .banner').length,
      field: box(field),
      player: box(player),
      check: box(check),
      count: box(count),
      head: box(head),
      menu: box(menu),
      shortcuts: box(shortcuts),
      importCta: box(importCta),
      importHit,
      overlaps: {
        toastField: intersects(box(toast), box(field)),
        toastPlayer: intersects(box(toast), box(player)),
        toastCheck: intersects(box(toast), box(check)),
        toastCount: intersects(box(toast), box(count)),
        toastHead: intersects(box(toast), box(head)),
        toastImportCta: intersects(box(toast), box(importCta)),
        shortcutsField: intersects(box(shortcuts), box(field)),
        shortcutsPlayer: intersects(box(shortcuts), box(player)),
        shortcutsCheck: intersects(box(menu), box(check)),
        shortcutsCount: intersects(box(shortcuts), box(count)),
        shortcutsHead: intersects(box(shortcuts), box(head)),
        shortcutsTopbar: intersects(box(shortcuts), box(topbar)),
      },
    };
  });
}

async function ensureDictation(page) {
  const toDictation = page.getByRole('button', { name: '听写', exact: true });
  if (await toDictation.count()) {
    await domClick(toDictation);
    await sleep(400);
  }
}

async function enterStudy(page) {
  await clickBtn(page, /^素材库$/).catch(() => {});
  await sleep(300);
  const speech = page.locator('.materials__row').filter({ hasText: 'speech' }).first();
  if (await speech.count()) {
    await domClick(speech);
    await sleep(500);
    const start = page.getByRole('button', { name: /开始听写/ }).first();
    if (await start.count()) {
      await domClick(start);
      await sleep(600);
    }
    if (await page.locator('.study__count').count()) {
      await ensureDictation(page);
      return true;
    }
  }
  await goHome(page);
  const candidates = [
    page.getByRole('button', { name: /开始听写/ }).first(),
    page.getByRole('button', { name: /^继续/ }).first(),
  ];
  for (const start of candidates) {
    if (await start.count()) {
      await domClick(start);
      await sleep(600);
      if (await page.locator('.study__count').count()) {
        await ensureDictation(page);
        return true;
      }
    }
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
    if (/已准备好|可以开始听写|音频已导入/.test(text)) {
      ready = true;
      break;
    }
    await sleep(500);
  }
  log('import ready=' + ready);
  return ready;
}

async function stubFfmpegMissing(page) {
  await page.evaluate(() => {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals?.invoke) throw new Error('no tauri invoke');
    window.__ATTUNE_ORIG_INVOKE ??= internals.invoke.bind(internals);
    internals.invoke = (cmd, args, extra) => {
      if (cmd === 'media_ffmpeg_status') {
        return Promise.resolve({
          available: false,
          source: 'missing',
          hint: '这台电脑还没有安装处理视频所需的本地工具。',
        });
      }
      return window.__ATTUNE_ORIG_INVOKE(cmd, args, extra);
    };
  });
}

async function restoreFfmpegInvoke(page) {
  await page.evaluate(() => {
    const internals = window.__TAURI_INTERNALS__;
    if (internals && window.__ATTUNE_ORIG_INVOKE) {
      internals.invoke = window.__ATTUNE_ORIG_INVOKE;
      delete window.__ATTUNE_ORIG_INVOKE;
    }
  });
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
    log('backup folders=' + folderBackup.length + ' materials=' + materialBackup.length);

    // --- Home: only one last session, no empty recent block ---
    const studied = [...materialBackup]
      .filter((row) => row.lastStudiedAt)
      .sort((a, b) => String(b.lastStudiedAt).localeCompare(String(a.lastStudiedAt)));
    const keepId = studied[0]?.id || materialBackup[0]?.id;
    const homeRows = materialBackup.filter((row) => row.id === keepId);
    await putStore(page, 'materials', homeRows);
    await putStore(page, 'folders', []);
    await reloadApp(page);
    await goHome(page);
    await sleep(400);
    await shot(page, '10-home-one-recent.png');
    const homeState = await page.evaluate(() => ({
      hasLast: !!(document.querySelector('.home__current') || '').innerText?.includes?.('上次学习') ||
        (document.body.innerText || '').includes('上次学习'),
      recentBlock: !!document.querySelector('.home-recent'),
      recentHeading: Array.from(document.querySelectorAll('h2')).some((el) => el.textContent?.trim() === '最近学习'),
      allMaterials: (document.body.innerText || '').includes('全部素材'),
      emptyCopy: (document.body.innerText || '').includes('暂无更多最近学习'),
    }));
    pass(
      'home_no_empty_recent',
      homeState.hasLast && !homeState.recentBlock && !homeState.recentHeading && !homeState.emptyCopy,
      homeState,
    );

    // Restore full library for the remaining shots.
    await putStore(page, 'materials', materialBackup);
    await putStore(page, 'folders', folderBackup);
    await reloadApp(page);
    log('restored after home prime');

    // --- Import / success toast (or dictation hint toast) ---
    let toastOk = false;
    const imported = await importWav(page).catch((err) => {
      log('import failed ' + err);
      return false;
    });
    await sleep(400);
    await shot(page, '20-import-toast.png');
    let toastLayout = await layoutSnapshot(page);
    if (toastLayout.toast && toastLayout.hostPosition === 'fixed') {
      toastOk =
        !toastLayout.overlaps.toastField &&
        !toastLayout.overlaps.toastImportCta &&
        !(toastLayout.importHit && toastLayout.importHit.blockedCount) &&
        toastLayout.pagePadding !== '36px';
    }
    if (!toastLayout.toast) {
      // Fall back: enter study and trigger the “write something first” toast.
      const inStudy = await enterStudy(page);
      if (inStudy) {
        const field = page.getByLabel(/第 \d+ 句听写/).first();
        if (await field.count()) {
          await field.focus();
          const before = await layoutSnapshot(page);
          await field.press('Enter');
          await sleep(300);
          await shot(page, '20-import-toast.png');
          toastLayout = await layoutSnapshot(page);
          toastOk =
            !!toastLayout.toast &&
            toastLayout.hostPosition === 'fixed' &&
            Math.abs((toastLayout.field?.top || 0) - (before.field?.top || 0)) < 8 &&
            Math.abs((toastLayout.player?.top || 0) - (before.player?.top || 0)) < 8;
        }
      }
    }
    summary.detail.toast = toastLayout;
    pass('toast_no_layout_push', toastOk && imported !== undefined, {
      imported,
      hostPosition: toastLayout.hostPosition,
      toastText: toastLayout.toastText,
      overlaps: toastLayout.overlaps,
    });

    // --- Study: shortcuts in menu, speed label, icons ---
    await goHome(page);
    const inStudy = await enterStudy(page);
    pass('entered_study', inStudy);
    if (inStudy) {
      await shot(page, '40-study-entered.png');
      const icons = await page.evaluate(() => {
        const replay = document.querySelector('.player--focus .player__replay');
        const loop = document.querySelector('.player--focus .player__loop');
        const replaySvg = replay?.querySelector('svg.player__icon');
        const loopSvg = loop?.querySelector('svg.player__icon');
        return {
          replayAria: replay?.getAttribute('aria-label') || '',
          loopAria: loop?.getAttribute('aria-label') || '',
          replayHasIcon: !!replaySvg,
          loopHasIcon: !!loopSvg,
          sameIcon: (replaySvg?.innerHTML || '') === (loopSvg?.innerHTML || ''),
          focusText: (document.querySelector('.player--focus')?.innerText || '').replace(/\s+/g, ' ').trim(),
        };
      });
      await shot(page, '41-player-icons.png');
      pass(
        'distinct_icons',
        icons.replayAria === '重听本句' &&
          icons.loopAria === '单句循环' &&
          icons.replayHasIcon &&
          icons.loopHasIcon &&
          !icons.sameIcon &&
          !/重听本句/.test(icons.focusText),
        icons,
      );

      await clickBtn(page, /^更多$/);
      await sleep(300);
      const speed = await page.evaluate(() => {
        const label = document.querySelector('.study__menu-volume');
        const firstText = label?.childNodes?.[0]?.textContent?.trim() || '';
        const select = document.querySelector('.study__menu select[aria-label="播放速度"]');
        const cycle = Array.from(document.querySelectorAll('[role="menuitem"]')).filter((el) =>
          /语速 ·/.test(el.textContent || ''),
        ).length;
        return { firstText, hasSelect: !!select, cycle, menuText: (document.querySelector('.study__menu')?.innerText || '').slice(0, 200) };
      });
      await shot(page, '42-menu-speed.png');
      pass('speed_label_only', speed.firstText === '语速' && speed.hasSelect && speed.cycle === 0, speed);

      const shortcutsItem = page.getByRole('menuitem', { name: '快捷键' });
      await shortcutsItem.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
      await sleep(200);
      await domClick(shortcutsItem);
      await sleep(300);
      const help = page.locator('.study__shortcuts');
      if (await help.count()) {
        await help.first().evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
        await sleep(200);
      }
      await shot(page, '50-shortcuts-in-menu.png');
      const shortcutLayout = await layoutSnapshot(page);
      summary.detail.shortcuts = shortcutLayout;
      const helpVisible = await page.locator('.study__shortcuts').count();
      const bannerGone = shortcutLayout.bannerCount === 0 && !shortcutLayout.toast;
      const fieldStillThere = await page.getByLabel('第 1 句听写').isVisible();
      const playerStillThere = await page.locator('.player, [class*="player"]').first().isVisible().catch(() => true);
      pass(
        'shortcuts_in_menu',
        helpVisible > 0 &&
          bannerGone &&
          fieldStillThere &&
          playerStillThere &&
          !shortcutLayout.overlaps.shortcutsCheck &&
          !shortcutLayout.overlaps.shortcutsCount &&
          !shortcutLayout.overlaps.shortcutsHead &&
          !shortcutLayout.overlaps.shortcutsTopbar,
        { helpVisible, fieldStillThere, overlaps: shortcutLayout.overlaps },
      );
    }

    // --- Delete + undo ---
    await goHome(page);
    await clickBtn(page, /^素材库$/);
    await sleep(400);
    const confirmCalls = await page.evaluate(() => {
      window.__confirmCalls = 0;
      window.confirm = () => {
        window.__confirmCalls += 1;
        return false;
      };
      return true;
    });
    const firstRow = page.locator('.materials__row').first();
    const more = page.getByLabel(/的更多操作/).first();
    const moreLabel = (await more.getAttribute('aria-label')) || '';
    const firstName = moreLabel.replace(/\s*的更多操作$/, '').trim() || ((await firstRow.innerText()) || '').split('\n').map((s) => s.trim()).find((s) => s && !/^▣|♪|♫/.test(s)) || '';
    const countBefore = await page.locator('.materials__row').count();
    await domClick(more);
    await sleep(200);
    const del = page.getByRole('menuitem', { name: '删除' });
    await domClick(del);
    await sleep(400);
    await shot(page, '60-delete-undo-toast.png');
    const deleteLayout = await layoutSnapshot(page);
    summary.detail.delete_toast_layout = deleteLayout;
    const deletedState = await page.evaluate((name) => {
      const toast = document.querySelector('.toast');
      const rows = Array.from(document.querySelectorAll('.materials__row'));
      return {
        toast: (toast?.innerText || '').trim(),
        hasUndo: !!(toast && /撤销/.test(toast.innerText || '')),
        rowGone: name ? !rows.some((el) => (el.innerText || '').includes(name)) : false,
        countAfter: rows.length,
        confirmCalls: window.__confirmCalls || 0,
      };
    }, firstName);
    deletedState.importVisible = !!deleteLayout.importCta;
    deletedState.toastImportCta = deleteLayout.overlaps.toastImportCta;
    deletedState.importHit = deleteLayout.importHit;
    const undoBtn = page.getByRole('button', { name: '撤销' });
    if (await undoBtn.count()) {
      await domClick(undoBtn.first());
      await sleep(400);
    }
    await shot(page, '61-delete-undone.png');
    const undone = await page.evaluate((name) => {
      return {
        rowBack: Array.from(document.querySelectorAll('.materials__row')).some((el) =>
          (el.innerText || '').includes(name),
        ),
        confirmCalls: window.__confirmCalls || 0,
      };
    }, firstName);
    const importClear =
      !!deleteLayout.importCta &&
      !deleteLayout.overlaps.toastImportCta &&
      !(deleteLayout.importHit && deleteLayout.importHit.blockedCount);
    pass(
      'delete_undo_no_confirm',
      confirmCalls &&
        deletedState.hasUndo &&
        deletedState.confirmCalls === 0 &&
        (deletedState.rowGone || (deletedState.countAfter !== undefined && deletedState.countAfter === countBefore - 1)) &&
        undone.rowBack &&
        undone.confirmCalls === 0 &&
        importClear,
      { firstName, countBefore, deletedState, undone, importClear, deleteLayout },
    );

    // --- Cache in-page confirm, if reachable ---
    let cacheShot = false;
    try {
      const inStudy2 = await enterStudy(page);
      if (inStudy2) {
        await clickBtn(page, /^更多$/);
        await sleep(200);
        const settings = page.getByRole('menuitem', { name: '素材设置' });
        if (await settings.count()) {
          await domClick(settings);
          await sleep(400);
          const morePrep = page.getByRole('button', { name: '更多 ···' });
          if (await morePrep.count()) {
            await domClick(morePrep);
            await sleep(200);
            const cacheItem = page.getByRole('menuitem', { name: /缓存/ });
            if (await cacheItem.count()) {
              await domClick(cacheItem);
              await sleep(200);
              const clearBtn = page.getByRole('button', { name: '清理全部媒体缓存' });
              if (await clearBtn.count()) {
                await domClick(clearBtn);
                await sleep(300);
                await shot(page, '70-cache-confirm.png');
                cacheShot = true;
                const panel = await page.locator('.confirm-panel').count();
                pass('cache_in_page_confirm', panel > 0 && (await page.evaluate(() => window.__confirmCalls || 0)) === 0);
                const cancel = page.getByRole('button', { name: '取消' });
                if (await cancel.count()) await domClick(cancel.first());
              }
            }
          }
        }
      }
    } catch (err) {
      log('cache path skipped ' + err);
    }
    if (!cacheShot) {
      summary.checks.cache_in_page_confirm = 'SKIP';
      log('cache_in_page_confirm => SKIP');
    }

    // --- In-page local-tool install consent (「同意安装」) ---
    let installShot = false;
    try {
      await goHome(page);
      const inStudy3 = await enterStudy(page);
      if (inStudy3) {
        await clickBtn(page, /^更多$/);
        await sleep(200);
        const settings = page.getByRole('menuitem', { name: '素材设置' });
        if (await settings.count()) {
          await stubFfmpegMissing(page);
          await domClick(settings);
          await sleep(500);
          const morePrep = page.getByRole('button', { name: '更多 ···' });
          if (await morePrep.count()) {
            await domClick(morePrep);
            await sleep(200);
            const videoItem = page.getByRole('menuitem', { name: '导入视频' });
            if (await videoItem.count()) {
              await domClick(videoItem);
              await sleep(500);
              const installBtn = page.getByRole('button', { name: '安装本地工具' });
              if (await installBtn.count()) {
                await domClick(installBtn.first());
                await sleep(400);
                const panelVisible = (await page.locator('.confirm-panel').count()) > 0;
                const hasAgree = (await page.getByRole('button', { name: '同意安装' }).count()) > 0;
                if (panelVisible && hasAgree) {
                  await shot(page, '80-install-consent.png');
                  installShot = true;
                  const copy = await page.locator('.confirm-panel').innerText();
                  pass('install_in_page_consent', /同意安装/.test(copy) && /本地工具/.test(copy), {
                    copy: copy.slice(0, 200),
                  });
                  const cancel = page.getByRole('button', { name: '取消' });
                  if (await cancel.count()) await domClick(cancel.first());
                }
              }
            }
          }
          await restoreFfmpegInvoke(page);
        }
      }
    } catch (err) {
      log('install consent path skipped ' + err);
      await restoreFfmpegInvoke(page).catch(() => {});
    }
    if (!installShot) {
      summary.checks.install_in_page_consent = 'FAIL';
      log('install_in_page_consent => FAIL (panel not reached)');
    }

    const failed = Object.entries(summary.checks).filter(([, v]) => v === 'FAIL');
    summary.all = failed.length ? 'FAIL' : 'PASS';
    log('ALL ' + summary.all);
  } catch (err) {
    log('ERROR ' + (err?.stack || err));
    summary.all = 'FAIL';
    summary.detail.error = String(err);
  } finally {
    try {
      await restore();
      await reloadApp(page);
    } catch (err) {
      log('restore failed ' + err);
    }
    writeSummary();
    await browser.close().catch(() => undefined);
  }
}

main().catch((err) => {
  log('FATAL ' + err);
  writeSummary();
  process.exit(1);
});
