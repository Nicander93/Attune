import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
  closeDatabase,
  deleteFolder,
  deleteMaterial,
  loadFolders,
  loadMaterials,
  newFolder,
  saveFolder,
  saveMaterial,
} from '../src/storage/db';
import type { Material } from '../src/domain/types';
import { legacyUnstudied, legacyV1, legacyV2 } from './fixtures/legacy';

/** Writes a store in an older schema version, the way a previous build left it. */
async function seed(version: number, records: unknown[]): Promise<void> {
  const factory = new IDBFactory();
  Object.assign(globalThis, { indexedDB: factory });
  await new Promise<void>((resolve, reject) => {
    const request = factory.open('attune', version);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('materials', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('materials', 'readwrite');
      for (const record of records) transaction.objectStore('materials').put(record);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
}

/**
 * fake-indexeddb clones values with a plain structured clone that keeps a Blob's
 * fields but not its prototype, so `audio` comes back as an object here. Asserting
 * that the bytes survived is still meaningful; `instanceof Blob` is not. Real Blob
 * preservation is covered by the Playwright tests, which run in Chromium.
 */
const audioBytes = (material: { audio: Blob }) => material.audio.size;

beforeEach(async () => {
  await closeDatabase();
  Object.assign(globalThis, { indexedDB: new IDBFactory() });
});

afterEach(async () => {
  await closeDatabase();
  vi.restoreAllMocks();
});

describe('an empty database', () => {
  it('opens at the current schema and reports nothing', async () => {
    expect(await loadMaterials()).toEqual([]);
    expect(await loadFolders()).toEqual([]);
  });
});

describe('upgrading a schema v2 database', () => {
  beforeEach(async () => {
    await seed(2, [legacyV2(), legacyUnstudied()]);
  });

  it('opens the migrated materials with their audio intact', async () => {
    const materials = await loadMaterials();
    expect(materials).toHaveLength(2);
    const podcast = materials.find((m) => m.displayName === 'podcast-01.mp3')!;
    expect(audioBytes(podcast)).toBe(64);
    expect(podcast.segments).toHaveLength(2);
  });

  it('keeps drafts, completed sentences and bookmarks', async () => {
    const [podcast] = await loadMaterials();
    const round = podcast.rounds[0];
    expect(round.drafts).toEqual({ 'seg-a': 'Hello world' });
    expect(round.completedSegmentIds).toEqual(['seg-b']);
    expect(podcast.bookmarkedSegmentIds).toEqual(['seg-b']);
  });

  it('is a no-op the second time the database is opened', async () => {
    const first = await loadMaterials();
    const second = await loadMaterials();
    expect(second).toEqual(first);
    expect(second[0].rounds[0].legacy?.['seg-b'].first).toEqual(['Nice', 'to', 'meet', 'you']);
  });
});

describe('upgrading a schema v1 database', () => {
  it('repairs segment ids without losing the draft', async () => {
    await seed(1, [legacyV1()]);
    const [material] = await loadMaterials();
    expect(material.segments).toHaveLength(3);
    expect(Object.values(material.rounds[0].drafts)).toEqual(['Second sentence']);
    expect(material.bookmarkedSegmentIds).toHaveLength(1);
  });
});

describe('saving', () => {
  it('persists replacement audio without losing the metadata', async () => {
    await seed(2, [legacyV2()]);
    const [before] = await loadMaterials();
    const replacement = new Blob(['replacement audio'], { type: 'audio/wav' });
    await saveMaterial({ ...before, audio: replacement });
    await closeDatabase();
    const [after] = await loadMaterials();
    expect(after.audio.size).toBe(replacement.size);
    expect(after.segments).toEqual(before.segments);
    expect(after.rounds).toEqual(before.rounds);
  });
  /** Counts writes to the audio store, which is where the expensive blob lives. */
  const spyAudioWrites = () => {
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    return () =>
      put.mock.calls.filter(
        (call) => call[0] && typeof call[0] === 'object' && 'blob' in (call[0] as object),
      ).length;
  };

  it('writes the blob once when the material is first stored', async () => {
    await seed(2, [legacyV2()]);
    await loadMaterials();
    const [stored] = await loadMaterials();
    const audioWrites = spyAudioWrites();
    await saveMaterial({ ...stored, displayName: 'renamed' });
    expect(audioWrites()).toBe(0);
    const [after] = await loadMaterials();
    expect(after.displayName).toBe('renamed');
  });

  it('never re-copies the audio on a repeated autosave', async () => {
    await seed(2, [legacyV2()]);
    await loadMaterials();
    const [stored] = await loadMaterials();
    const audioWrites = spyAudioWrites();
    for (const position of [1, 2, 3, 4, 5])
      await saveMaterial({ ...stored, playbackPosition: position });
    expect(audioWrites()).toBe(0);
    const [after] = await loadMaterials();
    expect(after.playbackPosition).toBe(5);
    expect(audioBytes(after)).toBe(64);
  });

  it('keeps subtitle, draft and bookmark data through a save and reload', async () => {
    await seed(2, [legacyV2(), legacyUnstudied()]);
    const [podcast] = await loadMaterials();
    await saveMaterial({ ...podcast, folderId: 'f1', displayName: 'Renamed' });
    const [reloaded] = await loadMaterials();
    expect(reloaded.displayName).toBe('Renamed');
    expect(reloaded.originalFileName).toBe('podcast-01.mp3');
    expect(reloaded.segments).toHaveLength(2);
    expect(reloaded.bookmarkedSegmentIds).toEqual(['seg-b']);
    expect(reloaded.rounds[0].drafts).toEqual({ 'seg-a': 'Hello world' });
    expect(reloaded.rounds[0].completedSegmentIds).toEqual(['seg-b']);
  });

  it('drops the row and its audio on delete', async () => {
    await seed(2, [legacyV2(), legacyUnstudied()]);
    const [podcast] = await loadMaterials();
    await deleteMaterial(podcast.id);
    const left = await loadMaterials();
    expect(left).toHaveLength(1);
    expect(left[0].id).not.toBe(podcast.id);
  });
});

describe('folders', () => {
  it('persists, renames and deletes without touching material data', async () => {
    await seed(2, [legacyV2()]);
    const [podcast] = await loadMaterials();
    const folder = newFolder('播客');
    await saveFolder(folder);
    await saveMaterial({ ...podcast, folderId: folder.id });

    expect((await loadFolders()).map((f) => f.name)).toEqual(['播客']);

    const updated = await deleteFolder(folder.id, await loadMaterials());
    expect(await loadFolders()).toEqual([]);
    expect(updated[0].folderId).toBeNull();
    const [reloaded] = await loadMaterials();
    expect(reloaded.bookmarkedSegmentIds).toEqual(['seg-b']);
    expect(audioBytes(reloaded)).toBe(64);
  });
});
