import { isDesktop } from '../../desktop';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  authorizeMediaPath,
  probeAuthorizedPath,
  stageImportFile,
  type MediaProbe,
} from '../../media';

export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v'];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus'];

export function isVideoFileName(name: string): boolean {
  return /\.(mp4|mkv|mov|webm|avi|m4v)$/i.test(name);
}

export function isAudioFileName(name: string): boolean {
  return /\.(mp3|wav|m4a|ogg|flac|aac|opus)$/i.test(name);
}

export function isVideoMedia(file: { name: string; type?: string }): boolean {
  if (file.type?.startsWith('video/')) return true;
  return isVideoFileName(file.name);
}

export function droppedFilePath(file: File): string | undefined {
  const path = (file as File & { path?: string }).path;
  return path?.trim() ? path : undefined;
}

export function fileNameFromPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Desktop "选择文件" must use the native dialog. WebView2's HTML file input
 * gives a File blob but no filesystem path, and video import needs a real path.
 */
export function importPickerKind(desktop: boolean): 'native-path' | 'html-file' {
  return desktop ? 'native-path' : 'html-file';
}

export async function pickLocalMediaPath(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: '媒体文件', extensions: [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  return selected;
}

function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    case 'aac':
      return 'audio/aac';
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mkv':
    case 'avi':
      return 'video/x-matroska';
    default:
      return 'application/octet-stream';
  }
}

/** Authorize a user-picked path, copy it into the app media cache, and return a File. */
export async function fileFromLocalPath(path: string, materialId: string): Promise<File> {
  const authorized = await authorizeMediaPath(path);
  const stagedPath = await stageImportFile(authorized, materialId);
  const bytes = await readFile(stagedPath);
  const name = fileNameFromPath(path);
  return new File([bytes], name, { type: mimeForName(name) });
}

export async function probeVideoPath(path: string): Promise<MediaProbe> {
  const authorized = await authorizeMediaPath(path);
  return probeAuthorizedPath(authorized);
}

export function listenDesktopMediaDrop(handlers: {
  onHover?: (hovering: boolean) => void;
  onDrop: (path: string) => void;
}): () => void {
  if (!isDesktop()) return () => undefined;
  let stop: (() => void) | undefined;
  let cancelled = false;
  void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
    if (cancelled) return;
    return getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          handlers.onHover?.(true);
        } else if (event.payload.type === 'leave') {
          handlers.onHover?.(false);
        } else if (event.payload.type === 'drop') {
          handlers.onHover?.(false);
          const path = event.payload.paths[0];
          if (path) handlers.onDrop(path);
        }
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      });
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}
