import { expect, test } from '@playwright/test';
import { material, openStudy, seed, wav } from './support';

/**
 * Recognizer word timings store trimmed tokens (see merge_words in transcribe.rs).
 * 听读 must put the gaps back, or English collapses into "Hellofromatune."
 */
const SPEECH_SEGMENTS = [
  {
    id: 's1',
    start: 0,
    end: 3,
    reference: 'Hello from attune.',
    translation: '你好，来自 Attune。',
    words: [
      { text: 'Hello', start: 0, end: 0.8 },
      { text: 'from', start: 0.8, end: 1.3 },
      { text: 'attune.', start: 1.3, end: 2.4 },
    ],
  },
  {
    id: 's2',
    start: 3,
    end: 6,
    reference: 'This is short English sentence for recognition.',
    translation: '这是一句用于识别的简短英文。',
    words: [
      { text: 'This', start: 3, end: 3.3 },
      { text: 'is', start: 3.3, end: 3.5 },
      { text: 'short', start: 3.5, end: 3.9 },
      { text: 'English', start: 3.9, end: 4.4 },
      { text: 'sentence', start: 4.4, end: 5.0 },
      { text: 'for', start: 5.0, end: 5.2 },
      { text: 'recognition.', start: 5.2, end: 5.9 },
    ],
  },
  {
    id: 's3',
    start: 6,
    end: 9,
    reference: 'See you later.',
    translation: '再见。',
    words: [
      { text: 'See', start: 6, end: 6.4 },
      { text: 'you', start: 6.4, end: 6.7 },
      { text: 'later.', start: 6.7, end: 8.2 },
    ],
  },
];

test('reading mode keeps word spaces in English and bilingual source text', async ({ page }) => {
  await seed(page, [
    material({
      audio: wav(9),
      segments: SPEECH_SEGMENTS,
      studySettings: { revealAll: true, language: 'en' },
    }),
  ]);
  await openStudy(page);
  await page.getByRole('button', { name: '听读', exact: true }).click();

  const english = page.locator('.reading__en');
  await expect(page.locator('.reading__word').first()).toBeVisible();
  await expect(english.nth(0)).toHaveText('Hello from attune.');
  await expect(english.nth(0)).toContainText('Hello from');
  await expect(english.nth(0)).not.toContainText('Hellofrom');
  await expect(english.nth(1)).toHaveText('This is short English sentence for recognition.');
  await expect(english.nth(1)).toContainText('This is short');
  await expect(english.nth(1)).not.toContainText('Thisisshort');

  await page.getByRole('button', { name: '双语', exact: true }).click();
  await expect(english.nth(0)).toHaveText('Hello from attune.');
  await expect(english.nth(0)).toContainText('Hello from');
  await expect(page.locator('.reading__zh').nth(0)).toHaveText('你好，来自 Attune。');
  await expect(english.nth(1)).toHaveText('This is short English sentence for recognition.');
  await expect(page.locator('.reading__zh').nth(1)).toBeVisible();
});
