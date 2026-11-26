import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLibrary } from './useLibrary';
import type { Route } from './routes';
import { ErrorBoundary } from './ErrorBoundary';
import { HomePage } from '../features/home/HomePage';
import { blank, LibraryPage } from '../features/library/LibraryPage';
import { MaterialWorkspace } from './MaterialWorkspace';
import type { SortOrder } from '../features/library/listing';
import { prefersReducedMotion, usePresence } from './motion';

/**
 * One window, a page stack, and no router dependency.
 *
 * `← 返回` returns to the page a second-level view was opened from, which is what the
 * spec means by "返回实际来源页面" - not a hard-coded jump to the library.
 */

function ShellBanner({
  message,
  error,
  children,
}: {
  message: string;
  error?: boolean;
  children?: ReactNode;
}) {
  const presence = usePresence(Boolean(message));
  const [text, setText] = useState(message);
  useEffect(() => {
    if (message) setText(message);
  }, [message]);
  if (presence === 'exited') return null;
  return (
    <div
      className={error ? 'banner banner--error' : 'banner'}
      data-motion={presence}
      role={error ? 'alert' : 'status'}
    >
      {text}
      {children}
    </div>
  );
}

export function App() {
  const library = useLibrary();
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const history = useRef<Route[]>([]);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<SortOrder>('recent');
  // Kept above the pages so a row stays selected when the user returns from a study
  // session, which is what makes F2 rename work on the material they just practised.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const go = useCallback(
    (next: Route) => {
      setNotice('');
      history.current.push(route);
      setRoute(next);
    },
    [route],
  );

  const goBack = useCallback(() => setRoute(history.current.pop() ?? { name: 'home' }), []);
  async function createMaterial(material = blank()) {
    await library.add(material);
    go({
      name: 'material',
      materialId: material.id,
      from: route.name === 'home' ? 'home' : 'library',
    });
  }

  const material = useMemo(
    () => library.materials.find((m) => m.id === ('materialId' in route ? route.materialId : '')),
    [library.materials, route],
  );
  const update = useCallback(
    (transform: Parameters<typeof library.update>[0]) =>
      material && library.update(transform, material.id),
    [library, material],
  );

  const focusStudy = route.name === 'study';
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    el.classList.remove('is-entering');
    if (prefersReducedMotion()) return;
    void el.offsetWidth;
    el.classList.add('is-entering');
  }, [route.name]);

  return (
    <div
      className="app"
      data-saving={library.saving ? 'true' : 'false'}
      data-focus={focusStudy ? 'study' : undefined}
    >
      <header
        className="topbar"
        aria-hidden={focusStudy || undefined}
        inert={focusStudy || undefined}
      >
        <button className="brand" onClick={() => go({ name: 'home' })} aria-label="Attune 首页">
          <span className="brand__bars" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          Attune
        </button>
        <nav className="topbar__nav" aria-label="主导航">
          <button
            className="quiet"
            aria-current={route.name === 'home' ? 'page' : undefined}
            onClick={() => go({ name: 'home' })}
          >
            首页
          </button>
          <button
            className="quiet"
            aria-current={route.name === 'library' ? 'page' : undefined}
            onClick={() => go({ name: 'library', folderId: null })}
          >
            素材库
          </button>
        </nav>
      </header>

      <ShellBanner message={library.error} error>
        <button className="quiet" onClick={library.flush}>
          重试保存
        </button>
      </ShellBanner>
      <ShellBanner message={notice} />

      <main className="page" ref={pageRef}>
        <ErrorBoundary key={material?.id ?? route.name}>
          {route.name === 'home' && (
            <HomePage
              materials={library.materials}
              ready={library.ready}
              onContinue={(id) => go({ name: 'study', materialId: id, from: 'home' })}
              onOpenLibrary={() => go({ name: 'library', folderId: null })}
              onNewMaterial={() => void createMaterial().catch(() => undefined)}
            />
          )}

          {route.name === 'library' && (
            <LibraryPage
              materials={library.materials}
              folders={library.folders}
              ready={library.ready}
              selectedFolder={route.folderId}
              query={query}
              onQueryChange={setQuery}
              order={order}
              onOrderChange={setOrder}
              onSelectFolder={(folderId) => setRoute({ name: 'library', folderId })}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onOpen={(id) => go({ name: 'study', materialId: id, from: 'library' })}
              onPrepare={(id) => go({ name: 'material', materialId: id, from: 'library' })}
              onCreate={createMaterial}
              onRename={library.rename}
              onMove={library.moveToFolder}
              onDelete={library.remove}
              onCreateFolder={library.createFolder}
              onRenameFolder={library.renameFolder}
              onDeleteFolder={library.removeFolder}
              onNotice={setNotice}
            />
          )}

          {material && (
            <MaterialWorkspace
              key={material.id}
              material={material}
              route={route}
              update={update}
              go={go}
              onBack={goBack}
              onNotice={setNotice}
            />
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
