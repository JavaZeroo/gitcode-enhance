<h1 align="center">GitCode Enhance</h1>

<p align="center">面向 gitcode.com（AtomGit）的油猴脚本：PR 跨文件差异搜索、评审导航、去干扰和可选的性能优化，所有功能都能在设置面板里单独开关。</p>

<p align="center">
  <a href="https://greasyfork.org/zh-CN/scripts/596921"><img src="https://img.shields.io/greasyfork/v/596921?style=flat-square&color=F59E0B" alt="Greasy Fork 版本"></a> <a href="https://greasyfork.org/zh-CN/scripts/596921"><img src="https://img.shields.io/greasyfork/dt/596921?style=flat-square&color=F59E0B" alt="Greasy Fork 总安装量"></a> <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-22C55E?style=flat-square" alt="License: MIT"></a>
</p>

本项目是非官方脚本，与 GitCode 无关。

## 核心亮点

| 亮点 | 对使用者的价值 |
|---|---|
| PR 差异全文搜索 | 在文件改动页按 Ctrl+F，可以搜到所有文件的 diff，包括还没渲染到屏幕上的部分，并直接跳到对应行 |
| 评审导航工具栏 | 显示正在阅读的文件，可以按路径筛选、跳到上一个或下一个文件、复制路径，还有专注模式 |
| 讨论区自动展开 | 自动点开「此处折叠了 N 条消息」，默认只展开阅读位置附近的部分 |
| 去广告和去干扰 | 隐藏客服悬浮窗、活动广告位、AI 翻译提示条；工作台首页直接打开最新动态，不进 AI 聊天页 |
| 分级性能优化 | 默认只做 DOM 和 CSS 层的处理；「极致级」会再拦截 AI、营销、埋点、客服和验证码相关请求 |

## 快速安装

1. 在浏览器里安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 用下面任意一种方式安装脚本：
   - Greasy Fork：[GitCode / AtomGit 增强](https://greasyfork.org/zh-CN/scripts/596921)，由 Greasy Fork 管理更新。
   - GitHub：[gitcode-enhance.user.js](https://raw.githubusercontent.com/JavaZeroo/gitcode-enhance/main/gitcode-enhance.user.js)，更新检查通过 `gitcode-enhance.meta.js` 进行。

两种方式只装一个，同时启用会重复运行。

## 快速开始

1. 打开 [gitcode.com](https://gitcode.com)。默认设置下脚本立即生效，不用额外配置。
2. 打开设置面板，下面任一方式都可以：
   - 左下角的「设置」悬浮按钮
   - 顶栏右侧的齿轮图标
   - 快捷键 `Alt+G`（macOS 上是 `Option+G`）
   - Tampermonkey 扩展菜单里的「打开设置面板」
3. 打开任意 PR 的「文件改动」页（地址以 `/pull/<编号>/diffs` 结尾），按 `Ctrl+F` 打开差异搜索。输入关键词后，`Enter` 跳到下一处，`Shift+Enter` 跳到上一处，`Esc` 关闭。

在设置面板里改完选项后，点「保存并刷新」生效。

## 功能

### PR 差异搜索

只在 PR 文件改动页接管 `Ctrl+F`，其他页面仍是浏览器自带的查找。

- 搜索范围是 diff 里的新增、删除和上下文行，不包括仓库里其他文件，也不包括文件中没改动的部分。
- 按字面文本匹配，默认忽略大小写；可以勾选「区分大小写」和「仅新增/删除行」。
- 从你正在阅读的文件开始往下搜，到末尾后从头继续。匹配的关键词会高亮，当前选中的结果用橙色标出并加行边框。
- 面板会显示覆盖了多少个文件和当前提交的 SHA，并列出没能索引的文件和原因，比如二进制文件、站点还没加载的差异、被截断的差异。

### PR 文件评审工具

文件改动页上有一个默认收起的悬浮工具栏，点「展开工具」打开：

- 显示正在阅读的文件路径，可以一键复制
- 按路径筛选文件，并从列表中选择跳转，或者跳到上一个、下一个文件
- 专注模式：收起 PR 大标题和分支信息，离开文件改动页后自动恢复

工具栏不会改动站点的文件树、折叠状态或已读状态。

### PR 讨论区自动展开

自动点开讨论区里折叠的历史消息，支持 `/pull/<编号>`、`/pull/<编号>/discuss` 和对应的 `merge_requests` 路径。

- 默认只展开阅读位置附近的折叠块，滚动到哪里展开到哪里；可以在设置里改成「全部折叠消息」。
- 标签页在后台时暂停，离开页面后停止；每个按钮只自动点一次。

### 去广告和去干扰

- 隐藏右下角的客服悬浮窗、右侧的反馈和帮助图标条
- 隐藏 README 顶部「以下内容由 AI 翻译…」提示条
- 隐藏活动广告轮播、校园活动弹窗和签到入口
- 工作台首页：打开 gitcode.com 时默认跳到「最新动态」，不进 AI 聊天页。也可以改成 Pull Requests、Issue、讨论、看板，或者选择不跳转。

### 界面

- GitHub 风格：只改系统字体、README 卡片圆角和阴影，保留站点原有背景和评论布局。
- 设置按钮、评审工具栏和 PR 查找栏各自可以放在六个位置之一（左上、左中、左下、右上、右中、右下）。
- 顶栏齿轮、悬浮「设置」按钮和「顶部」按钮各有独立开关，在设置面板的「功能增强 → 设置入口」里。

## 性能档位

档位只是一组预设，每一项都可以单独开关；只要改了其中任何一项，档位就会显示为「自定义」。

| 项目 | 作用层 | 轻量级（默认） | 极致级 |
|---|---|:-:|:-:|
| 隐藏 AI 组件（底部 AtomCode dock、顶栏和侧栏入口） | CSS | 是 | 是 |
| 裁剪未使用的图标雪碧图，用到时再放回 | DOM | 是 | 是 |
| 拦截 AI 接口 | 网络 | | 是 |
| 拦截营销和活动请求 | 网络 | | 是 |
| 拦截埋点上报 | 网络 | | 是 |
| 拦截客服 SDK | 网络 | | 是 |
| 拦截验证码 SDK（登录、注册相关路径自动放行） | 网络 | | 是 |

开启「极致级」后，AI Agent 和在线客服会无法使用。网络层的设置要刷新页面才生效。设置面板底部的「本页统计」会显示当前页面实际拦截了哪些请求、减少了多少 DOM 节点，以及主线程长任务的总时长。

目前没有证据表明脚本能让全站加载稳定变快。各次测量的范围和结论见下方「文档」里的性能报告。

## 已知限制

- 脚本依赖 gitcode.com 当前的页面结构和接口地址，不是官方 API，站点改版后部分功能可能失效。
- 网络拦截只作用于 `fetch`、`sendBeacon` 和 `<script>`，`XMLHttpRequest` 一律放行，以免站点弹出「连接出错」。
- 页面 HTML 里直接写的验证码脚本不一定拦得住，设置面板会显示实际有没有拦住。如果登录流程出问题，请关闭「拦截验证码 SDK」后刷新。
- 差异搜索不会自动加载站点上标着「加载差异」的文件，也不会把你手动加载的差异补进已建立的索引。
- PR 有新提交后，需要刷新页面再搜索，脚本不会跳到旧版本的代码行。
- 站点会回收离视口较远的代码表格，滚回去时会重新渲染。脚本不改变这一行为。

## 文档

| 主题 | 内容 | 链接 |
|---|---|---|
| 更新记录 | 各版本的改动 | [CHANGELOG.md](./CHANGELOG.md) |
| 下一版计划 | v0.4.0 的范围、验收标准和测量方案 | [ROADMAP.md](./ROADMAP.md) |
| 维护待办 | 未完成和已完成的事项 | [TODO.md](./TODO.md) |
| 讨论页性能分析 | 2026-11-03 定位到的样式重算放大问题及修复 | [打开文档](./docs/performance/2026-11-03-profiling.md) |
| 内存优化验证 | v0.3.4 图标存储方式和讨论区展开方式的内存对照 | [打开文档](./docs/performance/2026-11-03-memory.md) |
| 早期页面观察 | 雪碧图、客服轮询、验证码 SDK 等最初的测量记录 | [打开文档](./docs/performance/history.md) |
| v0.3.4 发布记录 | 测量边界和发布渠道状态 | [打开文档](./docs/releases/v0.3.4.md) |

## 本地开发

| 路径 | 用途 |
|---|---|
| `src/gitcode-enhance.js` | 脚本逻辑的唯一来源 |
| `scripts/build.mjs` | 把元数据头和源码拼接成发布文件 |
| `gitcode-enhance.user.js` | GitHub 发布版本，由构建生成，需要提交 |
| `gitcode-enhance.meta.js` | 只含元数据头，供 Tampermonkey 检查更新，由构建生成 |
| `gitcode-enhance.greasyfork.user.js` | Greasy Fork 发布版本，不含更新地址 |
| `dev/loader.user.js` | 本机开发用的加载器，通过 `@require file://` 加载源码 |

开发流程：

1. 把 `dev/loader.user.js` 里 `@require` 的路径改成你本机 `src/gitcode-enhance.js` 的实际路径，然后在 Tampermonkey 里安装，并在扩展设置里开启「允许访问文件网址」。开发时停用正式版脚本。
2. 修改 `src/gitcode-enhance.js`，保存后刷新 gitcode.com 页面查看效果。
3. 发布前先把 `package.json` 里的版本号调高，再运行测试和构建，并提交生成的三个文件：

```bash
npm test
```

```bash
npm run build
```

Greasy Fork 上的发布使用 `gitcode-enhance.greasyfork.user.js`，说明文字在 `greasyfork-description.txt`。

## 许可证

本项目基于 [MIT 许可证](./LICENSE) 发布。
