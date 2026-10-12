import { isCurrentMaterial, migrateMaterial, type LegacyMaterial } from '../domain/migrate';
import type { Folder, Material } from '../domain/types';
import { nowIso, uid } from '../domain/types';

const DB_NAME = 'attune';
const VERSION = 3;

/** A material without its audio, which lives in its own store. */
type StoredMaterial = Omit<Material, 'audio'> & { audio?: Blob };
/** The audio store holds the blob once, keyed by material id. */
type AudioRecord = { id: string; blob: Blob };

let database: Promise<IDBDatabase> | undefined;

/**
 * Schema 3 splits the audio blob out of the material record.
 *
 * Saving a draft rewrites the whole record, and keeping megabytes of audio inside it
 * would re-copy the blob on every 300ms autosave. The blob now lives once in its own
 * store and is written only when it actually changes.
 */
function upgrade(db: IDBDatabase, transaction: IDBTransaction, oldVersion: number): void {
  if (!db.objectStoreNames.contains('materials'))
    db.createObjectStore('materials', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });

  // `objectStoreNames.contains` answers a boolean, so the index check needs the store.
  const materials = transaction.objectStore('materials');
  if (!materials.indexNames.contains('by-folder')) materials.createIndex('by-folder', 'folderId');

  // Schema 1 and 2 kept audio, subtitles, rounds and bookmarks in one record. Rewrite
  // each row in place with a cursor - `onupgradeneeded` runs on a transaction that an
  // `await` would let close before the work finished.
  if (oldVersion < 1 || oldVersion >= VERSION) return;
  const audio = transaction.objectStore('audio');
  const cursor = materials.openCursor();
  cursor.onsuccess = () => {
    const row = cursor.result;
    if (!row) return;
    if (isCurrentMaterial(row.value)) {
      row.continue();
      return;
    }
    const migrated = migrateMaterial(row.value as LegacyMaterial);
    const { audio: blob, ...record } = migrated;
    audio.put({ id: migrated.id, blob });
    row.update(record);
    row.continue();
  };
}

function open(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = (event) =>
      upgrade(request.result, request.transaction!, event.oldVersion);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('数据库被其他窗口占用，请关闭其他窗口再重试。'));
  }));
}

/** Ids whose blob is already stored, so autosave never re-copies the audio. */
const withAudio = new Set<string>();

/** Closes the connection and drops the cache. Used on window teardown and by tests. */
export async function closeDatabase(): Promise<void> {
  const current = database;
  database = undefined;
  withAudio.clear();
  if (current) (await current).close();
}

function request<T>(db: IDBDatabase, name: string, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(name, 'readonly').objectStore(name));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** True when the database is reachable and already at the current schema. */
export async function isReady(): Promise<boolean> {
  await open();
  return true;
}

export async function loadMaterials(): Promise<Material[]> {
  const db = await open();
  const records = await request<StoredMaterial[]>(db, 'materials', (store) => store.getAll());
  const audioById = new Map<string, Blob>();
  await Promise.all(
    records.map(async (record) => {
      const entry = await request<AudioRecord | undefined>(db, 'audio', (store) =>
        store.get(record.id),
      );
      if (entry?.blob) audioById.set(record.id, entry.blob);
    }),
  );
  return (
    records
      // A row without its audio is unreadable rather than silently empty.
      .filter((record) => audioById.has(record.id))
      .map((record) => {
        withAudio.add(record.id);
        return { ...record, audio: audioById.get(record.id)! };
      })
  );
}

export async function saveMaterial(material: Material): Promise<void> {
  const { audio, ...record } = material;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(
      withAudio.has(material.id) ? ['materials'] : ['materials', 'audio'],
      'readwrite',
    );
    transaction.objectStore('materials').put(record);
    if (!withAudio.has(material.id)) {
      transaction.objectStore('audio').put({ id: material.id, blob: audio });
      withAudio.add(material.id);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const deleteMaterial = async (id: string): Promise<void> => {
  const db = await open();
  withAudio.delete(id);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['materials', 'audio'], 'readwrite');
    transaction.objectStore('materials').delete(id);
    transaction.objectStore('audio').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const loadFolders = async (): Promise<Folder[]> => {
  const db = await open();
  return request<Folder[]>(db, 'folders', (store) => store.getAll());
};

export const saveFolder = async (folder: Folder): Promise<void> => {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('folders', 'readwrite');
    transaction.objectStore('folders').put(folder);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * Removes a folder only. Its materials move to 未分类 - audio, subtitles, drafts and
 * bookmarks all survive, because a folder is a label and never owns anything.
 */
export const deleteFolder = async (id: string, materials: Material[]): Promise<Material[]> => {
  const db = await open();
  const affected = materials.filter((m) => m.folderId === id);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['folders', 'materials'], 'readwrite');
    transaction.objectStore('folders').delete(id);
    for (const material of affected) {
      // Only the folder changes; the blob stays in the audio store.
      const { audio: _blob, ...record } = material;
      transaction.objectStore('materials').put({ ...record, folderId: null });
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  return affected.map((m) => ({ ...m, folderId: null }));
};

export const newFolder = (name: string): Folder => ({ id: uid(), name, createdAt: nowIso() });
