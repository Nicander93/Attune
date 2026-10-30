# UI S2 import evidence

Branch: `feat/ui-s2-import` · tip recorded in `SUMMARY.json`.

Desktop smoke on Windows LM via CDP WebView2 (`scripts/_cdp_s2_smoke.mjs`), app from this worktree (`npm run desktop` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`).

Product gate (human/screenshot):

| # | Item | Result | Key shots |
| --- | --- | --- | --- |
| 1 | Empty import → choose file reaches ready | PASS | 01–02 |
| 2 | Needs review: 「校对字幕」visible; 「开始听写」usable | PASS | 10 |
| 3 | 「更多」reaches video import / cache (ffmpeg path) | PASS | 20–22 |
| 4 | Pure-audio old path does not regress | PASS | 30 |

S3 not started. See `SUMMARY.json` and `cdp-smoke-notes.txt`.
