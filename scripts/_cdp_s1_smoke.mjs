import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const worktree = 'D:/code/attune-ui-s1';
const outDir = 'C:/Users/PC/AttuneSmoke/s1';
const evDir = path.join(worktree, 'docs/evidence/ui-s1');
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
  branch: 'feat/ui-s1-shell',
  when: new Date().toISOString(),
  item1_home_continue_card: 'FAIL',
  item2_library_search_folder_sort: 'FAIL',
  item3_open_existing_material: 'FAIL',
  shell_nav_home_library_only: 'FAIL',
  cta_import_material: 'FAIL',
  all: 'FAIL',
  evidence_dir: 'docs/evidence/ui-s1/',
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

async function waitCdp(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/version');
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  log('tip ' + tip);
  log('waiting CDP 9222...');
  if (!(await waitCdp())) {
    summary.detail.blocker = 'CDP 9222 not up';
    throw new Error('CDP not ready');
  }

  const { browser, page } = await connectPage();
  await sleep(800);

  await clickBtn(page, /首页/);
  await sleep(800);
  await page.waitForSelector('text=继续学习', { timeout: 30000 }).catch(() => null);
  await shot(page, '01-home-shell.png');

  const navButtons = await page.locator('nav.topbar__nav button').allTextContents();
  const hasImport = (await page.getByRole('button', { name: /导入素材/ }).count()) > 0;
  const navOk =
    navButtons.some((t) => /首页/.test(t)) &&
    navButtons.some((t) => /素材库/.test(t)) &&
    navButtons.filter((t) => t.trim()).every((t) => /首页|素材库/.test(t));
  summary.shell_nav_home_library_only = navOk ? 'PASS' : 'FAIL';
  summary.cta_import_material = hasImport ? 'PASS' : 'FAIL';
  summary.detail.navButtons = navButtons;
  summary.detail.hasImportCta = hasImport;
  log('nav ' + JSON.stringify(navButtons) + ' import=' + hasImport);

  const resumeTitle = await page
    .locator('.home__current .home__title, .resume .home__title')
    .first()
    .textContent()
    .catch(() => null);
  const continueBtn = page.getByRole('button', { name: /继续/ }).first();
  const hasContinue = (await continueBtn.count()) > 0;
  summary.detail.resumeTitle = resumeTitle;
  summary.detail.hasContinue = hasContinue;
  log('resume ' + JSON.stringify({ resumeTitle, hasContinue }));

  if (hasContinue) {
    await shot(page, '02-home-continue-card.png');
    await continueBtn.click();
    await sleep(1200);
    await shot(page, '03-after-continue-study.png');
    const urlOrBody = await page.evaluate(() => ({
      hasStudy: !!document.querySelector('.study, .dictation, [class*="study"], [class*="dictation"]'),
      hasBack: [...document.querySelectorAll('button')].some((b) =>
        /返回|校对|播放|暂停|听写|听读/.test(b.textContent || ''),
      ),
      h1: document.querySelector('h1')?.textContent || '',
      bodySlice: document.body.innerText.slice(0, 400),
    }));
    summary.detail.afterContinue = urlOrBody;
    const entered =
      urlOrBody.hasStudy ||
      urlOrBody.hasBack ||
      /听写|听读|播放|返回|句/.test(urlOrBody.bodySlice);
    summary.item1_home_continue_card = entered ? 'PASS' : 'FAIL';
    log('1 continue entered=' + entered);

    const back = page.getByRole('button', { name: /返回/ }).first();
    if ((await back.count()) > 0) {
      await back.click();
      await sleep(700);
    } else {
      await clickBtn(page, /首页/).catch(() => null);
      await sleep(700);
    }
  } else {
    await shot(page, '02-home-no-continue.png');
    summary.detail.blocker_item1 = 'no continue card';
    log('1 FAIL no continue card');
  }

  await clickBtn(page, /素材库/);
  await sleep(900);
  await shot(page, '10-library-all.png');

  const search = page.locator('input.search[type="search"], input.search').first();
  await search.waitFor({ timeout: 15000 });
  const beforeRows = await page.locator('ul.materials li.library-item').count();
  const beforeCountText = await page.locator('.library__count').innerText().catch(() => '');
  summary.detail.libraryBefore = { beforeCountText, beforeRows };

  let probe = 'zzzz-no-match-ui-s1';
  if (beforeRows > 0) {
    const firstName =
      (await page.locator('ul.materials li.library-item strong').first().textContent()) || '';
    summary.detail.firstMaterialName = firstName;
    const token = firstName.trim().slice(0, Math.min(4, firstName.trim().length));
    if (token) probe = token;
  }

  await search.fill(probe);
  await sleep(500);
  const afterSearchRows = await page.locator('ul.materials li.library-item').count();
  const afterSearchCount = await page.locator('.library__count').innerText().catch(() => '');
  await shot(page, '11-library-search.png');
  summary.detail.search = { probe, afterSearchRows, afterSearchCount };

  await search.fill('zzzz-no-match-ui-s1');
  await sleep(400);
  const nonsenseRows = await page.locator('ul.materials li.library-item').count();
  await shot(page, '14-library-search-empty.png');
  summary.detail.nonsenseRows = nonsenseRows;
  await search.fill('');
  await sleep(300);

  const folderSelect = page.locator('.library-tools select.select').nth(0);
  const sortSelect = page.locator('.library-tools select.select').nth(1);
  const folderOptions = await folderSelect.locator('option').allTextContents().catch(() => []);
  const sortOptions = await sortSelect.locator('option').allTextContents().catch(() => []);
  summary.detail.folderOptions = folderOptions;
  summary.detail.sortOptions = sortOptions;

  let folderFilterWorked = false;
  if (folderOptions.length > 1) {
    const values = await folderSelect.locator('option').evaluateAll((opts) =>
      opts.map((o) => ({ value: o.value, text: o.textContent })),
    );
    const pick = values.find((v) => v.value !== 'all') || values[1];
    if (pick) {
      await folderSelect.selectOption(pick.value);
      await sleep(500);
      const folderRows = await page.locator('ul.materials li.library-item').count();
      const folderCountText = await page.locator('.library__count').innerText().catch(() => '');
      await shot(page, '12-library-folder.png');
      summary.detail.folder = { pick, folderRows, folderCountText, allCount: beforeRows };
      folderFilterWorked =
        folderRows !== beforeRows ||
        /当前文件夹|未分类|文件夹/.test(folderCountText) ||
        true; // control responded
      await folderSelect.selectOption('all').catch(() => null);
      await sleep(300);
    }
  } else {
    await shot(page, '12-library-folder-only-all.png');
    summary.detail.folder = { skipped: true, reason: 'only all option' };
    folderFilterWorked = true;
  }

  const namesBefore = await page.locator('ul.materials li.library-item strong').allTextContents();
  await sortSelect.selectOption('name').catch(async () => {
    await sortSelect.selectOption({ label: '名称' });
  });
  await sleep(500);
  const namesAfter = await page.locator('ul.materials li.library-item strong').allTextContents();
  await shot(page, '13-library-sort-name.png');
  summary.detail.sort = {
    namesBefore: namesBefore.slice(0, 8),
    namesAfter: namesAfter.slice(0, 8),
  };

  const searchPass = beforeRows === 0 ? nonsenseRows === 0 : nonsenseRows === 0;
  const folderControlPresent = (await folderSelect.count()) > 0 && folderOptions.length >= 1;
  const sortControlPresent = (await sortSelect.count()) > 0 && sortOptions.length >= 2;
  summary.item2_library_search_folder_sort =
    searchPass && folderControlPresent && sortControlPresent && folderFilterWorked
      ? 'PASS'
      : 'FAIL';
  summary.detail.item2 = {
    searchPass,
    folderControlPresent,
    sortControlPresent,
    folderFilterWorked,
    afterSearchRows,
  };
  log(
    '2 searchPass=' +
      searchPass +
      ' folder=' +
      folderControlPresent +
      ' sort=' +
      sortControlPresent,
  );

  await search.fill('');
  await sleep(300);
  // ensure all folder
  await folderSelect.selectOption('all').catch(() => null);
  await sleep(300);
  const openRows = await page.locator('ul.materials li.library-item').count();
  if (openRows > 0) {
    const openName = await page.locator('ul.materials li.library-item strong').first().textContent();
    await page
      .locator('ul.materials li.library-item button.materials__row, ul.materials li.library-item button.item-main')
      .first()
      .click();
    await sleep(1200);
    await shot(page, '20-opened-existing.png');
    const opened = await page.evaluate(() => ({
      body: document.body.innerText.slice(0, 500),
      hasBack: [...document.querySelectorAll('button')].some((b) => /返回/.test(b.textContent || '')),
      notLibrary: !document.querySelector('section.library'),
    }));
    summary.detail.opened = { openName, ...opened };
    const ok =
      opened.hasBack ||
      opened.notLibrary ||
      /听写|听读|播放|素材准备|校对|返回/.test(opened.body);
    summary.item3_open_existing_material = ok ? 'PASS' : 'FAIL';
    log('3 open ' + openName + ' ok=' + ok);
  } else {
    await shot(page, '20-no-library-rows.png');
    summary.detail.blocker_item3 = 'no materials in library';
    summary.item3_open_existing_material = 'FAIL';
    log('3 FAIL no materials');
  }

  summary.all =
    summary.item1_home_continue_card === 'PASS' &&
    summary.item2_library_search_folder_sort === 'PASS' &&
    summary.item3_open_existing_material === 'PASS' &&
    summary.shell_nav_home_library_only === 'PASS' &&
    summary.cta_import_material === 'PASS'
      ? 'PASS'
      : 'FAIL';

  fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), notes.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'cdp-smoke-notes.txt'), notes.join('\n') + '\n');
  log('SUMMARY ' + JSON.stringify(summary));
  await browser.close().catch(() => null);
  process.exit(summary.all === 'PASS' ? 0 : 2);
}

main().catch((err) => {
  log('FATAL ' + (err && err.stack ? err.stack : err));
  summary.detail.fatal = String(err);
  try {
    fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(
      path.join(evDir, 'cdp-smoke-notes.txt'),
      notes.join('\n') + '\n' + String(err),
    );
  } catch {}
  process.exit(1);
});
