# UI S1 shell evidence

Branch: `feat/ui-s1-shell` · tip recorded in `SUMMARY.json`.

Desktop smoke on Windows LM via CDP WebView2 (`scripts/_cdp_s1_smoke.mjs`), app from this worktree (`npm run desktop` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`).

Product gate (human/screenshot):

| # | Item | Result | Key shots |
| --- | --- | --- | --- |
| 1 | Home continue card enters dictation/study | PASS | 01–03 |
| 2 | Library search / folder / sort filter the list | PASS | 10–14 |
| 3 | Existing material opens from library | PASS | 20 |

Also checked: shell nav only Home + Library; CTA import present (both PASS).

S2/S3 not started. See `SUMMARY.json` and `cdp-smoke-notes.txt`.