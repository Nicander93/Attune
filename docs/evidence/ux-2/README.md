# UX-2 · 听写壳去噪 · 人眼冒烟证据

- 分支：`feat/ux-2-study-declutter`
- 基线：`origin/main` @ `8d21a8853cc46e6b635ef8594a3b5a935e59f994`
- 实施 tip：`5c3dc34b3a0f3ba36e999f52249a7ff4024ba6d4`
- 机器：Windows LM，WebView2 CDP `:9222`
- 启动：`npm run desktop` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
- 脚本：`scripts/_cdp_ux2_smoke.mjs`
- 总评：**PASS**
- 时间：2026-11-26 12:58（Asia/Shanghai）
- 素材：`C:\Users\PC\AttuneSmoke\p3\speech.wav`
- 视口：客户区逼近 1024×640（实测 inner 1024×640，DPI ≈ 1.39）

首页「仅一条上次学习」和「未建文件夹的库页」两张，是在临时只保留一条已学素材、文件夹列表为空后拍摄的；库页另外拍了恢复全部 67 条素材后、仍然没有自建文件夹的主工具行。拍完已把 IndexedDB 还原。

## 结果

| # | 路径 | 结果 | 关键截图 |
| --- | --- | --- | --- |
| 1 | `···` 里语速只留下拉，当前倍速写在标签上，没有循环按钮 | **PASS** | `42-menu-open.png` |
| 2 | focus 播放器「重听本句」是 ↺ 图标加无障碍名称，不再常驻长文案；单句循环仍是 ↻ 开关；核对区保留「重听」 | **PASS** | `40-study-entered.png`、`42-menu-open.png` |
| 3 | 句序只在状态行「01 / 02」出现一处，标题里不再写「第 n / m 句」 | **PASS** | `40-study-entered.png` |
| 4 | 菜单完全打开时，「核对答案」整颗看得见，没有被切掉 | **PASS** | `42-menu-open.png` |
| 5 | 听读 / 听写可以来回切换 | **PASS** | `43-listen-read.png`、`44-back-to-dictation.png` |
| 6 | 核对后按 Esc 回到修改 | **PASS** | `45-checked.png`、`46-esc-back-to-edit.png` |
| 7 | 首页只有一条「上次学习」时，不出现「暂无更多最近学习」 | **PASS** | `10-home-one-recent.png` |
| 8 | 还没有自建文件夹时，库页主工具行不放文件夹下拉；可以用「＋ 文件夹」 | **PASS** | `21-library-full-no-folders.png`、`20-library-no-folders.png` |
| 回归 | 点「快捷键」时菜单立刻关掉，没有半透明叠字；横幅在预留带里，不挡句序，也不和可见的学习顶栏相交 | **PASS** | `50-notice-appearing.png`、`51-notice-study.png` |

### 几何（1024×640）

- **菜单打开：** 与「核对答案」无相交；菜单 `opacity: 1`，背景 `rgb(255, 255, 255)`；主按钮整颗在窗内。语速循环 menuitem 数量为 0，下拉 `aria-label="播放速度"` 在。focus 播放器可见文案是运输控件和 ↻ / ↺，没有「重听本句」长文案。
- **点快捷键中途：** `menuPresent=false`，没有半透明离开态。
- **听写中横幅：** 横幅 56–92，学习顶栏 0–56，句序行 105–135。与句序、可见顶栏相交均为 null。听写过程中隐藏的全局 `.topbar` 仍有布局盒，不计入相交。

## 未做

未开 UX-3 / MOT-2。通知仍是横幅，关闭 / 自动消失、删除撤销、系统 confirm 未改。未改核对结果出现 / 收回、切句闪白、画面显隐。动效仍用 MOT-1 token。未改 UX-1 软口，未动 main 与 v0.1.3 Release。

详见 `SUMMARY.json` 与 `cdp-smoke-notes.txt`。
