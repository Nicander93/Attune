# Attune · 听写工作台

自用、免登录的英语听写桌面工具。Tauri 2 + React + TypeScript；可以先在浏览器中运行同一套界面。

## 已实现

- 导入本地音频，真实播放、变速、进度定位、整篇／片段模式与循环。
- 词格输入：Space 进入下一个词，空词 Backspace 返回，点击修改、整句粘贴、留空。
- 可选轻柔输入音效，播放音频时静音；播放控制恢复输入焦点。
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
```

首次运行浏览器测试前执行 `npx playwright install chromium`。测试会导入自动生成的 WAV 文件，验证词格、字幕、核对、持久化和整篇／片段播放。

## Windows 桌面运行与打包

需要 Rust stable、Visual Studio Build Tools（勾选 C++ 桌面开发与 Windows SDK）、WebView2。若此前没有 Rust，请通过 rustup 安装。

```bash
npm ci
npm run desktop
npm run tauri build
```

安装包输出在 `src-tauri/target/release/bundle/nsis/`。也可在 GitHub Actions 手动运行 Windows desktop 工作流生成安装包。

**当前交付验证了前端构建和浏览器行为；执行环境没有 Rust，Windows 原生打包尚未实测。**

## 使用顺序

1. 导入 MP3／WAV 等音频，默认建立覆盖整篇的片段。
2. 有 SRT 就导入字幕；没有字幕时先在播放位置拆分片段，再填写每段参考原文。
3. 选择整篇听或片段听，在词格输入。整篇听只高亮当前播放段，不自动滚动或抢走输入焦点。
4. 核对后首次稿被保留；继续编辑，点击保存修订稿。
5. 在练习记录中重新听写，或继续以前的一次练习。

快捷键：`Ctrl/⌘ + Shift + Space` 重播；`Ctrl/⌘ + Enter` 核对当前输入所在片段。

## 首版边界

- AI 识别和自动分句未接入。当前参考原文来自 SRT 或手动填写。
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
  App.tsx          材料、播放和练习流程
  WordEditor.tsx   词格输入与键盘交互
  domain.ts        片段、核对、练习记录、SRT
  storage.ts       本地音频与记录保存
  sound.ts         输入音效
src-tauri/         桌面外壳
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
