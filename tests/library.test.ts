import { describe, expect, it } from 'vitest';
import type { Material } from '../src/domain/types';
import {
  UNCATEGORIZED,
  defaultRenameValue,
  filterMaterials,
  folderRows,
  materialRow,
  progressLabel,
  sortMaterials,
} from '../src/features/library/listing';

const make = (id: string, overrides: Partial<Material> = {}): Material => ({
  id,
  displayName: `${id}.mp3`,
  originalFileName: `${id}.mp3`,
  folderId: null,
  audio: new Blob(),
  duration: 10,
  segments: [],
  createdAt: '2026-01-01T00:00:00Z',
  playbackPosition: 0,
  bookmarkedSegmentIds: [],
  rounds: [],
  activeRoundId: '',
  ...overrides,
});

const round = (completed: string[], drafts: Record<string, string> = {}, id = 'r1') => ({
  id,
  createdAt: '',
  updatedAt: '',
  drafts,
  completedSegmentIds: completed,
});

describe('folder scope', () => {
  const materials = [
    make('a', { folderId: 'f1' }),
    make('b', { folderId: null }),
    make('c', { folderId: 'f2' }),
  ];

  it('shows everything under 全部素材', () => {
    expect(filterMaterials(materials, { folderId: null }, '').list).toHaveLength(3);
  });

  it('shows only loose materials under 未分类', () => {
    const list = filterMaterials(materials, { folderId: UNCATEGORIZED }, '').list;
    expect(list.map((m) => m.id)).toEqual(['b']);
  });

  it('shows one folder at a time', () => {
    expect(filterMaterials(materials, { folderId: 'f1' }, '').list.map((m) => m.id)).toEqual(['a']);
  });

  it('searches across folders and reports that it is unscoped', () => {
    const result = filterMaterials(materials, { folderId: 'f1' }, 'c.mp3');
    expect(result.list.map((m) => m.id)).toEqual(['c']);
    expect(result.scoped).toBe(false);
  });

  it('keeps the folder scope when there is no search term', () => {
    expect(filterMaterials(materials, { folderId: 'f1' }, '   ').scoped).toBe(true);
  });
});

describe('sorting', () => {
  const materials = [
    make('a', { displayName: 'bbb', duration: 30, createdAt: '2026-01-01T00:00:00Z' }),
    make('b', { displayName: 'aaa', duration: 10, createdAt: '2026-02-01T00:00:00Z' }),
  ];
  const ids = (order: Parameters<typeof sortMaterials>[1]) =>
    sortMaterials(materials, order).map((m) => m.id);

  it('puts a real study time first and falls back to import time', () => {
    const studied = [
      make('old', { lastStudiedAt: '2026-01-01T00:00:00Z' }),
      make('new', { lastStudiedAt: '2026-05-01T00:00:00Z' }),
    ];
    expect(sortMaterials(studied, 'recent').map((m) => m.id)).toEqual(['new', 'old']);
    // Never studied: imported later comes first, not "first because it was imported".
    expect(ids('recent')).toEqual(['b', 'a']);
  });

  it('sorts by import time, name and duration', () => {
    expect(ids('added')).toEqual(['b', 'a']);
    expect(ids('name')).toEqual(['b', 'a']);
    expect(ids('duration')).toEqual(['a', 'b']);
  });

  it('breaks ties by id so equal rows never shuffle between renders', () => {
    const same = [make('z', { duration: 5 }), make('y', { duration: 5 })];
    expect(sortMaterials(same, 'duration').map((m) => m.id)).toEqual(['y', 'z']);
    expect(sortMaterials([...same].reverse(), 'duration').map((m) => m.id)).toEqual(['y', 'z']);
  });
});

describe('folder rows', () => {
  it('counts every material exactly once', () => {
    const materials = [make('a', { folderId: 'f1' }), make('b'), make('c', { folderId: 'f1' })];
    const rows = folderRows([{ id: 'f1', name: '播客', createdAt: '' }], materials);
    expect(rows.map((r) => [r.name, r.count])).toEqual([
      ['全部素材', 3],
      ['未分类', 1],
      ['播客', 2],
    ]);
  });
});

describe('row status', () => {
  it('separates 未开始 from a draft-only material', () => {
    const bare = materialRow(make('a', { rounds: [round([])], activeRoundId: 'r1' }));
    expect(progressLabel(bare)).toBe('未开始');
    const drafting = materialRow(
      make('b', { rounds: [round([], { s: 'hello' })], activeRoundId: 'r1' }),
    );
    expect(drafting.started).toBe(true);
    expect(progressLabel(drafting)).toBe('已听写 0 / 0 句');
  });

  it('counts only the active round, never the sum of every round', () => {
    const material = make('a', {
      segments: [{ id: 's1', start: 0, end: 1, reference: 'Hi.', words: [] }],
      rounds: [round(['s1'], {}, 'r1'), round([], {}, 'r2')],
      activeRoundId: 'r2',
    });
    expect(materialRow(material).completed).toBe(0);
    // The earlier round still holds its own result.
    expect(materialRow({ ...material, activeRoundId: 'r1' }).completed).toBe(1);
  });

  it('reports subtitle availability', () => {
    expect(materialRow(make('a')).hasSubtitles).toBe(false);
    expect(
      materialRow(
        make('b', { segments: [{ id: 's', start: 0, end: 1, reference: 'Hi.', words: [] }] }),
      ).hasSubtitles,
    ).toBe(true);
  });
});

describe('rename default', () => {
  it('offers the file name without its extension', () => {
    expect(defaultRenameValue(make('a', { displayName: 'lesson.mp3' }))).toBe('lesson');
    expect(defaultRenameValue(make('b', { displayName: 'lesson' }))).toBe('lesson');
  });
});
