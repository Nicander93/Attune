import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

/** True inside the Tauri desktop app; the browser build has no native backend. */
export const isDesktop = () => '__TAURI_INTERNALS__' in window;

/**
 * Saves text the user exports. The desktop WebView does not save `<a download>` links, so the
 * desktop app asks for a location instead. Resolves false when the user cancels.
 */
export async function saveTextFile(name: string, text: string, type: string): Promise<boolean> {
  if (isDesktop()) {
    const extension = name.split('.').pop() ?? '';
    const path = await save({
      defaultPath: name,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!path) return false;
    await writeTextFile(path, text);
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
