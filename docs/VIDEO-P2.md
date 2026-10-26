# Attune Video P2 — Unified media player

> Date: 2026-10-26 (Asia/Shanghai). Branch: `feat/video-p2-player` on `main` @ `677aed0` (post-#6 P1).
> Scope: one sounding media element + one play clock; dictation hide / review show / listen-read sync.
> **Out of scope:** P3 subtitle pipeline, OCR, reopening #5, installer ffmpeg bundling.

## Decisions

| Topic            | Choice                                                        | Why                                                              |
| ---------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Hook             | `useMediaPlayer` (re-export `useAudioPlayer`)                 | Same loop/speed/mode/keyboard/restore; call sites keep compiling |
| Sounding element | Exactly one: `<audio>` **or** `<video>`, never both           | One clock; no dual-decode drift                                  |
| Video URL        | `playbackAssetUrl(playbackPath)` → `convertFileSrc`           | Never load `sourcePath` / raw disk path in WebView               |
| Audio URL        | Blob object URL (unchanged)                                   | Whisper / existing audio materials                               |
| Hide surface     | `opacity` + `visibility` + off-flow (`.media-output--hidden`) | Player & element stay mounted across routes                      |
| Dictation        | Surface **hidden** by default                                 | Typing focus; audio still plays                                  |
| After 核对       | Optional **看画面** / **收起画面**                            | User reveals frame for that sentence                             |
| Listen-read      | Surface **visible**; subtitle/word sync unchanged             | Video + transcript clock share `position`                        |
| Workspace        | `MediaOutput` above pages in `MaterialWorkspace`              | Route changes do not remount the clock                           |

## How to test

### Automated (LM)

```powershell
cd D:\code\attune-video-p2
npm test
npx tsc -b --pretty false
npm run test:rust
npm run test:e2e
```

Focus: `tests/media-player.test.ts` (resolveMediaSource never uses raw `sourcePath`), existing `tests/video.test.ts`, e2e prep/player counts if UI sections change.

### Manual desktop smoke (after `npm run desktop`)

1. Open a P1 video material with `playbackPath` (H.264 copy or remux).
2. **Dictation:** play a sentence — audio plays, **no** visible video surface.
3. Type + **核对答案** — results show; click **看画面** — video appears for that sentence without restarting the clock mid-sentence oddly; **收起画面** hides again.
4. Switch to **听读** — video visible; word/sentence highlight tracks playback; speed / 本句循环 / Space / arrows behave as audio.
5. Leave study → 素材准备 / 字幕校对 → surface hidden; return to study → dictation still hidden until 听读 or 看画面.
6. Pure audio material: still `<audio>` only; no regression on loop/restore position.

## Residual risks

- WebView2 codec support still depends on P1 playback copy (HEVC → H.264); P2 does not add new codecs.
- `display:none` avoided for hide; if a future style accidentally unmounts `<video>`, the clock resets — keep MediaOutput at workspace root.
- Browser (non-Tauri) build never takes the video path (`isDesktop()` false) — by design until asset protocol exists there.
