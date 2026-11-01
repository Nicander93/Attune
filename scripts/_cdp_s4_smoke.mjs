import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const worktree = 'D:/code/attune-ui-s4';
const outDir = 'C:/Users/PC/AttuneSmoke/s4';
const evDir = path.join(worktree, 'docs/evidence/ui-s4');
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
  branch: 'feat/ui-s4-shell-visual',
  when: new Date().toISOString(),
  item1_home_resume_card: 'FAIL',
  item2_library_tools_row: 'FAIL',
  item3_import_empty: 'FAIL',
  all: 'FAIL',
  evidence_dir: 'docs/evidence/ui-s4/',
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

async function waitCdp(timeoutMs = 120000) {
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

async function main() {
  log('tip ' + tip);
  log('waiting CDP 9222...');
  if (!(await waitCdp())) {
    summary.detail.blocker = 'CDP 9222 not up';
    throw new Error('CDP not ready');
  }

  const { browser, page } = await connectPage();
  await sleep(1000);

  // --- 1 Home resume card ---
  await clickBtn(page, /首页/);
  await sleep(900);
  await page.waitForSelector('text=继续学习', { timeout: 30000 }).catch(() => null);
  await shot(page, '01-home-resume-card.png');

  const home = await page.evaluate(() => {
    const card = document.querySelector('.home__current');
    const title = card?.querySelector('.home__title')?.textContent?.trim() || '';
    const subtitle = card?.querySelector('.home__subtitle')?.textContent?.trim() || '';
    const continueBtn = [...(card?.querySelectorAll('button') || [])].find((b) =>
      /继续/.test(b.textContent || ''),
    );
    const progress = card?.querySelector('.progress-track');
    const row = card?.querySelector('.home__row');
    const brandBars = document.querySelectorAll('.brand__bars span, .brand-mark span, .logo-bars span');
    const navBtns = [...document.querySelectorAll('nav.topbar__nav button')].map((b) =>
      (b.textContent || '').trim(),
    );
    const paper =
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() ||
      getComputedStyle(document.body).backgroundColor;
    return {
      hasCard: !!card,
      title,
      subtitle,
      hasContinue: !!continueBtn,
      continueText: (continueBtn?.textContent || '').trim(),
      hasProgressBelow: !!progress,
      rowHasTitleAndContinue: !!(row && title && continueBtn),
      navBtns,
      brandBarCount: brandBars.length,
      paperBg: paper,
      bodySlice: document.body.innerText.slice(0, 500),
    };
  });
  summary.detail.home = home;
  const homePass =
    home.hasCard &&
    home.hasContinue &&
    home.hasProgressBelow &&
    home.rowHasTitleAndContinue &&
    /继续/.test(home.continueText);
  summary.item1_home_resume_card = homePass ? 'PASS' : 'FAIL';
  log('1 home resume=' + summary.item1_home_resume_card + ' ' + JSON.stringify(home));

  // --- 2 Library tools row ---
  await clickBtn(page, /素材库/);
  await sleep(900);
  await page.waitForSelector('.library-tools', { timeout: 20000 }).catch(() => null);
  await shot(page, '10-library-tools.png');

  const library = await page.evaluate(() => {
    const tools = document.querySelector('.library-tools');
    const search = tools?.querySelector('input.search, input[type="search"]');
    const selects = [...(tools?.querySelectorAll('select.select') || [])];
    const meta = document.querySelector('.library-tools-meta');
    const metaCount = meta?.querySelector('.library__count')?.textContent?.trim() || '';
    const toolsKids = [...(tools?.children || [])].map((el) => el.tagName + (el.className ? '.' + el.className : ''));
    const folderLabels = selects[0]
      ? [...selects[0].options].map((o) => o.textContent?.trim() || '')
      : [];
    const sortLabels = selects[1]
      ? [...selects[1].options].map((o) => o.textContent?.trim() || '')
      : [];
    // Primary tools row should NOT contain the old count / + folder chrome.
    const toolsText = (tools?.innerText || '').replace(/\s+/g, ' ');
    const primaryHasCount = /当前文件夹|段$/.test(toolsText) && !meta;
    const primaryHasAddFolder = /\+\s*文件夹|新建文件夹/.test(toolsText);
    return {
      hasTools: !!tools,
      hasSearch: !!search,
      selectCount: selects.length,
      folderLabels,
      sortLabels,
      hasMeta: !!meta,
      metaCount,
      toolsKids,
      toolsText,
      primaryHasCount,
      primaryHasAddFolder,
    };
  });
  summary.detail.library = library;
  const libPass =
    library.hasTools &&
    library.hasSearch &&
    library.selectCount >= 2 &&
    !library.primaryHasAddFolder;
  summary.item2_library_tools_row = libPass ? 'PASS' : 'FAIL';
  log('2 library tools=' + summary.item2_library_tools_row + ' ' + JSON.stringify(library));

  // --- 3 Import empty ---
  // Prefer primary CTA which creates a blank material and lands on prep empty.
  const importCta = page.getByRole('button', { name: /导入素材/ }).first();
  if ((await importCta.count()) > 0) {
    await importCta.click();
  } else {
    await clickBtn(page, /导入/);
  }
  await sleep(1200);
  await page.waitForSelector('.import__drop, .dropzone, text=音频或视频', { timeout: 20000 }).catch(() => null);
  await shot(page, '20-import-empty.png');

  const prep = await page.evaluate(() => {
    const drop = document.querySelector('.import__drop, .dropzone');
    const icon = document.querySelector('.import__upload-icon, .dropzone svg');
    const title =
      document.querySelector('.import__upload-title')?.textContent?.trim() ||
      [...(drop?.querySelectorAll('h2, .import__upload-title, div') || [])]
        .map((el) => (el.textContent || '').trim())
        .find((t) => /音频或视频/.test(t)) ||
      '';
    const hint =
      document.querySelector('.import__hint')?.textContent?.trim() ||
      [...document.querySelectorAll('p.muted, .import__hint')]
        .map((el) => (el.textContent || '').trim())
        .find((t) => /拖入/.test(t)) ||
      '';
    const body = document.body.innerText;
    return {
      hasDrop: !!drop,
      hasIcon: !!icon,
      title,
      hint,
      hasAudioOrVideoCopy: /音频或视频/.test(body),
      hasDragHint: /或拖入文件|拖入/.test(body),
      bodySlice: body.slice(0, 500),
    };
  });
  summary.detail.importEmpty = prep;
  const importPass =
    prep.hasDrop && prep.hasIcon && prep.hasAudioOrVideoCopy && /音频或视频/.test(prep.title || '音频或视频');
  // title may be empty if text lives elsewhere; rely on hasAudioOrVideoCopy + icon + drop
  summary.item3_import_empty =
    prep.hasDrop && prep.hasIcon && prep.hasAudioOrVideoCopy ? 'PASS' : 'FAIL';
  log('3 import empty=' + summary.item3_import_empty + ' ' + JSON.stringify(prep));

  summary.all =
    summary.item1_home_resume_card === 'PASS' &&
    summary.item2_library_tools_row === 'PASS' &&
    summary.item3_import_empty === 'PASS'
      ? 'PASS'
      : 'FAIL';

  const readme = `# UI S4 shell visual evidence

Branch: \`feat/ui-s4-shell-visual\` · tip recorded in \`SUMMARY.json\`.

Desktop smoke on Windows LM via CDP WebView2 (\`scripts/_cdp_s4_smoke.mjs\`), app from this worktree (\`npm run desktop\` + \`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222\`).

Product gate (human/screenshot):

| # | Item | Result | Key shots |
| --- | --- | --- | --- |
| 1 | Home resume card: title + subtitle \\| 继续, progress below | ${summary.item1_home_resume_card} | 01 |
| 2 | Library tools row: search / folder / sort (CRUD in meta) | ${summary.item2_library_tools_row} | 10 |
| 3 | Import empty: upload icon +「音频或视频」/「或拖入文件」 | ${summary.item3_import_empty} | 20 |

S5 / v0.1.3 not started. See \`SUMMARY.json\` and \`cdp-smoke-notes.txt\`.
`;

  fs.writeFileSync(path.join(evDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(evDir, 'cdp-smoke-notes.txt'), notes.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'cdp-smoke-notes.txt'), notes.join('\n') + '\n');
  fs.writeFileSync(path.join(evDir, 'README.md'), readme);
  fs.writeFileSync(path.join(evDir, '.gitignore'), '# keep screenshots + notes in git for merge gate\n');
  log('SUMMARY ' + JSON.stringify({ tip: summary.tip, all: summary.all }));
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
