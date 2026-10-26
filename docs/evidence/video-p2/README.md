# Video P2 desktop smoke evidence

Tip: 629a446 on eat/video-p2-player. CDP against WebView2 (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222) + Fill-OpenDialog.ps1.

| Item | Result | Key shots |
| --- | --- | --- |
| 1 Dictation: audio plays, video hidden | PASS | 10-dictation-entry.png, 11-dictation-playing-hidden.png |
| 2 After check: 看画面/收起画面, no remount | PASS | 20-after-check.png, 21-show-video.png, 22-hide-video.png |
| 3 Listen-read: video + sync; loop/speed/keyboard | PASS | 30-listen-read.png, 31-listen-read-controls.png |
| 4 Pure audio: no regression | PASS | 41-audio-dictation.png, 42-audio-playing.png |

See cdp-smoke-notes.txt and SUMMARY.json.
