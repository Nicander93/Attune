import { useCallback, useEffect, useRef, useState } from 'react';
import { nowIso, type Folder, type Material } from '../domain/types';
import {
  deleteFolder,
  deleteMaterial,
  loadFolders,
  loadMaterials,
  newFolder,
  saveFolder,
  saveMaterial,
} from '../storage/db';

const AUTOSAVE_MS = 300;

export type LibraryState = {
  ready: boolean;
  /** True while a debounced write is still queued or in flight. */
  saving: boolean;
  error: string;
  materials: Material[];
  folders: Folder[];
  update: (transform: (material: Material) => Material, id: string) => void;
  rename: (id: string, displayName: string) => void;
  moveToFolder: (id: string, folderId: string | null) => void;
  remove: (id: string) => Promise<void>;
  add: (material: Material) => Promise<void>;
  createFolder: (name: string) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  markStudied: (id: string, patch?: Partial<Material>) => void;
  flush: () => void;
};

/**
 * Owns materials and folders for the whole app.
 *
 * Updates are synchronous against an in-memory copy and flushed to IndexedDB on a
 * timer, so typing never waits on storage. Failures are kept pending and reported
 * rather than dropped - losing a draft silently is the one failure mode that must
 * not happen.
 */
export function useLibrary(): LibraryState {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const current = useRef<Material[]>([]);
  const foldersRef = useRef<Folder[]>([]);
  const pending = useRef(new Map<string, Material>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef(Promise.resolve());

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const batch = [...pending.current.values()];
    pending.current.clear();
    if (!batch.length) return;
    queue.current = queue.current.then(async () => {
      try {
        for (const item of batch) await saveMaterial(item);
        setError('');
      } catch (err) {
        for (const item of batch) {
          const latest = current.current.find((m) => m.id === item.id);
          if (latest && !pending.current.has(item.id)) pending.current.set(item.id, latest);
        }
        setError(`保存失败：${String(err)}。请保留窗口并点击重试保存。`);
      } finally {
        // A newer keystroke may have queued work while this write was in flight.
        if (!pending.current.size && timer.current === undefined) setSaving(false);
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadMaterials(), loadFolders()])
      .then(([items, lists]) => {
        if (cancelled) return;
        current.current = items;
        foldersRef.current = lists;
        setMaterials(items);
        setFolders(lists);
        setReady(true);
      })
      .catch((err) => setError(`本地数据库无法打开：${String(err)}。请重新打开应用。`));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const commit = useCallback((next: Material[]) => {
    current.current = next;
    setMaterials(next);
  }, []);

  const update = useCallback(
    (transform: (material: Material) => Material, id: string) => {
      const next = current.current.map((m) => (m.id === id ? transform(m) : m));
      const changed = next.find((m) => m.id === id);
      current.current = next;
      setMaterials(next);
      if (!changed) return;
      pending.current.set(id, changed);
      setSaving(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
    },
    [flush],
  );

  const add = useCallback(async (material: Material) => {
    setSaving(true);
    try {
      await saveMaterial(material);
      current.current = [material, ...current.current];
      setMaterials(current.current);
    } catch (err) {
      setError(`创建素材失败：${String(err)}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const rename = useCallback(
    (id: string, displayName: string) => {
      const name = displayName.trim();
      if (!name) return;
      // Display name only: the audio blob, the original file name, subtitles, segment
      // ids and every practice record stay exactly as they were.
      update((m) => (m.id === id ? { ...m, displayName: name } : m), id);
    },
    [update],
  );

  const moveToFolder = useCallback(
    (id: string, folderId: string | null) =>
      update((m) => (m.id === id ? { ...m, folderId } : m), id),
    [update],
  );

  const remove = useCallback(
    async (id: string) => {
      const removed = current.current.find((m) => m.id === id);
      pending.current.delete(id);
      const next = current.current.filter((m) => m.id !== id);
      commit(next);
      queue.current = queue.current.then(() => deleteMaterial(id));
      try {
        await queue.current;
      } catch (err) {
        queue.current = Promise.resolve();
        if (removed) commit([removed, ...current.current]);
        setError(`删除失败：${String(err)}`);
      }
    },
    [commit],
  );

  const createFolder = useCallback(async (name: string) => {
    const folder = newFolder(name.trim());
    await saveFolder(folder);
    foldersRef.current = [...foldersRef.current, folder];
    setFolders(foldersRef.current);
    return folder;
  }, []);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = foldersRef.current.map((f) => (f.id === id ? { ...f, name: trimmed } : f));
    foldersRef.current = next;
    setFolders(next);
    await saveFolder(next.find((f) => f.id === id)!);
  }, []);

  /** Deleting a folder only unlabels its materials; nothing else is touched. */
  const removeFolder = useCallback(
    async (id: string) => {
      flush();
      await queue.current;
      const moved = await deleteFolder(id, current.current);
      foldersRef.current = foldersRef.current.filter((f) => f.id !== id);
      setFolders(foldersRef.current);
      const byId = new Map(moved.map((m) => [m.id, m]));
      commit(current.current.map((m) => byId.get(m.id) ?? m));
    },
    [commit, flush],
  );

  /**
   * Records real study behaviour. Only called by typing, checking or playing - never by
   * rendering a list, which is what would make 最近学习 a lie.
   */
  const markStudied = useCallback(
    (id: string, patch?: Partial<Material>) => {
      update((m) => (m.id === id ? { ...m, ...patch, lastStudiedAt: nowIso() } : m), id);
    },
    [update],
  );

  return {
    ready,
    saving,
    error,
    materials,
    folders,
    update,
    rename,
    moveToFolder,
    remove,
    add,
    createFolder,
    renameFolder,
    removeFolder,
    markStudied,
    flush,
  };
}
