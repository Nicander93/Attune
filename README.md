# Attune · 听写工作台

自用、免登录的英语听写桌面工具。Tauri 2 + React + TypeScript；可以先在浏览器中运行同一套界面。

## 已实现

- 导入本地音频，真实播放、变速、进度定位、整篇／片段模式与循环。
- 词格输入：Space 进入下一个词，空词 Backspace 返回，点击修改、整句粘贴、留空。
- 可选轻柔输入音效，播放音频时静音；播放控制恢复输入焦点。
- 桌面版本机离线识别原文（whisper.cpp）：后台运行、显示进度、可取消；识别完成后一次性生成带起止时间的句子片段，并保留词级时间。取消或失败不改动已有片段。
- 识别模型首次使用时下载（默认 base.en）：下载地址可在“识别设置”里修改，格式为带 `{file}` 的地址模板，下载时 `{file}` 换成模型文件名。预设有 ModelScope（国内，默认）、HF-Mirror 和 Hugging Face 官方。支持断点续传，下载后按 SHA-256 校验，校验不过不启用；离线时可导入本地 ggml 模型文件，导入同名模型前会先确认是否替换。
- 导出 SRT（UTF-8、`HH:MM:SS,mmm`），导出的文件可以再导入，句子和时间保持一致。
- 导入 SRT 自动建立片段；可手动编辑片段起止时间、参考原文，在播放位置拆分空白片段。
- 核对前不展示原文或单词数量，核对后按词对齐差异，忽略大小写与标点。
- 首次稿、修订稿、重新练习分别保存；历史回顾、重听标记、JSON 记录导出。
- IndexedDB 保存音频 Blob、草稿、播放位置和记录。浏览器和桌面端分别拥有自己的数据。

## 本地启动

需要 Node.js 22 LTS。

```bash
npm ci
npm run dev
```

打开终端显示的 `http://localhost:1420`。请固定使用相同地址和端口，以便访问同一份本地数据。

```bash
npm test
npm run build
npm run test:e2e
npm run test:rust   # Rust 单元测试，需要下文的桌面构建环境
```

首次运行浏览器测试前执行 `npx playwright install chromium`。测试会导入自动生成的 WAV 文件，验证词格、字幕、核对、持久化和整篇／片段播放。

## Windows 桌面运行与打包

需要 Rust stable、Visual Studio Build Tools（勾选 C++ 桌面开发与 Windows SDK）、WebView2。若此前没有 Rust，请通过 rustup 安装。

识别模块会编译 whisper.cpp，所以**从源码构建时**另外需要下面两项。它们只在编译时用到；用安装包安装的用户不需要安装 CMake 或 libclang。

- **CMake**：PATH 里有就用；没有时自动使用 VS Build Tools 自带的 CMake。
- **libclang**（生成 whisper.cpp 绑定）：安装 LLVM，或执行 `pip install libclang`；也可以自己设置 `LIBCLANG_PATH`。

`npm run desktop`、`npm run tauri ...` 和 `npm run test:rust` 都通过 `scripts/native-env.mjs` 运行，它会自动找到上面两项并设置 `CMAKE`、`LIBCLANG_PATH`，不需要手动改 PATH。直接运行 `cargo` 时，请写成 `node scripts/native-env.mjs cargo ...`。

```bash
npm ci
npm run desktop
npm run tauri build
```

安装包输出在 `src-tauri/target/release/bundle/nsis/`。也可在 GitHub Actions 手动运行 Windows desktop 工作流生成安装包。

已在 Windows（Rust 1.98、VS 2026 Build Tools、自带 CMake、`pip install libclang`）上实测 `npm run tauri build`，并在桌面版里完整跑过：首次下载模型、识别、取消、导出 SRT 再导入、导入本地模型。

## 使用顺序

1. 导入 MP3／WAV 等音频，默认建立覆盖整篇的片段。
2. 点“识别原文”自动切句（首次会先下载模型）；也可以导入 SRT，或在播放位置拆分片段后手动填写参考原文。需要时点“导出 SRT”。
3. 选择整篇听或片段听，在词格输入。整篇听只高亮当前播放段，不自动滚动或抢走输入焦点。
4. 核对后首次稿被保留；继续编辑，点击保存修订稿。
5. 在练习记录中重新听写，或继续以前的一次练习。

快捷键：`Ctrl/⌘ + Shift + Space` 重播；`Ctrl/⌘ + Enter` 核对当前输入所在片段。

## 首版边界

- 识别只针对英文，模型为 whisper 的 tiny.en／base.en／small.en，按 20 分钟以内的音频设计；整段音频一次解码、一次识别。
- 识别结果和 SRT 一样会替换整条时间轴；材料已有听写记录时不允许替换。识别出的原文暂不能逐句修改、合并或拆分（下一步）。
- 识别只在桌面版可用；浏览器版的“识别原文”按钮不可用。
- 同一个材料只能在一个窗口编辑；尚未实现多窗口冲突处理。
- 字幕不支持重叠时间段；已有听写记录时禁止替换整个时间轴，避免历史错位。
- 已核对片段的参考原文不可直接改写，首次核对会保存参考原文快照。
- 听写草稿 300ms 防抖保存；隐藏页面时触发保存。异常断电仍可能丢失最后几个按键。
- 浏览器清除站点数据会删除材料。导出 JSON **仅包含练习记录，不包含音频，尚无导入恢复功能**。
- 输入音效是合成音，首版仅开关，音量选项后续补充。
- 长音频会完整复制到本地数据库；首版没有流式存储和波形展示。
- 系统 WebView 的音频解码能力不同，优先使用 MP3／WAV。

## 目录

```text
src/
  App.tsx                材料、播放和练习流程
  WordEditor.tsx         词格输入与键盘交互
  domain.ts              片段、核对、练习记录、SRT 导入导出、数据迁移
  storage.ts             本地音频与记录保存
  sound.ts               输入音效
  recognition.ts         与桌面端识别、模型管理通信
  useRecognition.ts      识别和模型下载的进度、取消
  RecognitionSettings.tsx 识别设置面板
src-tauri/src/
  main.rs                桌面命令
  models.rs              模型目录、断点续传下载、校验、本地导入
  transcribe.rs          whisper 识别与切句
  jobs.rs                单任务与取消
scripts/native-env.mjs   为原生构建找到 CMake 与 libclang
tests/             核对、字幕与历史测试
e2e/               浏览器流程测试
```

## 源码仓库

项目仓库：[Nicander93/Attune](https://github.com/Nicander93/Attune)。

克隆源码：

```bash
git clone https://github.com/Nicander93/Attune.git
cd Attune
```

若你解压源码包，可以连接现有仓库：

```bash
git init -b main
git remote add origin https://github.com/Nicander93/Attune.git
```
