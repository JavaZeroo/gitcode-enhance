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
// @description  去广告、GitHub 风格美化、性能优化（可分级去除 AI 组件）、PR 评论自动展开
// @description:en  Remove ads, GitHub-style skin, tiered performance mode (strip AI widgets), auto-expand collapsed PR comments
// @author       JavaZeroo
// @match        https://gitcode.com/*
// @icon         https://gitcode.com/favicon.ico
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
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
