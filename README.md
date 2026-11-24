# Markdown Viewer

替代 Chrome 扩展 [Markdown Viewer (simov)](https://chromewebstore.google.com/detail/markdown-viewer/ckkdlimhmcjmikdlpkmbgfkaikojcbjk) 的用户脚本（userscript），适用于暴力猴（Violentmonkey）/ Tampermonkey。

![version](https://img.shields.io/badge/version-1.1.3-blue) [![install](https://img.shields.io/badge/install-raw%20link-green)](https://raw.githubusercontent.com/leoshone/markdown-viewer/main/markdown-viewer.user.js)

## 功能

- GitHub 风格 Markdown 渲染（marked.js 12，GFM 表格/任务列表/删除线）
- 代码语法高亮（highlight.js 11，有语言标注直接高亮，无标注小代码块自动检测）
- 目录 TOC 侧栏（右上角 ☰ 开关），滚动跟随高亮，点击跳转
- 主题：跟随系统 / 亮色 / 暗色（GitHub 配色，含代码高亮配色），右上角 ◐ 切换
- 本地文件**自动刷新**：编辑器里改完 2 秒内页面就地更新，滚动位置不丢
- 源码 / 渲染 双视图切换（右上角 `</>`）
- DOMPurify 过滤输出，远程 .md 内容防 XSS

## 安装

1. 浏览器装好 [暴力猴](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) 或 Tampermonkey。
2. 点击安装（暴力猴会弹出确认页）：
   **[https://raw.githubusercontent.com/leoshone/markdown-viewer/main/markdown-viewer.user.js](https://raw.githubusercontent.com/leoshone/markdown-viewer/main/markdown-viewer.user.js)**
3. **关键一步**（否则本地文件不渲染）：`chrome://extensions` → 暴力猴 → 详细信息 → 打开**「允许访问文件网址」**。

## 使用

- 浏览器直接打开或拖入 `.md` / `.markdown` / `.mdown` 文件（本地或远程 URL 均可）。
- 右上角按钮：`☰` 目录开关、`</>` 源码/渲染切换、`◐` 主题切换（系统→亮→暗）。
- 脚本管理器菜单里有同样四个命令，「自动刷新」开关仅对本地文件生效。

## 说明与限制

- 仅接管非 HTML 响应的 .md 页面（`text/plain`、`text/markdown` 等）；GitHub 等已自带渲染的站点已排除。
- **本地文件不注入？** 暴力猴/Tampermonkey 的 MV3 userScripts API 按 `@match`（非 `@include`）注册注入规则——本脚本已内置 `file:///*` match，但仍需开启「允许访问文件网址」。
- 首次渲染需联网加载 CDN 库（marked / highlight.js / DOMPurify），之后由脚本管理器缓存。
- 自动刷新基于轮询（2 秒）；远程 http(s) 的 .md 不轮询。
- Mermaid 图表、数学公式暂未集成，需要时欢迎提 issue。

## 与原扩展的功能对比

| 功能 | 原扩展 | 本脚本 |
|---|---|---|
| GFM 渲染 | ✅ | ✅ |
| 代码高亮 | ✅ | ✅ |
| 目录 TOC | ✅ | ✅（含滚动跟随） |
| 亮/暗主题 | ✅ 30+ | ✅ GitHub 配色 3 态 |
| MathJax / Mermaid | ✅ | ❌（待加） |
| 本地文件自动刷新 | ✅ | ✅ 2s 轮询 |
| 30+ 主题 / 设置同步 | ✅ | ❌ |

## License

MIT
