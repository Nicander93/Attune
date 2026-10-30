import type { Folder, Material } from '../../domain/types';
import { materialProgress } from '../../domain/progress';

export type SortOrder = 'recent' | 'added' | 'name' | 'duration';

/** Labels shown in the library sort control. `added` stays for callers/tests. */
export const SORT_LABELS: Record<SortOrder, string> = {
  recent: '最近学习',
  added: '最近导入',
  name: '名称',
  duration: '时长',
};

/** S1 shell: the three sorts the V2 prototype surfaces. */
export const LIBRARY_SORT_OPTIONS: SortOrder[] = ['recent', 'name', 'duration'];

/** 未分类 is a virtual view, not a stored folder. */
export const UNCATEGORIZED = '__uncategorized__';

const byString = (a: string | undefined, b: string | undefined) => (a ?? '').localeCompare(b ?? '');

/**
 * Ties are broken by id so repeated renders never shuffle equal rows. `recent` puts
 * materials with a real study time first; materials that were only imported fall back
 * to their own import time instead of being dropped.
 */
export function sortMaterials(materials: Material[], order: SortOrder): Material[] {
  const sorted = [...materials];
  switch (order) {
    case 'recent':
      return sorted.sort(
        (a, b) =>
          (b.lastStudiedAt ?? '').localeCompare(a.lastStudiedAt ?? '') ||
          byString(b.createdAt, a.createdAt) ||
          a.id.localeCompare(b.id),
      );
    case 'added':
      return sorted.sort((a, b) => byString(b.createdAt, a.createdAt) || a.id.localeCompare(b.id));
    case 'name':
      return sorted.sort(
        (a, b) =>
          a.displayName.localeCompare(b.displayName, 'zh-Hans-CN') || a.id.localeCompare(b.id),
      );
    case 'duration':
      return sorted.sort((a, b) => b.duration - a.duration || a.id.localeCompare(b.id));
  }
}

export type FolderScope = { folderId: string | null };

/**
 * `folderId` distinguishes three states: null means 全部素材, UNCATEGORIZED means
 * 未分类, and anything else is a real folder id.
 */
const inScope = (material: Material, folderId: string | null) =>
  folderId === null ||
  (material.folderId ?? null) === (folderId === UNCATEGORIZED ? null : folderId);

/**
 * Search runs across every folder, even while one is selected - hiding matches because
 * of an unrelated filter is the confusing part of a file picker. `scoped` tells the UI
 * to say so.
 */
export function filterMaterials(
  materials: Material[],
  { folderId }: FolderScope,
  query: string,
): { list: Material[]; scoped: boolean } {
  const term = query.trim().toLowerCase();
  if (term) {
    return {
      list: materials.filter((m) => m.displayName.toLowerCase().includes(term)),
      scoped: false,
    };
  }
  return { list: materials.filter((m) => inScope(m, folderId)), scoped: true };
}

export type FolderRow = {
  id: string;
  name: string;
  count: number | null;
  virtual?: 'all' | 'uncategorized';
};

export function folderRows(folders: Folder[], materials: Material[]): FolderRow[] {
  const countIn = (predicate: (m: Material) => boolean) =>
    materials.reduce((total, m) => total + (predicate(m) ? 1 : 0), 0);
  return [
    { id: '', name: '全部素材', count: materials.length, virtual: 'all' },
    {
      id: UNCATEGORIZED,
      name: '未分类',
      count: countIn((m) => !m.folderId),
      virtual: 'uncategorized',
    },
    ...folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      count: countIn((m) => m.folderId === folder.id),
    })),
  ];
}

export type MaterialKind = 'audio' | 'video';

export type MaterialRow = {
  id: string;
  displayName: string;
  duration: number;
  kind: MaterialKind;
  folderName: string;
  hasSubtitles: boolean;
  needsReview: boolean;
  completed: number;
  total: number;
  started: boolean;
  stale: number;
};

/** Auto-generated subtitles that the user has not confirmed yet. */
export const needsSubtitleReview = (material: Material) =>
  material.subtitleReviewStatus === 'unreviewed';

/** 字幕 status and progress for one row, always measured against the active round. */
export const materialRow = (material: Material, folders: Folder[] = []): MaterialRow => {
  const progress = materialProgress(material);
  const folder = folders.find((f) => f.id === material.folderId);
  return {
    id: material.id,
    displayName: material.displayName,
    duration: material.duration,
    kind: material.video ? 'video' : 'audio',
    folderName: folder?.name ?? '未分类',
    hasSubtitles: material.segments.some((s) => s.reference.trim()),
    needsReview: needsSubtitleReview(material),
    completed: progress.completed,
    total: progress.total,
    started: progress.completed > 0 || progress.inProgress > 0,
    stale: progress.stale,
  };
};

/** Compact library status: 待校对 wins over any progress count. */
export const libraryStatusLabel = (row: MaterialRow) => {
  if (row.needsReview) return '待校对';
  if (!row.started) return '未开始';
  return `${row.completed} / ${row.total}`;
};

export const progressLabel = (row: MaterialRow) =>
  row.started ? `已听写 ${row.completed} / ${row.total} 句` : '未开始';

/** Home resume / recent subtitle: mode · n / m 句. */
export const homeProgressLabel = (mode: string, completed: number, total: number) =>
  `${mode} · ${completed} / ${total} 句`;

/** Default name offered when renaming: the file name without its extension. */
export const defaultRenameValue = (material: Material) =>
  material.displayName.replace(/\.[^.]+$/, '') || material.displayName;
