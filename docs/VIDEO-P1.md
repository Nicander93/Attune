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

## 产品验收清单（主管可勾选）

P1 合并前建议按下面四条验收。证据目录：`docs/evidence/video-p1/`（脚本冒烟日志；完整桌面截图若未附上，需人工在 `v0.1.1` + 本分支 build 上补一眼）。

- [ ] **1. 本机没有 ffmpeg**  
  不设置 `ATTUNE_FFMPEG_DIR`，且 `PATH` / `{appData}/tools/ffmpeg` 都找不到二进制时：材料准备页「从视频导入」区域出现明确错误提示（`banner--error`，文案来自 `media_ffmpeg_status` hint，例如未找到 ffmpeg/ffprobe），**导入按钮禁用**，应用不崩溃。

- [ ] **2. H.264/AAC 导入可进入听读/听写链路（P1 能做到的部分）**  
  选本地 H.264（如 `fixtures/video-p0/h264_aac.mp4`）→ probe → 选音轨/时间范围 → 提取音频写入 `Material.audio`，并带上 `Material.video` 元数据。之后仍可用现有「开始听写 / 听读」路径（音频 blob + duration 为 clip 相对秒）。不要求本 PR 做 P2 藏视频 UX。

- [ ] **3. HEVC（H.265）**  
  选 HEVC 源（如 `h265_aac.mp4`）时：要么在 appData `media/{materialId}/playback.mp4` 生成可播的 H.264 副本（优先 `h264_mf`），要么界面给出**清晰错误**（`无法生成可播放副本…`），**禁止静默失败**。`needsTranscode` / `compatibilityNote` 在 probe 结果里可见。

- [ ] **4. 未授权路径进不了播放器 / asset 协议**  
  WebView **不直接**加载用户原始 `sourcePath`。仅 `media_authorize_path` 登记过的输入可供 ffmpeg；播放走 `convertFileSrc(playbackPath)`，且 `assetProtocol.scope` 只允许 app `media/**`。对未授权绝对路径调用 probe/extract 应返回明确拒绝错误，而不是把文件暴露给 `asset:`。

### 本机已自动核验 vs 仍需人眼

| 项 | 自动冒烟（本 PR） | 仍需人眼 |
| --- | --- | --- |
| 1 无 ffmpeg | 临时清空 `ATTUNE_FFMPEG_DIR` + 隔离 PATH 后跑 resolve/status 脚本；单元/面板逻辑（`available === false` → banner） | 真机桌面点开确认 banner 文案与不崩溃 |
| 2 H.264 | 对 `h264_aac.mp4` 跑与 Rust 同参的 ffprobe + 抽 wav；Vitest / Rust 绿；e2e 节数对齐 | 桌面走完「提取并写入材料」再点听写入口 |
| 3 HEVC | 对 `h265_aac.mp4` 跑 probe（`needs_transcode`）+ 尝试 `h264_mf` 转码；失败则核对错误串存在于代码路径 | 桌面确认错误展示或 playback 副本可播 |
| 4 未授权路径 | Rust allowlist / 危险字符单测；`tauri.conf.json` scope 审计 | 手工确认 `<video>`/`<img>` 未用原始盘符路径 |

跑冒烟（需本机已有 `D:\Temp\ffmpeg-p0` 与 P0 fixtures，**勿提交二进制**）：

```powershell
cd D:\code\attune-video-p1
powershell -File scripts/video-p1-acceptance-smoke.ps1
```

## Out of scope (later)

- P2: dictation hide-video / unified media clock UI
- P3: auto extract embedded text subs → segments
- P4: OCR
- Closing / merging PR #5
