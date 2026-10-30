import { expect, type Page } from '@playwright/test';

/** A real 16-bit PCM WAV, so the browser decodes it like any imported material. */
export function wav(seconds = 4): Buffer {
  const rate = 8000,
    count = rate * seconds,
    data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(Math.sin(i / 12) * 4000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Writes materials straight into IndexedDB in the schema the app expects, then reloads.
 * This tests the stored shape as well as the UI, which is the contract that matters
 * for a migration. The audio is rebuilt inside the page because a Node Buffer would
 * arrive as a plain object rather than a Blob.
 */
export async function seed(
  page: Page,
  materials: { audio: Buffer; [key: string]: unknown }[],
  folders: { id: string; name: string; createdAt?: string }[] = [],
) {
  await page.goto('/');
  const rows = materials.map((m) => ({ ...m, audio: m.audio.toString('base64') }));
  await page.evaluate(
    async ({ data, folderRows }) => {
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('attune', 3);
        open.onupgradeneeded = () => {
          const db = open.result;
          for (const name of ['materials', 'folders', 'audio'])
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
          if (!db.transaction.objectStore('materials').indexNames.contains('by-folder'))
            db.transaction.objectStore('materials').createIndex('by-folder', 'folderId');
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['materials', 'audio', 'folders'], 'readwrite');
          for (const row of data) {
            const { audio, ...record } = row;
            const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
            tx.objectStore('materials').put(record);
            tx.objectStore('audio').put({
              id: record.id,
              blob: new Blob([bytes], { type: 'audio/wav' }),
            });
          }
          for (const folder of folderRows) {
            tx.objectStore('folders').put({
              createdAt: '2026-03-01T08:00:00Z',
              ...folder,
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
    { data: rows, folderRows: folders },
  );
  await page.reload();
}

/** Autosave is debounced, so wait for the queue to drain before reloading or reading. */
export async function settled(page: Page) {
  await expect(page.locator('.app')).toHaveAttribute('data-saving', 'false');
}

export const storedMaterial = (page: Page, id: string) =>
  page.evaluate(
    (key) =>
      new Promise<any>((resolve) => {
        const open = indexedDB.open('attune', 3);
        open.onsuccess = () => {
          const request = open.result.transaction('materials').objectStore('materials').get(key);
          request.onsuccess = () => resolve(request.result);
        };
      }),
    id,
  );

export const SENTENCES = [
  { id: 's1', start: 0, end: 3, reference: 'Hello world.', words: [] },
  { id: 's2', start: 3, end: 6, reference: 'Nice to meet you.', words: [] },
  { id: 's3', start: 6, end: 9, reference: 'See you later.', words: [] },
];

export function material(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    displayName: 'podcast.mp3',
    originalFileName: 'podcast.mp3',
    folderId: null,
    duration: 9,
    segments: SENTENCES,
    createdAt: '2026-03-01T08:00:00Z',
    playbackPosition: 0,
    bookmarkedSegmentIds: [],
    rounds: [],
    activeRoundId: '',
    audio: wav(),
    ...overrides,
  };
}

/** Opens the library and enters the first material's study page. */
export async function openStudy(page: Page) {
  await page.getByRole('button', { name: '素材库' }).first().click();
  await page.locator('.materials__row').first().click();
  await expect(page.getByRole('heading', { name: /第 1 \/ 3 句/ })).toBeVisible();
}

export const srt = [
  '1\n00:00:00,000 --> 00:00:03,000\nHello world.\n',
  '2\n00:00:03,000 --> 00:00:06,000\nNice to meet you.\n',
].join('\n');

export const vtt = [
  'WEBVTT\n',
  '\n00:00:00.000 --> 00:00:03.000\nHello world\n你好，世界\n',
  '\n00:00:03.000 --> 00:00:06.000\nNice to meet you\n很高兴见到你\n',
].join('\n');
