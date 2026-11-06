# 早期页面观察

以下为早期页面的历史观察，用于解释实现选择，不代表当前所有页面；站点代码、请求和浏览器环境会变化。

用 Chrome 对 `/dashboard`、仓库首页、一个有 363 条讨论的 PR 页做了实测（脚本完全关闭作为基线），结论：

- **图标雪碧图是最大的 DOM 开销。** 站点用 iconfont 的 symbol 方案，两个 JS（原始 1.5MB，gzip 408KB）在 DOMContentLoaded 时往 `<body>` 开头塞 1746 个 `<symbol>`，约 5200 个 DOM 节点，占仓库页全部节点的 68%、展开后 PR 页的 44%；而一个页面实际用到的图标只有 45～50 个。把没用的 symbol 摘掉（放在内存里，页面之后出现新的 `<use href="#xxx">` 时同步放回）：
  - 仓库页：6160 → 1987 个节点，整页样式重算 87ms → 29ms
  - 展开 363 条评论的 PR 页：9534 → 5361 个节点，127ms → 63ms
  - 当时主要收益是减少参与样式计算的活跃 DOM，节点仍保存在 Map 中。v0.3.4 已改为存储 SVG 文本，恢复时重建节点；新的内存证据见[内存优化验证](2026-11-03-memory.md)，不能用这些历史 DOM 数字换算内存收益。
- **客服 SDK 一直在后台轮询。** `udeskApi.js`（133KB）+ 3 个到 udesk.cn 的 JSONP + 一个 iframe，iframe 里 socket.io 用 polling 模式一直打 `basevistor.s2.udesk.cn`。这是主框架空闲时唯一的持续网络活动；只用 CSS 藏掉入口挡不住它，必须拦脚本本身。
- **当时采样页面加载了 3 个验证码 SDK**（yunpian riddler 170KB、yidun、tac），以 `<script defer>` 写在 SSR HTML 里，登录/注册依赖这些 SDK，其他风控流程的需求未完整验证。
- **每页约 10 个营销/活动/统计请求**：校园活动弹窗配置 + 身份校验 + 2 张背景大图、每日签到状态、用户调研、目标任务、`adList/active.json` 广告位配置、热搜词、积分商城白名单、`api/v1/report` 埋点。
- **AI 相关**：`/dashboard` 默认是沉浸式 AI Agent（288KB 独立 chunk + 3 个 copilot-agent 接口），每个页面底部还有一个 fixed 的 AtomCode dock；另有 token 用量、算力领取、AI review 检查等接口。
- **当时的 CSS 检查**：采样页面没有 `backdrop-filter`，没有无限循环动画，主框架空闲 50 秒零 DOM 变更、零请求。不能据此推断其他页面和交互没有渲染开销。
- 当时的 PR 样本展开了内存中已有评论，未观察到新请求；105 个评论框展开后堆内存约 127MB。该历史结果不能推广到当前站点的所有分页、状态和讨论加载流程。

另外 0.1.x 的「极致级」其实没有生效：Tampermonkey 在有 `@grant` 时会把 `window` 换成沙箱代理，`window.fetch = ...` 只改到沙箱副本。0.2.0 起改为打到 `unsafeWindow` 上，当时还加入了 XHR、`sendBeacon`、动态脚本和 SSR 脚本拦截；当前版本已撤销 XHR 拦截，SSR 脚本仅尽力阻止，详见 README 的[已知限制](../../README.md#已知限制)。
