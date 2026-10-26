# Video P4 desktop smoke evidence

Tip: see `SUMMARY.json`. CDP against WebView2 (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`) + Fill-OpenDialog.ps1.

| Item | Result | Key shots |
| --- | --- | --- |
| 1 Burned-in English → ocr / unreviewed | PASS | 01–03 |
| 2 EN pack missing honest + ASR fallback | PASS | 20–22 |
| 3 Text track → P3 embedded (not OCR) | PASS | 30–32 |
| 4 Protected reviewed → OCR does not overwrite | PASS | 10–13 |

See `cdp-smoke-notes.txt` and `SUMMARY.json`.
