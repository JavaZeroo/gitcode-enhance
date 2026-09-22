# GitCode Enhance

非官方的 [gitcode.com](https://gitcode.com)（AtomGit）增强油猴脚本：去广告、GitHub 风格美化、分级性能优化、PR 评论自动展开。

## 安装

- GreasyFork: https://greasyfork.org/zh-CN/scripts/596921-gitcode-atomgit-增强
- 或直接安装 GitHub 上的最新版本：[gitcode-enhance.user.js](https://raw.githubusercontent.com/JavaZeroo/gitcode-enhance/main/gitcode-enhance.user.js)（需要先装 [Tampermonkey](https://www.tampermonkey.net/)）

## 功能

### 去广告 / 去干扰
- 隐藏右下角客服悬浮聊天窗
- 隐藏右侧悬浮的反馈/帮助图标条
- 隐藏 README 顶部「以下内容由 AI 翻译…」提示条

### GitHub 风格美化
参照 GitHub Primer 设计规范做了轻度换肤：白底、6px 圆角、系统字体栈，不用阴影/毛玻璃堆叠。

（之前试过苹果 Liquid Glass 风格的 `backdrop-filter` 毛玻璃效果，在评论多的 PR 页面上实测很卡，放弃了。）

### 性能优化（分级去除 AI 组件）
`/dashboard` 首页默认是一个沉浸式 AI Agent 聊天界面，平时用不到的话可以关掉。装好脚本后，点 Tampermonkey 图标里的脚本菜单可以切换档位：

- **轻量级**（默认）：只用 CSS 隐藏 AI Agent 面板，不碰网络请求，零风险
- **极致级**：额外在页面加载最早期拦截 `copilot-agent.gitcode.com` 等 AI 相关接口请求，真正省流量和 CPU；代价是这个档位下 AI Agent 功能会打不开
- **关闭**：完全不处理，保留原始体验

### PR 评论自动展开
PR 讨论区里被折叠的历史消息（"此处折叠了 N 条消息 查看更多"）会在打开页面后自动全部展开，不用手动一个个点。

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
