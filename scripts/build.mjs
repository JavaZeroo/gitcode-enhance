// 把 UserScript 元数据头 + src/gitcode-enhance.js 拼成可直接安装/发布的单文件脚本。
// 用法: node scripts/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

let header = `// ==UserScript==
// @name         GitCode / AtomGit 增强
// @name:en      GitCode Enhance
// @namespace    https://github.com/JavaZeroo/gitcode-enhance
// @version      ${pkg.version}
// @description  GitCode 评审增强：Ctrl+F 跨文件差异搜索与高亮、回到顶部、可配置悬浮工具、去干扰和按需性能优化
// @description:en  Cross-file PR diff search and highlighting, back to top, configurable floating tools, decluttering and on-demand optimizations
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
// Greasy Fork manages updates for its own distribution.
writeFileSync(join(root, 'gitcode-enhance.greasyfork.user.js'), header.replace(/^\/\/ @(?:updateURL|downloadURL).*\n/gm, '' ) + body);

console.log(`built gitcode-enhance.user.js @ v${pkg.version}`);
