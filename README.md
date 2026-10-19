# GitCode Enhance

非官方的 [gitcode.com](https://gitcode.com)（AtomGit）增强油猴脚本：去广告、GitHub 风格美化、基于实测的分级性能优化、PR 评论自动展开，自带可视化设置面板。

## 安装

- GreasyFork: https://greasyfork.org/zh-CN/scripts/596921-gitcode-atomgit-增强
- 或直接安装 GitHub 上的最新版本：[gitcode-enhance.user.js](https://raw.githubusercontent.com/JavaZeroo/gitcode-enhance/main/gitcode-enhance.user.js)（需要先装 [Tampermonkey](https://www.tampermonkey.net/)）

## 功能

所有功能都可以在设置面板里单独开关：点页面右侧中部的「⚙ 设置」悬浮按钮、顶栏搜索框右侧的齿轮图标，或按 `Alt+G`，或 Tampermonkey 图标 → 脚本菜单「⚙️ 打开设置面板」。设置按钮、评审工具栏和 PR 查找栏的位置可以分别选择左/右上、居中、左/右下，保存后刷新生效。面板底部还有「本页统计」，显示当前设置在这个页面上实际拦截了哪些请求、裁掉了多少 DOM 节点、主线程长任务总时长。

### 去广告 / 去干扰
- 隐藏右下角客服悬浮聊天窗
- 隐藏右侧悬浮的反馈/帮助图标条
- 隐藏 README 顶部「以下内容由 AI 翻译…」提示条
- 隐藏活动广告位（`adList` 轮播图）、校园活动弹窗、签到入口

### GitHub 风格美化
参照 GitHub Primer 设计规范做了轻度换肤：保留站点原生背景和评论布局，仅调整系统字体、README 圆角与阴影。不会为 PR 动态外层添加背景。设置面板跟随站点主题。

（之前试过苹果 Liquid Glass 风格的 `backdrop-filter` 毛玻璃效果，在评论多的 PR 页面上实测很卡，放弃了。）

### 性能优化（分级）

档位只是预设，每一项都能单独开关；改了任意一项就变成「自定义」。

| 项目 | 层 | 轻量级（默认） | 极致级 |
|---|---|:-:|:-:|
| 隐藏 AI 组件（每页底部悬浮的 AtomCode dock、顶栏 AtomCode 按钮、工作台侧栏的 AI 入口） | CSS | ✓ | ✓ |
| 裁剪图标雪碧图（见下文） | DOM | ✓ | ✓ |
| 拦截 AI 接口（copilot-agent 会话/模型、token 用量、算力领取、AI review） | 网络 | | ✓ |
| 拦截营销/活动请求（校园活动弹窗 + 2 张大图、签到、调研、广告位、热搜词、积分商城） | 网络 | | ✓ |
| 拦截埋点上报（`api/v1/report`） | 网络 | | ✓ |
| 拦截客服 SDK（udeskApi.js + JSONP + iframe 内 socket.io 长轮询） | 网络 | | ✓ |
| 拦截验证码 SDK（每页 defer 加载的 3 个 SDK，登录/注册路径自动放行） | 网络 | | ✓ |

轻量级只动 DOM/CSS，不碰任何请求；极致级会让 AI Agent、在线客服打不开。v0.2.4 保留原生 XHR：站点不统一识别主动取消，拒绝 XHR 会弹出“连接出错”。因此仅对 fetch、sendBeacon 和脚本实施拦截，XHR 请求正常发送；不会留下永久等待或伪造成功响应。这会减少部分网络拦截收益，面板只统计实际拦截项。

验证码 SDK 拦截是尽力而为：解析器已经开始加载的脚本不一定能被阻止，具体看面板的执行检测。登录相关路径会按当前路由放行，但已被阻止加载的 SDK 不会自动补载；若登录流程需要它，请关闭此项并刷新。

### PR 评论自动展开
PR 讨论区里被折叠的历史消息（"此处折叠了 N 条消息 查看更多"）会在打开页面后自动展开，不用手动一个个点。支持 `/pull/:id`、`/pull/:id/discuss` 及 `merge_requests` 对应路径；延迟加载的评论也会处理，离开页面后停止。每次进入页面最多尝试 300 次点击。

本页统计中的拦截项按 URL 去重；DOM 数字为裁剪后扣除已恢复图标的净减少量。长任务时长包含页面自身工作，不代表节省的时间。

### PR 文件评审工具

文件改动页增加可收起的独立悬浮工具栏：显示正在阅读的文件，未搜索时导航自动跟随滚动位置，支持复制当前文件路径；按文件路径筛选跳转列表、选择文件跳转、上一/下一文件。搜索不会隐藏差异内容，也不会修改站点的已读状态。专注模式默认关闭，点击后收起 PR 大标题和来源分支信息，保留文件树、评审标签和代码操作；离开文件改动页后恢复。可在设置面板关闭整个工具栏。

### PR 差异内容搜索

在文件改动页按 Ctrl+F，或点击「查找差异 Ctrl+F」。优先复用当前页面的 diff 数据并缓存索引；页面数据不匹配当前提交或使用自定义比较时才重新读取当前地址。不依赖虚拟列表当前渲染了哪些代码。连续输入延迟 100ms 合并，每批扫描最多 1000 行，过期查询会取消。

- 按字面文本搜索，默认忽略大小写；可选择区分大小写、仅新增/删除行。
- 显示文件路径、新/旧行号、匹配片段；点击结果先定位文件，等待代码渲染后跳转到行。
- 首屏最多显示 100 条匹配行，可继续加载；统计覆盖全部已索引行。
- 显示文件覆盖数量和提交 SHA。二进制、超大文件或服务器省略的 diff 会明确提示，不能把缺失部分当作已搜索。
- 搜索范围是 diff 的新增、删除、上下文行，不是仓库所有文件或文件未改动的全文。文件改动页 Ctrl+F 打开查找栏；Enter / Shift+Enter 切换匹配行，Esc 关闭。其他页面保留浏览器查找。
- PR 提交改变时拒绝跳转到不同版本的行；刷新页面后重新搜索。折叠文件或无法渲染的行会提示手动展开。

### 工作台首页
打开 gitcode.com（或点顶栏「工作台」）会落到 `/dashboard`，这个页面本身就是 AI Agent 聊天界面。脚本默认把它直接跳到 `/dashboard/latest-activity`（最新动态），左侧是正常的工作台侧栏、右侧是内容区；面板里可以改成 Pull Requests / Issue / 讨论 / 看板，或者选「不跳转」保留原样。

配合「隐藏 AI 组件」，侧栏里的 AtomCode 入口和「AI 开发与资源」分组（Notebook / API 密钥 / 资源用量）、顶栏的 AtomCode 按钮也会一起藏掉。

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

运行 `npm test` 检查路由匹配、延迟评论、任务取消、请求拦截和图标恢复统计。修改文件后，应在浏览器设置面板确认版本为 `0.3.0`；已经安装的正式版不会因本地文件变化而自动更新。

## License

MIT


### 0.3.0：评审定位与运行时负担

- Ctrl+F 跳转后，真实代码中的关键词用 CSS Highlight 标黄，目标行加底色和边框；左右对比只高亮匹配侧文字，不改写 Vue 管理的代码节点。
- 查找窗遮住目标文字时自动调整滚动位置；修改关键词、关闭查找或切换页面会清除旧高亮。
- 悬浮设置入口旁增加「↑ 顶部」，支持页面及正文祖先滚动容器。
- 图标裁剪和路由增强延后到页面加载后的空闲时段，路由离开可取消；去干扰扫描按 DOM 变化触发，滚动不再重建文件下拉框。
- 性能样本随服务器响应、渲染及浏览器调度变化；这些调整不承诺全站加载时间下降。原始逐项对照记录见 test/ablation-2026-10-19.json。
- 发布 Greasy Fork 使用 gitcode-enhance.greasyfork.user.js（MIT，完整单文件），不含本地 @require，也不把更新重定向到 GitHub。
