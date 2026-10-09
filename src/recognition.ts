import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { RecognizedSentence } from './domain';
export { isDesktop } from './desktop';

export type ModelStatus = {
  id: string;
  label: string;
  sizeBytes: number;
  downloadedBytes: number;
  installed: boolean;
};
export type DownloadProgress = { modelId: string; downloadedBytes: number; totalBytes: number };
/** `modelUrl` is a download URL template; `{file}` becomes the model file name. */
export type RecognitionSettings = { modelUrl: string; modelId: string };

export const FILE_PLACEHOLDER = '{file}';
/** Every preset serves the same ggml files; downloads are checked against fixed SHA-256 sums. */
export const MODEL_SOURCES = [
  {
    label: 'ModelScope（国内）',
    template: 'https://www.modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/{file}',
  },
  {
    label: 'HF-Mirror',
    template: 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/{file}',
  },
  {
    label: 'Hugging Face（官方）',
    template: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file}',
  },
];
export const CANCELLED = '已取消';
const SAMPLE_RATE = 16000;
/** Larger single IPC payloads (tens of MB) crash the WebView2 renderer. */
const UPLOAD_CHUNK_SAMPLES = 1 << 20;
const SETTINGS_KEY = 'attune.recognition';
const DEFAULT_SETTINGS: RecognitionSettings = {
  modelUrl: MODEL_SOURCES[0].template,
  modelId: 'base.en',
};
/** Earlier builds saved only a mirror host and always appended this repository path. */
const LEGACY_DEFAULT_MIRROR = 'https://hf-mirror.com';
const LEGACY_REPOSITORY_PATH = '/ggerganov/whisper.cpp/resolve/main/{file}';

type SavedSettings = Partial<RecognitionSettings> & { mirror?: string };

/** Turns a saved mirror host into a URL template; the old default moves to the new default. */
export function migrateSettings(saved: SavedSettings): RecognitionSettings {
  const { mirror, ...current } = saved;
  const settings = { ...DEFAULT_SETTINGS, ...current };
  const host = mirror?.trim().replace(/\/+$/, '');
  if (!current.modelUrl && host && host !== LEGACY_DEFAULT_MIRROR)
    settings.modelUrl = host + LEGACY_REPOSITORY_PATH;
  return settings;
}

export function loadSettings(): RecognitionSettings {
  try {
    return migrateSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export function saveSettings(settings: RecognitionSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
export const isCancelled = (err: unknown) => String(err) === CANCELLED;

/** Explains what is wrong with a download URL template, or returns undefined when it is usable. */
export function modelUrlProblem(template: string): string | undefined {
  if (!/^https?:\/\//.test(template.trim())) return '下载地址需要以 https:// 或 http:// 开头。';
  if (!template.includes(FILE_PLACEHOLDER))
    return '下载地址需要包含 {file}，下载时会替换成模型文件名。';
}

export const listModels = () => invoke<ModelStatus[]>('list_models');

export async function downloadModel(
  modelId: string,
  urlTemplate: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  const stop = await listen<DownloadProgress>('model-download-progress', (e) =>
    onProgress(e.payload),
  );
  try {
    await invoke('download_model', { modelId, urlTemplate });
  } finally {
    stop();
  }
}
export const cancelDownload = () => invoke('cancel_download');

/** Asks for a local ggml model file; resolves null when the user closes the dialog. */
export const pickModelFile = () =>
  open({
    multiple: false,
    directory: false,
    filters: [{ name: 'whisper 模型（ggml）', extensions: ['bin'] }],
  });

export const importModel = (path: string) => invoke<ModelStatus>('import_model', { path });

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const mixed = new Float32Array(channels[0].length);
  for (const channel of channels)
    for (let i = 0; i < mixed.length; i++) mixed[i] += channel[i] / channels.length;
  return mixed;
}

/** Decodes audio and resamples it to the 16 kHz mono input whisper expects. */
async function decodeForRecognition(audio: Blob): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = await context.decodeAudioData(await audio.arrayBuffer());
  return mixToMono(
    Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i)),
  );
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw CANCELLED;
}

/** Rejects with CANCELLED as soon as `signal` aborts. */
function whenCancelled(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(CANCELLED);
    signal.addEventListener('abort', () => reject(CANCELLED), { once: true });
  });
}

async function uploadAudio(samples: Float32Array, signal: AbortSignal): Promise<void> {
  await invoke('clear_audio');
  try {
    for (let i = 0; i < samples.length; i += UPLOAD_CHUNK_SAMPLES) {
      throwIfCancelled(signal);
      const chunk = samples.subarray(i, i + UPLOAD_CHUNK_SAMPLES);
      await invoke(
        'append_audio',
        new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      );
    }
    throwIfCancelled(signal);
  } catch (err) {
    await invoke('clear_audio').catch(() => undefined);
    throw err;
  }
}

/**
 * Recognizes `audio`. Aborting `signal` stops at once while decoding or uploading;
 * once recognition runs, `cancelRecognition` stops it.
 */
export async function recognize(
  audio: Blob,
  modelId: string,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<RecognizedSentence[]> {
  const samples = await Promise.race([decodeForRecognition(audio), whenCancelled(signal)]);
  if (!samples.length) throw new Error('音频里没有可识别的内容，请重新导入音频。');
  await uploadAudio(samples, signal);
  const stop = await listen<number>('recognition-progress', (e) => onProgress(e.payload));
  try {
    return await invoke<RecognizedSentence[]>('recognize', { modelId });
  } finally {
    stop();
  }
}
export const cancelRecognition = () => invoke('cancel_recognition');
