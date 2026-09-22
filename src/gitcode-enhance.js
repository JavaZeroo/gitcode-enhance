(function () {
  'use strict';

  const PR_PAGE_RE = /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/;

  function log(...args) {
    console.log('[gitcode-enhance]', ...args);
  }

  // ---- 功能：PR 讨论区自动展开所有折叠的消息 ----
  // gitcode 的 PR 讨论区会把大段历史消息折叠成一个
  // ".collapse-btn"（文案类似“此处折叠了 363 条消息 查看更多”）。
  // 点开一个折叠块后，里面可能还嵌套着新的折叠块，所以要反复点击，
  // 直到连续几轮都找不到新的折叠块为止。
  function autoExpandPRComments() {
    const COLLAPSE_SELECTOR = '.collapse-btn__more';
    const CLICK_DELAY_MS = 500;
    const MAX_IDLE_ROUNDS = 3; // 连续几轮没有新折叠块，就认为展开完了
    const MAX_TICKS = 300; // 兜底上限，防止意外死循环

    let idleRounds = 0;
    let ticks = 0;
    let expanded = 0;

    function tick() {
      ticks++;
      const btn = document.querySelector(COLLAPSE_SELECTOR);

      if (btn) {
        idleRounds = 0;
        expanded++;
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } else {
        idleRounds++;
      }

      if (ticks < MAX_TICKS && idleRounds < MAX_IDLE_ROUNDS) {
        setTimeout(tick, CLICK_DELAY_MS);
      } else {
        log(`PR 评论自动展开完成，共点开 ${expanded} 处折叠块`);
      }
    }

    log('开始自动展开 PR 折叠评论…');
    setTimeout(tick, 800); // 等页面讨论区先渲染出来
  }

  // ---- 功能：去广告/去干扰 ----
  // 目前处理三类：
  //   1. 客服悬浮聊天窗 #udesk_iframe
  //   2. 右侧悬浮工具条 .gitcode-tools-float-root（反馈/帮助图标）
  //   3. README 顶部“以下内容由 AI 翻译…”提示条（没有稳定 class，靠文本特征匹配）
  GM_addStyle(`
    #udesk_iframe,
    .gitcode-tools-float-root {
      display: none !important;
    }
  `);

  // ---- 功能：GitHub 风格皮肤 ----
  // 试过苹果 Liquid Glass（backdrop-filter 大面积毛玻璃），实测又丑又卡（这种内容密集的
  // 页面上 blur 层开销很大），改成 GitHub Primer 设计规范：纯色背景 + 6px 小圆角，
  // 不用 blur/阴影堆叠。细边框加上去被吐槽丑，去掉了，只留背景/圆角/字体。
  GM_addStyle(`
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
        "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif !important;
    }

    .g-header,
    .repo-header-inner {
      background: #ffffff !important;
      box-shadow: none !important;
    }

    .repo-markdown-card,
    .set-skeleton,
    .comment-box {
      background: #ffffff !important;
      border-radius: 6px !important;
      box-shadow: none !important;
    }
  `);

  function hideAiTranslationNotice() {
    const link = Array.from(document.querySelectorAll('a')).find((a) =>
      a.textContent.includes('提交 issue 反馈')
    );
    if (!link) return false;
    const bar = link.closest('.repo-markdown-card-header') ? link.parentElement.parentElement : null;
    if (bar && bar.style.display !== 'none') {
      bar.style.display = 'none';
      log('已隐藏 AI 翻译提示条');
    }
    return true;
  }

  // README 是异步加载出来的，切换仓库/路由后要重新轮询等它出现
  function declutter() {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (hideAiTranslationNotice() || tries > 20) clearInterval(timer);
    }, 500);
  }

  // ---- 功能：性能优化（分级去除 AI 组件） ----
  // /dashboard 首页默认就是一个沉浸式 AI Agent 聊天界面（.dashboard-shell--immersive），
  // 还会额外打 copilot-agent.gitcode.com 的几个接口 + token_usage/claim_computing_power 小组件接口。
  // 平时用不到这些的话，分两档处理：
  //   轻量级：只 CSS 隐藏，不动网络请求，零风险，纯粹减少渲染/占用的视觉空间
  //   极致级：额外在 document-start 阶段拦截这些请求，真正省下流量和 CPU，
  //           代价是想用 AI Agent 时会打不开——用户自己承担
  const PERF_LEVEL_KEY = 'gitcode_enhance_perf_level';
  const PERF_LEVELS = ['off', 'light', 'aggressive'];
  const PERF_LEVEL_LABEL = { off: '关闭', light: '轻量级', aggressive: '极致级' };
  const AI_BLOCK_PATTERNS = ['copilot-agent.gitcode.com', 'token_usage', 'claim_computing_power'];

  function getPerfLevel() {
    const v = GM_getValue(PERF_LEVEL_KEY, 'light');
    return PERF_LEVELS.includes(v) ? v : 'light';
  }

  function blockAiNetworkRequests() {
    function isBlocked(url) {
      url = String(url || '');
      return AI_BLOCK_PATTERNS.some((p) => url.includes(p));
    }

    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (isBlocked(url)) {
          log('极致级性能优化：拦截请求', url);
          return Promise.reject(new Error('blocked by gitcode-enhance perf mode'));
        }
        return origFetch.apply(this, arguments);
      };
    }

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__gitcodeEnhanceBlocked = isBlocked(url);
      if (this.__gitcodeEnhanceBlocked) log('极致级性能优化：拦截请求', url);
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      if (this.__gitcodeEnhanceBlocked) return;
      return origSend.apply(this, args);
    };
  }

  function applyPerfOptimization() {
    const level = getPerfLevel();
    if (level === 'off') return;

    GM_addStyle(`
      .dashboard-shell--immersive {
        display: none !important;
      }
    `);

    if (level === 'aggressive') {
      blockAiNetworkRequests();
    }
  }

  function registerPerfMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    const current = getPerfLevel();
    for (const level of PERF_LEVELS) {
      const mark = level === current ? '✓ ' : '';
      GM_registerMenuCommand(`性能优化：${mark}${PERF_LEVEL_LABEL[level]}`, () => {
        GM_setValue(PERF_LEVEL_KEY, level);
        location.reload();
      });
    }
  }

  applyPerfOptimization();
  registerPerfMenu();

  // ---- SPA 路由处理：gitcode 是客户端路由，切换 PR 不会整页刷新 ----
  let lastPath = '';
  function onRouteChange() {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;

    declutter();

    if (PR_PAGE_RE.test(path)) {
      autoExpandPRComments();
    }
  }

  onRouteChange();
  setInterval(onRouteChange, 1000);
})();
