import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, spawn } from 'node:child_process';

const worktree = 'D:/code/attune-ui-mot2';
const outDir = 'C:/Users/PC/AttuneSmoke/mot-2';
const evDir = path.join(worktree, 'docs/evidence/mot-2');
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
  branch: 'feat/mot-2-study-motion',
  when: new Date().toISOString(),
  all: 'FAIL',
  checks: {},
  detail: {},
  evidence_dir: 'docs/evidence/mot-2/',
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

async function readStore(page, name) {
  return page.evaluate(async (storeName) => {
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
  }, name);
}

function pass(key, ok, detail) {
  summary.checks[key] = ok ? 'PASS' : 'FAIL';
  if (detail !== undefined) summary.detail[key] = detail;
  log(key + ' => ' + (ok ? 'PASS' : 'FAIL') + (detail ? ' ' + JSON.stringify(detail) : ''));
}

async function visualAudit(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return null;
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 80),
      };
    };
    const intersects = (a, b) => {
      if (!a || !b) return null;
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (width <= 1 || height <= 1) return null;
      return { width, height };
    };
    const inWindow = (b) => !!b && b.top >= -1 && b.bottom <= window.innerHeight + 1 && b.left >= -1;
    const head = box(document.querySelector('.study__head'));
    const count = box(document.querySelector('.study__count'));
    const player = box(document.querySelector('.player--focus, .player'));
    const field = box(document.querySelector('.flow'));
    const diff = box(document.querySelector('.diff'));
    const actions = box(document.querySelector('.dictation__actions'));
    const next = box(
      [...document.querySelectorAll('button')].find((el) => /下一句|核对答案|修改/.test(el.textContent || '')),
    );
    const toggle = box(
      [...document.querySelectorAll('button')].find((el) => /显示画面|收起画面/.test(el.textContent || '')),
    );
    const picture = box(document.querySelector('.media-output:not(.media-output--hidden)'));
    const problems = [];
    if (head && !inWindow(head)) problems.push('head_clipped');
    if (count && !inWindow(count)) problems.push('count_clipped');
    if (player && !inWindow(player)) problems.push('player_clipped');
    if (actions && !inWindow(actions)) problems.push('actions_clipped');
    if (next && !inWindow(next)) problems.push('primary_clipped');
    if (toggle && !inWindow(toggle)) problems.push('toggle_clipped');
    const overlapCount = intersects(count, picture) || intersects(count, diff);
    if (overlapCount) problems.push('count_covered');
    if (intersects(head, picture)) problems.push('head_covered');
    const typeEls = [
      document.querySelector('.study__file'),
      document.querySelector('.diff__text'),
      document.querySelector('.flow__input'),
    ];
    for (const el of typeEls) {
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      const color = style.color;
      if (size < 11) problems.push('type_too_small:' + (el.className || el.tagName));
      if (color === 'transparent' || style.opacity === '0') problems.push('type_invisible:' + el.className);
    }
    return {
      inner: { w: window.innerWidth, h: window.innerHeight },
      head,
      count,
      player,
      field,
      diff,
      actions,
      next,
      toggle,
      picture,
      pictureMotion: document.querySelector('.media-output')?.getAttribute('data-motion') || null,
      diffMotion: document.querySelector('.diff')?.getAttribute('data-motion') || null,
      problems,
    };
  });
}


async function resultFirstScreen(page) {
  return page.evaluate(() => {
    const visibleIn = (el, box, firstLine = false) => {
      if (!(el instanceof HTMLElement) || !(box instanceof HTMLElement)) return false;
      const r = firstLine ? el.getClientRects()[0] || el.getBoundingClientRect() : el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return (
        r.top >= b.top - 1 &&
        r.bottom <= b.bottom + 1 &&
        r.top >= -1 &&
        r.bottom <= window.innerHeight + 1 &&
        r.height > 8
      );
    };
    const diff = document.querySelector('.diff');
    const picture = document.querySelector('.media-output:not(.media-output--hidden)');
    if (!(diff instanceof HTMLElement)) {
      return { present: false, pictureHeight: picture?.getBoundingClientRect().height ?? 0 };
    }
    return {
      present: true,
      height: diff.getBoundingClientRect().height,
      clientHeight: diff.clientHeight,
      scrollOverflow: diff.scrollHeight - diff.clientHeight,
      titleVisible: visibleIn(diff.querySelector('.caption'), diff),
      comparisonVisible: visibleIn(diff.querySelector('.diff__text'), diff),
      explanationLineVisible: visibleIn(diff.querySelector('p.muted'), diff, true),
      pictureHeight: picture?.getBoundingClientRect().height ?? 0,
    };
  });
}

async function importWav(page) {
  log('importing ' + wav);
  await goHome(page);
  await clickBtn(page, /导入素材/);
  await sleep(400);
  const pending = new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-File', filler, wav], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out: out.trim() }));
  });
  await sleep(400);
  await clickBtn(page, /选择文件/);
  const pick = await pending;
  log('import dialog ' + JSON.stringify(pick));
  let ready = false;
  for (let i = 0; i < 40; i++) {
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

async function openRow(page, nameRe) {
  await goHome(page);
  await clickBtn(page, /^素材库$/).catch(() => {});
  await sleep(400);
  const row = page.locator('.materials__row').filter({ hasText: nameRe }).first();
  if (!(await row.count())) return false;
  await domClick(row);
  await sleep(500);
  const start = page.getByRole('button', { name: /开始听写/ }).first();
  if (await start.count()) {
    await domClick(start);
    await sleep(600);
  }
  if (await page.locator('.study__count').count()) {
    const toDictation = page.getByRole('button', { name: '听写', exact: true });
    if (await toDictation.count()) {
      await domClick(toDictation);
      await sleep(300);
    }
    return true;
  }
  return false;
}

async function referenceFor(page, nameRe) {
  const rows = await readStore(page, 'materials');
  const row = rows.find((item) => nameRe.test(item.displayName || item.originalFileName || ''));
  const text = row?.segments?.[0]?.reference?.trim() || '';
  log('reference for ' + nameRe + ' = ' + JSON.stringify(text).slice(0, 120));
  return text;
}

async function typeAndCheck(page, text) {
  const field = page.getByLabel(/第 \d+ 句听写/).first();
  await field.click();
  await field.fill('');
  await field.pressSequentially(text, { delay: 15 });
  await field.press('Enter');
  await expectVisible(page, '.diff');
  return field;
}

async function expectVisible(page, selector, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const visible = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!(el instanceof HTMLElement)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0';
    }, selector);
    if (visible) return true;
    await sleep(50);
  }
  throw new Error('not visible: ' + selector);
}

async function main() {
  if (!(await waitCdp())) throw new Error('CDP 9222 not up');
  const { browser, page, client } = await connectPage();
  try {
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: '' }],
    }).catch(() => {});
    const size = await setInnerSize(page, client, 1180, 800);
    summary.detail.size = size;
    log('size ' + JSON.stringify(size));
    await goHome(page);

    let opened = await openRow(page, /speech/);
    if (!opened) {
      const imported = await importWav(page);
      if (imported) {
        const start = page.getByRole('button', { name: /开始听写/ }).first();
        if (await start.count()) {
          await start.click({ timeout: 5000 }).catch(() => domClick(start));
          await sleep(800);
        }
        opened = !!(await page.locator('.study__count').count());
      }
    }
    pass('enter_study', opened, { opened });
    if (!opened) throw new Error('could not open a study session');

    const countBtn = page.locator('.study__count');
    if (await countBtn.count()) {
      await domClick(countBtn);
      await sleep(200);
      const first = page.getByRole('option').first();
      if (await first.count()) {
        await domClick(first);
        await sleep(300);
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
    }

    const reference = (await referenceFor(page, /speech/)) || 'Hello world';
    const field = await typeAndCheck(page, reference);
    await page.locator('.diff').waitFor({ state: 'visible' });
    // Wait until enter settles so the mid-shot is not a fully transparent frame.
    await sleep(40);
    await shot(page, '10-check-appearing.png');
    await sleep(200);
    await shot(page, '11-check-result.png');
    const checkAudit = await visualAudit(page);
    const nearField = await page.evaluate(() => {
      const fieldBox = document.querySelector('.flow')?.getBoundingClientRect();
      const diffBox = document.querySelector('.diff')?.getBoundingClientRect();
      if (!fieldBox || !diffBox) return null;
      return { gap: diffBox.top - fieldBox.bottom, below: diffBox.top >= fieldBox.top };
    });
    pass(
      'check_appears_near_field',
      !!(nearField && nearField.below && nearField.gap < 48 && nearField.gap >= -2) &&
        checkAudit.problems.length === 0,
      { nearField, problems: checkAudit.problems, audit: checkAudit },
    );

    await field.press('Escape');
    await sleep(40);
    await shot(page, '12-esc-retracting.png');
    await page.locator('.diff').waitFor({ state: 'detached', timeout: 2000 });
    await shot(page, '13-esc-edited.png');
    const retracted = (await page.locator('.diff').count()) === 0;
    pass('esc_retracts', retracted);

    await field.press('Enter');
    await expectVisible(page, '.diff');
    await sleep(220);
    await shot(page, '14-check-again.png');

    const swap = await page.evaluate(async () => {
      const dictation = document.querySelector('.dictation');
      const pageView = document.querySelector('.page__view');
      const head = document.querySelector('.study__head');
      const player = document.querySelector('.player');
      const headTop = head?.getBoundingClientRect().top ?? 0;
      const playerTop = player?.getBoundingClientRect().top ?? 0;
      const opacities = [];
      const runningPageIn = () =>
        (pageView?.getAnimations() ?? []).some(
          (animation) =>
            animation instanceof CSSAnimation &&
            animation.animationName === 'motion-page-in' &&
            animation.playState === 'running',
        );
      const before = runningPageIn();
      const next = [...document.querySelectorAll('button')].find((el) => /下一句/.test(el.textContent || ''));
      next?.click();
      let mid = null;
      const started = performance.now();
      while (performance.now() - started < 220) {
        const anim = dictation?.getAnimations()?.[0];
        if (anim && (anim.playState === 'running' || anim.playState === 'pending')) {
          // Hold a real in-flight frame near the 0.55 start keyframe so the
          // screenshot is the mid-change, not the finished after-state.
          try {
            anim.currentTime = 8;
            anim.pause();
          } catch {}
          mid = {
            opacity: dictation ? Number(getComputedStyle(dictation).opacity) : 1,
            playState: anim.playState,
            currentTime: anim.currentTime,
            headDelta: (head?.getBoundingClientRect().top ?? 0) - headTop,
            playerDelta: (player?.getBoundingClientRect().top ?? 0) - playerTop,
          };
          break;
        }
        if (dictation) opacities.push(Number(getComputedStyle(dictation).opacity));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return {
        minOpacity: mid ? mid.opacity : opacities.length ? Math.min(...opacities) : 1,
        before,
        after: runningPageIn(),
        sentence: document.querySelector('.study__count')?.textContent,
        mid,
      };
    });
    await shot(page, '20-next-sentence.png');
    await page.evaluate(() => {
      const dictation = document.querySelector('.dictation');
      for (const animation of dictation?.getAnimations() ?? []) {
        try {
          animation.finish();
        } catch {
          animation.cancel();
        }
      }
    });
    const midOk = swap.mid
      ? swap.mid.opacity >= 0.5 &&
        swap.mid.opacity < 0.95 &&
        Math.abs(swap.mid.headDelta) < 2 &&
        Math.abs(swap.mid.playerDelta) < 2
      : swap.minOpacity > 0.4 && swap.minOpacity < 0.95;
    pass(
      'sentence_change_no_flash',
      midOk && swap.after === false && /02|2 \//.test(swap.sentence || ''),
      swap,
    );

    await clickBtn(page, /^听读$/);
    await sleep(400);
    await shot(page, '30-reading.png');
    const reading = await page.locator('.reading').count();
    pass('reading_mode', reading > 0, { reading });

    // Video material: show / hide / interrupt, plus narrow and wide frames.
    await goHome(page);
    const videoOpened = await openRow(page, /h264_aac_subs/);
    pass('open_video_material', videoOpened);
    if (videoOpened) {
      const videoRef = (await referenceFor(page, /h264_aac_subs/)) || reference;
      const videoField = page.getByLabel(/第 \d+ 句听写/).first();
      if (await videoField.count()) {
        await videoField.click();
        await videoField.fill('');
        await videoField.pressSequentially(videoRef, { delay: 15 });
        await videoField.press('Enter');
        await expectVisible(page, '.diff');
        await sleep(200);
      }
      const show = page.getByRole('button', { name: '显示画面' });
      const hasToggle = (await show.count()) > 0;
      pass('video_toggle_present', hasToggle);
      if (hasToggle) {
        await shot(page, '40-video-before-show.png');
        await domClick(show);
        await sleep(60);
        await shot(page, '41-video-showing-mid.png');
        await sleep(200);
        await shot(page, '42-video-shown.png');
        const shownAudit = await visualAudit(page);
        const shownOk =
          shownAudit.problems.filter((p) => /clipped|covered/.test(p)).length === 0 &&
          (shownAudit.pictureMotion === 'entered' || shownAudit.pictureMotion === 'entering');
        pass('video_show_controls_in_window', shownOk, shownAudit);

        // Interrupt mid-hide then mid-show.
        await clickBtn(page, /收起画面/);
        await sleep(50);
        await shot(page, '43-video-hide-interrupt.png');
        await clickBtn(page, /显示画面/);
        await sleep(220);
        await shot(page, '44-video-interrupt-shown.png');
        const interrupted = await page.evaluate(() => ({
          motion: document.querySelector('.media-output')?.getAttribute('data-motion'),
          hidden: document.querySelector('.media-output')?.classList.contains('media-output--hidden'),
          label: [...document.querySelectorAll('button')].find((el) => /画面/.test(el.textContent || ''))
            ?.textContent,
        }));
        pass(
          'video_interruptible',
          interrupted.motion === 'entered' && !interrupted.hidden && /收起画面/.test(interrupted.label || ''),
          interrupted,
        );

        await clickBtn(page, /收起画面/);
        await sleep(250);
        await shot(page, '45-video-hidden.png');

        for (const vp of [
          { id: 'narrow', width: 1024, height: 640 },
          { id: 'wide', width: 1440, height: 900 },
        ]) {
          const measured = await setInnerSize(page, client, vp.width, vp.height);
          await sleep(200);
          const reopen = page.getByRole('button', { name: '显示画面' });
          if (await reopen.count()) await domClick(reopen);
          await sleep(250);
          await shot(page, `50-${vp.id}-video-shown.png`);
          const audit = await visualAudit(page);
          const readable = await resultFirstScreen(page);
          const controlsOk =
            audit.problems.filter((p) => /clipped|covered/.test(p)).length === 0 &&
            audit.actions &&
            audit.actions.bottom <= audit.inner.h + 1 &&
            audit.toggle &&
            audit.toggle.bottom <= audit.inner.h + 1;
          const resultOk =
            readable.present &&
            readable.titleVisible &&
            readable.comparisonVisible &&
            readable.explanationLineVisible &&
            (vp.id !== 'wide' || readable.scrollOverflow <= 2);
          pass(`video_${vp.id}_controls`, controlsOk, { measured, audit });
          pass(`video_${vp.id}_result_readable`, resultOk, readable);
          await clickBtn(page, /收起画面/).catch(() => {});
          await sleep(200);
        }
      }
    }

    // Reduced motion: instant check and retract.
    await setInnerSize(page, client, 1180, 800);
    await goHome(page);
    const reducedOpen = (await openRow(page, /speech/)) || (await openRow(page, /h264_aac_subs/));
    if (reducedOpen) {
      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      await sleep(200);
      const reducedRef = (await referenceFor(page, /speech/)) || reference;
      const rField = page.getByLabel(/第 \d+ 句听写/).first();
      await rField.click();
      await rField.fill(reducedRef);
      await rField.press('Enter');
      await expectVisible(page, '.diff');
      const timings = await page.evaluate(() => {
        const diff = document.querySelector('.diff');
        const style = diff instanceof HTMLElement ? getComputedStyle(diff) : null;
        return {
          motion: diff?.getAttribute('data-motion'),
          transition: style?.transitionDuration,
          animation: style?.animationName,
        };
      });
      await shot(page, '60-reduced-check.png');
      const goneAt = Date.now();
      await rField.press('Escape');
      await page.locator('.diff').waitFor({ state: 'detached', timeout: 500 });
      const retractMs = Date.now() - goneAt;
      await shot(page, '61-reduced-retract.png');
      const instant =
        !!timings.motion &&
        (timings.transition || '').split(', ').every((value) => value === '0s') &&
        (timings.animation === 'none' || timings.animation === '') &&
        retractMs < 200;
      pass('reduced_motion_instant', instant, { timings, retractMs });
      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: '' }],
      });
    } else {
      pass('reduced_motion_instant', false, 'could not reopen study');
    }

    const hash20 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(evDir, '20-next-sentence.png')))
      .digest('hex');
    const hash61 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(evDir, '61-reduced-retract.png')))
      .digest('hex');
    pass('next_sentence_not_duplicate', hash20 !== hash61, { hash20, hash61 });

    const failed = Object.entries(summary.checks).filter(([, v]) => v === 'FAIL');
    summary.all = failed.length ? 'FAIL' : 'PASS';
    log('ALL ' + summary.all + (failed.length ? ' failed=' + failed.map(([k]) => k).join(',') : ''));
    writeSummary();
    await browser.close().catch(() => {});
  } catch (err) {
    summary.all = 'FAIL';
    summary.detail.error = String(err && err.stack ? err.stack : err);
    log('ERROR ' + summary.detail.error);
    writeSummary();
    throw err;
  }
}

main();
