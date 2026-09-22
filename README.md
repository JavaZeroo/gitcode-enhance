# GitCode Enhance

非官方的 [gitcode.com](https://gitcode.com)（AtomGit）增强油猴脚本：去广告、GitHub 风格美化、基于实测的分级性能优化、PR 评论自动展开，自带可视化设置面板。

## 安装

- GreasyFork: https://greasyfork.org/zh-CN/scripts/596921-gitcode-atomgit-增强
- 或直接安装 GitHub 上的最新版本：[gitcode-enhance.user.js](https://raw.githubusercontent.com/JavaZeroo/gitcode-enhance/main/gitcode-enhance.user.js)（需要先装 [Tampermonkey](https://www.tampermonkey.net/)）

## 功能

所有功能都可以在设置面板里单独开关：Tampermonkey 图标 → 脚本菜单「⚙️ 打开设置面板」，或在 gitcode.com 页面按 `Alt+G`。面板底部还有「本页统计」，显示当前设置在这个页面上实际拦截了哪些请求、裁掉了多少 DOM 节点、主线程长任务总时长。

### 去广告 / 去干扰
- 隐藏右下角客服悬浮聊天窗
- 隐藏右侧悬浮的反馈/帮助图标条
- 隐藏 README 顶部「以下内容由 AI 翻译…」提示条
- 隐藏活动广告位（`adList` 轮播图）、校园活动弹窗、签到入口

### GitHub 风格美化
参照 GitHub Primer 设计规范做了轻度换肤：白底、6px 圆角、系统字体栈，不用阴影/毛玻璃堆叠。

（之前试过苹果 Liquid Glass 风格的 `backdrop-filter` 毛玻璃效果，在评论多的 PR 页面上实测很卡，放弃了。）

### 性能优化（分级）

档位只是预设，每一项都能单独开关；改了任意一项就变成「自定义」。

| 项目 | 层 | 轻量级（默认） | 极致级 |
|---|---|:-:|:-:|
| 隐藏 AI 组件（`/dashboard` 沉浸式 Agent 面板、每页底部悬浮的 AtomCode dock） | CSS | ✓ | ✓ |
| 裁剪图标雪碧图（见下文） | DOM | ✓ | ✓ |
| 拦截 AI 接口（copilot-agent 会话/模型、token 用量、算力领取、AI review） | 网络 | | ✓ |
| 拦截营销/活动请求（校园活动弹窗 + 2 张大图、签到、调研、广告位、热搜词、积分商城） | 网络 | | ✓ |
| 拦截埋点上报（`api/v1/report`） | 网络 | | ✓ |
| 拦截客服 SDK（udeskApi.js + JSONP + iframe 内 socket.io 长轮询） | 网络 | | ✓ |
| 拦截验证码 SDK（每页 defer 加载的 3 个 SDK，登录/注册路径自动放行） | 网络 | | ✓ |

轻量级只动 DOM/CSS，不碰任何请求，零风险；极致级会让 AI Agent、在线客服打不开，自己权衡。

### PR 评论自动展开
PR 讨论区里被折叠的历史消息（"此处折叠了 N 条消息 查看更多"）会在打开页面后自动全部展开，不用手动一个个点。

## 性能剖析（为什么这么分档）

用 Chrome 对 `/dashboard`、仓库首页、一个有 363 条讨论的 PR 页做了实测（脚本完全关闭作为基线），结论：

- **图标雪碧图是最大的 DOM 开销。** 站点用 iconfont 的 symbol 方案，两个 JS（原始 1.5MB，gzip 408KB）在 DOMContentLoaded 时往 `<body>` 开头塞 1746 个 `<symbol>`，约 5200 个 DOM 节点，占仓库页全部节点的 68%、展开后 PR 页的 44%；而一个页面实际用到的图标只有 45～50 个。把没用的 symbol 摘掉（放在内存里，页面之后出现新的 `<use href="#xxx">` 时同步放回）：
  - 仓库页：6160 → 1987 个节点，整页样式重算 87ms → 29ms
  - 展开 363 条评论的 PR 页：9534 → 5361 个节点，127ms → 63ms
  - 局部 class 切换（hover 之类）不受影响，收益在整页级别的样式失效（主题/布局切换、窗口 resize）和内存
- **客服 SDK 一直在后台轮询。** `udeskApi.js`（133KB）+ 3 个到 udesk.cn 的 JSONP + 一个 iframe，iframe 里 socket.io 用 polling 模式一直打 `basevistor.s2.udesk.cn`。这是主框架空闲时唯一的持续网络活动；只用 CSS 藏掉入口挡不住它，必须拦脚本本身。
- **每个页面都会加载 3 个验证码 SDK**（yunpian riddler 170KB、yidun、tac），以 `<script defer>` 写在 SSR HTML 里，但只有登录/注册才用得到。
- **每页约 10 个营销/活动/统计请求**：校园活动弹窗配置 + 身份校验 + 2 张背景大图、每日签到状态、用户调研、目标任务、`adList/active.json` 广告位配置、热搜词、积分商城白名单、`api/v1/report` 埋点。
- **AI 相关**：`/dashboard` 默认是沉浸式 AI Agent（288KB 独立 chunk + 3 个 copilot-agent 接口），每个页面底部还有一个 fixed 的 AtomCode dock；另有 token 用量、算力领取、AI review 检查等接口。
- **没有可以“CSS 优化”的东西**：全站没有 `backdrop-filter`，没有无限循环动画，主框架空闲 50 秒零 DOM 变更、零请求。所以本脚本不做任何“关动画/关特效”之类的假优化。
- PR 页展开折叠评论是纯前端的（数据已在内存里），不会产生新请求；105 个评论框展开后堆内存约 127MB。

另外 0.1.x 的「极致级」其实没有生效：Tampermonkey 在有 `@grant` 时会把 `window` 换成沙箱代理，`window.fetch = ...` 只改到沙箱副本。0.2.0 起改为打到 `unsafeWindow` 上，并补上了 XHR、`sendBeacon`、动态 `<script>` 和 SSR 内联 `<script>` 的拦截。

## 已知限制 / 免责声明

这些功能大多是靠匹配 gitcode.com 当前版本的 DOM class / 接口 URL 实现的，不是官方 API，gitcode 改版后可能会失效，欢迎提 [Issue](https://github.com/JavaZeroo/gitcode-enhance/issues)。

## 本地开发

```
gitcode-enhance/
  src/gitcode-enhance.js   # 脚本逻辑的唯一来源
  scripts/build.mjs        # 拼接 metadata + src，生成 gitcode-enhance.user.js
  dev/loader.user.js       # 仅本机开发用，通过 @require file:// 热加载 src，改完刷新页面即可生效
  gitcode-enhance.user.js  # 发布用的单文件版本（由 build 生成，需要提交）
```

开发时：
1. Tampermonkey 里装 `dev/loader.user.js`（需要在扩展设置里开启「允许访问文件网址」）
2. 改 `src/gitcode-enhance.js`，保存后刷新 gitcode.com 页面看效果
3. 发布前跑 `npm run build` 生成最终的 `gitcode-enhance.user.js`

## License

MIT
