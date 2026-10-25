# Video P1 smoke evidence

Generated: 2026-10-25 23:16:18 +08:00 (Asia/Shanghai / box-local)

Script: `scripts/video-p1-acceptance-smoke.ps1`

Artifacts:
- `smoke-log.txt` — full run log
- `SUMMARY.txt` — one line per acceptance item
- `h264_clip.wav` — extracted clip from P0 `h264_aac.mp4` (if ffmpeg present)
- `hevc_playback.mp4` — playback copy attempt from `h265_aac.mp4` (if successful)
- `*_ffmpeg.err.txt` — ffmpeg stderr captures

Not included: full Tauri desktop screenshots (needs human on `npm run desktop` with `ATTUNE_FFMPEG_DIR`).
