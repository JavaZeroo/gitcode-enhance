// 把 UserScript 元数据头 + src/gitcode-enhance.js 拼成可直接安装/发布的单文件脚本。
// 用法: node scripts/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const header = `// ==UserScript==
// @name         GitCode / AtomGit 增强
// @name:en      GitCode Enhance
// @namespace    https://github.com/JavaZeroo/gitcode-enhance
// @version      ${pkg.version}
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

`;

const body = readFileSync(join(root, 'src', 'gitcode-enhance.js'), 'utf8');

writeFileSync(join(root, 'gitcode-enhance.user.js'), header + body);

console.log(`built gitcode-enhance.user.js @ v${pkg.version}`);
