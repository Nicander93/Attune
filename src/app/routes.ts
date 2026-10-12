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

export type RouteName = Route['name'];

/** Study pages own ←/→/Space. Library and home must not react to playback keys. */
export const isStudyRoute = (route: Route) => route.name === 'study' || route.name === 'subtitles';

export const titleOf = (route: Route): string =>
  ({
    home: '首页',
    library: '素材库',
    material: '素材准备',
    study: '听写学习',
    subtitles: '字幕校对',
    transcript: '完整原文',
  })[route.name];
