import { expect, test } from '@playwright/test';
import { material, openStudy, seed, wav } from './support';

async function dictateAndCheck(page: import('@playwright/test').Page, text = 'Hello world') {
  const field = page.getByLabel('第 1 句听写');
  await field.click();
  await field.pressSequentially(text);
  await field.press('Enter');
  await expect(page.locator('.diff')).toBeVisible();
  await expect(page.locator('.diff')).toHaveAttribute('data-motion', 'entered');
  return field;
}

/** Playwright runs in the browser, where the video element is not mounted.
    Insert a tall surface that uses the same CSS, so max-height is exercised. */
async function expandPictureForLayout(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '显示画面' }).click();
  await expect(page.getByRole('button', { name: '收起画面' })).toBeVisible();
  await page.evaluate(() => {
    const pageEl = document.querySelector('.page');
    if (!(pageEl instanceof HTMLElement)) return;
    let surface = pageEl.querySelector('.media-output');
    if (!(surface instanceof HTMLElement)) {
      surface = document.createElement('div');
      surface.className = 'media-output';
      const video = document.createElement('div');
      video.className = 'media-output__video';
      video.style.width = '100%';
      video.style.height = '360px';
      surface.appendChild(video);
      const view = pageEl.querySelector('.page__view');
      pageEl.insertBefore(surface, view);
    }
    surface.classList.remove('media-output--hidden');
    surface.setAttribute('data-motion', 'entered');
    const video = surface.querySelector('.media-output__video');
    if (video instanceof HTMLElement && surface.getBoundingClientRect().height < 80) {
      video.style.width = '100%';
      video.style.height = '360px';
    }
  });
}

test('check results appear near the field and retract along the same path', async ({ page }) => {
  await seed(page, [material({ audio: wav() })]);
  await openStudy(page);
  const field = await dictateAndCheck(page);

  const layout = await page.evaluate(() => {
    const fieldBox = document.querySelector('.flow')?.getBoundingClientRect();
    const diffBox = document.querySelector('.diff')?.getBoundingClientRect();
    if (!fieldBox || !diffBox) return null;
    return {
      gap: diffBox.top - fieldBox.bottom,
      below: diffBox.top >= fieldBox.top,
      motion: document.querySelector('.diff')?.getAttribute('data-motion'),
    };
  });
  expect(layout).not.toBeNull();
  expect(layout!.below).toBe(true);
  expect(layout!.gap).toBeGreaterThanOrEqual(-2);
  expect(layout!.gap).toBeLessThan(48);
  expect(layout!.motion).toBe('entered');

  await field.press('Escape');
  await expect(page.locator('.diff')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '核对答案' })).toBeVisible();

  await field.press('Enter');
  await expect(page.locator('.diff')).toBeVisible();
  await page.getByRole('button', { name: '修改' }).click();
  await expect(page.locator('.diff')).toHaveCount(0);
});

test('reduced motion makes check, retract and sentence change instant', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page, [material({ audio: wav() })]);
  await openStudy(page);
  const field = await dictateAndCheck(page);

  const durations = await page.evaluate(() => {
    const diff = document.querySelector('.diff');
    if (!(diff instanceof HTMLElement)) return null;
    const style = getComputedStyle(diff);
    return {
      transition: style.transitionDuration,
      animation: style.animationName,
    };
  });
  expect(durations).not.toBeNull();
  expect(durations!.transition.split(', ').every((value) => value === '0s')).toBe(true);
  expect(durations!.animation === 'none' || durations!.animation === '').toBe(true);

  await field.press('Escape');
  await expect(page.locator('.diff')).toHaveCount(0);

  await field.press('Enter');
  await expect(page.locator('.diff')).toBeVisible();
  const opacity = await page.evaluate(async () => {
    const dictation = document.querySelector('.dictation');
    const samples: number[] = [];
    const button = document.querySelector('.dictation__actions .primary') as HTMLButtonElement;
    button.click();
    for (let i = 0; i < 8; i++) {
      samples.push(Number(getComputedStyle(dictation!).opacity));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return Math.min(...samples);
  });
  expect(opacity).toBe(1);
  await expect(page.locator('.study__count')).toContainText('02 / 03');
});

test('changing sentence does not flash the page white or move the chrome', async ({ page }) => {
  await seed(page, [material({ audio: wav() })]);
  await openStudy(page);
  await dictateAndCheck(page);

  const probe = await page.evaluate(async () => {
    const pageView = document.querySelector('.page__view');
    const dictation = document.querySelector('.dictation');
    const head = document.querySelector('.study__head');
    const player = document.querySelector('.player');
    if (!pageView || !dictation || !head || !player) return null;
    const runningPageIn = () =>
      pageView.getAnimations().some(
        (animation) =>
          animation instanceof CSSAnimation &&
          animation.animationName === 'motion-page-in' &&
          animation.playState === 'running',
      );
    const before = {
      head: head.getBoundingClientRect().top,
      player: player.getBoundingClientRect().top,
      pageIn: runningPageIn(),
    };
    const opacities: number[] = [];
    const start = performance.now();
    const tick = () => {
      opacities.push(Number(getComputedStyle(dictation).opacity));
      if (performance.now() - start < 220) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (document.querySelector('.dictation__actions .primary') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 280));
    return {
      before,
      after: {
        head: head.getBoundingClientRect().top,
        player: player.getBoundingClientRect().top,
        pageIn: runningPageIn(),
        sentence: document.querySelector('.study__count')?.textContent,
      },
      minOpacity: Math.min(...opacities),
    };
  });

  expect(probe).not.toBeNull();
  expect(probe!.after.sentence).toContain('02 / 03');
  expect(probe!.before.pageIn).toBe(false);
  expect(probe!.after.pageIn).toBe(false);
  expect(Math.abs(probe!.after.head - probe!.before.head)).toBeLessThan(2);
  expect(Math.abs(probe!.after.player - probe!.before.player)).toBeLessThan(2);
  expect(probe!.minOpacity).toBeGreaterThan(0.4);
});

test('a video material shows an interruptible picture toggle after checking', async ({ page }) => {
  await seed(page, [
    material({
      audio: wav(),
      video: { playbackPath: 'C:\\\\AttuneSmoke\\\\h264_aac_subs.mp4' },
    }),
  ]);
  await openStudy(page);
  await dictateAndCheck(page);
  const toggle = page.getByRole('button', { name: '显示画面' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole('button', { name: '收起画面' })).toBeVisible();
  await page.getByRole('button', { name: '收起画面' }).click();
  await expect(page.getByRole('button', { name: '显示画面' })).toBeVisible();
});

test('an expanded picture at 1024x640 still shows the check result on the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await seed(page, [
    material({
      audio: wav(),
      video: { playbackPath: 'C:\\\\AttuneSmoke\\\\h264_aac_subs.mp4' },
    }),
  ]);
  await openStudy(page);
  await dictateAndCheck(page);
  await expect(page.locator('.diff')).toHaveAttribute('data-motion', 'entered');
  await expandPictureForLayout(page);

  const layout = await page.evaluate(() => {
    const visibleIn = (el, box) => {
      if (!(el instanceof HTMLElement) || !(box instanceof HTMLElement)) return false;
      const e = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return (
        e.top >= b.top - 1 &&
        e.bottom <= b.bottom + 1 &&
        e.top >= -1 &&
        e.bottom <= window.innerHeight + 1 &&
        e.height > 8
      );
    };
    const firstLineVisibleIn = (el, box) => {
      if (!(el instanceof HTMLElement) || !(box instanceof HTMLElement)) return false;
      const line = el.getClientRects()[0];
      const b = box.getBoundingClientRect();
      if (!line) return false;
      return (
        line.top >= b.top - 1 &&
        line.bottom <= b.bottom + 1 &&
        line.top >= -1 &&
        line.bottom <= window.innerHeight + 1 &&
        line.height > 8
      );
    };
    const inWindow = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const r = el.getBoundingClientRect();
      return r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.height > 8;
    };
    const diff = document.querySelector('.diff');
    const title = diff?.querySelector('.caption');
    const comparison = diff?.querySelector('.diff__text');
    const explanation = diff?.querySelector('p.muted');
    const toggle = [...document.querySelectorAll('button')].find((el) =>
      /收起画面/.test(el.textContent || ''),
    );
    const edit = [...document.querySelectorAll('button')].find(
      (el) => (el.textContent || '').trim() === '修改',
    );
    const next = [...document.querySelectorAll('button')].find((el) =>
      /下一句/.test(el.textContent || ''),
    );
    const picture = document.querySelector('.media-output:not(.media-output--hidden)');
    return {
      pictureHeight: picture?.getBoundingClientRect().height ?? 0,
      diffHeight: diff instanceof HTMLElement ? diff.getBoundingClientRect().height : 0,
      diffClient: diff instanceof HTMLElement ? diff.clientHeight : 0,
      titleVisible: visibleIn(title, diff),
      comparisonVisible: visibleIn(comparison, diff),
      explanationLineVisible: firstLineVisibleIn(explanation, diff),
      toggleInWindow: inWindow(toggle),
      editInWindow: inWindow(edit),
      nextInWindow: inWindow(next),
    };
  });

  expect(layout.titleVisible, JSON.stringify(layout)).toBe(true);
  expect(layout.comparisonVisible, JSON.stringify(layout)).toBe(true);
  expect(layout.explanationLineVisible, JSON.stringify(layout)).toBe(true);
  expect(layout.toggleInWindow, JSON.stringify(layout)).toBe(true);
  expect(layout.editInWindow, JSON.stringify(layout)).toBe(true);
  expect(layout.nextInWindow, JSON.stringify(layout)).toBe(true);
  expect(layout.pictureHeight, JSON.stringify(layout)).toBeGreaterThan(80);
  expect(layout.pictureHeight, JSON.stringify(layout)).toBeLessThanOrEqual(120);
  expect(layout.diffHeight, JSON.stringify(layout)).toBeGreaterThan(80);
});

test('an expanded picture at 1440x900 still shows a complete check result', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page, [
    material({
      audio: wav(),
      video: { playbackPath: 'C:\\\\AttuneSmoke\\\\h264_aac_subs.mp4' },
    }),
  ]);
  await openStudy(page);
  await dictateAndCheck(page);
  await expect(page.locator('.diff')).toHaveAttribute('data-motion', 'entered');
  await expandPictureForLayout(page);

  const layout = await page.evaluate(() => {
    const inWindow = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const r = el.getBoundingClientRect();
      return r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.height > 8;
    };
    const diff = document.querySelector('.diff');
    const overflow =
      diff instanceof HTMLElement ? diff.scrollHeight - diff.clientHeight : 999;
    const picture = document.querySelector('.media-output:not(.media-output--hidden)');
    return {
      overflow,
      pictureHeight: picture?.getBoundingClientRect().height ?? 0,
      title: inWindow(diff?.querySelector('.caption')),
      comparison: inWindow(diff?.querySelector('.diff__text')),
      explanation: inWindow(diff?.querySelector('p.muted')),
      toggle: inWindow(
        [...document.querySelectorAll('button')].find((el) => /收起画面/.test(el.textContent || '')),
      ),
      next: inWindow(
        [...document.querySelectorAll('button')].find((el) => /下一句/.test(el.textContent || '')),
      ),
    };
  });

  expect(layout.overflow).toBeLessThanOrEqual(2);
  expect(layout.pictureHeight).toBeGreaterThan(80);
  expect(layout.pictureHeight).toBeLessThanOrEqual(250);
  expect(layout.title).toBe(true);
  expect(layout.comparison).toBe(true);
  expect(layout.explanation).toBe(true);
  expect(layout.toggle).toBe(true);
  expect(layout.next).toBe(true);
});
