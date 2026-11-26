# UX-1 人眼冒烟证据

- 分支：`feat/ux-1-import-delegate`
- 实施 tip：`fc0dc117efe379c67786482b6eb812483aa5e471`（冒烟开始时 HEAD）
- 机器：Windows LM，WebView2 CDP `:9222`
- 启动：`npm run desktop` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
- 脚本：`scripts/_cdp_ux1_smoke.mjs`
- 总评：**FAIL**（第 1 条 PASS，第 2 条 FAIL）

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
| 1 | 首页 → 导入无字幕音频 → 自动准备字幕（可见「正在准备字幕…」）→「已准备好 2 句，可以开始听写」且开始听写可点 → 进入听写 | **PASS** | `02-import-empty.png`、`04-audio-preparing.png`、`05-audio-ready.png`、`06-audio-dictation.png` |
| 2 | 选中无文本轨视频后沿同一条路做完，不二次选择；有字幕则抽出，无则自动识别；主路径不出现 ffmpeg/ASR/OCR 等术语 | **FAIL** | `11-video-after-pick.png`、`13-video-ready.png` |

### 第 2 条失败点

选中 `speech_nosubs.mp4` 后，主路径出现：

> 无法确定这个视频文件的位置，请使用「选择文件」。

没有打开「导入视频」技术面板，也没有主路径术语，但自动处理没有开始，因此不能验收「选中后沿同一条路做完 / 无文本轨则自动识别」。

复现：系统「打开」对话框选中该文件，以及 Playwright `setInputFiles` 指向同一路径，结果相同。页面拿到的是 `video/mp4` File，但没有 `path`。WebView2 的 HTML file input 未提供本地路径，而当前主路径处理视频依赖这条路径。

未改产品代码。未开始 MOT-1 / UX-2 / UX-3 / MOT-2。未动 main 与 v0.1.3 Release。

详见 `SUMMARY.json` 与 `cdp-smoke-notes.txt`。

