# UI S3 focus evidence

Branch: `feat/ui-s3-focus` · tip recorded in `SUMMARY.json`.

Desktop smoke on Windows LM via CDP WebView2 (`scripts/_cdp_s3_smoke.mjs`), app from this worktree (`npm run desktop` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`).

Product gate (human/screenshot):

| # | Item | Result | Key shots |
| --- | --- | --- | --- |
| 1 | Study page has no 首页/素材库 global nav | PASS | 01 |
| 2 | Video: hidden by default; after check show/hide picture (same clock) | PASS | 10–13 |
| 3 | 听写 ↔ 听读 mode switch in same shell | PASS | 20–21 |
| 4 | Enter / Space / ←→ / Esc no regression | PASS | 30 |

Code tip smoked: `c1d7ac0`. Evidence on PR head.

See `SUMMARY.json` and `cdp-smoke-notes.txt`.
