# UX-1 人眼冒烟证据

- 分支：`feat/ux-1-import-delegate`
- 冒烟 tip：`67b6fe16091f8aed3532e71c15e2ba096742f87b`（桌面「选择文件」改走系统对话框，并修好 `media_stage_import` 的 camelCase）
- 机器：Windows LM，WebView2 CDP `:9222`
- 启动：`npm run desktop` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
- 脚本：`scripts/_cdp_ux1_smoke.mjs`（点击真实「选择文件」，用 `Fill-OpenDialog.ps1` 填入系统「打开」对话框，不是 Playwright `setInputFiles`）
- 总评：**PASS**（音频选择文件、视频选择文件都过）
- 时间：2026-11-26 10:31（Asia/Shanghai）

## 素材

| 用途 | 文件 | 来源 |
| --- | --- | --- |
| 无字幕音频 | `C:\Users\PC\AttuneSmoke\p3\speech.wav`（313,722 字节） | 先前 Video P3 冒烟样例 |
| 无文本字幕轨视频 | `C:\Users\PC\AttuneSmoke\p3\speech_nosubs.mp4`（46,198 字节） | 先前 Video P3 冒烟样例（SAPI 英语，无文本轨，应走自动识别） |
| 带内嵌文本字幕视频 | 未找到 | 先前脚本写的 `D:\code\attune-video-p0\fixtures\video-p0\h264_aac_subs.mkv`，该 worktree 已不在；未从个人不相干目录另取文件 |

本机 `appData/tools/ffmpeg` 与 `models/ggml-base.en.bin` 均已存在，故本轮没有出现「缺本地工具时的人话同意 + 安装进度」。

## 结果

| # | 路径 | 结果 | 关键截图 |
| --- | --- | --- | --- |
| 1 | 首页 → 「选择文件」导入无字幕音频 → 自动准备字幕（可见「正在准备字幕…」）→「已准备好 2 句，可以开始听写」且开始听写可点 → 进入听写 | **PASS** | `02-import-empty.png`、`04-audio-preparing.png`、`05-audio-ready.png`、`06-audio-dictation.png` |
| 2 | 「选择文件」选中无文本轨视频后沿同一条路做完，不二次选择，不出现「无法确定…位置」；无文本轨则自动识别；主路径不出现 ffmpeg/ASR/OCR 等术语 | **PASS** | `12-video-preparing.png`、`13-video-ready.png` |

第 2 条这次走的是系统「打开」对话框（与真实桌面「选择文件」同一条路）。选中后出现「正在准备素材…」/「正在准备字幕…」，随后「已准备好 2 句，可以开始听写」，「开始听写」可点，没有打开「导入视频」技术面板，也没有主路径术语。

## 原生拖入

本轮未单独自动化操作系统级拖入（WebView2 走的是 Tauri 投放事件，现有脚本只能稳定驱动「选择文件」对话框）。原生拖入监听仍走原来的 `listenDesktopMediaDrop` → `importFromPath`，与这次修好并验收过的视频路径会合，代码未改这条监听。

## 未开始

未开始 MOT-1 / UX-2 / UX-3 / MOT-2。未动 main 与 v0.1.3 Release。软口未改。

详见 `SUMMARY.json` 与 `cdp-smoke-notes.txt`。
