import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/gitcode-enhance.js', import.meta.url), 'utf8');
function harness(path = '/org/repo/pull/10/discuss') {
  const timers = new Map(), observers = [], attrs = {}, uses = [];
  let nextId = 0, button = null;
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }
  class XHR {
    open(method, url) { this.url = url; }
    send() { this.sent = true; }
  }
  const context = vm.createContext({
    console: { log() {} }, DOMException, Promise, TypeError,
    location: { pathname: path }, localStorage: { getItem() { return null; } },
    GM_getValue: () => ({ perf: { blockAnalytics: true, blockCaptcha: true } }),
    document: {
      addEventListener() {}, body: null,
      documentElement: { setAttribute(k, v) { attrs[k] = v; } },
      querySelector: () => button, querySelectorAll: () => [],
      getElementsByTagName: () => uses,
    },
    MutationObserver: Observer, MouseEvent: class {}, XMLHttpRequest: XHR,
    setTimeout(fn) { timers.set(++nextId, fn); return nextId; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener() {}, removeEventListener() {}, fetch: async () => 'sent',
  });
  context.window = context;
  // Run the real definitions and settings, stopping before UI/bootstrap side effects.
  const prefix = source.slice(0, source.indexOf('  installHeaderButton();'));
  vm.runInContext(prefix + '\n globalThis.api = { afterPageReady, textMatchOffsets, floatingStyle, PR_PAGE_RE, readDiffSnapshot, parseDiffLines, searchDiffRows, stats, matchRule, installNetworkBlocking, installIconSpritePruner, autoExpandPRComments, cancel: () => cancelPRExpansion() }; })();', context);
  return {
    context, api: context.api, attrs, uses, observers, timers,
    setButton(value) { button = value; },
    flush() { const batch = [...timers.values()]; timers.clear(); for (const fn of batch) fn(); },
    mutate(records = []) { for (const o of observers) if (o.active) o.callback(records); },
  };
}

test('discussion route aliases match, diff and commit pages do not', () => {
  const { PR_PAGE_RE } = harness().api;
  for (const path of ['/a/b/pull/1', '/a/b/pull/1/discuss/', '/a/b/merge_requests/2/discuss']) assert.ok(PR_PAGE_RE.test(path));
  for (const path of ['/a/b/pull/1/diffs', '/a/b/pull/1/commit', '/a/b/issues/1']) assert.equal(PR_PAGE_RE.test(path), false);
});

test('XHR compatibility preserves native send and never records an unblocked request', () => {
  const { context, api } = harness();
  const nativeOpen = context.XMLHttpRequest.prototype.open;
  const nativeSend = context.XMLHttpRequest.prototype.send;
  api.installNetworkBlocking();
  const xhr = new context.XMLHttpRequest();
  xhr.open('POST', 'https://web-api.gitcode.com/api/v1/report');
  xhr.send();
  assert.equal(xhr.sent, true);
  assert.equal(context.XMLHttpRequest.prototype.open, nativeOpen);
  assert.equal(context.XMLHttpRequest.prototype.send, nativeSend);
  assert.equal(api.stats.blocked.length, 0);
});

test('captcha exemption follows SPA navigation; fetch URL objects are blocked', async () => {
  const { context, api } = harness('/login');
  api.installNetworkBlocking();
  assert.equal(api.matchRule('/js/yidun/sdk.js'), null);
  context.location.pathname = '/org/repo';
  assert.equal(api.matchRule('/js/yidun/sdk.js').key, 'blockCaptcha');
  context.location.pathname = '/login';
  assert.equal(api.matchRule('/js/yidun/sdk.js'), null);
  await assert.rejects(context.fetch(new URL('https://web-api.gitcode.com/api/v1/report')));
});

test('late comments expand after initial idle; route departure cancels clicks', () => {
  const h = harness();
  h.api.autoExpandPRComments();
  h.flush();
  assert.equal(h.timers.size, 0);
  let clicks = 0;
  h.setButton({ dispatchEvent() { clicks++; h.setButton(null); } });
  h.mutate(); h.flush();
  assert.equal(clicks, 1);
  assert.equal(h.api.stats.prExpanded, 1);
  h.setButton({ dispatchEvent() { clicks++; } });
  h.context.location.pathname = '/a/b/issues/1';
  h.flush();
  assert.equal(clicks, 1);
  assert.ok(h.observers.every(o => !o.active));
});

test('restarting expansion disconnects previous observer and timer', () => {
  const h = harness();
  h.api.autoExpandPRComments(); h.api.autoExpandPRComments();
  assert.equal(h.timers.size, 1);
  assert.equal(h.observers.filter(o => o.active).length, 1);
  h.api.cancel();
  assert.equal(h.timers.size, 0);
});

test('restoring a symbol subtracts its actual node count and updates diagnostics', () => {
  const h = harness();
  const symbols = Array.from({ length: 51 }, (_, i) => ({
    id: 'icon-' + i, getElementsByTagName: () => [1, 2], remove() {},
  }));
  const restored = [];
  const sprite = { nodeType: 1, tagName: 'svg', querySelectorAll: () => symbols, appendChild: s => restored.push(s) };
  h.context.document.body = { querySelectorAll: () => [sprite] };
  h.api.installIconSpritePruner();
  assert.equal(h.api.stats.spriteNodesRemoved, 153);
  const use = { nodeType: 1, tagName: 'use', getAttribute: () => '#icon-0' };
  h.mutate([{ type: 'childList', addedNodes: [use] }]);
  assert.equal(h.api.stats.spriteNodesRemoved, 150);
  assert.equal(h.api.stats.spritePruned, 50);
  assert.equal(h.attrs['data-gce-pruned'], '51->1 nodes-150');
  h.mutate([{ type: 'attributes', target: use }]);
  assert.equal(restored.length, 1);
  assert.equal(h.api.stats.spriteNodesRemoved, 150);
});


test('unified diff indexes both sides with correct line numbers across hunks', () => {
  const { parseDiffLines } = harness().api;
  const parsed = parseDiffLines('@@ -10,2 +10,3 @@\n same\n-old\n+new\n+extra\n@@ -40 +41 @@\n-before\n+after\n\\ No newline at end of file\n');
  assert.equal(parsed.complete, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.rows.map(r => [r.text,r.oldLine,r.newLine]))), [
    ['same',10,10],['old',11,null],['new',null,11],['extra',null,12],['before',40,null],['after',null,41],
  ]);
  assert.equal(parseDiffLines('@@ -1,2 +1,2 @@\n one\n').complete, false);
  assert.equal(parseDiffLines('Binary files differ').complete, false);
});

test('search includes off-screen file text and honors literal/case/change filters', () => {
  const { searchDiffRows, parseDiffLines } = harness().api;
  const files = [{path:'offscreen.py',rows:parseDiffLines('@@ -1,2 +1,2 @@\n context.*\n-old NEEDLE\n+new needle\n').rows}];
  assert.equal(searchDiffRows(files,'needle').length,2);
  assert.equal(searchDiffRows(files,'NEEDLE',true).length,1);
  assert.equal(searchDiffRows(files,'.*').length,1);
  assert.equal(searchDiffRows(files,'context',false,true).length,0);
  assert.equal(searchDiffRows(files,'').length,0);
});

test('snapshot resolves only matching PR data and preserves completeness flags', () => {
  const { readDiffSnapshot } = harness().api;
  const table = [{ 'pr-diffs:org%2Frepo:10':1 },{ files:2, changesCount:3, commitId:4 },[5],2,'abc123',
    {filePath:6,diff:7,binary:8,tooLarge:9,collapsed:9},'hidden.py','@@ -0,0 +1 @@\n+x\n',false,true];
  const snapshot = readDiffSnapshot(JSON.stringify(table),'/org/repo/pull/10/diffs');
  assert.equal(snapshot.total,2);
  assert.equal(snapshot.files.length,1);
  assert.equal(snapshot.files[0].tooLarge,true);
  assert.equal(snapshot.files[0].path,'hidden.py');
  assert.throws(()=>readDiffSnapshot(JSON.stringify(table),'/org/repo/pull/11/diffs'));
});


test('floating positions use valid anchors and reject unknown settings', () => {
  const { floatingStyle } = harness().api;
  assert.equal(floatingStyle('left-top', 'right-middle'), 'left:16px;top:150px;');
  assert.equal(floatingStyle('right-bottom', 'right-middle'), 'right:16px;bottom:16px;');
  assert.match(floatingStyle('left-middle', 'right-middle'), /left:16px;top:50%/);
  assert.equal(floatingStyle('bad;display:none', 'right-top'), 'right:16px;top:150px;');
});

test('keyword offsets include every literal occurrence and respect case', () => {
  const { textMatchOffsets } = harness().api;
  assert.equal(JSON.stringify(textMatchOffsets('PyTorch torch TORCH', 'torch', false)), '[[2,7],[8,13],[14,19]]');
  assert.equal(JSON.stringify(textMatchOffsets('PyTorch torch TORCH', 'torch', true)), '[[8,13]]');
  assert.equal(JSON.stringify(textMatchOffsets('a.* b.*', '.*', false)), '[[1,3],[5,7]]');
  assert.equal(textMatchOffsets('abc', '', false).length, 0);
});

test('deferred route work can be cancelled before idle execution', () => {
  const h = harness(); let ran = 0;
  h.context.document.readyState = 'complete';
  h.context.requestIdleCallback = h.context.setTimeout;
  h.context.cancelIdleCallback = h.context.clearTimeout;
  const cancel = h.api.afterPageReady(() => ran++);
  assert.equal(ran, 0); cancel(); h.flush(); assert.equal(ran, 0);
  h.api.afterPageReady(() => ran++); h.flush(); assert.equal(ran, 1);
});

test('route cancellation removes pending load listener', () => {
  const h = harness(); let listener, ran = 0;
  h.context.document.readyState = 'loading';
  h.context.addEventListener = (name, fn) => { if (name === 'load') listener = fn; };
  h.context.removeEventListener = (name, fn) => { if (listener === fn) listener = null; };
  const cancel = h.api.afterPageReady(() => ran++);
  assert.equal(typeof listener, 'function'); cancel(); assert.equal(listener, null); h.flush(); assert.equal(ran, 0);
});
