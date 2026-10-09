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
export type RecognitionSettings = { mirror: string; modelId: string };

export const MIRRORS = [
  { label: 'HF-Mirror（国内镜像）', url: 'https://hf-mirror.com' },
  { label: 'Hugging Face（官方）', url: 'https://huggingface.co' },
];
export const CANCELLED = '已取消';
const SAMPLE_RATE = 16000;
/** Larger single IPC payloads (tens of MB) crash the WebView2 renderer. */
const UPLOAD_CHUNK_SAMPLES = 1 << 20;
const SETTINGS_KEY = 'attune.recognition';
const DEFAULT_SETTINGS: RecognitionSettings = { mirror: MIRRORS[0].url, modelId: 'base.en' };

export function loadSettings(): RecognitionSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export function saveSettings(settings: RecognitionSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
export const isCancelled = (err: unknown) => String(err) === CANCELLED;

export const listModels = () => invoke<ModelStatus[]>('list_models');

export async function downloadModel(
  modelId: string,
  mirror: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  const stop = await listen<DownloadProgress>('model-download-progress', (e) =>
    onProgress(e.payload),
  );
  try {
    await invoke('download_model', { modelId, mirror });
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

export async function recognize(
  audio: Blob,
  modelId: string,
  onProgress: (percent: number) => void,
): Promise<RecognizedSentence[]> {
  const samples = await decodeForRecognition(audio);
  await invoke('clear_audio');
  for (let i = 0; i < samples.length; i += UPLOAD_CHUNK_SAMPLES) {
    const chunk = samples.subarray(i, i + UPLOAD_CHUNK_SAMPLES);
    await invoke('append_audio', new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  const stop = await listen<number>('recognition-progress', (e) => onProgress(e.payload));
  try {
    return await invoke<RecognizedSentence[]>('recognize', { modelId });
  } finally {
    stop();
  }
}
export const cancelRecognition = () => invoke('cancel_recognition');
