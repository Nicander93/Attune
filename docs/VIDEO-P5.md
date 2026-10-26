# Attune Video P5 — 验收与打包

> Date: 2026-10-26 (Asia/Shanghai). Branch: `feat/video-p5-packaging` on `main` @ `1d6bad3` (P4 #9).
> Scope: on-demand LGPL ffmpeg download + consent, video persist / reassociate / recovery, cache cleanup UI, audio/IDB regression, candidate Windows NSIS recipe + E2E human checklist.
> **Out of scope:** merging this PR; shipping GPL Gyan essentials in the installer; full human E2E listen gate (documented; may run post-Draft).

## Product binding

| # | Requirement | Landed in this PR |
| --- | --- | --- |
| 1 | ffmpeg on-demand **LGPL** into `{appData}/tools/ffmpeg/` + consent UX + failure messages; installer must **not** ship GPL ffmpeg (~201MB essentials) | Yes — pinned BtbN `win64-lgpl-shared` download, SHA-256 verify, zip `bin/*` extract; consent `window.confirm`; NSIS still has no `externalBin` / no ffmpeg resources |
| 2 | Persist / re-associate / exception recovery for video materials | Yes — IDB already stores `video` JSON (P1); reassociate + **重建播放副本** (re-authorize sourcePath) + missing-playbackPath banner; player warning points back to prep |
| 3 | Cache cleanup UI entry | Yes — per-material「清理本素材缓存」+ prep「清理全部媒体缓存」(`media_clear_cache` / `media_clear_all_cache`) |
| 4 | Regression: old audio materials + IndexedDB | Covered by existing `tests/video.test.ts` / `storage` / `migrate`; no schema bump |
| 5 | Candidate Windows installer + E2E human path docs | Recipe below; automated tests green. Full human listen path may be post-Draft gate |

## ffmpeg redistribution (P5 closes P1 “future UI”)

| Item | Value |
| --- | --- |
| Bundle id | `btbn-win64-lgpl-shared-2025-10-31` |
| URL | `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2025-10-31-13-40/ffmpeg-N-121583-g4348bde2d2-win64-lgpl-shared.zip` |
| Size | `82530365` bytes (~79 MB) |
| SHA-256 | `4506683103ef542a3c50016b464d7db0fa8c740806589975ae7ce5bc7216e218` |
| Install dir | `{appData}/tools/ffmpeg/` (`ffmpeg.exe`, `ffprobe.exe`, shared DLLs) |
| Encode path | Prefer `h264_mf` (unchanged from P1) so LGPL build does not need libx264 |
| Forbidden | Gyan essentials / any `win64-gpl` zip inside NSIS or as the default download |

Resolve order unchanged: `ATTUNE_FFMPEG_DIR` → `appData/tools/ffmpeg` → `PATH`.

Download shares the model-download job slot (one download at a time). Progress event: `ffmpeg-download-progress`. Cancel: `cancel_download`.

## Persist / recovery

- `Material.video` remains additive JSON on the materials store; audio Blob stays in the `audio` store (schema v3). No version bump.
- **重新关联源文件** — updates `sourcePath` / `originalName` after a fresh open dialog + authorize.
- **重建播放副本** — `media_authorize_path` then `media_prepare_playback` (needed after restart because the in-memory allowlist is empty).
- Clearing cache clears `playbackPath` on the current material so the player falls back to clip audio until rebuild.
- If the source file moved: authorize/canonicalize fails → user must reassociate.

## Cache cleanup

| Entry | Command | Effect |
| --- | --- | --- |
| 清理本素材缓存 | `media_clear_cache(id)` | Deletes `{appData}/media/{id}/`; clears `playbackPath` on that material |
| 清理全部媒体缓存 | `media_clear_all_cache` | Deletes `{appData}/media/`; clears `playbackPath` on the open material (other materials may still list a stale path until opened/rebuilt — player shows recovery copy) |

Whisper models under `{appData}/models/` are **not** touched.

## Candidate Windows installer

NSIS target already in `src-tauri/tauri.conf.json` (`bundle.targets: ["nsis"]`). No `externalBin`, no ffmpeg resources.

```powershell
cd D:\code\attune-video-p5
$env:ATTUNE_FFMPEG_DIR = 'D:\Temp\ffmpeg-p0'   # optional for local smoke; not baked into installer
npm run build
npm run tauri -- build
```

Artifact (typical): `src-tauri\target\release\bundle\nsis\Attune_*_x64-setup.exe`.

**Acceptance of the package:** installer size must not jump by ~201 MB; searching the installed tree must not find a bundled `ffmpeg.exe` under the install prefix (only under `%APPDATA%`…`tools\ffmpeg` after on-demand download).

## E2E human listen path (post-Draft gate OK)

1. Fresh install (or clean appData) → open 准备页 → ffmpeg missing banner → **同意** download LGPL → status shows `app_data/tools/ffmpeg`.
2. 导入视频 → pick clip / audio / optional subs → 写入素材.
3. 字幕校对（embedded / ASR / OCR as available）→ mark reviewed if required by product.
4. 听写：**隐藏视频** surface → dictate → 对照时 **显示视频**.
5. 听读 view with video surface.
6. 退出并重启应用 → 素材仍在；若曾清缓存则「重建播放副本」或重新关联后恢复画面；音频听写路径仍可用.
7. 「清理本素材缓存」/「清理全部媒体缓存」→ playback falls back; rebuild works.
8. 旧纯音频素材：库列表 / 听写 / IndexedDB 无回归.

Automated substitute in this PR: `npm test`, `npm run test:rust` (incl. zip extract + LGPL pin asserts). Desktop CDP smoke optional on LM with `ATTUNE_FFMPEG_DIR`.

## Acceptance checklist

- [x] On-demand LGPL download + consent + failure copy
- [x] Installer recipe does not ship GPL ffmpeg
- [x] Reassociate + rebuild playback + missing-copy banner
- [x] Cache cleanup UI (per-material + all)
- [x] Audio / IDB regression tests green
- [x] `docs/VIDEO-P5.md`
- [ ] Human E2E listen path (may be post-Draft)
- [ ] NSIS candidate built on LM and spot-checked for no bundled ffmpeg (run recipe above)

## Constraints carried forward

H.264/AAC baseline; HEVC probe→transcode/error; CSP/`media-src` + asset protocol; WinRT OCR from P4; no PaddleOCR; P3 text-track path intact.
