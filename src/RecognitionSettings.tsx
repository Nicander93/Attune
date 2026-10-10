import {
  MODEL_SOURCES,
  modelUrlProblem,
  type ModelStatus,
  type RecognitionSettings as Settings,
} from './recognition';

function modelState(model: ModelStatus): string {
  if (model.installed) return '已就绪';
  if (model.downloadedBytes > 0)
    return `已下载 ${Math.floor((model.downloadedBytes / model.sizeBytes) * 100)}%，可继续`;
  return '未下载';
}

export function RecognitionSettings(props: {
  settings: Settings;
  models: ModelStatus[];
  busy: boolean;
  onChange: (settings: Settings) => void;
  onDownload: () => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const { settings, models, busy, onChange } = props;
  const selected = models.find((m) => m.id === settings.modelId);
  const urlProblem = modelUrlProblem(settings.modelUrl);
  return (
    <section className="settings">
      <h2>识别设置</h2>
      <p className="muted">
        识别在本机离线运行。模型首次识别时自动下载，下载完成并校验通过后才会启用。
      </p>
      <label>
        模型下载地址
        <input
          type="url"
          aria-label="模型下载地址"
          aria-invalid={Boolean(urlProblem)}
          value={settings.modelUrl}
          onChange={(e) => onChange({ ...settings, modelUrl: e.target.value })}
        />
      </label>
      <p className={urlProblem ? 'muted invalid' : 'muted'} role={urlProblem ? 'alert' : undefined}>
        {urlProblem ?? '{file} 会替换成模型文件名，例如 ggml-base.en.bin。'}
      </p>
      <div className="row">
        {MODEL_SOURCES.map((source) => (
          <button
            key={source.template}
            className="quiet"
            aria-pressed={settings.modelUrl === source.template}
            onClick={() => onChange({ ...settings, modelUrl: source.template })}
          >
            {source.label}
          </button>
        ))}
      </div>
      <label>
        识别模型{' '}
        <select
          aria-label="识别模型"
          value={settings.modelId}
          onChange={(e) => onChange({ ...settings, modelId: e.target.value })}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {modelState(m)}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button
          disabled={busy || !selected || selected.installed || Boolean(urlProblem)}
          onClick={props.onDownload}
        >
          {selected && selected.downloadedBytes > 0 && !selected.installed
            ? '继续下载'
            : '下载模型'}
        </button>
        <button disabled={busy} onClick={props.onImport}>
          导入本地模型文件
        </button>
        <button onClick={props.onClose}>收起</button>
      </div>
    </section>
  );
}
