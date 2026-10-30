import { useCallback, useMemo, useRef, useState } from 'react';
import { useLibrary } from './useLibrary';
import type { Route } from './routes';
import { ErrorBoundary } from './ErrorBoundary';
import logoUrl from '../assets/logo.svg';
import { HomePage } from '../features/home/HomePage';
import { blank, LibraryPage } from '../features/library/LibraryPage';
import { MaterialWorkspace } from './MaterialWorkspace';
import type { SortOrder } from '../features/library/listing';

/**
 * One window, a page stack, and no router dependency.
 *
 * `← 返回` returns to the page a second-level view was opened from, which is what the
 * spec means by "返回实际来源页面" - not a hard-coded jump to the library.
 */
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

  return (
    <div
      className="app"
      data-saving={library.saving ? 'true' : 'false'}
      data-focus={focusStudy ? 'study' : undefined}
    >
      {!focusStudy && (
        <header className="topbar">
          <button className="brand" onClick={() => go({ name: 'home' })}>
            <img className="brand__mark" src={logoUrl} alt="" width={20} height={20} />
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
      )}

      {library.error && (
        <div className="banner banner--error" role="alert">
          {library.error}
          <button className="quiet" onClick={library.flush}>
            重试保存
          </button>
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          {notice}
        </div>
      )}

      <main className="page">
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
