# Video P5 E2E evidence

Branch: `feat/video-p5-packaging` · tip recorded in `SUMMARY.json`.

Human-eye checklist (docs/VIDEO-P5.md) run on LM via CDP WebView2 smoke
(`scripts/_cdp_p5_smoke.mjs` + `_cdp_p5_items34.mjs`), PATH sanitized so ffmpeg
is missing until consent download.

| # | Item | Result | Key shots |
| --- | --- | --- | --- |
| 1 | No ffmpeg → consent LGPL download → usable | PASS | 01–03 |
| 2 | Import → subs → hide-video dictation → check → listen-read | PASS | 10–18 |
| 3 | After restart: restore playback | PASS | 20–23 |
| 4 | Clear cache → recover via rebuild | PASS | 30–31 |
| 5 | Old pure-audio materials: no regression | PASS | 40–42 |

See `SUMMARY.json` and `cdp-smoke-notes.txt`.
