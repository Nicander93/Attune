# Attune Video P3 — Auto subtitle generation

> Date: 2026-10-26 (Asia/Shanghai). Branch: `feat/video-p3-subtitles` on `main` @ `f0c7a37` (post-#7 P2).
> Scope: embedded **text** subtitle extract → segments; ASR fallback via existing whisper.cpp path; origin + review tagging.
> **Out of scope:** OCR / bitmap (PGS, DVD) subtitles (= P4), installer ffmpeg bundling, merging this PR.

## Goal

After a video clip is applied, the user can start formal dictation/check **without manually uploading an SRT**, while never treating auto text (especially ASR) as silent ground truth.

## Pipeline

```
video apply
  ├─ text subtitle track selected? ──yes──► ffmpeg -map 0:N -c:s srt
  │                                         parseSrt → toClipRelativeSegments
  │                                         applySubtitleTimeline(origin=embedded, review=unreviewed)
  └─ no / empty / fail ───────────────────► onNeedAsr → useRecognition / recognize / transcribe.rs
                                            applySubtitleTimeline(origin=asr, review=unreviewed)

manual SRT/VTT import ────────────────────► applySubtitleTimeline(origin=external, review=reviewed)
```

## Decisions

| Topic | Choice | Why |
| ----- | ------ | --- |
| Extract command | `media_extract_subtitles` (typed argv, same bin resolve as P1) | Reuse allowlist / ATTUNE_FFMPEG_DIR → appData/tools → PATH |
| Text codecs only | subrip/srt/ass/ssa/mov_text/webvtt/ttml… | Bitmap needs OCR (= P4) |
| Clip times | `-ss clipStart -t duration` + `toClipRelativeSegments` | Study clock is clip-relative (P1/P2) |
| ASR path | Existing `useRecognition` → `recognize` → Rust whisper | No second pipeline |
| Origin tags | `subtitleOrigin`: embedded / asr / external | UI can show provenance |
| Trust | Auto (embedded/asr) starts `unreviewed`; edits or “标记已校对” → `reviewed` | Never silent ground truth |
| Overwrite guard | `hasProtectedSubtitles` → `replaceTimeline` throws | Drafts, checks, bookmarks, or reviewed status block replace |
| Default track pick | `pickDefaultSubtitleStream` text-only | Avoid selecting PGS by accident |

## Surfaces

- **VideoImportPanel** — after clip audio + playback copy, tries embedded extract; else `onNeedAsr`.
- **MaterialPrepPage** — ASR callback tags `asr`/`unreviewed`; banner + 去校对; pending ASR effect.
- **SubtitleProofPage** — any successful edit/split/merge calls `markSubtitlesReviewed`; explicit 标记已校对.

## Non-goals (P4+)

- OCR of PGS/DVD/bitmap tracks
- Burned-in / hardsub detection
- Cloud ASR providers
- Auto-merge into `main` (Draft PR only)

## Tests

- Domain: `tests/subtitle-source.test.ts`, extended `tests/subtitle-edits.test.ts`
- Rust: `is_text_subtitle_codec` unit test in `media.rs`
- Existing npm / rust / e2e suites remain green

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| ffmpeg subtitle timestamps absolute vs relative | `toClipRelativeSegments` heuristic + clamp |
| Empty text track (forced subs / wrong language) | Fall through to ASR; user can re-import SRT |
| ASR overwrites curated timeline | `hasProtectedSubtitles` blocks replace |
| Bitmap track selected historically | UI lists text codecs only; Rust refuses bitmap |
| Large ASR jobs on long clips | Existing cancel + model settings; clip range already limited at import |


## Desktop acceptance (human-eye ①–④)

Date: 2026-10-26 11:05 Asia/Shanghai. Tip: `ac1b5270ee39a19d4919b7c5a7db82ef1df29633`. Evidence: `docs/evidence/video-p3/`.

| # | Check | Result |
| - | ----- | ------ |
| ① | Video with embedded English text subs → formal dictation/check without manual SRT | **PASS** |
| ② | No suitable track → ASR path; UI shows asr / unreviewed | **PASS** |
| ③ | Protected (draft/check/bookmark/reviewed) → auto extract does NOT overwrite | **PASS** |
| ④ | Manual SRT import still works | **PASS** |

CI: see PR #8 checks (frontend). Do not merge until product + CI gate.
