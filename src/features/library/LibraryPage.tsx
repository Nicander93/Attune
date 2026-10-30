import { useEffect, useMemo, useRef, useState } from 'react';
import type { Folder, Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import {
  UNCATEGORIZED,
  LIBRARY_SORT_OPTIONS,
  SORT_LABELS,
  defaultRenameValue,
  filterMaterials,
  folderRows,
  libraryStatusLabel,
  materialRow,
  sortMaterials,
  type SortOrder,
} from './listing';

type Props = {
  materials: Material[];
  folders: Folder[];
  ready: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  order: SortOrder;
  onOrderChange: (order: SortOrder) => void;
  selectedFolder: string | null;
  onSelectFolder: (folderId: string | null) => void;
  /** Lifted to the app so the row survives navigating away and back. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onPrepare: (id: string) => void;
  onCreate: (material: Material) => Promise<void>;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onDelete: (id: string) => Promise<void>;
  onCreateFolder: (name: string) => Promise<Folder>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onNotice: (message: string) => void;
};

export const blank = (): Material => ({
  id: crypto.randomUUID(),
  displayName: '未命名素材',
  originalFileName: '',
  folderId: null,
  audio: new Blob([], { type: 'audio/wav' }),
  duration: 0,
  segments: [],
  createdAt: new Date().toISOString(),
  playbackPosition: 0,
  bookmarkedSegmentIds: [],
  rounds: [],
  activeRoundId: '',
});

/**
 * S1 library shell aligned to V2: search + folder + sort in one tools row, compact
 * rows with kind mark and 待校对-first status. Folder CRUD stays on labeled controls
 * next to the folder select so existing capabilities are not removed.
 */
export function LibraryPage(props: Props) {
  const { query, onQueryChange: setQuery, order, onOrderChange: setOrder } = props;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [folderFor, setFolderFor] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const selected = props.selectedId;
  const searchRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const scope = useMemo(() => ({ folderId: props.selectedFolder }), [props.selectedFolder]);
  const { list, scoped } = useMemo(
    () => filterMaterials(props.materials, scope, query),
    [props.materials, scope, query],
  );
  const rows = useMemo(() => sortMaterials(list, order), [list, order]);
  const rowsView = useMemo(
    () => rows.map((material) => materialRow(material, props.folders)),
    [rows, props.folders],
  );
  const folders = useMemo(
    () => folderRows(props.folders, props.materials),
    [props.folders, props.materials],
  );

  const folderSelectValue =
    props.selectedFolder === null
      ? 'all'
      : props.selectedFolder === UNCATEGORIZED
        ? UNCATEGORIZED
        : props.selectedFolder;

  const activeFolder =
    props.selectedFolder && props.selectedFolder !== UNCATEGORIZED
      ? props.folders.find((f) => f.id === props.selectedFolder)
      : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const inputFocused = (event.target as HTMLElement | null)?.closest(
        'input, textarea, [contenteditable], select',
      );
      if (inputFocused) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key === 'F2' && selected) {
        event.preventDefault();
        beginRename(selected);
      }
      if (event.key === 'Escape') {
        setMenuFor(null);
        setFolderFor(null);
        setAddingFolder(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  function beginRename(id: string) {
    const material = props.materials.find((m) => m.id === id);
    if (!material) return;
    setRenameValue(defaultRenameValue(material));
    setRenaming(id);
    setMenuFor(null);
  }

  async function confirmDelete(id: string) {
    const material = props.materials.find((m) => m.id === id);
    setMenuFor(null);
    if (!material) return;
    if (
      !window.confirm(
        `删除「${material.displayName}」？音频、草稿和难句标记都会一并删除，无法恢复。`,
      )
    )
      return;
    await props.onDelete(id);
    props.onNotice(`已删除「${material.displayName}」。`);
  }

  async function confirmDeleteFolder(id: string) {
    const folder = props.folders.find((f) => f.id === id);
    if (!folder) return;
    if (
      !window.confirm(
        `删除文件夹「${folder.name}」？其中的素材会移到「未分类」，音频和学习记录都会保留。`,
      )
    )
      return;
    await props.onDeleteFolder(id);
    props.onSelectFolder(null);
    props.onNotice(`已删除文件夹「${folder.name}」，其中素材已移到未分类。`);
  }

  return (
    <section className="library">
      <div className="page-heading">
        <div>
          <h1>素材库</h1>
        </div>
        <button
          className="primary"
          disabled={!props.ready}
          onClick={() => void props.onCreate(blank()).catch(() => undefined)}
        >
          ＋ 导入素材
        </button>
      </div>

      <div className="library__content">
        <div className="library-tools">
          <input
            ref={searchRef}
            className="search"
            type="search"
            aria-label="搜索素材"
            placeholder="搜索素材"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            className="select"
            aria-label="文件夹"
            value={folderSelectValue}
            onChange={(event) => {
              const value = event.target.value;
              props.onSelectFolder(
                value === 'all' ? null : value === UNCATEGORIZED ? UNCATEGORIZED : value,
              );
            }}
          >
            {folders.map((row) => (
              <option
                key={row.id || 'all'}
                value={
                  row.virtual === 'all'
                    ? 'all'
                    : row.virtual === 'uncategorized'
                      ? UNCATEGORIZED
                      : row.id
                }
              >
                {row.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="排序"
            value={LIBRARY_SORT_OPTIONS.includes(order) ? order : 'recent'}
            onChange={(event) => setOrder(event.target.value as SortOrder)}
          >
            {LIBRARY_SORT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="quiet"
            aria-label="新建文件夹"
            onClick={() => {
              setAddingFolder(true);
              setFolderName('');
            }}
          >
            ＋ 文件夹
          </button>
          {activeFolder && (
            <span className="library-folder-actions">
              <button
                type="button"
                className="quiet"
                aria-label={`重命名文件夹 ${activeFolder.name}`}
                onClick={() => {
                  const next = window.prompt('文件夹名称', activeFolder.name);
                  if (next?.trim()) void props.onRenameFolder(activeFolder.id, next);
                }}
              >
                重命名
              </button>
              <button
                type="button"
                className="quiet"
                aria-label={`删除文件夹 ${activeFolder.name}`}
                onClick={() => void confirmDeleteFolder(activeFolder.id)}
              >
                删除
              </button>
            </span>
          )}
        </div>

        {addingFolder && (
          <form
            className="folders__new"
            onSubmit={async (event) => {
              event.preventDefault();
              if (folderName.trim()) {
                const created = await props.onCreateFolder(folderName);
                props.onSelectFolder(created.id);
                setAddingFolder(false);
              }
            }}
          >
            <input
              aria-label="新文件夹名称"
              value={folderName}
              autoFocus
              onChange={(event) => setFolderName(event.target.value)}
              onBlur={() => {
                if (!folderName.trim()) setAddingFolder(false);
              }}
            />
          </form>
        )}

        <p className="muted library__count">
          {scoped ? '当前文件夹' : `搜索「${query.trim()}」，已忽略文件夹`} · {rows.length} 段
        </p>

        <ul className="materials">
          {rowsView.map((row) => {
            const material = props.materials.find((m) => m.id === row.id)!;
            const status = libraryStatusLabel(row);
            return (
              <li key={row.id} className="library-item">
                {renaming === row.id ? (
                  <form
                    className="materials__rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (renameValue.trim()) props.onRename(row.id, renameValue);
                      setRenaming(null);
                    }}
                  >
                    <input
                      ref={renameRef}
                      aria-label={`重命名 ${row.displayName}`}
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => setRenaming(null)}
                    />
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`materials__row item-main${selected === row.id ? ' is-selected' : ''}`}
                      onClick={() => {
                        props.onSelect(row.id);
                        props.onOpen(row.id);
                      }}
                    >
                      <span className="item-mark" aria-hidden="true">
                        {row.kind === 'video' ? '▣' : '♫'}
                      </span>
                      <span className="materials__main item-meta">
                        <strong>{row.displayName}</strong>
                        <small className="muted">
                          {row.folderName} · {formatTime(row.duration)}
                          {row.hasSubtitles ? '' : ' · 无字幕'}
                          {row.stale > 0 ? ` · ${row.stale} 句待重新核对` : ''}
                        </small>
                      </span>
                      <span className={`item-state${row.needsReview ? ' item-state--review' : ''}`}>
                        {status}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="quiet icon more-row"
                      aria-label={`${row.displayName} 的更多操作`}
                      aria-expanded={menuFor === row.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuFor(menuFor === row.id ? null : row.id);
                        setFolderFor(null);
                      }}
                    >
                      ···
                    </button>
                    {menuFor === row.id && (
                      <div className="menu menu--right" role="menu">
                        <button
                          role="menuitem"
                          onClick={(event) => {
                            event.stopPropagation();
                            beginRename(row.id);
                          }}
                        >
                          重命名
                        </button>
                        <button
                          role="menuitem"
                          onClick={(event) => {
                            event.stopPropagation();
                            setFolderFor(row.id);
                            setMenuFor(null);
                          }}
                        >
                          移动到文件夹
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setMenuFor(null);
                            props.onPrepare(row.id);
                          }}
                        >
                          素材准备
                        </button>
                        <button role="menuitem" onClick={() => void confirmDelete(row.id)}>
                          删除
                        </button>
                      </div>
                    )}
                    {folderFor === row.id && (
                      <div className="menu menu--right" role="menu">
                        <button
                          role="menuitem"
                          onClick={() => {
                            props.onMove(row.id, null);
                            setFolderFor(null);
                          }}
                        >
                          未分类
                        </button>
                        {props.folders.map((folder) => (
                          <button
                            key={folder.id}
                            role="menuitem"
                            onClick={() => {
                              props.onMove(row.id, folder.id);
                              setFolderFor(null);
                            }}
                          >
                            {folder.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <span className="sr-only">{material.originalFileName}</span>
              </li>
            );
          })}
        </ul>
        {rowsView.length === 0 && (
          <p className="muted empty-row empty-state">
            {query.trim() ? '没有找到素材' : '这个文件夹还是空的。'}
          </p>
        )}
      </div>
      <p className="library__hint muted">
        快捷键：<kbd>Ctrl</kbd>+<kbd>F</kbd> 搜索 · <kbd>F2</kbd> 重命名 · <kbd>Esc</kbd> 关闭菜单
      </p>
    </section>
  );
}
