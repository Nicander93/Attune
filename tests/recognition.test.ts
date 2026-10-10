import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  CANCELLED,
  MODEL_SOURCES,
  migrateSettings,
  modelUrlProblem,
  recognize,
} from '../src/recognition';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(), open: vi.fn() }));

const invoked = () => vi.mocked(invoke).mock.calls.map(([command]) => command);

/** Stands in for the browser decoder; `onDecode` runs while decoding is in progress. */
function stubDecoder(samples: Float32Array, onDecode: () => void = () => undefined) {
  class FakeAudioContext {
    async decodeAudioData() {
      onDecode();
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { numberOfChannels: 1, getChannelData: () => samples };
    }
  }
  vi.stubGlobal('OfflineAudioContext', FakeAudioContext);
}

describe('recognition cancel before the native task starts', () => {
  const audio = new Blob([new Uint8Array(8)]);
  beforeEach(() => vi.mocked(invoke).mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('stops during decoding without uploading or recognizing', async () => {
    const controller = new AbortController();
    stubDecoder(new Float32Array(16), () => controller.abort());
    await expect(recognize(audio, 'base.en', vi.fn(), controller.signal)).rejects.toBe(CANCELLED);
    expect(invoked()).toEqual([]);
  });

  it('stops between upload chunks, clears the upload and never recognizes', async () => {
    const controller = new AbortController();
    stubDecoder(new Float32Array(3 << 20));
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'append_audio') controller.abort();
    });
    await expect(recognize(audio, 'base.en', vi.fn(), controller.signal)).rejects.toBe(CANCELLED);
    expect(invoked()).toEqual(['clear_audio', 'append_audio', 'clear_audio']);
  });

  it('recognizes after uploading every chunk when not cancelled', async () => {
    stubDecoder(new Float32Array(3 << 20));
    vi.mocked(invoke).mockResolvedValue([]);
    await recognize(audio, 'base.en', vi.fn(), new AbortController().signal);
    expect(invoked()).toEqual([
      'clear_audio',
      'append_audio',
      'append_audio',
      'append_audio',
      'recognize',
    ]);
  });
});

describe('model download address', () => {
  it('offers only templates with a file placeholder', () =>
    MODEL_SOURCES.forEach((source) => expect(modelUrlProblem(source.template)).toBeUndefined()));

  it('explains a missing placeholder or scheme', () => {
    expect(modelUrlProblem('https://hf-mirror.com')).toContain('{file}');
    expect(modelUrlProblem('hf-mirror.com/{file}')).toContain('https://');
  });

  it('turns a saved mirror host into a template and moves the old default to the new one', () => {
    expect(migrateSettings({ mirror: 'https://hf-mirror.com/', modelId: 'tiny.en' })).toEqual({
      modelUrl: MODEL_SOURCES[0].template,
      modelId: 'tiny.en',
    });
    expect(migrateSettings({ mirror: 'https://huggingface.co' }).modelUrl).toBe(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file}',
    );
    const custom = 'https://example.com/models/{file}';
    expect(migrateSettings({ modelUrl: custom }).modelUrl).toBe(custom);
    expect(migrateSettings({}).modelUrl).toBe(MODEL_SOURCES[0].template);
  });
});
