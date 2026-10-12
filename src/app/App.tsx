import { useCallback, useMemo, useState } from 'react';
import { useLibrary } from './useLibrary';
import type { Route } from './routes';
import { previousRoute } from './routes';
import { ErrorBoundary } from './ErrorBoundary';
import { HomePage } from '../features/home/HomePage';
import { LibraryPage } from '../features/library/LibraryPage';
import { MaterialPrepPage } from '../features/material/MaterialPrepPage';
import { SubtitleProofPage } from '../features/subtitles/SubtitleProofPage';
import { StudyPage } from '../features/study/StudyPage';
import { TranscriptPage } from '../features/reading/TranscriptPage';

/**
 * One window, a page stack, and no router dependency.
 *
 * `← 返回` returns to the page a second-level view was opened from, which is what the
 * spec means by "返回实际来源页面" - not a hard-coded jump to the library.
 */
export function App() {
  const library = useLibrary();
  const [route, setRoute] = useState<Route>({ name: 'home' });
  // Kept above the pages so a row stays selected when the user returns from a study
  // session, which is what makes F2 rename work on the material they just practised.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const go = useCallback((next: Route) => {
    setNotice('');
    setRoute(next);
  }, []);

  const back = useCallback((current: Route): Route => previousRoute(current), []);
  const goBack = useCallback(() => setRoute(back), [back]);

  const material = useMemo(
    () => library.materials.find((m) => m.id === ('materialId' in route ? route.materialId : '')),
    [library.materials, route],
  );
  const update = useCallback(
    (transform: Parameters<typeof library.update>[0]) =>
      material && library.update(transform, material.id),
    [library, material],
  );

  return (
    <div className="app" data-saving={library.saving ? 'true' : 'false'}>
      <header className="topbar">
        <button className="brand" onClick={() => go({ name: 'home' })}>
          <span className="brand__mark" aria-hidden="true" />
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
        <ErrorBoundary key={route.name}>
          {route.name === 'home' && (
            <HomePage
              materials={library.materials}
              ready={library.ready}
              onContinue={(id) => go({ name: 'study', materialId: id, from: 'home' })}
              onOpenLibrary={() => go({ name: 'library', folderId: null })}
              onNewMaterial={() => go({ name: 'library', folderId: null })}
            />
          )}

          {route.name === 'library' && (
            <LibraryPage
              materials={library.materials}
              folders={library.folders}
              ready={library.ready}
              selectedFolder={route.folderId}
              onSelectFolder={(folderId) => go({ name: 'library', folderId })}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onOpen={(id) => go({ name: 'study', materialId: id, from: 'library' })}
              onPrepare={(id) => go({ name: 'material', materialId: id, from: 'library' })}
              onCreate={library.add}
              onRename={library.rename}
              onMove={library.moveToFolder}
              onDelete={library.remove}
              onCreateFolder={library.createFolder}
              onRenameFolder={library.renameFolder}
              onDeleteFolder={library.removeFolder}
              onNotice={setNotice}
            />
          )}

          {route.name === 'study' && material && (
            <StudyPage
              material={material}
              update={update}
              onBack={goBack}
              onPrepare={() => go({ name: 'material', materialId: material.id, from: 'study' })}
              onSubtitles={() => go({ name: 'subtitles', materialId: material.id })}
              onTranscript={() => go({ name: 'transcript', materialId: material.id })}
              onNotice={setNotice}
            />
          )}

          {route.name === 'material' && material && (
            <MaterialPrepPage
              material={material}
              update={update}
              onBack={goBack}
              onStudy={() => go({ name: 'study', materialId: material.id, from: 'material' })}
              onNotice={setNotice}
            />
          )}

          {route.name === 'subtitles' && material && (
            <SubtitleProofPage
              material={material}
              update={update}
              onBack={goBack}
              onNotice={setNotice}
            />
          )}

          {route.name === 'transcript' && material && (
            <TranscriptPage
              material={material}
              onBack={goBack}
              onPlayFrom={(segmentId) => {
                const target = material.segments.find((s) => s.id === segmentId);
                if (target) update((m) => ({ ...m, playbackPosition: target.start }));
              }}
            />
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
