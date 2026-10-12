import { useCallback, useMemo, useState } from 'react';
import { useLibrary } from './useLibrary';
import type { Route } from './routes';
import { ErrorBoundary } from './ErrorBoundary';
import { HomePage } from '../features/home/HomePage';
import { LibraryPage } from '../features/library/LibraryPage';
import { StudyPage } from '../features/study/StudyPage';

/**
 * One window, a page stack, and no router dependency.
 *
 * `back` returns to the page a second-level view was opened from, which is what the
 * "← 返回" contract means - not a hard-coded jump to the library.
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

  const back = useCallback(() => {
    setRoute((current) => {
      switch (current.name) {
        case 'material':
          return {
            name: current.from === 'study' ? 'study' : 'library',
            ...materialOf(current),
          } as Route;
        case 'study':
          return current.from === 'home' ? { name: 'home' } : { name: 'library', folderId: null };
        case 'subtitles':
        case 'transcript':
          return { name: 'study', materialId: current.materialId, from: 'material' };
        default:
          return { name: 'home' };
      }
    });
  }, []);

  const material = useMemo(
    () => library.materials.find((m) => m.id === ('materialId' in route ? route.materialId : '')),
    [library.materials, route],
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
          <button
            className="quiet"
            onClick={() => {
              library.flush();
            }}
          >
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
              onSelect={(id) => setSelectedId(id)}
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
              onBack={back}
              onPrepare={() => go({ name: 'material', materialId: material.id, from: 'study' })}
              onTranscript={() => go({ name: 'transcript', materialId: material.id })}
              onSubtitles={() => go({ name: 'subtitles', materialId: material.id })}
              onNotice={setNotice}
              update={(transform) => library.update(transform, material.id)}
              markStudied={(patch) => library.markStudied(material.id, patch)}
            />
          )}
          {route.name === 'material' && material && (
            <MaterialPlaceholder
              material={material}
              onBack={back}
              onStudy={() => go({ name: 'study', materialId: material.id, from: 'material' })}
              onNotice={setNotice}
              update={(transform) => library.update(transform, material.id)}
            />
          )}
          {(route.name === 'subtitles' || route.name === 'transcript') && material && (
            <SecondaryPlaceholder
              route={route.name}
              material={material}
              onBack={back}
              update={(transform) => library.update(transform, material.id)}
            />
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}

const materialOf = (route: Extract<Route, { materialId: string }>) => ({
  materialId: route.materialId,
});

/**
 * Phase 2 owns material preparation and subtitle proofing. Rendered as an explicit
 * placeholder rather than a fake working form, per the spec's ban on static demos
 * standing in for real capability.
 */
function MaterialPlaceholder(props: {
  material: { displayName: string; segments: unknown[] };
  onBack: () => void;
  onStudy: () => void;
  onNotice: (message: string) => void;
  update: (transform: (material: any) => any) => void;
}) {
  return (
    <section className="placeholder">
      <button className="quiet back" onClick={props.onBack}>
        ← 返回
      </button>
      <h1>{props.material.displayName}</h1>
      <p className="muted">
        音频与字幕的分开导入、Whisper 识别与字幕校对将在<strong>阶段 2</strong>交付。
      </p>
      <p className="muted">当前素材已有 {props.material.segments.length} 个片段。</p>
      <button className="primary" onClick={props.onStudy}>
        开始听写
      </button>
    </section>
  );
}

/** Phases 3-5 own the shared player, 听读 and the full transcript page. */
function SecondaryPlaceholder(props: {
  route: 'subtitles' | 'transcript';
  material: { displayName: string };
  onBack: () => void;
  update: (transform: (material: any) => any) => void;
}) {
  return (
    <section className="placeholder">
      <button className="quiet back" onClick={props.onBack}>
        ← 返回
      </button>
      <h1>{props.route === 'subtitles' ? '字幕校对' : '完整原文'}</h1>
      <p className="muted">{props.material.displayName}</p>
      <p className="muted">
        该页面将在<strong>阶段 {props.route === 'subtitles' ? '2' : '5'}</strong>交付。
      </p>
    </section>
  );
}
