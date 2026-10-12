import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { material, wav } from './support';

const shot = (name: string) => resolve(process.cwd(), 'screenshots', `${name}.png`);

const rows = [
  {
    ...material({
      id: 'm1',
      displayName: 'The Power of Small Habits.mp3',
      originalFileName: 'small-habits.mp3',
      folderId: 'f1',
      duration: 192,
      segments: [
        {
          id: 's1',
          start: 0,
          end: 6,
          reference: 'Tiny changes compound into remarkable results over time.',
          translation: '微小的改变会随时间累积成惊人的成果。',
          words: [],
        },
        {
          id: 's2',
          start: 6,
          end: 12,
          reference: 'You do not rise to the level of your goals.',
          translation: '你不会升到目标的高度。',
          words: [],
        },
      ],
      lastStudiedAt: '2026-10-11T20:00:00Z',
      lastView: 'dictation',
      bookmarkedSegmentIds: ['s2'],
      rounds: [
        {
          id: 'r1',
          createdAt: '2026-10-10T08:00:00Z',
          updatedAt: '2026-10-11T20:00:00Z',
          drafts: { s1: 'Tiny changes compound into remarkable' },
          completedSegmentIds: ['s1'],
        },
      ],
      activeRoundId: 'r1',
    }),
    audio: wav(6),
  },
  {
    ...material({
      id: 'm2',
      displayName: 'BBC Learning English.wav',
      folderId: null,
      segments: [],
      duration: 24,
    }),
    audio: wav(4),
  },
  {
    ...material({ id: 'm3', displayName: 'English Podcast 01.mp3', folderId: 'f2', duration: 64 }),
    audio: wav(5),
  },
];

const folders = [
  { id: 'f1', name: '播客', createdAt: '2026-09-01T00:00:00Z' },
  { id: 'f2', name: '英语课程', createdAt: '2026-09-02T00:00:00Z' },
];

async function load(page: Page) {
  await page.goto('/');
  await page.evaluate(
    async ({ data, lists }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('attune', 3);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['materials', 'audio', 'folders'], 'readwrite');
          for (const folder of lists) tx.objectStore('folders').put(folder);
          for (const row of data as any[]) {
            const { audio, ...record } = row;
            tx.objectStore('materials').put(record);
            tx.objectStore('audio').put({
              id: record.id,
              blob: new Blob([Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))], {
                type: 'audio/wav',
              }),
            });
          }
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    },
    {
      data: rows.map((r) => ({ ...r, audio: r.audio.toString('base64') })),
      lists: folders,
    },
  );
  await page.reload();
  await page.waitForTimeout(600);
}

test('capture every page at 1280x720 and 1024x640', async ({ page }) => {
  mkdirSync(resolve(process.cwd(), 'screenshots'), { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await load(page);

  await page.screenshot({ path: shot('home') });

  await page.getByRole('button', { name: '素材库' }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('library') });

  await page.locator('.materials__row').first().click();
  await expect(page.getByRole('heading', { name: /第 1 \/ 2 句/ })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('dictation') });

  // Checked state with the difference panel.
  await page.getByLabel('第 1 句听写').fill('Tiny changes compound into big results over time');
  await page.getByLabel('第 1 句听写').press('Enter');
  await expect(page.locator('.diff')).toBeVisible();
  await page.screenshot({ path: shot('dictation-checked') });

  await page.getByRole('tab', { name: '听读' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('reading') });

  await page.getByRole('button', { name: '完整原文 ↗' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('transcript') });

  await page.getByRole('button', { name: '← 返回' }).click();
  await page.getByRole('button', { name: '素材设置' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('prepare') });

  await page.getByRole('button', { name: '← 返回' }).click();
  await page.getByRole('button', { name: '字幕校对' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('subtitles') });

  await page.setViewportSize({ width: 1024, height: 640 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('subtitles-1024x640') });
});
