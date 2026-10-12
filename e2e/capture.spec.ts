import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const shot = (name: string) => resolve(process.cwd(), 'screenshots', `${name}.png`);

const wav = (seconds = 4): Buffer => {
  const rate = 8000,
    count = rate * seconds,
    data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(Math.sin(i / 12) * 4000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
};

const rows = [
  {
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
        reference: 'Tiny changes compound into remarkable results.',
        words: [],
      },
      {
        id: 's2',
        start: 6,
        end: 12,
        reference: 'You do not rise to the level of your goals.',
        words: [],
      },
    ],
    createdAt: '2026-09-01T08:00:00Z',
    lastStudiedAt: '2026-10-11T20:00:00Z',
    lastView: 'dictation',
    playbackPosition: 4,
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
    audio: wav(6),
  },
  {
    id: 'm2',
    displayName: 'BBC Learning English.wav',
    originalFileName: 'bbc.wav',
    folderId: null,
    duration: 24,
    segments: [],
    createdAt: '2026-10-05T08:00:00Z',
    playbackPosition: 0,
    bookmarkedSegmentIds: [],
    rounds: [],
    activeRoundId: '',
    audio: wav(4),
  },
  {
    id: 'm3',
    displayName: 'English Podcast 01.mp3',
    originalFileName: 'podcast01.mp3',
    folderId: 'f2',
    duration: 64,
    segments: [{ id: 'x', start: 0, end: 5, reference: 'Welcome back.', words: [] }],
    createdAt: '2026-10-12T08:00:00Z',
    playbackPosition: 0,
    bookmarkedSegmentIds: [],
    rounds: [],
    activeRoundId: '',
    audio: wav(5),
  },
];

test('capture screens', async ({ page }) => {
  mkdirSync(resolve(process.cwd(), 'screenshots'), { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.evaluate(
    async ({ data, folders }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('attune', 3);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['materials', 'audio', 'folders'], 'readwrite');
          for (const f of folders) tx.objectStore('folders').put(f);
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
      folders: [
        { id: 'f1', name: '播客', createdAt: '2026-09-01T00:00:00Z' },
        { id: 'f2', name: '英语课程', createdAt: '2026-09-02T00:00:00Z' },
      ],
    },
  );
  await page.reload();
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('home') });

  await page.getByRole('button', { name: '素材库' }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('library') });

  await page.locator('.materials__row').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('study') });

  await page.setViewportSize({ width: 1024, height: 640 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('study-1024x640') });
});
