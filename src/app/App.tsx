import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLibrary } from './useLibrary';
import type { Route } from './routes';
import { ErrorBoundary } from './ErrorBoundary';
import { HomePage } from '../features/home/HomePage';
import { blank, LibraryPage } from '../features/library/LibraryPage';
import { MaterialWorkspace } from './MaterialWorkspace';
import type { SortOrder } from '../features/library/listing';
import { prefersReducedMotion, usePresence } from './motion';

function translatedY(el: Element) {
  const transform = getComputedStyle(el).transform;
  if (!transform || transform === 'none') return 0;
  const matrix3d = transform.match(/matrix3d\((.+)\)/);
  if (matrix3d) {
    const parts = matrix3d[1].split(',').map(Number);
    return parts[13] ?? 0;
  }
  const matrix = transform.match(/matrix\((.+)\)/);
  if (!matrix) return 0;
  const parts = matrix[1].split(',').map(Number);
  return parts[5] ?? 0;
}

function syncBannerAnchor(focusStudy: boolean) {
  const root = document.querySelector('.app');
  if (!(root instanceof HTMLElement)) return;
  const chrome = focusStudy
    ? document.querySelector('.study__head')
    : document.querySelector('.topbar');
  const banner = document.querySelector('.banner');
  const rootTop = root.getBoundingClientRect().top;
  // Use the layout box, not a mid-transition translated box, so the banner
  // cannot be pinned 8px into a topbar that is still sliding in.
  const chromeBottom =
    chrome instanceof HTMLElement
      ? chrome.getBoundingClientRect().bottom - translatedY(chrome) - rootTop
      : 0;
  const bannerHeight = banner instanceof HTMLElement ? banner.getBoundingClientRect().height : 0;
  if (chromeBottom > 0) root.style.setProperty('--banner-top', `${Math.round(chromeBottom)}px`);
  if (bannerHeight > 0) {
    root.style.setProperty('--shell-banner-height', `${Math.round(bannerHeight)}px`);
  }
}

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
  const open = Boolean(message);
  const presence = usePresence(open);
  const [text, setText] = useState(message);
  useEffect(() => {
    if (message) setText(message);
  }, [message]);
  // Stay mounted in the same render as `message`, so the reserved slot can be
  // measured before paint. `usePresence` would otherwise still be exited.
  if (!open && presence === 'exited') return null;
  const motion = open && presence === 'exited' ? 'entering' : presence;
  return (
    <div
      className={error ? 'banner banner--error' : 'banner'}
      data-motion={motion}
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

  const bannerPresent = Boolean(notice || library.error);
  useLayoutEffect(() => {
    syncBannerAnchor(focusStudy);
    const root = document.querySelector('.app');
    if (!root) return;
    const observer = new ResizeObserver(() => syncBannerAnchor(focusStudy));
    observer.observe(root);
    const banner = document.querySelector('.banner');
    if (banner) observer.observe(banner);
    const chrome = focusStudy
      ? document.querySelector('.study__head')
      : document.querySelector('.topbar');
    if (chrome) observer.observe(chrome);
    const mutations = new MutationObserver(() => {
      syncBannerAnchor(focusStudy);
      const nextBanner = document.querySelector('.banner');
      if (nextBanner) observer.observe(nextBanner);
    });
    mutations.observe(root, { childList: true, subtree: true });
    const onResize = () => syncBannerAnchor(focusStudy);
    const onTransition = () => syncBannerAnchor(focusStudy);
    window.addEventListener('resize', onResize);
    root.addEventListener('transitionend', onTransition);
    const later = window.setTimeout(() => syncBannerAnchor(focusStudy), 280);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', onResize);
      root.removeEventListener('transitionend', onTransition);
      window.clearTimeout(later);
    };
  }, [focusStudy, bannerPresent, notice, library.error, route.name]);

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
