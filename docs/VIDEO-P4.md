# Video V1 — P4 OCR（烧录 / 图形字幕）

> **Status:** Draft PR  
> **Base:** `main@b1e3e1a`（P3 squash）  
> **Branch:** `feat/video-p4-ocr`  
> **Scope:** burned-in / bitmap subtitle → WinRT OCR → SRT → `subtitleOrigin: 'ocr'`  
> **Out of scope:** changing P3 text-track → Whisper → tags / protect path; shipping ONNX/RapidOCR weights; full Python PaddleOCR; merge; P5.

## Goal

When a clip has **no usable text subtitle track** (or the user opts in), Attune can sample video frames, run **Windows.Media.Ocr**, merge nearby identical reads into cues, and write a managed SRT — same review / protect semantics as P3 (`unreviewed` until user marks reviewed).

Installer delta aim: **~0 bundled OCR deps** (OS language pack only).

## Design

| Piece | Choice | Notes |
| --- | --- | --- |
| Default backend | `Windows.Media.Ocr` via Rust `windows` 0.62 (`Media_Ocr`, Imaging, Storage…) | Prefer EN pack; fall back to any creatable pack / user profile |
| Optional backend | `ATTUNE_OCR_BACKEND=onnx` | Scaffold only — clear error; **no** RapidOCR pack shipped in this Draft |
| Forbidden | Full Python PaddleOCR / paddlepaddle | Aligns with P0 OCR notes |
| Sampling | ffmpeg `-ss` + single PNG frames under `media/<id>/ocr-frames/` | Interval default 0.75s, max 24 (clamped) |
| Merge | `merge_ocr_samples` | Collapse stable text across nearby timestamps into cues |
| Output | `media/<id>/ocr.srt` + `applySubtitleTimeline(..., 'ocr', 'unreviewed')` | Protect / reviewed rules unchanged from P3 |
| UI | Probe checkbox「OCR 烧录/图形字幕」 | Auto-checked when bitmap (PGS/DVD) streams present; only runs if no text extract applied and not protected; OCR failure falls through to existing ASR hook |
| P3 path | **Unchanged** | Text codec select → `extractEmbeddedSubtitles` → else `onNeedAsr` when OCR not requested |

### Flow

```
probe
  ├─ text subtitle selected → P3 extract (unchanged)
  ├─ else if protected → keep segments
  ├─ else if wantOcr && WinRT available → sample frames → OCR → SRT → origin=ocr
  └─ else → onNeedAsr (P3 Whisper path)
```

### Commands

| Command | Role |
| --- | --- |
| `ocr_status_cmd` | Backend, languages, preferred tag, hint |
| `ocr_recognize_image` | Single-image smoke / debug |
| `media_ocr_burned_in` | Clip-range frame sample + merge + SRT |

## Acceptance

- [x] WinRT path compiles and unit-tests merge/normalize helpers
- [x] Bitmap codec helpers mirrored TS + Rust; P3 text codecs untouched
- [x] ONNX env flag returns explicit “pack not installed” (no fat binary)
- [x] UI does not change text→ASR when OCR checkbox off
- [x] `docs/VIDEO-P4.md` + Draft PR (no merge, no P5)
- [x] Human desktop smoke ①–④ PASS (see `docs/evidence/video-p4/`)

## Non-goals (later)

- Ship RapidOCR / ONNX enhancement pack
- Bitmap *packet* demux OCR (current path OCRs composited video frames; good enough for burned-in and often for burned PGS)
- Cloud OCR
- Auto-merge to `main`

## Tests

- Rust: `ocr::tests::*`, `media::tests::text_subtitle_codecs` (includes bitmap)
- TS: `tests/subtitle-source.test.ts` bitmap helpers
- `npm run test:rust` / `npm test` / `tsc` green before Draft

## P0 alignment

P0 marked OCR PoC **PARTIAL** and forbade shipping full Python PaddleOCR; preferred WinRT (~0 MB) with optional ONNX pack later. This Draft implements that preference.

## Desktop acceptance (human-eye ①–④)

Date: 2026-10-26 Asia/Shanghai. Evidence: `docs/evidence/video-p4/`.

| # | Item | Result |
| --- | --- | --- |
| 1 | Burned-in English → OCR cues; UI shows ocr / unreviewed | PASS |
| 2 | EN OCR pack missing → honest status hint; OCR miss → ASR fallback | PASS |
| 3 | Text track present → P3 embedded path (OCR checkbox on does not steal) | PASS |
| 4 | Protected (reviewed) → OCR does not overwrite | PASS |
