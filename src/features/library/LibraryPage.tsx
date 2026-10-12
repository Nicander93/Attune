import { useEffect, useMemo, useRef, useState } from 'react';
import type { Folder, Material } from '../../domain/types';
import { displayTime } from '../../domain/types';
import {
  UNCATEGORIZED,
  SORT_LABELS,
  defaultRenameValue,
  filterMaterials,
  folderRows,
  materialRow,
  progressLabel,
  sortMaterials,
  type SortOrder,
} from './listing';

type Props = {
  materials: Material[];
  folders: Folder[];
  ready: boolean;
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

const blank = (): Material => ({
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

export function LibraryPage(props: Props) {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<SortOrder>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [folderFor, setFolderFor] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const selected = props.selectedId;
  const searchRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const scope = useMemo(() => ({ folderId: props.selectedFolder }), [props.selectedFolder]);
  const { list, scoped } = useMemo(
    () => filterMaterials(props.materials, scope, query),
    [props.materials, scope, query],
  );
  const rows = useMemo(() => sortMaterials(list, order), [list, order]);
  const rowsView = useMemo(() => rows.map(materialRow), [rows]);
  const folders = useMemo(
    () => folderRows(props.folders, props.materials),
    [props.folders, props.materials],
  );

  // Library-scoped shortcuts only. Playback and sentence navigation belong to study
  // pages, so Ctrl+F and F2 must not leak out of this screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
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
        setSortOpen(false);
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
    // Deleting throws away audio, drafts and bookmarks, so it always asks.
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
    setFolderFor(null);
    setAddingFolder(false);
    if (!folder) return;
    // Deleting a folder never deletes what is inside it.
    if (
      !window.confirm(
        `删除文件夹「${folder.name}」？其中的素材会移到「未分类」，音频和学习记录都会保留。`,
      )
    )
      return;
    await props.onDeleteFolder(id);
    props.onNotice(`已删除文件夹「${folder.name}」，其中素材已移到未分类。`);
  }

  return (
    <section className="library">
      <div className="page-heading">
        <div>
          <p className="eyebrow">素材库</p>
          <h1>全部素材</h1>
        </div>
        <button className="primary" disabled={!props.ready} onClick={() => props.onCreate(blank())}>
          ＋ 新建素材
        </button>
      </div>

      <div className="library__body">
        <aside className="folders" aria-label="文件夹">
          <div className="folders__head">
            <span className="caption">文件夹</span>
            <button
              className="quiet"
              aria-label="新建文件夹"
              onClick={() => {
                setAddingFolder(true);
                setFolderName('');
              }}
            >
              ＋
            </button>
          </div>
          <ul>
            {folders.map((row) => {
              const id =
                row.virtual === 'all'
                  ? null
                  : row.virtual === 'uncategorized'
                    ? UNCATEGORIZED
                    : row.id;
              const active =
                (row.virtual === 'all' && props.selectedFolder === null) ||
                (row.virtual === 'uncategorized' && props.selectedFolder === UNCATEGORIZED) ||
                (row.id === props.selectedFolder && !row.virtual);
              return (
                <li key={row.id}>
                  <button
                    className={`folders__item${active ? ' is-active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() =>
                      props.onSelectFolder(
                        row.virtual === 'all'
                          ? null
                          : row.virtual === 'uncategorized'
                            ? UNCATEGORIZED
                            : row.id,
                      )
                    }
                  >
                    <span>{row.name}</span>
                    <span className="muted">{row.count ?? ''}</span>
                  </button>
                  {!row.virtual && (
                    <span className="folders__actions">
                      <button
                        className="quiet"
                        aria-label={`重命名文件夹 ${row.name}`}
                        onClick={() => {
                          setFolderName(row.name);
                          setFolderFor(row.id);
                        }}
                      >
                        ⋯
                      </button>
                      {folderFor === row.id && (
                        <span className="menu" role="menu">
                          <button
                            role="menuitem"
                            onClick={() => {
                              const next = window.prompt('文件夹名称', folderName);
                              if (next?.trim()) void props.onRenameFolder(row.id, next);
                              setFolderFor(null);
                            }}
                          >
                            重命名
                          </button>
                          <button role="menuitem" onClick={() => void confirmDeleteFolder(row.id)}>
                            删除文件夹
                          </button>
                        </span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {addingFolder && (
            <form
              className="folders__new"
              onSubmit={async (event) => {
                event.preventDefault();
                if (folderName.trim()) {
                  await props.onCreateFolder(folderName);
                  setAddingFolder(false);
                }
              }}
            >
              <input
                aria-label="新文件夹名称"
                value={folderName}
                autoFocus
                onChange={(event) => setFolderName(event.target.value)}
                onBlur={() => setAddingFolder(false)}
              />
            </form>
          )}
        </aside>

        <div className="library__list">
          <div className="library__toolbar">
            <input
              ref={searchRef}
              type="search"
              aria-label="搜索全部素材"
              placeholder="搜索全部素材"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="sortmenu">
              <button
                className="quiet icon"
                aria-label={`排序：${SORT_LABELS[order]}`}
                aria-expanded={sortOpen}
                onClick={() => setSortOpen((open) => !open)}
              >
                ⚑
              </button>
              {sortOpen && (
                <ul className="menu" role="menu">
                  {(Object.keys(SORT_LABELS) as SortOrder[]).map((value) => (
                    <li key={value}>
                      <button
                        role="menuitemradio"
                        aria-checked={order === value}
                        onClick={() => {
                          setOrder(value);
                          setSortOpen(false);
                        }}
                      >
                        {SORT_LABELS[value]}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p className="muted library__count">
            {scoped ? '当前文件夹' : `搜索「${query.trim()}」，已忽略文件夹`} · {rows.length} 段
          </p>

          <ul className="materials">
            {rowsView.map((row) => {
              const material = props.materials.find((m) => m.id === row.id)!;
              return (
                <li key={row.id}>
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
                    <div
                      className={`materials__row${selected === row.id ? ' is-selected' : ''}`}
                      tabIndex={0}
                      role="button"
                      onClick={() => {
                        props.onSelect(row.id);
                        props.onOpen(row.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          props.onOpen(row.id);
                        }
                      }}
                    >
                      <span className="materials__main">
                        <strong>{row.displayName}</strong>
                        <span className="muted">
                          {displayTime(row.duration)} · {progressLabel(row)}
                          {row.hasSubtitles ? '' : ' · 无字幕'}
                          {row.stale > 0 ? ` · ${row.stale} 句待重新核对` : ''}
                        </span>
                      </span>
                      <span className="materials__actions">
                        {!row.hasSubtitles && (
                          <button
                            className="quiet"
                            onClick={(event) => {
                              event.stopPropagation();
                              props.onPrepare(row.id);
                            }}
                          >
                            准备
                          </button>
                        )}
                        {row.started ? (
                          <button
                            className="quiet"
                            onClick={(event) => {
                              event.stopPropagation();
                              props.onOpen(row.id);
                            }}
                          >
                            继续
                          </button>
                        ) : (
                          <button
                            className="quiet"
                            onClick={(event) => {
                              event.stopPropagation();
                              props.onOpen(row.id);
                            }}
                          >
                            开始
                          </button>
                        )}
                        <button
                          className="quiet icon"
                          aria-label={`${row.displayName} 的更多操作`}
                          aria-expanded={menuFor === row.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuFor(menuFor === row.id ? null : row.id);
                          }}
                        >
                          ⋯
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
                            <button role="menuitem" onClick={() => props.onPrepare(row.id)}>
                              素材准备
                            </button>
                            <button role="menuitem" onClick={() => void confirmDelete(row.id)}>
                              删除
                            </button>
                          </div>
                        )}
                      </span>
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
                  <span className="sr-only">{material.originalFileName}</span>
                </li>
              );
            })}
          </ul>
          {rowsView.length === 0 && (
            <p className="muted empty-row">
              {query.trim() ? '没有匹配的素材。' : '这个文件夹还是空的。'}
            </p>
          )}
        </div>
      </div>
      <p className="library__hint muted">
        快捷键：<kbd>Ctrl</kbd>+<kbd>F</kbd> 搜索 · <kbd>F2</kbd> 重命名 · <kbd>Esc</kbd> 关闭菜单
      </p>
    </section>
  );
}
