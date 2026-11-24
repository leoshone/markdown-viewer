// ==UserScript==
// @name         Markdown Viewer
// @namespace    leoshone/markdown-viewer
// @version      1.1.3
// @description  替代 simov/markdown-viewer 扩展的油猴脚本：GFM 渲染、代码高亮、目录 TOC、亮/暗/跟随系统主题、本地文件自动刷新、源码/渲染切换。支持远程与本地 file:// 的 .md 文件。
// @author       leoshone
// @homepageURL  https://github.com/leoshone/markdown-viewer
// @supportURL   https://github.com/leoshone/markdown-viewer/issues
// @match        *://*/*.md
// @match        *://*/*.mdown
// @match        *://*/*.markdown
// @match        file:///*/*.md
// @match        file:///*/*.mdown
// @match        file:///*/*.markdown
// @match        file:///*/*.MD
// @include      /^https?:\/\/[^/]+\/.+\/[^/?#]*\.(md|mdown|markdown)(\?.*)?$/i
// @include      /^file:\/\/\/.+\.md(own)?$/i
// @include      /^file:\/\/\/.+\.markdown$/i
// @exclude      https://github.com/*
// @exclude      http://github.com/*
// @require      https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

/*
 * 设计决策（为什么这么做）：
 * 1. marked 仅负责解析，代码高亮与标题锚点用 DOM 后处理实现，
 *    不侵入 marked 的 renderer 签名 —— marked 升级时这里零改动。
 * 2. DOMPurify 过滤输出 HTML：远程 .md 内容不可信，防 XSS。
 * 3. 自动刷新用 GM_xmlhttpRequest 轮询 file:// 自身（页面内 fetch 受 CORS 限制不可用），
 *    变更后就地重渲染并保持滚动位置，不整页 reload。
 * 4. contentType 判定 text/plain 才接管页面：避免误伤返回 text/html 的普通网页。
 * 5. Mermaid / 数学公式暂不集成，保持精简；需要时可在 render() 后追加后处理钩子。
 */
(function () {
  'use strict';

  /* ============ 前置判定：只在“纯文本的 .md 页面”上工作 ============ */
  const PATH_RE = /\.(md|mdown|markdown)$/i;
  if (!PATH_RE.test(location.pathname)) return;
  const ct = (document.contentType || '').toLowerCase();
  // Chrome 对不认识的 Content-Type 一律按纯文本渲染（body>pre 包裹），
  // 所以这里放行所有非 HTML 响应：text/plain、text/markdown、application/octet-stream 等。
  // 只排除 text/html——那是普通网页，绝不能碰。
  // 注意：本地文件无 Content-Type 时 ct 可能为空串，同样放行。
  if (ct && (ct === 'text/html' || ct.startsWith('application/xhtml'))) return;

  /* ============ 持久化状态 ============ */
  const store = {
    get theme()        { return GM_getValue('mv:theme', 'system'); },   // system | light | dark
    get tocOn()        { return GM_getValue('mv:toc', true); },
    get autoReload()   { return GM_getValue('mv:reload', true); },      // 仅 file:// 生效
  };
  const state = {
    raw: '',
    view: 'render',       // render | source
    theme: store.theme,
    tocOn: store.tocOn,
    autoReload: store.autoReload,
    reloadTimer: null,
    headings: [],         // [{level, id, text}] 供 scrollspy 用
  };
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');

  /* ============ 入口 ============ */
  function init() {
    const raw = extractRaw();
    if (!raw || !raw.trim()) return;
    buildSkeleton();
    injectStyles();
    applyTheme();
    render(raw);
    buildBar();
    registerMenus();
    if (location.protocol === 'file:' && state.autoReload) startAutoReload();
    // 跟随系统主题时，系统切换明暗要实时生效
    mqDark.addEventListener('change', () => { if (state.theme === 'system') applyTheme(); });
  }

  /** Chrome 把 text/plain 文件放进 body 的 <pre> 里，textContent 即原始文本 */
  function extractRaw() {
    return document.body.textContent || '';
  }

  /* ============ 页面骨架 ============ */
  function buildSkeleton() {
    document.head.innerHTML = '';
    document.body.innerHTML =
      '<nav id="mv-toc"><div class="mv-toc-title">目录</div><div id="mv-toc-list"></div></nav>' +
      '<main id="mv-content" class="markdown-body"></main>' +
      '<div id="mv-bar">' +
      '<button id="mv-btn-toc" title="目录 开/关">☰</button>' +
      '<button id="mv-btn-view" title="渲染/源码切换">&lt;/&gt;</button>' +
      '<button id="mv-btn-theme" title="主题：系统→亮→暗">◐</button>' +
      '</div>';
  }

  /* ============ 渲染 ============ */
  function render(raw, keepScroll) {
    const scrollY = keepScroll ? window.scrollY : 0;
    state.raw = raw;

    let html;
    try {
      html = marked.parse(raw, { gfm: true, breaks: false });
    } catch (e) {
      html = '<p>解析失败：' + String(e && e.message || e) + '</p>';
    }
    // 远程文件内容不可信，统一过 DOMPurify（本地文件同样处理，规则简单一致）
    html = DOMPurify.sanitize(html);

    const main = document.getElementById('mv-content');
    if (state.view === 'source') {
      main.innerHTML = '';
      const pre = document.createElement('pre');
      pre.id = 'mv-src';
      pre.className = 'mv-src';
      pre.textContent = raw;
      main.appendChild(pre);
    } else {
      main.innerHTML = html;
      highlightCode(main);
      assignHeadingIds(main);
      buildToc();
    }
    window.scrollTo(0, scrollY);
  }

  /** 代码高亮：有语言标注直接高亮；无标注且块小于 5000 字符时自动检测（大块跳过防卡顿） */
  function highlightCode(root) {
    if (typeof hljs === 'undefined') return;
    root.querySelectorAll('pre > code').forEach((el) => {
      const lang = (el.className.match(/language-([\w#+-]+)/) || [])[1];
      try {
        if (lang && hljs.getLanguage(lang)) {
          hljs.highlightElement(el);
        } else if (!lang && el.textContent.length < 5000) {
          hljs.highlightElement(el); // 无 class 时 hljs 走 auto-detection
        }
      } catch (e) { /* 单块高亮失败不影响整体 */ }
    });
  }

  /** GitHub 风格 slug 化标题 id，供 TOC 锚点跳转 */
  function assignHeadingIds(root) {
    const used = Object.create(null);
    state.headings = [];
    root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
      let slug = h.textContent.toLowerCase().trim()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-') || 'section';
      if (used[slug] != null) { used[slug] += 1; slug = slug + '-' + used[slug]; }
      else used[slug] = 0;
      h.id = slug;
      state.headings.push({ level: Number(h.tagName[1]), id: slug, text: h.textContent });
    });
  }

  /* ============ 目录 TOC ============ */
  function buildToc() {
    const list = document.getElementById('mv-toc-list');
    if (!list) return;
    list.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.headings.forEach((hd) => {
      const a = document.createElement('a');
      a.href = '#' + hd.id;
      a.textContent = hd.text;
      a.className = 'mv-toc-item';
      a.style.paddingLeft = (8 + (hd.level - 1) * 14) + 'px';
      a.dataset.target = hd.id;
      frag.appendChild(a);
    });
    list.appendChild(frag);
    applyTocVisibility();
    setupScrollSpy();
  }

  function applyTocVisibility() {
    const toc = document.getElementById('mv-toc');
    if (toc) toc.style.display = state.tocOn ? 'block' : 'none';
    // 正文让位与 TOC 开关联动：开时 body.mv-toc-on 生效，正文右移避让
    document.body.classList.toggle('mv-toc-on', state.tocOn);
    const btn = document.getElementById('mv-btn-toc');
    if (btn) btn.style.opacity = state.tocOn ? '1' : '.45';
  }

  /** scrollspy：滚动时高亮“视口上方最近的标题”对应的目录项（rAF 节流） */
  function setupScrollSpy() {
    let ticking = false;
    window.onscroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        let current = null;
        for (const hd of state.headings) {
          const el = document.getElementById(hd.id);
          if (el && el.getBoundingClientRect().top <= 120) current = hd.id;
          else break;
        }
        document.querySelectorAll('#mv-toc-list a').forEach((a) => {
          a.classList.toggle('mv-active', a.dataset.target === current);
        });
      });
    };
  }

  /* ============ 主题 ============ */
  function resolveTheme() {
    return state.theme === 'system' ? (mqDark.matches ? 'dark' : 'light') : state.theme;
  }
  function applyTheme() {
    document.documentElement.dataset.mvTheme = resolveTheme();
  }
  function cycleTheme() {
    state.theme = state.theme === 'system' ? 'light' : state.theme === 'light' ? 'dark' : 'system';
    GM_setValue('mv:theme', state.theme);
    applyTheme();
  }

  /* ============ 浮动按钮 ============ */
  function buildBar() {
    const btn = (id) => document.getElementById(id);
    btn('mv-btn-toc').onclick = () => toggleToc();
    btn('mv-btn-view').onclick = () => toggleView();
    btn('mv-btn-theme').onclick = () => cycleTheme();
    applyTocVisibility();
  }
  function toggleToc() {
    state.tocOn = !state.tocOn;
    GM_setValue('mv:toc', state.tocOn);
    applyTocVisibility();
  }
  function toggleView() {
    state.view = state.view === 'render' ? 'source' : 'render';
    render(state.raw, true);
  }

  /* ============ 油猴菜单 ============ */
  function registerMenus() {
    GM_registerMenuCommand('📑 目录 开/关', toggleToc);
    GM_registerMenuCommand('🖥 渲染/源码 切换', toggleView);
    GM_registerMenuCommand('🎨 主题切换（系统→亮→暗）', cycleTheme);
    GM_registerMenuCommand('🔄 自动刷新 开/关（仅本地文件生效）', () => {
      state.autoReload = !state.autoReload;
      GM_setValue('mv:reload', state.autoReload);
      if (location.protocol === 'file:') {
        if (state.autoReload) startAutoReload();
        else stopAutoReload();
      }
    });
  }

  /* ============ 自动刷新（仅 file://）：轮询文件内容，变更就地重渲染 ============ */
  function startAutoReload() {
    if (state.reloadTimer || location.protocol !== 'file:') return;
    let lastText = state.raw;
    state.reloadTimer = setInterval(() => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: location.href,
        headers: { 'Cache-Control': 'no-cache' },
        onload: (res) => {
          const t = res.responseText;
          if (typeof t === 'string' && t !== lastText) {
            lastText = t;
            render(t, true); // 保持滚动位置
          }
        },
      });
    }, 2000);
  }
  function stopAutoReload() {
    if (state.reloadTimer) { clearInterval(state.reloadTimer); state.reloadTimer = null; }
  }

  /* ============ 样式（GitHub 风格精简版，CSS 变量做明暗主题） ============ */
  function injectStyles() {
    const css = `
:root, html[data-mv-theme="light"] {
  --mv-bg:#ffffff; --mv-fg:#24292f; --mv-border:#d0d7de; --mv-muted:#57606a;
  --mv-link:#0969da; --mv-code-bg:#eff1f3; --mv-pre-bg:#f6f8fa; --mv-quote:#d0d7de;
  --mv-bar-bg:rgba(255,255,255,.85); --mv-bar-fg:#24292f; --mv-toc-bg:#f6f8fa;
}
html[data-mv-theme="dark"] {
  --mv-bg:#0d1117; --mv-fg:#c9d1d9; --mv-border:#30363d; --mv-muted:#8b949e;
  --mv-link:#58a6ff; --mv-code-bg:#2d333b; --mv-pre-bg:#161b22; --mv-quote:#444c56;
  --mv-bar-bg:rgba(13,17,23,.85); --mv-bar-fg:#c9d1d9; --mv-toc-bg:#010409;
}
html { background:var(--mv-bg); }
body {
  margin:0; background:var(--mv-bg); color:var(--mv-fg);
  font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Helvetica,Arial,sans-serif;
  text-size-adjust:100%;
}
#mv-content { max-width:880px; margin:0 auto; padding:40px 28px 120px; box-sizing:border-box; }
/* TOC 开启时正文右移让位：优先保持视觉居中（在 TOC 右侧的剩余空间里居中），空间不足则紧贴 TOC */
body.mv-toc-on #mv-content { margin-left:max(288px, calc(272px + (100vw - 272px - 880px)/2)); }
#mv-toc {
  position:fixed; left:0; top:0; bottom:0; width:272px; box-sizing:border-box;
  overflow-y:auto; padding:16px 8px 32px; background:var(--mv-toc-bg);
  border-right:1px solid var(--mv-border); font-size:13px; z-index:9;
}
.mv-toc-title { font-weight:600; padding:0 10px 8px; color:var(--mv-muted); }
.mv-toc-item {
  display:block; padding:3px 10px; color:var(--mv-fg); text-decoration:none;
  border-radius:5px; line-height:1.5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.mv-toc-item:hover { background:var(--mv-code-bg); }
.mv-toc-item.mv-active { background:var(--mv-code-bg); color:var(--mv-link); font-weight:600; }
@media (max-width:1160px) {
  #mv-toc { display:none !important; }
  body.mv-toc-on #mv-content { margin-left:auto; } /* 窄屏 TOC 隐藏，正文回中央 */
}
/* 右上角竖排：纵向堆叠不占横向空间，正文首行不受影响 */
#mv-bar { position:fixed; right:10px; top:16px; display:flex; flex-direction:column; gap:8px; z-index:10; }
#mv-bar button {
  width:34px; height:34px; border:1px solid var(--mv-border); border-radius:8px;
  background:var(--mv-bar-bg); color:var(--mv-bar-fg); font-size:14px; cursor:pointer;
  backdrop-filter:blur(4px); transition:opacity .15s;
}
#mv-bar button:hover { border-color:var(--mv-link); }
/* ---- markdown 元素 ---- */
#mv-content h1,#mv-content h2,#mv-content h3,#mv-content h4,#mv-content h5,#mv-content h6 {
  margin:24px 0 16px; line-height:1.35; font-weight:600;
}
#mv-content h1 { font-size:2em; padding-bottom:.35em; border-bottom:1px solid var(--mv-border); }
#mv-content h2 { font-size:1.5em; padding-bottom:.3em; border-bottom:1px solid var(--mv-border); }
#mv-content h3 { font-size:1.25em; } #mv-content h4 { font-size:1em; }
#mv-content h5 { font-size:.875em; } #mv-content h6 { font-size:.85em; color:var(--mv-muted); }
#mv-content p { margin:0 0 16px; }
#mv-content a { color:var(--mv-link); text-decoration:none; }
#mv-content a:hover { text-decoration:underline; }
#mv-content img { max-width:100%; }
#mv-content hr { border:0; height:1px; background:var(--mv-border); margin:24px 0; }
#mv-content ul,#mv-content ol { margin:0 0 16px; padding-left:2em; }
#mv-content li { margin:4px 0; }
#mv-content li > input[type="checkbox"] { margin-right:6px; }
#mv-content blockquote {
  margin:0 0 16px; padding:0 1em; color:var(--mv-muted);
  border-left:4px solid var(--mv-quote);
}
#mv-content code {
  font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace;
  font-size:85%; background:var(--mv-code-bg); border-radius:4px; padding:.2em .4em;
}
#mv-content pre {
  background:var(--mv-pre-bg); border-radius:6px; padding:16px; overflow:auto;
  line-height:1.5; margin:0 0 16px;
}
#mv-content pre code { background:transparent; padding:0; font-size:85%; display:block; white-space:pre; }
#mv-content table { border-collapse:collapse; margin:0 0 16px; display:block; max-width:100%; overflow:auto; }
#mv-content th,#mv-content td { border:1px solid var(--mv-border); padding:6px 13px; }
#mv-content th { font-weight:600; background:var(--mv-pre-bg); }
#mv-content tr:nth-child(2n) td { background:color-mix(in srgb, var(--mv-pre-bg) 55%, transparent); }
.mv-src { font-size:14px; white-space:pre-wrap; word-break:break-word; }
/* ---- highlight.js 配色（GitHub Light / Dark 精简版） ---- */
#mv-content .hljs { color:inherit; background:transparent; }
html[data-mv-theme="light"] #mv-content .hljs-keyword,html[data-mv-theme="light"] #mv-content .hljs-selector-tag,
html[data-mv-theme="light"] #mv-content .hljs-subst,html[data-mv-theme="light"] #mv-content .hljs-literal,
html[data-mv-theme="light"] #mv-content .hljs-doctag,html[data-mv-theme="light"] #mv-content .hljs-name { color:#d73a49; }
html[data-mv-theme="light"] #mv-content .hljs-string,html[data-mv-theme="light"] #mv-content .hljs-regexp,
html[data-mv-theme="light"] #mv-content .hljs-addition,html[data-mv-theme="light"] #mv-content .hljs-attribute,
html[data-mv-theme="light"] #mv-content .hljs-meta .hljs-string { color:#032f62; }
html[data-mv-theme="light"] #mv-content .hljs-title,html[data-mv-theme="light"] #mv-content .hljs-section,
html[data-mv-theme="light"] #mv-content .hljs-selector-id,html[data-mv-theme="light"] #mv-content .hljs-selector-class { color:#6f42c1; }
html[data-mv-theme="light"] #mv-content .hljs-attr,html[data-mv-theme="light"] #mv-content .hljs-variable,
html[data-mv-theme="light"] #mv-content .hljs-template-variable,html[data-mv-theme="light"] #mv-content .hljs-type,
html[data-mv-theme="light"] #mv-content .hljs-number,html[data-mv-theme="light"] #mv-content .hljs-symbol,
html[data-mv-theme="light"] #mv-content .hljs-bullet,html[data-mv-theme="light"] #mv-content .hljs-link { color:#005cc5; }
html[data-mv-theme="light"] #mv-content .hljs-comment,html[data-mv-theme="light"] #mv-content .hljs-quote,
html[data-mv-theme="light"] #mv-content .hljs-deletion { color:#6a737d; }
html[data-mv-theme="light"] #mv-content .hljs-built_in,html[data-mv-theme="light"] #mv-content .hljs-builtin-name { color:#e36209; }
html[data-mv-theme="light"] #mv-content .hljs-meta { color:#6f42c1; }
html[data-mv-theme="light"] #mv-content .hljs-emphasis { font-style:italic; }
html[data-mv-theme="light"] #mv-content .hljs-strong { font-weight:600; }
html[data-mv-theme="dark"] #mv-content .hljs-keyword,html[data-mv-theme="dark"] #mv-content .hljs-selector-tag,
html[data-mv-theme="dark"] #mv-content .hljs-literal,html[data-mv-theme="dark"] #mv-content .hljs-doctag,
html[data-mv-theme="dark"] #mv-content .hljs-name { color:#ff7b72; }
html[data-mv-theme="dark"] #mv-content .hljs-string,html[data-mv-theme="dark"] #mv-content .hljs-regexp,
html[data-mv-theme="dark"] #mv-content .hljs-addition { color:#a5d6ff; }
html[data-mv-theme="dark"] #mv-content .hljs-title,html[data-mv-theme="dark"] #mv-content .hljs-section,
html[data-mv-theme="dark"] #mv-content .hljs-selector-id,html[data-mv-theme="dark"] #mv-content .hljs-selector-class { color:#d2a8ff; }
html[data-mv-theme="dark"] #mv-content .hljs-attr,html[data-mv-theme="dark"] #mv-content .hljs-variable,
html[data-mv-theme="dark"] #mv-content .hljs-template-variable,html[data-mv-theme="dark"] #mv-content .hljs-type,
html[data-mv-theme="dark"] #mv-content .hljs-number,html[data-mv-theme="dark"] #mv-content .hljs-symbol,
html[data-mv-theme="dark"] #mv-content .hljs-bullet,html[data-mv-theme="dark"] #mv-content .hljs-link { color:#79c0ff; }
html[data-mv-theme="dark"] #mv-content .hljs-comment,html[data-mv-theme="dark"] #mv-content .hljs-quote,
html[data-mv-theme="dark"] #mv-content .hljs-deletion { color:#8b949e; }
html[data-mv-theme="dark"] #mv-content .hljs-built_in,html[data-mv-theme="dark"] #mv-content .hljs-builtin-name { color:#ffa657; }
html[data-mv-theme="dark"] #mv-content .hljs-meta { color:#d2a8ff; }
html[data-mv-theme="dark"] #mv-content .hljs-emphasis { font-style:italic; }
html[data-mv-theme="dark"] #mv-content .hljs-strong { font-weight:600; }
`;
    const style = document.createElement('style');
    style.id = 'mv-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  init();
})();
