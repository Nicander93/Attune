import { useEffect, useRef, useState } from 'react';
import { sentencesToSegments } from './domain/subtitles';
import type { Material, SubtitleSegment } from './domain/types';
import {
  COPY,
  downloadingModelProgress,
  megabytesLabel,
  modelConsentMessage,
} from './features/material/import-messages';
import {
  CANCELLED,
  cancelDownload,
  cancelRecognition,
  downloadModel,
  importModel,
  isCancelled,
  listModels,
  loadSettings,
  pickModelFile,
  recognize,
  saveSettings,
  type ModelStatus,
  type RecognitionSettings,
} from './recognition';

export type Task = { label: string; percent?: number; cancel?: () => void };
type Callbacks = {
  /** Called once with the complete result; never with partial segments. */
  onRecognized: (materialId: string, segments: SubtitleSegment[]) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};
const megabytes = (bytes: number) => (bytes / 1_048_576).toFixed(1);

export function useRecognition({ onRecognized, onError, onNotice }: Callbacks) {
  const [settings, setSettings] = useState(loadSettings),
    [models, setModels] = useState<ModelStatus[]>([]),
    [task, setTask] = useState<Task | undefined>();
  const busy = useRef(false);
  const cancelTask = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelTask.current?.(), []);

  function changeSettings(next: RecognitionSettings) {
    setSettings(next);
    saveSettings(next);
  }
  async function refreshModels(): Promise<ModelStatus[]> {
    const items = await listModels();
    setModels(items);
    return items;
  }
  async function download(model: ModelStatus): Promise<void> {
    setTask({ label: COPY.downloadingModel, cancel: () => void cancelDownload() });
    try {
      await downloadModel(model.id, settings.modelUrl, (progress) =>
        setTask({
          label: downloadingModelProgress(
            megabytes(progress.downloadedBytes),
            megabytes(progress.totalBytes),
          ),
          percent: (progress.downloadedBytes / progress.totalBytes) * 100,
          cancel: () => void cancelDownload(),
        }),
      );
    } finally {
      await refreshModels().catch(() => undefined);
    }
  }
  async function run(work: () => Promise<void>, cancelledMessage: string) {
    if (busy.current) return;
    busy.current = true;
    try {
      await work();
    } catch (err) {
      if (isCancelled(err)) onNotice(cancelledMessage);
      else onError(String(err));
    } finally {
      busy.current = false;
      cancelTask.current = undefined;
      setTask(undefined);
    }
  }
  function downloadSelected() {
    const model = models.find((item) => item.id === settings.modelId);
    if (!model || task || busy.current) return;
    cancelTask.current = () => void cancelDownload();
    void run(async () => {
      await download(model);
      onNotice('识别数据已下载并准备好。');
    }, '已暂停下载，下次会从断点继续。');
  }
  function importLocal() {
    if (task || busy.current) return;
    void run(async () => {
      const path = await pickModelFile();
      if (!path) return;
      setTask({ label: COPY.importingModel });
      const model = await importModel(path);
      await refreshModels();
      changeSettings({ ...settings, modelId: model.id });
      onNotice('已导入识别数据。');
    }, '已取消导入。');
  }
  function start(material: Material) {
    if (task || busy.current) return;
    const controller = new AbortController();
    const stop = () => {
      controller.abort();
      void cancelRecognition();
      void cancelDownload();
    };
    cancelTask.current = stop;
    void run(async () => {
      const model = (await refreshModels()).find((item) => item.id === settings.modelId);
      if (!model) throw new Error(COPY.recognitionNoModel);
      if (!model.installed) {
        const sizeMb = Number(megabytesLabel(model.sizeBytes - model.downloadedBytes));
        if (!window.confirm(modelConsentMessage(sizeMb))) throw CANCELLED;
        await download(model);
      }
      setTask({ label: COPY.preparingSubtitles, cancel: stop });
      const sentences = await recognize(
        material.audio,
        model.id,
        (percent) =>
          setTask({
            label: `正在准备字幕… ${percent}%`,
            percent,
            cancel: stop,
          }),
        controller.signal,
      );
      if (controller.signal.aborted) throw CANCELLED;
      const segments = sentencesToSegments(sentences, material.duration);
      if (!segments.length) {
        onError(COPY.recognitionNoSpeech);
        return;
      }
      onRecognized(material.id, segments);
    }, COPY.recognitionCancelled);
  }
  return {
    settings,
    changeSettings,
    models,
    refreshModels,
    task,
    start,
    downloadSelected,
    importLocal,
  };
}
