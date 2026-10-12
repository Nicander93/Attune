# Attune · 英语听写

本地优先、免登录的英语听写桌面工具。Tauri 2 + React + TypeScript + Rust（whisper.cpp）；同一套界面也能在浏览器里运行，语音识别只在桌面版可用。

## 流程

1. **素材库 → 新建素材**：分别导入音频（必需）和字幕（可选）。两者互相独立，同名文件不会自动匹配。
2. 字幕支持 SRT 与 VTT。双语字幕会按行拆成英文和中文；判断不了时整块保留为原文，不丢内容。
3. 没有字幕也可以先听，但**没有参考字幕就无法核对答案**。
4. 桌面版可以在本地用 whisper.cpp 识别原文，模型首次使用时下载，下载完成并通过 SHA-256 校验后才会启用。
5. **听写**：播放 → 写下来 → `Enter` 核对 → `Enter` 下一句。核对前不显示任何正确性提示。
6. **听读**：连续文本 + 当前句高亮，可切换英文／中文／双语；未听写的句子默认隐藏原文。
7. **难句**标记属于素材，跨轮次保留；「只看难句」把导航范围限制到已标记的句子。

## 快捷键

输入框获得焦点时，`←` `→` 仍然移动光标，不切句。

| 按键               | 学习页（非输入焦点） | 听写输入框       |
| ------------------ | -------------------- | ---------------- |
| `←` / `→`          | 上一句 / 下一句      | 移动光标         |
| `Space`            | 播放 / 暂停          | 输入空格         |
| `Enter`            | 核对后下一句         | 核对答案         |
| `Esc`              | 关闭菜单或浮层       | 核对后回到修改   |
| `Ctrl+←/→`         | 浏览器原生           | 按词移动光标     |
| `Ctrl+A/C/V/X/Z/Y` | 遵循系统             | 遵循原生编辑行为 |

素材库内另有 `F2` 重命名选中素材、`Ctrl+F` 聚焦搜索。

`Ctrl+←/→`、`Ctrl+Space` 和 `Alt+←/→` 刻意没有占用：它们分别与逐词导航、中英文输入法切换和浏览器前进后退冲突。

## 旧数据兼容

IndexedDB 从 v2 升到 v3 是非破坏性的：音频、字幕、草稿、已核对句子、难句标记和片段 ID 全部保留。v1 缺失或重复的片段 ID 会被修复，对应的草稿会跟随到正确的句子。v2 的首次稿／修订稿档案会保留在兼容层中，但不再展示。

两处刻意的诚实处理：

- 老数据没有可信的「学习时间」（v2 在导入音频时就创建了首个练习轮次），所以 `lastStudiedAt` 一律留空，而不是用导入时间冒充。
- 导入时间只从音频文件自身的修改时间推导；取不到就留空，此时「最近导入」会稳定地排在最后。

## 目录

```text
src/
  app/                    页面导航、全局状态、快捷键作用域、样式
  domain/                 数据类型、核对算法、字幕解析与编辑规则、迁移
  storage/db.ts           IndexedDB v3 与版本迁移
  features/
    home/                 首页与继续学习
    library/              素材库、文件夹、搜索、排序
    material/             音频与字幕导入
    subtitles/            字幕校对
    player/               共享播放器与句级导航
    dictation/            单词流编辑器
    reading/              听读、完整原文
  assets/logo.svg         品牌符号主稿
src-tauri/src/
  main.rs                 桌面命令
  models.rs               模型目录、断点续传、校验、本地导入
  transcribe.rs           whisper 识别与切句
  jobs.rs                 单任务与取消
scripts/
  native-env.mjs          为原生构建找到 CMake 与 libclang
  build-icons.mjs         从 logo.svg 生成各尺寸 PNG 与 icon.ico
tests/                    领域与存储测试
e2e/                      浏览器流程测试
```

## 本地开发

需要 Node.js 22 LTS。

```bash
npm ci
npm run dev        # http://127.0.0.1:1420
npm test           # 单元测试
npm run test:e2e   # 浏览器流程（首次需 npx playwright install chromium）
npm run icons      # 从 src/assets/logo.svg 重新生成应用图标
npm run format     # Prettier
```

## Windows 桌面运行与打包

需要 Rust stable、Visual Studio Build Tools（勾选 C++ 桌面开发与 Windows SDK）、WebView2。

识别模块会编译 whisper.cpp，所以**从源码构建时**另外需要 CMake 和 libclang；用安装包安装的用户不需要。`npm run desktop`、`npm run tauri ...` 和 `npm run test:rust` 都通过 `scripts/native-env.mjs` 运行，它会自动找到这两项。

```bash
npm ci
npm run desktop
npm run tauri build
```

安装包输出在 `src-tauri/target/release/bundle/nsis/`。

## 已知限制

- 语音识别只支持英文，模型为 whisper 的 tiny.en／base.en／small.en，按 20 分钟以内的音频设计。
- 字幕不支持重叠时间段；单段超过 60 秒会被拒绝，请在校对页拆分。
- 已经有过听写记录时，不再允许替换整条时间轴，以免旧记录的片段对不上。
- 合并字幕会改变片段 ID，后一句上的记录无法迁移时会明确告知，而不是悄悄丢弃。
- 同一段素材只能在一个窗口编辑，尚未实现多窗口冲突处理。
- 没有中文译文的字幕无法呈现双语模式；系统不会凭空生成翻译。
- 系统 WebView 的音频解码能力不同，优先使用 MP3／WAV。
- Windows 原生窗口下的语音识别、文件对话框与输入法尚未逐项实测。

## 仓库

https://github.com/Nicander93/Attune
