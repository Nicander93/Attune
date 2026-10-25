# Attune Video P1 — Material extension

> Date: 2026-10-25 (Asia/Shanghai). Branch: `feat/video-p1-material` on `main` @ `1745fa9` (v0.1.1).
> Scope: video as `Material` (import, probe, clip audio extract, playback copy, CSP/asset protocol). **No P2 hide-video UX, no P3 subtitle pipeline, no P4 OCR.**
> P0 evidence lives in Draft PR #5 (`feat/video-p0-feasibility`) and is **not** merged into this branch.

## Decision: ffmpeg redistribution

| Option | Installer size | License | Chosen? |
| --- | --- | --- | --- |
| Ship Gyan essentials (~201 MB ffmpeg+ffprobe) | Huge | **GPL** | **No** |
| Bundle LGPL static in NSIS | Still large | LGPL | Not in P1 |
| **On-demand LGPL tools under `{appData}/tools/ffmpeg/`** | **0 in NSIS** | **LGPL (planned download)** | **Yes** |
| Dev override `ATTUNE_FFMPEG_DIR` | 0 | whatever local build | Yes (dev) |

**P1 behavior**

1. Resolve `ffmpeg` / `ffprobe` from, in order: `ATTUNE_FFMPEG_DIR` → `{appData}/tools/ffmpeg/` → `PATH`.
2. NSIS does **not** list ffmpeg as `externalBin`. No GPL binary is committed or packaged.
3. Playback remux/transcode prefers **`h264_mf`** (Windows Media Foundation) so an LGPL build can encode without libx264.
4. Future release UI (not this PR) can download a documented LGPL build into `tools/ffmpeg/` after user consent.

Dev on LM: `$env:ATTUNE_FFMPEG_DIR = 'D:\Temp\ffmpeg-p0'` (local spike binaries are fine; do not commit them).

## Domain

```ts
interface VideoSource {
  originalName: string;
  sourcePath: string;      // user file; WebView never loads this path directly
  playbackPath?: string;   // managed copy under appData/media/{materialId}/
  clipStart: number;
  clipEnd: number;
  selectedAudioStream?: number;
  selectedSubtitleStream?: number;
  subtitleOrigin?: 'embedded' | 'asr' | 'ocr' | 'external';
}

interface Material {
  // ...existing fields
  video?: VideoSource;
  audio: Blob;             // clip-extracted WAV for Whisper / <audio> pipeline
  duration: number;        // clip-relative seconds
}
```

No IndexedDB version bump: `video` is additive JSON on the material record; audio stays in the `audio` store.

## Security (CSP + asset protocol)

`tauri.conf.json`:

- `assetProtocol.enable = true`
- Scope allow only `$APPDATA/**/media/**/*` and `$APPLOCALDATA/**/media/**/*`
- CSP `media-src` / `img-src` include `asset:` and `http://asset.localhost` (plus existing `blob:` for audio Object URLs)
- User originals are **authorized** via `media_authorize_path` after the open dialog; ffmpeg inputs must be allowlisted; outputs must stay under `media/`

## How to test

### Unit / Vitest

```powershell
cd D:\code\attune-video-p1
npm test
```

Includes audio regression suites plus `tests/video.test.ts` (clip helpers + video meta persistence).

### Rust

```powershell
$env:ATTUNE_FFMPEG_DIR = 'D:\Temp\ffmpeg-p0'
npm run test:rust
```

`media` module unit tests cover path metachar rejection, material id rules, H.264 vs HEVC probe flags.

### Manual desktop smoke

1. Set `ATTUNE_FFMPEG_DIR` to a folder containing `ffmpeg.exe` + `ffprobe.exe`.
2. `npm run desktop`
3. 新建素材 → 素材准备 → **导入视频** → pick `fixtures` from P0 or any H.264 MP4 → choose audio/range → **提取音轨并写入素材**
4. Confirm `duration` matches clip length; recognition still uses `Material.audio`.
5. For HEVC: either a managed H.264 copy appears under appData `media/{id}/playback.mp4`, or a **clear error** (never silent).

## Out of scope (later)

- P2: dictation hide-video / unified media clock UI
- P3: auto extract embedded text subs → segments
- P4: OCR
- Closing / merging PR #5
