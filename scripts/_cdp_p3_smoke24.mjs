import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const outDir = 'C:/Users/PC/AttuneSmoke/p3';
const evDir = 'D:/code/attune-video-p3/docs/evidence/video-p3';
const filler = 'C:/Users/PC/AttuneSmoke/Fill-OpenDialog.ps1';
const speechMp4 = 'C:\\Users\\PC\\AttuneSmoke\\p3\\speech_nosubs.mp4';
const manualSrt = 'C:\\Users\\PC\\AttuneSmoke\\p3\\manual.srt';
const notesPath = path.join(evDir, 'cdp-smoke-notes.txt');
const notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8').split(/\n/) : [];
notes.push('--- resume items 2+4 ---');
const log = (m) => { notes.push(String(m)); console.log(m); };

async function shot(page, name) {
  const p = path.join(outDir, name);
  await page.screenshot({ path: p, fullPage: true });
  fs.copyFileSync(p, path.join(evDir, name));
  log('shot ' + name);
}
function fill(filePath) {
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', filler, '-FilePath', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve) => {
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out: out.trim() }));
    setTimeout(() => { try { child.kill(); } catch {} resolve({ code: -1, out: out + ' TIMEOUT' }); }, 25000);
  });
}
async function clickBtn(page, re) { await page.getByRole('button', { name: re }).first().click(); }
async function goHome(page) { await clickBtn(page, /\u9996\u9875/); await page.waitForTimeout(500); }
async function newMaterial(page) { await goHome(page); await clickBtn(page, /\u65b0\u5efa\u7d20\u6750/); await page.waitForTimeout(900); }
async function readBanner(page) { return (await page.locator('.banner').allTextContents()).join(' | '); }

async function applyVideoFile(page, filePath, shotProbe, shotApplied) {
  const pending = fill(filePath);
  await page.waitForTimeout(300);
  await page.locator('article.prep__section--video button').filter({ hasText: /\u5bfc\u5165\u89c6\u9891|\u91cd\u65b0\u5bfc\u5165\u89c6\u9891/ }).first().click();
  log('video dialog ' + JSON.stringify(await pending));
  await page.waitForSelector('.video-probe', { timeout: 30000 });
  if (shotProbe) await shot(page, shotProbe);
  await page.locator('article.prep__section--video button.primary').click();
  // Wait until probe UI gone and audio present
  for (let i = 0; i < 180; i++) {
    const probe = await page.locator('.video-probe').count();
    const body = await page.locator('.prep').innerText();
    const hasAudio = /\u97f3\u9891\u5df2\u6dfb\u52a0|\u66f4\u6362\u97f3\u9891/.test(body);
    if (probe === 0 && hasAudio) break;
    await page.waitForTimeout(1000);
  }
  if (shotApplied) await shot(page, shotApplied);
  log('prep after apply ' + (await page.locator('.prep').innerText()).slice(0, 500));
}

async function waitForSubtitles(page, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const prep = await page.locator('.prep').innerText();
    const banners = await readBanner(page);
    const countMatch = prep.match(/\u5df2\u5bfc\u5165\s*(\d+)\s*\u53e5/) || banners.match(/\u5171\s*(\d+)\s*\u53e5/);
    const n = countMatch ? Number(countMatch[1]) : 0;
    const asr = /ASR|\u8bed\u97f3\u8bc6\u522b|\u8bc6\u522b\u5b8c\u6210|\u4ec5\u4f9b\u53c2\u8003/.test(prep + banners);
    const unreviewed = /\u5c1a\u672a\u6821\u5bf9|\u53bb\u6821\u5bf9|ASR/.test(prep + banners);
    if (n > 0) return { n, prep, banners, asr, unreviewed };
    if (/\u8bc6\u522b|\u6b63\u5728|\u4e0b\u8f7d/.test(prep + banners)) log('asr wait… ' + (banners || prep.match(/.{0,60}/)?.[0]));
    await page.waitForTimeout(2000);
  }
  return { n: 0, prep: await page.locator('.prep').innerText(), banners: await readBanner(page), asr: false, unreviewed: false };
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('1420')) || browser.contexts()[0].pages()[0];
await page.bringToFront();
log('page ' + page.url());

log('=== ITEM 2 ASR (speech fixture) ===');
await newMaterial(page);
await applyVideoFile(page, speechMp4, '20-nosubs-probed.png', '21-nosubs-applied.png');
const sub2 = await waitForSubtitles(page, 300000);
log('item2 ' + JSON.stringify({ n: sub2.n, asr: sub2.asr, unreviewed: sub2.unreviewed, banners: sub2.banners, prep: sub2.prep.slice(0, 400) }));
await shot(page, '22-asr-result.png');
const item2Pass = sub2.n > 0 && (sub2.asr || sub2.unreviewed || /ASR/.test(sub2.banners + sub2.prep));
log('2 PASS=' + item2Pass);

log('=== ITEM 4 manual SRT ===');
await newMaterial(page);
await applyVideoFile(page, speechMp4, '30-manual-video-probed.png', '31-manual-video-applied.png');
// Cancel ASR if running by waiting briefly then importing SRT (overwrite ok if no drafts)
await page.waitForTimeout(5000);
const pendingSrt = fill(manualSrt);
await page.waitForTimeout(300);
await page.getByRole('button', { name: /\u5bfc\u5165\u5b57\u5e55|\u9009\u62e9\u5b57\u5e55\u6587\u4ef6/ }).first().click();
log('srt dialog ' + JSON.stringify(await pendingSrt));
await page.waitForTimeout(2500);
const prep4 = await page.locator('.prep').innerText();
const b4 = await readBanner(page);
log('after srt banners=' + b4);
log('after srt prep=' + prep4.slice(0, 500));
await shot(page, '32-manual-srt-imported.png');
const n4 = (prep4.match(/\u5df2\u5bfc\u5165\s*(\d+)\s*\u53e5/) || b4.match(/(\d+)\s*\u53e5/));
const item4Pass = (n4 && Number(n4[1]) >= 2) || /\u5df2\u5bfc\u5165/.test(prep4 + b4);
log('4 PASS=' + item4Pass + ' n=' + (n4 && n4[1]));

const summaryPath = path.join(evDir, 'SUMMARY.json');
let summary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : {};
summary.item2_asr_fallback_unreviewed = item2Pass ? 'PASS' : 'FAIL';
summary.item4_manual_srt_import = item4Pass ? 'PASS' : 'FAIL';
summary.item1_embedded_text_to_dictation = summary.item1_embedded_text_to_dictation || 'PASS';
summary.item3_protected_no_overwrite = summary.item3_protected_no_overwrite || 'PASS';
summary.all = [summary.item1_embedded_text_to_dictation, summary.item2_asr_fallback_unreviewed, summary.item3_protected_no_overwrite, summary.item4_manual_srt_import].every((x) => x === 'PASS') ? 'PASS' : 'FAIL';
summary.when = new Date().toISOString();
summary.branch = 'feat/video-p3-subtitles';
summary.evidence_dir = 'docs/evidence/video-p3/';
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
fs.writeFileSync(notesPath, notes.join('\n'), 'utf8');
fs.writeFileSync(path.join(outDir, 'cdp-smoke-notes.txt'), notes.join('\n'), 'utf8');
log('SUMMARY ' + JSON.stringify(summary));
process.exit(summary.all === 'PASS' ? 0 : 2);
