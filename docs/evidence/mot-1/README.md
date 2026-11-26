# MOT-1 人眼冒烟证据

- 分支：`feat/mot-1-motion-language`
- 实施 tip：`e2fa77ff644200c016e279358d1dda839671bd5d`（听写横幅改到学习顶栏下方）
- 本轮冒烟对照该 tip
- 机器：Windows LM，WebView2 CDP `:9222`
- 启动：`npm run desktop` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
- 脚本：`scripts/_cdp_mot1_smoke.mjs`
- 总评：**PASS**
- 时间：2026-11-26 11:22（Asia/Shanghai）

视口按窗口客户区去逼近目标尺寸（DPI ≈ 1.39，实测会有 1px 左右偏差）：

| 标签 | 目标 | 实测 inner |
| --- | --- | --- |
| 默认 / 第 1 条切换 | 1180×800（应用默认） | 1180×800 |
| 参考 | 1024×640 | 1025×641 |
| 更窄（应用 min 720×560） | 720×560 | 721×561 |
| 宽屏 | 1440×900 | 1441×901 |
| 听写与通知 | 1024×640 | 1025×641 |

## 素材

听写使用 `C:\Users\PC\AttuneSmoke\p3\speech.wav`（先前 Video P3 / UX-1 冒烟样例）。本机共享素材库条目较多，点第一行未能稳定进入听写，故又导入了该音频；自动准备后「已准备好 2 句，可以开始听写」，再进入听写。

## 结果

| # | 路径 | 结果 | 关键截图 |
| --- | --- | --- | --- |
| 1 | 首页 ↔ 库 ↔ 导入：页面切换有交代，不闪、不无故重排、不溢出 | **PASS** | `01-home.png`、`02-home-to-library-mid.png`、`03-library.png`、`04-library-to-import-mid.png`、`05-import.png`、`06-back-library.png`、`07-back-home.png` |
| 2 | 进入听写：顶栏消失；离开后顶栏回来；`···` 菜单和句子列表从按钮附近出现与收起，中途再点可打断 | **PASS** | `40-study-entered.png`、`41-menu-opening.png`、`42-menu-open.png`、`43-menu-interrupt.png`、`46-sentence-open.png`、`47-sentence-interrupt.png`、`48-leave-study.png` |
| 3 | 1024×640、更窄 720×560、宽屏 1440×900：首页 / 库 / 导入不横向溢出、可见主控件仍在窗内 | **PASS** | `10-ref-home.png`、`11-ref-library.png`、`12-ref-import.png`、`10-narrow-*.png`、`10-wide-*.png` 等同系列 |
| 4 | 听写中快捷键横幅在学习顶栏下方叠着，不盖住工具栏，页面不被顶开；离开后横幅仍在全局顶栏下方，导入页标题和返回看得见 | **PASS** | `51-notice-study.png`、`52-notice-after-leave.png` |

### 第 4 条：挡没挡住标题 / 工具栏（本轮补修后）

用听写壳「更多 → 快捷键」触发现有横幅（文案为快捷键说明）。

- **听写中：** 学习顶栏在 0–56px（「← 返回」、素材名 `speech`、「听读」、`···`），完全可见。横幅叠在其下，约 56–92px，与学习顶栏无重叠，页面没有被顶下去。见 `51-notice-study.png`。
- **离开听写回到导入页后：** 通知仍在。横幅在全局顶栏下方（约 54–90px）。「← 返回」和「导入素材」标题（约 135px）都看得见，没有被挡住。见 `52-notice-after-leave.png`。几何上横幅上沿与测得的顶栏底边有约 12px 相交（顶栏 `getBoundingClientRect` 高度约 66px，样式高度 54px）；顶栏 `z-index` 在横幅之上，截图里标志和「首页 / 素材库」仍完整露在横幅上面。

## 未做

未把「减少动态效果」作为本轮必过项来跑。未开始 UX-2 / UX-3 / MOT-2。未改 UX-1 软口，也未为滚动软口改代码。未改关闭 / 自动消失策略，也未把通知改成 toast。未动 main 与 v0.1.3 Release。

详见 `SUMMARY.json` 与 `cdp-smoke-notes.txt`。
