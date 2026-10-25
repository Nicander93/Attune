# Attune Video P0 — Feasibility Evidence

> Date: 2026-10-25 (Asia/Shanghai). Branch: `feat/video-p0-feasibility` on top of `main` @ `1745fa9` (post-#4 / v0.1.1).
> Scope: evidence only. **No Material model / P1 changes.** V3 UI work stays on its own track (already merged via #4).

## Summary / Go–No-Go

| Item | Result | Notes |
| --- | --- | --- |
| 1. WebView2 / Edge H.264+AAC MP4 | **PASS** | Plays to end, 640×360, readyState=4 |
| 1b. H.265/HEVC MP4 | **PASS on this LM** | Requires `Microsoft.HEVCVideoExtension`. Treat as **conditional**; without extension → transcode or clear error |
| 1c. MKV H.264+AAC+text sub | **PASS play** | Edge/Chromium plays A/V; text track not exposed to `<video>` TextTracks usefully — extract via ffmpeg |
| 2. ffprobe/ffmpeg sidecar feasibility | **PASS** | Typed `Start-Process -ArgumentList` + path allowlist works; probe/extract/transcode OK |
| 2b. Sidecar size | **WARN** | Gyan essentials: `ffmpeg.exe` ≈ **100.5 MB**, `ffprobe.exe` ≈ **100.3 MB** (~**201 MB** combined). Too heavy to ship both full builds blindly |
| 3. Hide surface, audio continues | **PASS** | `visibility:hidden` and `opacity:0` — `paused=false`, `currentTime` advanced |
| 4. OCR PoC | **PARTIAL** | Burned-in frame extracted; **no OCR runtime installed** on LM (no dotnet / winsdk / rapidocr). Options documented; **do not ship full Python PaddleOCR** |
| 5. FFmpeg license | **NOTE** | Essentials build used here is **GPL** (`--enable-gpl`, libx264/libx265). Shipping needs LGPL or non-GPL encode path |

**Recommendation for P1:** **GO**, with constraints below. Playback + extract + hide-surface are acceptable. Blockers are packaging size/license of ffmpeg and OCR engine choice (defer OCR to P4).

## Environment

- Machine: LM Windows (`c1c173b2-58ed-405f-824f-408438c6eefb`)
- Repo worktree: `D:\code\attune-video-p0`
- Base: `origin/main` `1745fa9` — *feat: V3 原型界面对照补齐（v0.1.1） (#4)*
- Browser harness: Playwright `channel: 'msedge'` (Edge 156 / Chromium) — same media stack family as WebView2
- HEVC extension present: `Microsoft.HEVCVideoExtension 2.5.48.0`
- FFmpeg for spike (not committed): `D:\Temp\ffmpeg-p0\` Gyan 9.0.2 essentials (GPL)

## Fixtures (tiny, generated)

Under `fixtures/video-p0/` (lavfi-generated, a few dozen KB each):

| File | Content |
| --- | --- |
| `h264_aac.mp4` | H.264 + AAC, 3s |
| `h265_aac.mp4` | HEVC + AAC, 3s |
| `h264_aac_subs.mkv` | H.264 + AAC + `subrip` eng track |
| `burned_in_en.mp4` | Black frame + drawtext `THE QUICK BROWN FOX` |
| `extracted/` | wav / srt / h265→h264 / burned_frame.png / logs (local; see `.gitignore`) |
| `p0-edge-results.json` | Harness dump |
| `webview2-harness.html` | Manual / Playwright harness |

## 1. Playback evidence

From `scripts/video-p0-edge.mjs` → `fixtures/video-p0/p0-edge-results.json`:

- **h264**: `canplay` / `playing` / `play() resolved`, duration 3s, 640×360
- **h265**: same on this LM (HEVC extension installed). **Product rule:** probe codec; if HEVC and decode fails → offer transcode to H.264 playback copy or show clear error (do not silent-fail)
- **mkv**: A/V plays. Embedded text subtitle is **not** relied on via HTMLTextTrack; use ffmpeg `-map 0:s:N`
- **h265_to_h264.mp4**: transcode playback copy plays

CSP note (current `tauri.conf.json`): `media-src 'self' blob:`. P1 must extend asset protocol / CSP for authorized local video paths (out of P0 code scope; recorded as risk).

## 2. Sidecar / extract

Spike: `scripts/video-p0-ff.ps1`

- Invokes ffmpeg/ffprobe via **typed argument arrays** (`Start-Process -ArgumentList`), **no shell string concatenation**
- Path allowlist: only under configured roots; `C:\Windows\...` **rejected**
- Demonstrated:
  - `ffprobe` streams on MKV → `h264,video` / `aac,audio` / `subrip,subtitle`
  - Extract audio → 16 kHz mono PCM wav (Whisper-friendly)
  - Extract `0:s:0` → SRT text matches fixture
  - Transcode HEVC → H.264 playback copy

### Size / packaging implications

| Approach | Approx size | License |
| --- | --- | --- |
| Ship Gyan essentials ffmpeg+ffprobe | ~201 MB | **GPL** |
| Ship single shared build + `ffmpeg` also acting as probe (`ffmpeg -i`) | ~100 MB | still GPL if x264/x265 enabled |
| BtbN **LGPL** static (decode-focused) | smaller / no x264 | **LGPL** — preferred for Apache-2.0 app if encode via MediaFoundation / prebuilt restricted set |
| Download-on-demand sidecar | 0 in installer | UX + trust friction |

**P1 recommendation:** do **not** embed the 200 MB GPL essentials pair in the NSIS installer. Prefer (a) LGPL decode build + Windows MF transcode, or (b) optional on-demand download with license disclosure, or (c) slim custom build with only needed demuxers/decoders/encoders and explicit license review.

Tauri `bundle.externalBin` / sidecar is feasible (no existing sidecar in tree today). Wire-up belongs in P1/P3, not this branch beyond spikes.

## 3. Hide video surface

Harness auto-test on H.264 element:

```
playing start t=0.00
auto visibility:hidden t=0.46 paused=false
after 1.5s hide: t=1.46 paused=false
switch to opacity:0 t=1.97 paused=false
final t=2.76 paused=false
hidePass=true
```

**Conclusion:** CSS `visibility:hidden` / `opacity:0` does **not** pause Edge/WebView2 media. Prefer these over `display:none` (not re-tested here; avoid destroying layout/player). Keep one `<video>` mounted across routes (P2).

## 4. OCR PoC

- Frame at t≈1.5s extracted: `fixtures/video-p0/extracted/burned_frame.png` (~10 KB)
- Live OCR **not executed**: LM has Python 3.10 + Pillow, but no `winsdk` / RapidOCR / Tesseract / `dotnet` for WinRT OCR from this session
- **Do not** introduce full **PaddleOCR + paddlepaddle** Python runtime into the desktop installer (hundreds of MB–GB)

| Option | Install delta | Notes |
| --- | --- | --- |
| **Windows.Media.Ocr** via Rust `windows` crate | ~0 MB (OS) | Preferred P4 default for EN; needs language pack |
| RapidOCR / PaddleOCR **ONNX** | ~20–60 MB | Optional enhancement pack |
| Full Python PaddleOCR | **Unacceptable** for V1 ship | — |

P0 status: **packaging risk understood; accuracy numbers deferred to P4** once WinRT or ONNX path is wired.

## 5. FFmpeg license (brief)

- Spike binaries: Gyan essentials **GPL** (`--enable-gpl --enable-version3`, libx264, libx265)
- Attune is Apache-2.0-oriented desktop app: **redistributing GPL ffmpeg forces GPL obligations on the shipped combination** depending on linking/packaging interpretation — treat as **release blocker** until an LGPL or system-API encode path is chosen
- LGPL builds (e.g. BtbN LGPL) omit GPL encoders; pair with MediaFoundation H.264 encode for playback copies if needed
- Always ship corresponding FFmpeg `LICENSE` / `COPYING` and document modifications

## Scripts added (spike only)

- `scripts/video-p0-ff.ps1` — allowlisted typed-arg ffprobe/ffmpeg
- `scripts/video-p0-edge.mjs` — Edge/Playwright playback + hide-surface harness
- `fixtures/video-p0/webview2-harness.html` — same tests in a browser page

## What P0 deliberately did **not** do

- No `Material` / IndexedDB schema changes
- No merge of unrelated V3 work (already on main via #4)
- No P1 import UI
- No committing ffmpeg binaries

## Follow-ups before / during P1

1. Choose ffmpeg redistribution strategy (LGPL vs on-demand) and record license files
2. Codec policy: H.264+AAC baseline; HEVC → detect + transcode/error
3. Tauri asset protocol + CSP for local video
4. Re-run hide-surface once inside real Tauri WebView2 window (Edge proxy is strong but not identical host chrome)
5. OCR: spike WinRT from Rust in P4, not P1
