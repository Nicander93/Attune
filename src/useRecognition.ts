import { useRef, useState } from 'react';
import { sentencesToSegments, type Material, type Segment } from './domain';
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
  onRecognized: (materialId: string, segments: Segment[]) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};
const megabytes = (bytes: number) => (bytes / 1_048_576).toFixed(1);

export function useRecognition({ onRecognized, onError, onNotice }: Callbacks) {
  const [settings, setSettings] = useState(loadSettings),
    [models, setModels] = useState<ModelStatus[]>([]),
    [task, setTask] = useState<Task | undefined>();
  const cancelled = useRef(false);

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
    setTask({ label: `正在下载模型 ${model.label}…`, cancel: () => void cancelDownload() });
    try {
      await downloadModel(model.id, settings.mirror, (p) =>
        setTask({
          label: `正在下载模型：${megabytes(p.downloadedBytes)} / ${megabytes(p.totalBytes)} MB`,
          percent: (p.downloadedBytes / p.totalBytes) * 100,
          cancel: () => void cancelDownload(),
        }),
      );
    } finally {
      await refreshModels().catch(() => undefined);
    }
  }
  async function run(work: () => Promise<void>, cancelledMessage: string) {
    try {
      await work();
    } catch (err) {
      if (isCancelled(err)) onNotice(cancelledMessage);
      else onError(String(err));
    } finally {
      setTask(undefined);
    }
  }
  function downloadSelected() {
    const model = models.find((m) => m.id === settings.modelId);
    if (!model || task) return;
    void run(async () => {
      await download(model);
      onNotice('模型已下载并通过校验。');
    }, '已暂停下载，下次会从断点继续。');
  }
  function importLocal() {
    if (task) return;
    void run(async () => {
      const path = await pickModelFile();
      if (!path) return;
      setTask({ label: '正在导入并检查模型文件…' });
      const model = await importModel(path);
      await refreshModels();
      changeSettings({ ...settings, modelId: model.id });
      onNotice(`已导入模型：${model.label}`);
    }, '已取消导入。');
  }
  function start(material: Material) {
    if (task) return;
    cancelled.current = false;
    const stop = () => {
      cancelled.current = true;
      void cancelRecognition();
    };
    void run(async () => {
      const model = (await refreshModels()).find((m) => m.id === settings.modelId);
      if (!model) throw new Error('请先在识别设置中选择模型。');
      if (!model.installed) await download(model);
      setTask({ label: '正在解码音频…', cancel: stop });
      const sentences = await recognize(material.audio, model.id, (percent) =>
        setTask({ label: `正在识别：${percent}%`, percent, cancel: stop }),
      );
      if (cancelled.current) throw CANCELLED;
      const segments = sentencesToSegments(sentences, material.duration);
      if (!segments.length) {
        onNotice('没有识别出英文语音，片段保持不变。');
        return;
      }
      onRecognized(material.id, segments);
    }, '已取消，片段没有改动。');
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
