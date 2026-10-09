import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { CANCELLED, recognize } from '../src/recognition';

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
