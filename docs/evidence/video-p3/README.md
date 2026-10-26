# Video P3 desktop smoke evidence

Tip: `ac1b5270ee39a19d4919b7c5a7db82ef1df29633` on `feat/video-p3-subtitles`. CDP against WebView2 (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`) + Fill-OpenDialog.ps1.

| Item | Result | Key shots |
| --- | --- | --- |
| 1 Embedded English text → dictation without manual SRT | PASS | 01–04 |
| 2 No text track → ASR; UI shows asr / unreviewed | PASS | 20–22 |
| 3 Protected (reviewed) → auto extract does not overwrite | PASS | 10–13 |
| 4 Manual SRT import still works | PASS | 30–32 |

See `cdp-smoke-notes.txt` and `SUMMARY.json`.
