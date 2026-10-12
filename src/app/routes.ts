/**
 * Where the user is. A second-level page remembers where it was opened from so
 * "← 返回" returns to the real origin instead of always jumping to the library.
 */
export type Route =
  | { name: 'home' }
  | { name: 'library'; folderId: string | null }
  | { name: 'material'; materialId: string; from: 'home' | 'library' | 'study' }
  | { name: 'study'; materialId: string; from: 'home' | 'library' | 'material' }
  | { name: 'subtitles'; materialId: string }
  | { name: 'transcript'; materialId: string };

export function previousRoute(route: Route): Route {
  switch (route.name) {
    case 'home':
      return { name: 'home' };
    case 'library':
      return { name: 'home' };
    case 'material':
      return route.from === 'study'
        ? { name: 'study', materialId: route.materialId, from: 'material' }
        : { name: 'library', folderId: null };
    case 'study':
      return route.from === 'home' ? { name: 'home' } : { name: 'library', folderId: null };
    case 'subtitles':
    case 'transcript':
      return { name: 'study', materialId: route.materialId, from: 'material' };
  }
}
