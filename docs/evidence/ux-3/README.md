# UX-3 · 通知、确认、撤销 · 人眼冒烟证据

- 分支：`feat/ux-3-notice-undo`
- 基线：`origin/main` @ `98e55cd`
- 实施 tip：`0c68e1aefc121ffc06138c16591fc609efeba66c`
- 机器：Windows LM，WebView2 CDP `:9222`
- 启动：`npm run desktop` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
- 脚本：`scripts/_cdp_ux3_smoke.mjs`
- 总评：**PASS**
- 时间：2026-11-26 16:12（Asia/Shanghai）
- 素材：`C:\Users\PC\AttuneSmoke\p3\speech.wav`
- 视口：客户区 1024×640（实测 inner 1024×640，DPI ≈ 1.39）

首页「只有一条上次学习」那张，是在临时只保留一条已学素材后拍摄的；拍完已把 IndexedDB 还原。删除路径用素材库第一条「h264_aac_subs」，删除前后以文件夹条数核对（68 → 67，撤销后回到 68）；库里还有同名条目，所以不能只看名称是否还在列表里。

## 结果

| # | 路径 | 结果 | 关键截图 |
| --- | --- | --- | --- |
| 1 | 首页只有一条「上次学习」时，不再留下空的「最近学习」标题 | **PASS** | `10-home-one-recent.png` |
| 2 | 导入成功后，右上角短时提示「音频已导入：speech.wav」，不占内容列，也不把版面顶走 | **PASS** | `20-import-toast.png` |
| 3 | 循环和重听是两套不同的图标，能一眼分开；核对区仍保留「重听」文字按钮 | **PASS** | `40-study-entered.png`、`41-player-icons.png` |
| 4 | 菜单里语速标签只写「语速」，当前倍速只出现在下拉里；「核对答案」整颗看得见 | **PASS** | `42-menu-speed.png` |
| 5 | 「快捷键」在菜单底部展开说明，不再用横幅；输入区和播放器仍在原位，「核对答案」、句序和顶栏没有被挡住 | **PASS** | `50-shortcuts-in-menu.png` |
| 6 | 从行菜单删除素材，没有系统确认框；出现「已删除「h264_aac_subs」。」和「撤销」；点撤销后条目回来 | **PASS** | `60-delete-undo-toast.png`、`61-delete-undone.png` |
| 7 | 清理全部媒体缓存是页内说明和确认，按钮为「清理」「取消」 | **PASS** | `70-cache-confirm.png` |

### 几何与人眼补充

- **导入提示：** toast 主机是 `position: fixed`，文案「音频已导入：speech.wav」，与输入区、播放器、「核对答案」、句序、标题均无相交。
- **快捷键说明：** 说明块在可滚动的听写菜单里。打开后菜单最小宽度加到 228px，便于把「核对或进入下一句」一类短句放下。较长的「在输入框外」仍会在句末折行，但整段看得见。菜单会盖住输入框右侧一角，这和打开菜单时本来就会盖住右侧的情况一样；输入区和播放器没有被顶走，「核对答案」、句序、顶栏均无相交。
- **删除：** 删除时 `window.confirm` 调用次数为 0；当前文件夹条数 68 → 67；提示含「撤销」；点撤销后条数回到 68，被删的「h264_aac_subs」回到列表顶部。

## 未做 / 软口

未开 MOT-2。未改核对结果出现或收回、切句闪白、画面显隐。动效仍用 MOT-1 token。库页「待校对」状态仍在（UX-1 软口，本刀未收）。菜单滚动时仍可能切到后一项的中线（#21 软口）。未动 main 与 v0.1.3 Release。

详见 `SUMMARY.json` 与 `cdp-smoke-notes.txt`。
