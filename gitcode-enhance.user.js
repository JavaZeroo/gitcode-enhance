// ==UserScript==
// @name         GitCode / AtomGit 增强
// @name:en      GitCode Enhance
// @namespace    https://github.com/JavaZeroo/gitcode-enhance
// @version      0.2.2
// @description  去广告、GitHub 风格美化、分级性能优化（拦截 AI/营销/客服/验证码请求、裁剪图标雪碧图）、PR 评论自动展开、可视化设置面板
// @description:en  Remove ads, GitHub-style skin, tiered performance mode (block AI/marketing/support/captcha requests, prune icon sprite), auto-expand PR comments, settings panel
// @author       JavaZeroo
// @match        https://gitcode.com/*
// @icon         https://gitcode.com/favicon.ico
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @license      MIT
// @homepageURL  https://github.com/JavaZeroo/gitcode-enhance
// @supportURL   https://github.com/JavaZeroo/gitcode-enhance/issues
// @updateURL    https://raw.githubusercontent.com/JavaZeroo/gitcode-enhance/main/gitcode-enhance.user.js
// @downloadURL  https://raw.githubusercontent.com/JavaZeroo/gitcode-enhance/main/gitcode-enhance.user.js
// ==/UserScript==

(function () {
  'use strict';

  // 总开关（调试/对照测量用）：localStorage.setItem('gitcode-enhance:disabled','1') 后刷新即可完全停用
  try {
    if (localStorage.getItem('gitcode-enhance:disabled') === '1') {
      console.log('[gitcode-enhance] 已被总开关停用');
      return;
    }
  } catch (e) { /* ignore */ }

  // Tampermonkey 在有 @grant 时会把 window 换成沙箱代理，直接改 window.fetch 只会改到沙箱里的副本，
  // 页面代码看不到。要拦截页面请求必须打到页面真正的 window（unsafeWindow）上。
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const VERSION = '0.2.2';
  const PR_PAGE_RE = /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/;

  function log(...args) {
    console.log('[gitcode-enhance]', ...args);
  }

  // 调试用：把关键状态写到 <html data-gce-*>，方便在页面上下文里读取（沙箱里的变量页面看不到）
  function debug(key, val) {
    try { document.documentElement.setAttribute('data-gce-' + key, String(val)); } catch (e) { /* ignore */ }
  }

  // =====================================================================
  // 设置
  // =====================================================================
  const SETTINGS_KEY = 'gitcode_enhance_settings';
  const LEGACY_PERF_KEY = 'gitcode_enhance_perf_level';

  const PERF_TOGGLES = ['hideAiUi', 'pruneIconSprite', 'blockAiApi', 'blockMarketing', 'blockAnalytics', 'blockUdesk', 'blockCaptcha'];

  const PERF_PRESETS = {
    off: { hideAiUi: false, pruneIconSprite: false, blockAiApi: false, blockMarketing: false, blockAnalytics: false, blockUdesk: false, blockCaptcha: false },
    light: { hideAiUi: true, pruneIconSprite: true, blockAiApi: false, blockMarketing: false, blockAnalytics: false, blockUdesk: false, blockCaptcha: false },
    aggressive: { hideAiUi: true, pruneIconSprite: true, blockAiApi: true, blockMarketing: true, blockAnalytics: true, blockUdesk: true, blockCaptcha: true },
  };

  const DEFAULTS = {
    adblock: { udeskWidget: true, floatTools: true, aiTranslateNotice: true, promo: true },
    theme: { github: true },
    pr: { autoExpand: true },
    // /dashboard 默认是 AI Agent 聊天页，打开 gitcode.com 也会跳到这里。改成落到工作台的某个真实页面。
    dashboard: { home: 'latest-activity' },
    ui: { headerButton: true },
    perf: { level: 'light', ...PERF_PRESETS.light },
  };

  const DASHBOARD_HOMES = [
    ['latest-activity', '最新动态'],
    ['pulls', 'Pull Requests'],
    ['issues', 'Issue'],
    ['discussions', '讨论'],
    ['kanban', '看板'],
    ['none', '不跳转（保留 AI 聊天页）'],
  ];
  const DASHBOARD_AI_RE = /^\/dashboard\/?(atomcode\/?)?$/;

  function dashboardRedirectTarget(path) {
    const home = settings.dashboard.home;
    if (!home || home === 'none') return null;
    if (!DASHBOARD_HOMES.some(([k]) => k === home)) return null;
    return DASHBOARD_AI_RE.test(path) ? '/dashboard/' + home : null;
  }

  function deepMerge(base, patch) {
    const out = { ...base };
    if (!patch || typeof patch !== 'object') return out;
    for (const k of Object.keys(patch)) {
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = deepMerge(base[k], patch[k]);
      else if (patch[k] !== undefined) out[k] = patch[k];
    }
    return out;
  }

  function detectLevel(perf) {
    for (const [name, preset] of Object.entries(PERF_PRESETS)) {
      if (PERF_TOGGLES.every((k) => !!perf[k] === preset[k])) return name;
    }
    return 'custom';
  }

  function gmGet(key, def) {
    try { return typeof GM_getValue === 'function' ? GM_getValue(key, def) : def; } catch (e) { return def; }
  }
  function gmSet(key, val) {
    try { if (typeof GM_setValue === 'function') GM_setValue(key, val); } catch (e) { /* ignore */ }
    try { if (typeof GM !== 'undefined' && GM && typeof GM.setValue === 'function') GM.setValue(key, val); } catch (e) { /* ignore */ }
  }

  function loadSettings() {
    let saved = null;
    const raw = gmGet(SETTINGS_KEY, null);
    if (raw) {
      try { saved = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { saved = null; }
    }
    const s = deepMerge(DEFAULTS, saved);
    if (!saved) {
      // 兼容 0.1.x：只有一个性能档位键
      const legacy = gmGet(LEGACY_PERF_KEY, null);
      if (legacy && PERF_PRESETS[legacy]) s.perf = { ...s.perf, ...PERF_PRESETS[legacy] };
    }
    s.perf.level = detectLevel(s.perf);
    return s;
  }

  function saveSettings(s) {
    s.perf.level = detectLevel(s.perf);
    gmSet(SETTINGS_KEY, JSON.stringify(s));
  }

  const settings = loadSettings();

  // =====================================================================
  // 运行时统计（给设置面板的「本页统计」用）
  // =====================================================================
  const stats = {
    blocked: [], // { cat, url }
    longTasks: 0,
    longTaskMs: 0,
    spriteSymbols: 0,
    spritePruned: 0,
    spriteRestored: 0,
    spriteNodesRemoved: 0,
    prExpanded: 0,
    promoHidden: 0,
    lateScripts: [], // 启动时就已经在 DOM 里的被拦截脚本（解析器插入的，只能尝试摘除）
    captchaExecuted: null, // load 后检查验证码 SDK 是否还是执行了
  };

  try {
    const PO = W.PerformanceObserver || PerformanceObserver;
    const po = new PO((list) => {
      for (const t of list.getEntries()) {
        stats.longTasks++;
        stats.longTaskMs += t.duration;
      }
      debug('longtasks', stats.longTasks + ':' + Math.round(stats.longTaskMs));
    });
    po.observe({ entryTypes: ['longtask'] });
    debug('longtask-observer', 'ok:' + (PO === W.PerformanceObserver ? 'page' : 'sandbox'));
  } catch (e) { debug('longtask-observer', 'err:' + e.message); }

  // =====================================================================
  // 网络层：按类别拦截请求 / 脚本
  // 规则来自对 gitcode.com 各页面的实测（见 README「性能剖析」）。
  // =====================================================================
  const BLOCK_RULES = [
    {
      key: 'blockAiApi',
      label: 'AI 接口',
      patterns: ['copilot-agent.gitcode.com', '/widget/api/v1/token_usage', 'claim_computing_power', '/projects/ai-review/check'],
    },
    {
      key: 'blockMarketing',
      label: '营销/活动',
      patterns: ['campus_welcome_page', '/user/identity/sjtu', '/task/v2/sign_status', 'user_preference_survey', 'target-task-name', '/adList/', '/score-proxy/', 'sjtu_modal'],
    },
    {
      key: 'blockAnalytics',
      label: '埋点统计',
      patterns: ['/api/v1/report', 'hm.baidu.com'],
    },
    {
      key: 'blockUdesk',
      label: '客服 SDK',
      patterns: ['udeskApi.js', 'udesk.cn'],
    },
    {
      key: 'blockCaptcha',
      label: '验证码 SDK',
      patterns: ['/js/tac/', '/js/yunpian/', '/js/yidun/', 'captcha.yunpian.com'],
      // 登录/注册页需要验证码，这些路径不拦
      skipPaths: /^\/(login|register|signup|passport|oauth|sso|auth)/i,
    },
  ];

  const activeRules = BLOCK_RULES.filter((r) => settings.perf[r.key] && !(r.skipPaths && r.skipPaths.test(location.pathname)));
  const blockedUrlSeen = new Set();

  function matchRule(url) {
    url = String(url || '');
    if (!url) return null;
    for (const r of activeRules) {
      if (r.patterns.some((p) => url.includes(p))) return r;
    }
    return null;
  }

  function recordBlock(rule, url) {
    const short = String(url).replace(/^https?:\/\//, '').split('?')[0];
    if (blockedUrlSeen.has(short)) return;
    blockedUrlSeen.add(short);
    stats.blocked.push({ cat: rule.label, url: short });
    log(`拦截[${rule.label}]`, short);
  }

  function installNetworkBlocking() {
    if (!activeRules.length) return;

    // fetch（Nuxt 的 $fetch/ofetch 底层就是 globalThis.fetch，运行时取值，document-start 时替换即可）
    const origFetch = W.fetch;
    if (typeof origFetch === 'function') {
      W.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input && input.url;
        const rule = matchRule(url);
        if (rule) {
          recordBlock(rule, url);
          return W.Promise.reject(new W.TypeError('Failed to fetch (blocked by gitcode-enhance)'));
        }
        return origFetch.apply(this, arguments);
      };
    }

    // XHR
    const XHR = W.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const origOpen = XHR.prototype.open;
      const origSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        const rule = matchRule(url);
        this.__gceBlocked = !!rule;
        if (rule) recordBlock(rule, url);
        return origOpen.apply(this, arguments);
      };
      // 被拦的 XHR 直接不发、也不派发 error：站点用 axios，派 error 会弹「连接出错」提示。
      // 这些请求都是上报/小组件类的 fire-and-forget，让它永远 pending 最安静。
      XHR.prototype.send = function () {
        if (this.__gceBlocked) return;
        return origSend.apply(this, arguments);
      };
    }

    // sendBeacon（埋点常用）
    if (W.navigator && typeof W.navigator.sendBeacon === 'function') {
      const origBeacon = W.navigator.sendBeacon;
      W.navigator.sendBeacon = function (url) {
        const rule = matchRule(url);
        if (rule) { recordBlock(rule, url); return true; }
        return origBeacon.apply(this, arguments);
      };
    }

    // 动态插入的 <script>（udesk 就是 createElement('script') + src 注入的）
    const SP = W.HTMLScriptElement && W.HTMLScriptElement.prototype;
    if (SP) {
      const desc = Object.getOwnPropertyDescriptor(SP, 'src');
      if (desc && desc.set) {
        Object.defineProperty(SP, 'src', {
          configurable: true,
          enumerable: desc.enumerable,
          get: desc.get,
          set(v) {
            const rule = matchRule(v);
            if (rule) {
              recordBlock(rule, v);
              this.type = 'text/plain';
              this.setAttribute('data-gitcode-enhance-blocked', rule.key);
              return;
            }
            return desc.set.call(this, v);
          },
        });
      }
      const origSetAttribute = W.Element.prototype.setAttribute;
      W.Element.prototype.setAttribute = function (name, value) {
        if (String(name).toLowerCase() === 'src' && this instanceof W.HTMLScriptElement) {
          const rule = matchRule(value);
          if (rule) {
            recordBlock(rule, value);
            this.type = 'text/plain';
            return origSetAttribute.call(this, 'data-gitcode-enhance-blocked', rule.key);
          }
        }
        return origSetAttribute.apply(this, arguments);
      };
    }

    // SSR HTML 里写死的 <script src defer>（三个验证码 SDK 就是这么进来的）：
    // 解析器插入的节点走不到上面的 setter，只能靠 MutationObserver 在它执行前改 type + 摘掉。
    try {
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.nodeName !== 'SCRIPT') continue;
            const src = node.getAttribute && node.getAttribute('src');
            const rule = matchRule(src);
            if (!rule) continue;
            recordBlock(rule, src);
            node.type = 'javascript/blocked';
            node.setAttribute('data-gitcode-enhance-blocked', rule.key);
            node.remove();
          }
        }
      });
      mo.observe(document, { childList: true, subtree: true });
    } catch (e) { /* ignore */ }

    // 脚本注入时 <head> 里可能已经有解析器插入的 <script defer>（取决于油猴注入得多早）。
    // 这种已经 prepare 过的脚本，改 type / 移除节点在 Chrome 里未必能阻止执行，只能尽力而为，
    // 然后在 load 后检查它到底有没有执行，如实显示在面板里。
    for (const node of document.querySelectorAll('script[src]')) {
      const src = node.getAttribute('src');
      const rule = matchRule(src);
      if (!rule) continue;
      stats.lateScripts.push({ cat: rule.label, url: src.replace(/^https?:\/\//, '') });
      node.type = 'javascript/blocked';
      node.setAttribute('data-gitcode-enhance-blocked', rule.key);
      node.remove();
    }
    if (stats.lateScripts.length) debug('late-scripts', stats.lateScripts.length);

    if (activeRules.some((r) => r.key === 'blockCaptcha')) {
      W.addEventListener('load', () => {
        stats.captchaExecuted = typeof W.YpRiddler === 'function' || typeof W.initTAC === 'function' || typeof W.initNECaptcha === 'function';
        debug('captcha-executed', stats.captchaExecuted);
      });
    }
  }

  // =====================================================================
  // DOM 层：图标雪碧图裁剪
  // gitcode 用 iconfont 的 symbol 方案：两个 JS（合计 1.5MB）在 DOMContentLoaded 时往 body 开头
  // 塞一个含 1389 个 <symbol> 的 <svg>，共 4172 个 DOM 节点，占仓库页全部节点的 68%，
  // 而一个页面实际用到的图标只有 45～50 个。实测把没用的 symbol 摘掉后，
  // 整页样式重算耗时从 87ms 降到 29ms（仓库页）/ 127ms 降到 63ms（展开 363 条评论的 PR 页）。
  // 摘掉的 symbol 放在内存里，页面之后新出现 <use href="#xxx"> 时同步放回去，不会丢图标。
  // =====================================================================
  function installIconSpritePruner() {
    // gitcode 有两份雪碧图（两个 iconfont 项目：357 个 + 1389 个 symbol），都要处理。
    const stash = new Map(); // symbol id -> { sym, sprite }
    const sprites = new Set();

    const idOf = (use) => {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      return href.startsWith('#') ? href.slice(1) : null;
    };

    function restore(id) {
      if (!id) return;
      const entry = stash.get(id);
      if (!entry) return;
      stash.delete(id);
      entry.sprite.appendChild(entry.sym);
      stats.spriteRestored++;
      stats.spritePruned--;
    }

    function scanUses(root) {
      if (!root || root.nodeType !== 1) return;
      if (root.tagName === 'use') restore(idOf(root));
      const uses = root.getElementsByTagName ? root.getElementsByTagName('use') : [];
      for (let i = 0; i < uses.length; i++) restore(idOf(uses[i]));
    }

    function prune(svg) {
      sprites.add(svg);
      const used = new Set();
      const uses = document.getElementsByTagName('use');
      for (let i = 0; i < uses.length; i++) { const id = idOf(uses[i]); if (id) used.add(id); }
      const symbols = svg.querySelectorAll('symbol');
      let removedNodes = 0, pruned = 0;
      for (const sym of symbols) {
        if (!sym.id || used.has(sym.id)) continue;
        removedNodes += sym.getElementsByTagName('*').length + 1;
        stash.set(sym.id, { sym, sprite: svg });
        sym.remove();
        pruned++;
      }
      stats.spriteSymbols += symbols.length;
      stats.spritePruned += pruned;
      stats.spriteNodesRemoved += removedNodes;
      debug('pruned', `${stats.spriteSymbols}->${stats.spriteSymbols - stats.spritePruned} nodes-${stats.spriteNodesRemoved}`);
      log(`图标雪碧图裁剪：${symbols.length} 个 symbol，暂存 ${pruned} 个未使用的（减少 ${removedNodes} 个 DOM 节点）`);
    }

    const isSprite = (node) => node.nodeType === 1 && node.tagName === 'svg' && !sprites.has(node) && node.querySelectorAll('symbol').length > 50;

    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') { restore(idOf(m.target)); continue; }
        for (const node of m.addedNodes) {
          if (isSprite(node)) prune(node);
          else if (stash.size) scanUses(node);
        }
      }
    });
    mo.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'xlink:href'],
    });

    // 如果雪碧图已经在了（比如脚本注入晚了）
    if (document.body) {
      for (const svg of document.body.querySelectorAll('svg')) if (isSprite(svg)) prune(svg);
    }
  }

  // =====================================================================
  // CSS：去广告 / 隐藏 AI 组件 / GitHub 风格
  // =====================================================================
  function addStyle(css) {
    try { GM_addStyle(css); } catch (e) {
      const el = document.createElement('style'); el.textContent = css; (document.head || document.documentElement).appendChild(el);
    }
  }

  function applyStyles() {
    const rules = [];
    const ab = settings.adblock;
    if (ab.udeskWidget) rules.push('#udesk_container, #udesk_iframe, #udesk_panel { display: none !important; }');
    if (ab.floatTools) rules.push('.gitcode-tools-float-root { display: none !important; }');
    if (ab.promo) rules.push('[class*="sjtu"], .sign-in-entry, .campus-welcome, .user-preference-survey, .dashboard-sidebar__site-shortcuts a[href*="news.gitcode.com"] { display: none !important; }');
    if (rules.length) addStyle(rules.join('\n'));

    if (settings.perf.hideAiUi) {
      // 1. 每个页面底部居中的 fixed AtomCode dock（272x52）
      // 2. 顶栏右侧的 AtomCode 启动按钮
      // 3. 工作台侧栏里的 AtomCode 入口 + 「AI 开发与资源」分组（Notebook / API 密钥 / 资源用量）
      // /dashboard 本身的 AI 聊天页不用 CSS 藏（藏了只剩侧栏），而是由 dashboard.home 直接跳到工作台的真实页面。
      addStyle(`
        .atomcode-dock-container,
        .atomcode-dock-center-wrapper,
        .repo-layout__dock-wrapper,
        .atomcode-launcher,
        .dashboard-sidebar__feed a[href="/dashboard/atomcode"],
        .dashboard-sidebar__group:has(a[href="/dashboard/api-key"]) { display: none !important; }
      `);
    }

    if (settings.theme.github) {
      // 参照 GitHub Primer：纯色背景 + 6px 圆角 + 系统字体栈，不用 blur/阴影堆叠、不加细边框。
      addStyle(`
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
            "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif !important;
        }
        .g-header, .repo-header-inner { background: #ffffff !important; box-shadow: none !important; }
        .repo-markdown-card, .set-skeleton, .comment-box {
          background: #ffffff !important; border-radius: 6px !important; box-shadow: none !important;
        }
      `);
    }
  }

  // =====================================================================
  // 去干扰：需要靠 JS 找的元素（没有稳定 class）
  // =====================================================================
  function hideAiTranslationNotice() {
    const link = Array.from(document.querySelectorAll('a')).find((a) => a.textContent.includes('提交 issue 反馈'));
    if (!link) return false;
    const bar = link.closest('.repo-markdown-card-header') ? link.parentElement.parentElement : null;
    if (bar && bar.style.display !== 'none') {
      bar.style.display = 'none';
      log('已隐藏 AI 翻译提示条');
    }
    return true;
  }

  function hidePromoImages() {
    // 活动位图片来自 cdn-static.gitcode.com/adList/*，把它所在的链接/轮播项藏掉
    let n = 0;
    for (const img of document.querySelectorAll('img[src*="/adList/"]')) {
      const box = img.closest('a, li, .swiper-slide, [class*="banner"], [class*="carousel"]') || img;
      if (box.style.display !== 'none') { box.style.display = 'none'; n++; }
    }
    if (n) { stats.promoHidden += n; log(`已隐藏 ${n} 个活动广告位`); }
    return n;
  }

  // README 是异步加载出来的，切换仓库/路由后要重新轮询等它出现
  function declutter() {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      let done = true;
      if (settings.adblock.aiTranslateNotice && !hideAiTranslationNotice()) done = false;
      if (settings.adblock.promo) hidePromoImages();
      if (done || tries > 20) clearInterval(timer);
    }, 500);
  }

  // =====================================================================
  // 功能：PR 讨论区自动展开所有折叠的消息
  // 折叠块 ".collapse-btn"（“此处折叠了 363 条消息 查看更多”），点开后里面可能还嵌套新的折叠块，
  // 所以反复点，直到连续几轮都找不到为止。Vue 的 click 绑在内层 .collapse-btn__more 上。
  // =====================================================================
  function autoExpandPRComments() {
    const COLLAPSE_SELECTOR = '.collapse-btn__more';
    const CLICK_DELAY_MS = 500;
    const MAX_IDLE_ROUNDS = 6; // 连续 3s 没有新折叠块才算完（后台标签页里渲染会被节流，放宽一点）
    const MAX_TICKS = 300;
    let idleRounds = 0, ticks = 0, expanded = 0;

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
      if (ticks < MAX_TICKS && idleRounds < MAX_IDLE_ROUNDS) setTimeout(tick, CLICK_DELAY_MS);
      else {
        stats.prExpanded += expanded;
        log(`PR 评论自动展开完成，共点开 ${expanded} 处折叠块`);
      }
    }

    log('开始自动展开 PR 折叠评论…');
    setTimeout(tick, 800);
  }

  // =====================================================================
  // 设置面板（Shadow DOM，样式与页面隔离）
  // =====================================================================
  const PERF_TOGGLE_META = {
    hideAiUi: { group: 'dom', label: '隐藏 AI 组件', desc: '每页底部悬浮的 AtomCode dock、顶栏 AtomCode 按钮、工作台侧栏的 AtomCode 入口和「AI 开发与资源」分组。仅 CSS，零风险。' },
    pruneIconSprite: { group: 'dom', label: '裁剪图标雪碧图', desc: '页面会注入 1389 个 <symbol>（4172 个节点），实际只用 ~50 个。摘掉未用的、按需放回：整页样式重算 -50%，DOM 节点 -4000。' },
    blockAiApi: { group: 'net', label: '拦截 AI 接口', desc: 'copilot-agent 会话/模型列表、token 用量、算力领取、AI review 检查。开启后 AI Agent 打不开。' },
    blockMarketing: { group: 'net', label: '拦截营销/活动请求', desc: '校园活动弹窗（含 2 张大图）、每日签到、用户调研、活动广告位、热搜词、积分商城，每页约 10 个请求。' },
    blockAnalytics: { group: 'net', label: '拦截埋点统计', desc: 'api/v1/report 行为上报（pageview 等）。' },
    blockUdesk: { group: 'net', label: '拦截客服 SDK', desc: 'udeskApi.js（133KB）+ 3 个 JSONP + 一个 iframe 里永不停止的 socket.io 长轮询。单纯 CSS 隐藏挡不住轮询。开启后「在线客服」不可用。' },
    blockCaptcha: { group: 'net', label: '拦截验证码 SDK', desc: '每个页面都会 defer 加载 3 个验证码 SDK（约 190KB），只有登录/注册用得到。登录相关路径自动放行。' },
  };

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .backdrop { position: fixed; inset: 0; background: rgba(27,31,36,.5); z-index: 2147483000; display: flex; align-items: flex-start; justify-content: center; padding: 48px 16px; overflow: auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif; font-size: 14px; color: #1f2328; line-height: 1.5; }
    .panel { background: #fff; border: 1px solid #d1d9e0; border-radius: 12px; width: 100%; max-width: 640px; box-shadow: 0 8px 24px rgba(140,149,159,.2); }
    .hd { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid #d1d9e0; }
    .hd h1 { font-size: 16px; font-weight: 600; margin: 0; }
    .hd .ver { color: #59636e; font-weight: 400; font-size: 12px; margin-left: 8px; }
    .close { background: none; border: 0; font-size: 20px; line-height: 1; color: #59636e; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
    .close:hover { background: #f6f8fa; color: #1f2328; }
    .body { padding: 4px 20px 8px; max-height: calc(100vh - 220px); overflow: auto; }
    h2 { font-size: 12px; font-weight: 600; color: #59636e; text-transform: uppercase; letter-spacing: .04em; margin: 18px 0 6px; }
    .row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eef1f4; }
    .row:last-child { border-bottom: 0; }
    .row .t { font-weight: 500; }
    .row .d { color: #59636e; font-size: 12px; margin-top: 2px; }
    .sel { flex: none; font: inherit; font-size: 13px; padding: 4px 8px; border: 1px solid #d1d9e0; border-radius: 6px; background: #f6f8fa; color: #1f2328; max-width: 220px; }
    .sw { flex: none; position: relative; width: 36px; height: 20px; margin-top: 2px; }
    .sw input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; z-index: 1; }
    .sw i { position: absolute; inset: 0; background: #d1d9e0; border-radius: 10px; transition: background .15s; }
    .sw i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: transform .15s; }
    .sw input:checked + i { background: #1f883d; }
    .sw input:checked + i::after { transform: translateX(16px); }
    .seg { display: inline-flex; border: 1px solid #d1d9e0; border-radius: 6px; overflow: hidden; margin: 4px 0 8px; }
    .seg button { background: #f6f8fa; border: 0; border-right: 1px solid #d1d9e0; padding: 5px 14px; font: inherit; font-size: 13px; cursor: pointer; color: #1f2328; }
    .seg button:last-child { border-right: 0; }
    .seg button.on { background: #0969da; color: #fff; }
    .seg button:disabled { cursor: default; }
    .sub { font-size: 12px; color: #59636e; margin: 8px 0 2px; font-weight: 600; }
    .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 4px; }
    .stat { background: #f6f8fa; border-radius: 6px; padding: 8px 10px; }
    .stat b { display: block; font-size: 18px; font-weight: 600; }
    .stat span { font-size: 12px; color: #59636e; }
    .list { font-size: 12px; color: #59636e; margin-top: 6px; max-height: 120px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .list div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ft { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-top: 1px solid #d1d9e0; background: #f6f8fa; border-radius: 0 0 12px 12px; }
    .ft .note { font-size: 12px; color: #59636e; }
    .btn { font: inherit; font-size: 13px; font-weight: 500; padding: 5px 14px; border-radius: 6px; border: 1px solid #d1d9e0; background: #f6f8fa; color: #1f2328; cursor: pointer; }
    .btn:hover { background: #eef1f4; }
    .btn.primary { background: #1f883d; border-color: #1f883d; color: #fff; }
    .btn.primary:hover { background: #1a7f37; }
    .btn.danger { color: #d1242f; }
    .btns { display: flex; gap: 8px; }
    @media (max-width: 640px) { .stats { grid-template-columns: 1fr; } .ft { flex-direction: column; align-items: stretch; } }
  `;

  let panelHost = null;

  function openPanel() {
    if (panelHost) { closePanel(); return; }
    const draft = JSON.parse(JSON.stringify(settings));
    panelHost = document.createElement('div');
    panelHost.id = 'gitcode-enhance-panel-host';
    const root = panelHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'backdrop';
    root.appendChild(wrap);

    function h(tag, attrs, ...children) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
      for (const c of children) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      return el;
    }

    function toggleRow(label, desc, get, set) {
      const input = h('input', { type: 'checkbox' });
      input.checked = !!get();
      input.addEventListener('change', () => { set(input.checked); render(); });
      return h('div', { class: 'row' },
        h('div', {}, h('div', { class: 't', text: label }), desc ? h('div', { class: 'd', text: desc }) : null),
        h('label', { class: 'sw' }, input, h('i')));
    }

    function selectRow(label, desc, options, get, set) {
      const sel = h('select', { class: 'sel' });
      for (const [v, text] of options) {
        const o = h('option', { value: v, text });
        if (v === get()) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { set(sel.value); render(); });
      return h('div', { class: 'row' },
        h('div', {}, h('div', { class: 't', text: label }), desc ? h('div', { class: 'd', text: desc }) : null),
        sel);
    }

    let bodyEl = null;
    let panel = null;

    function render() {
      const level = detectLevel(draft.perf);
      const body = h('div', { class: 'body' });

      body.appendChild(h('h2', { text: '去广告 / 去干扰' }));
      body.appendChild(toggleRow('隐藏客服悬浮窗', '右下角 udesk 客服聊天入口（仅隐藏；要连轮询一起停掉见下方「拦截客服 SDK」）', () => draft.adblock.udeskWidget, (v) => (draft.adblock.udeskWidget = v)));
      body.appendChild(toggleRow('隐藏右侧悬浮工具条', '反馈 / 帮助图标条', () => draft.adblock.floatTools, (v) => (draft.adblock.floatTools = v)));
      body.appendChild(toggleRow('隐藏 AI 翻译提示条', 'README 顶部「以下内容由 AI 翻译…」', () => draft.adblock.aiTranslateNotice, (v) => (draft.adblock.aiTranslateNotice = v)));
      body.appendChild(toggleRow('隐藏活动 / 营销位', '活动广告轮播、校园活动弹窗、签到入口', () => draft.adblock.promo, (v) => (draft.adblock.promo = v)));

      body.appendChild(h('h2', { text: '美化' }));
      body.appendChild(toggleRow('GitHub 风格', '白底、6px 圆角、系统字体栈，不用阴影 / 毛玻璃', () => draft.theme.github, (v) => (draft.theme.github = v)));

      body.appendChild(h('h2', { text: '功能增强' }));
      body.appendChild(toggleRow('PR 评论自动展开', '打开 PR 页后自动点开所有「此处折叠了 N 条消息」', () => draft.pr.autoExpand, (v) => (draft.pr.autoExpand = v)));
      body.appendChild(toggleRow('顶栏显示设置按钮', '页面右上角的齿轮图标，点开这个面板（也可以按 Alt+G，或用 Tampermonkey 菜单）', () => draft.ui.headerButton, (v) => (draft.ui.headerButton = v)));
      body.appendChild(selectRow('工作台首页', '打开 gitcode.com / 点「工作台」会落到 /dashboard 的 AI 聊天页，这里改成直接跳到工作台的某个页面', DASHBOARD_HOMES, () => draft.dashboard.home, (v) => (draft.dashboard.home = v)));

      body.appendChild(h('h2', { text: '性能优化' }));
      const seg = h('div', { class: 'seg' });
      for (const [name, label] of [['off', '关闭'], ['light', '轻量级'], ['aggressive', '极致级'], ['custom', '自定义']]) {
        const b = h('button', { class: name === level ? 'on' : '', text: label, type: 'button' });
        if (name === 'custom') b.disabled = true;
        else b.addEventListener('click', () => { Object.assign(draft.perf, PERF_PRESETS[name]); render(); });
        seg.appendChild(b);
      }
      body.appendChild(seg);
      body.appendChild(h('div', { class: 'd', text: '轻量级 = 只做 DOM/CSS 层处理，不碰网络；极致级 = 再加上网络层拦截。单独改任一项即为自定义。' }));
      body.appendChild(h('div', { class: 'sub', text: 'DOM / CSS 层' }));
      for (const k of PERF_TOGGLES.filter((k) => PERF_TOGGLE_META[k].group === 'dom')) {
        const m = PERF_TOGGLE_META[k];
        body.appendChild(toggleRow(m.label, m.desc, () => draft.perf[k], (v) => (draft.perf[k] = v)));
      }
      body.appendChild(h('div', { class: 'sub', text: '网络层（需刷新生效）' }));
      for (const k of PERF_TOGGLES.filter((k) => PERF_TOGGLE_META[k].group === 'net')) {
        const m = PERF_TOGGLE_META[k];
        body.appendChild(toggleRow(m.label, m.desc, () => draft.perf[k], (v) => (draft.perf[k] = v)));
      }

      body.appendChild(h('h2', { text: '本页统计（当前设置下实际生效的效果）' }));
      const byCat = {};
      for (const b of stats.blocked) byCat[b.cat] = (byCat[b.cat] || 0) + 1;
      const catText = Object.entries(byCat).map(([c, n]) => `${c} ${n}`).join(' · ') || '无';
      const grid = h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', { text: String(stats.blocked.length) }), h('span', { text: '拦截的请求 / 脚本：' + catText })),
        h('div', { class: 'stat' }, h('b', { text: stats.spriteNodesRemoved ? `-${stats.spriteNodesRemoved}` : '0' }), h('span', { text: stats.spriteSymbols ? `DOM 节点（雪碧图 ${stats.spriteSymbols} 个 symbol，暂存 ${stats.spritePruned}，按需放回 ${stats.spriteRestored}）` : 'DOM 节点（雪碧图未处理）' })),
        h('div', { class: 'stat' }, h('b', { text: `${Math.round(stats.longTaskMs)}ms` }), h('span', { text: `主线程长任务 ${stats.longTasks} 个（>50ms，含页面自身加载）` })),
        h('div', { class: 'stat' }, h('b', { text: String(stats.prExpanded) }), h('span', { text: 'PR 折叠块已自动点开' })));
      body.appendChild(grid);
      if (stats.blocked.length || stats.lateScripts.length) {
        const list = h('div', { class: 'list' });
        for (const b of stats.blocked) list.appendChild(h('div', { text: `[${b.cat}] ${b.url}` }));
        for (const b of stats.lateScripts) {
          const ok = b.cat === '验证码 SDK' ? (stats.captchaExecuted === null ? '未知' : stats.captchaExecuted ? '未拦住' : '已拦住') : '已尝试摘除';
          list.appendChild(h('div', { text: `[${b.cat}] ${b.url} —— 注入时已在 <head> 里，${ok}` }));
        }
        body.appendChild(list);
      }
      if (stats.captchaExecuted === true) {
        body.appendChild(h('div', { class: 'd', text: '验证码 SDK 是 SSR HTML 里的 <script defer>，本页油猴注入得比 <head> 解析晚，没能阻止它执行。装 GreasyFork/GitHub 的正式版（非 file:// 开发加载器）通常注入更早。' }));
      }

      if (bodyEl) bodyEl.replaceWith(body);
      else panel.insertBefore(body, panel.lastChild);
      bodyEl = body;
    }

    panel = h('div', { class: 'panel' },
      h('div', { class: 'hd' },
        h('h1', {}, 'GitCode Enhance 设置', h('span', { class: 'ver', text: 'v' + VERSION })),
        h('button', { class: 'close', text: '×', title: '关闭 (Esc)', type: 'button', onclick: closePanel })),
      h('div', { class: 'ft' },
        h('div', { class: 'note', text: '保存后会刷新当前页面以应用设置。' }),
        h('div', { class: 'btns' },
          h('button', { class: 'btn danger', text: '恢复默认', type: 'button', onclick: () => { Object.assign(draft, JSON.parse(JSON.stringify(DEFAULTS))); render(); } }),
          h('button', { class: 'btn', text: '取消', type: 'button', onclick: closePanel }),
          h('button', { class: 'btn primary', text: '保存并刷新', type: 'button', onclick: () => { saveSettings(draft); setTimeout(() => location.reload(), 300); } }))));
    wrap.appendChild(panel);
    render();

    wrap.addEventListener('click', (e) => { if (e.target === wrap) closePanel(); });
    (document.body || document.documentElement).appendChild(panelHost);
  }

  function closePanel() {
    if (panelHost) { panelHost.remove(); panelHost = null; }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelHost) closePanel();
    // Alt+G 打开/关闭设置面板
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); openPanel(); }
  }, true);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙️ 打开设置面板 (Alt+G)', openPanel);
  }

  // 页面内入口：顶栏右侧塞一个齿轮按钮（Tampermonkey 菜单项需要 GM_registerMenuCommand 授权，
  // 旧版加载器没有这个 grant 就看不到菜单，所以页面里也放一个）。
  function installHeaderButton() {
    if (!settings.ui.headerButton) return;
    const ID = 'gitcode-enhance-header-btn';
    addStyle(`
      #${ID} { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; margin-right: 8px;
        border: 0; border-radius: 6px; background: transparent; color: #59636e; cursor: pointer; }
      #${ID}:hover { background: #f6f8fa; color: #1f2328; }
      #${ID} svg { width: 18px; height: 18px; }
    `);
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (document.getElementById(ID)) { clearInterval(timer); return; }
      const bar = document.querySelector('.g-toolbar-right');
      if (!bar) { if (tries > 40) clearInterval(timer); return; }
      const btn = document.createElement('button');
      btn.id = ID;
      btn.type = 'button';
      btn.title = 'GitCode Enhance 设置 (Alt+G)';
      btn.setAttribute('aria-label', 'GitCode Enhance 设置');
      btn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.04.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"></path></svg>';
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPanel(); });
      bar.insertBefore(btn, bar.firstChild);
      clearInterval(timer);
    }, 300);
  }
  installHeaderButton();

  // =====================================================================
  // 启动
  // =====================================================================
  {
    const target = dashboardRedirectTarget(location.pathname);
    if (target) {
      log('工作台首页跳转 →', target);
      location.replace(target + location.search + location.hash);
      return;
    }
  }

  installNetworkBlocking();
  if (settings.perf.pruneIconSprite) installIconSpritePruner();
  applyStyles();
  log(`v${VERSION} 已启动，性能档位：${settings.perf.level}`, JSON.stringify(settings));
  debug('started', document.readyState + ' level=' + settings.perf.level + ' prune=' + settings.perf.pruneIconSprite + ' unsafeWindow=' + (typeof unsafeWindow !== 'undefined'));

  // SPA 路由处理：gitcode 是客户端路由，切换 PR 不会整页刷新
  let lastPath = '';
  function onRouteChange() {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    const target = dashboardRedirectTarget(path);
    if (target) { location.replace(target); return; }
    declutter();
    if (settings.pr.autoExpand && PR_PAGE_RE.test(path)) autoExpandPRComments();
  }
  onRouteChange();
  setInterval(onRouteChange, 1000);
})();
