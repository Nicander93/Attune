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
