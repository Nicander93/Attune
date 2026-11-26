# 听读词间空格 evidence

Desktop CDP human smoke for the reading-mode word-space fix. Shots were taken on the Windows LM from `scripts/_cdp_reading_spaces_smoke.mjs` (untracked helper), then copied here and to `C:\Users\PC\AttuneSmoke\reading-word-spaces\`.

Baseline: `main@1cfc353`. Walk: 素材库 → 已有 speech（2/2）→ 听写 → 听读，英文和双语各拍一张。这份 speech 没有中文译文，双语模式下会看到说明，英文原文仍应带词间空格。

Hard gates: overlapping text, clipped primary buttons, covered 句序 / study head, or unreadable type are FAIL.

## Before / after (same speech, word timings present)

Stored reference (unchanged): `Hello from a tune.` / `This is a short English sentence for recognition.`
Stored words (trimmed, as the recognizer saves them): `Hello from a tune.` / `This is a short English sentence for recognition.`

| Shot | What it shows |
| --- | --- |
| `before-02-reading-en.png` | `main@1cfc353` 英文：`Hellofromatune.` / `ThisisashortEnglishsentenceforrecognition.` |
| `before-03-reading-both.png` | 同基准、双语：英文同样挤在一起，并提示没有中文译文 |
| `after-01-dictation.png` | 修复后先回到听写，草稿仍是 `Hello from a tune.` |
| `after-02-reading-en.png` | 修复后英文：`Hello from a tune.` / `This is a short English sentence for recognition.` 当前词下划线仍在 |
| `after-03-reading-both.png` | 修复后双语：英文词间空格仍在，无中文译文说明可见 |

Human smoke: PASS. 句序、顶栏、播放器和「听写」入口都在窗口里，没有叠字或切掉主按钮。其他已记下的软口（快捷键换行、结果框约 21px 内部溢出）未改。
