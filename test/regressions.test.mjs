import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/gitcode-enhance.js', import.meta.url), 'utf8');
function harness(path = '/org/repo/pull/10/discuss') {
  const timers = new Map(), observers = [], attrs = {}, uses = [];
  const docListeners = new Map(), winListeners = new Map();
  const listen = (map, type, fn) => { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); };
  const unlisten = (map, type, fn) => { map.get(type)?.delete(fn); };
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
      addEventListener(type, fn) { listen(docListeners, type, fn); },
      removeEventListener(type, fn) { unlisten(docListeners, type, fn); }, body: null,
      documentElement: { setAttribute(k, v) { attrs[k] = v; } },
      querySelector: () => button, querySelectorAll: selector => selector === '.collapse-btn__more' && button ? [button] : [],
      getElementsByTagName: () => uses,
    },
    MutationObserver: Observer, MouseEvent: class {}, XMLHttpRequest: XHR,
    setTimeout(fn) { timers.set(++nextId, fn); return nextId; },
    clearTimeout(id) { timers.delete(id); },
    innerHeight: 800, innerWidth: 1200,
    addEventListener(type, fn) { listen(winListeners, type, fn); },
    removeEventListener(type, fn) { unlisten(winListeners, type, fn); }, fetch: async () => 'sent',
  });
  context.window = context;
  // Run the real definitions and settings, stopping before UI/bootstrap side effects.
  const prefix = source.slice(0, source.indexOf('  installHeaderButton();'));
  vm.runInContext(prefix + '\n globalThis.api = { settings, handleCommentShortcut, selectedDiffText, readBlobText, sourceContextRows, mergeDiffRows, atSearchOrigin, declutter, stopDeclutter: () => stopDeclutter(), recordBlock, expireDiffCache, clearDiffCache, cache: () => diffSearchCache, seedCache: value => { diffSearchCache = value; }, afterPageReady, codeTextRanges, hitLineLookup, textMatchOffsets, floatingStyle, findReviewFileIndex, mergeExpandedContext, indexDiffSnapshot, indexDiffSnapshotAsync, prioritizeDiffFiles, PR_PAGE_RE, readDiffSnapshot, parseDiffLines, searchDiffRows, stats, matchRule, installNetworkBlocking, installIconSpritePruner, autoExpandPRComments, cancel: () => cancelPRExpansion() }; })();', context);
  return {
    context, api: context.api, attrs, uses, observers, timers,
    setButton(value) {
      if (value) {
        value.isConnected ??= true;
        value.getClientRects ??= () => [value.getBoundingClientRect()];
        value.getBoundingClientRect ??= () => ({ top: 100, bottom: 120, left: 0, right: 100, width: 100, height: 20 });
      }
      button = value;
    },
    event(type, windowEvent = false) { for (const fn of (windowEvent ? winListeners : docListeners).get(type) || []) fn(); },
    listenerCount(type, windowEvent = false) { return (windowEvent ? winListeners : docListeners).get(type)?.size || 0; },
    flush() { const batch = [...timers.values()]; timers.clear(); for (const fn of batch) fn(); },
    mutate(records = []) { for (const o of observers) if (o.active) o.callback(records); },
  };
}

test('index retains searchable rows without retaining the raw patch', () => {
  const { indexDiffSnapshot, searchDiffRows } = harness().api;
  const diff = '@@ -0,0 +1,2 @@\n+Hello\n+World\n';
  const result = indexDiffSnapshot({ total: 1, files: [{ path: 'a.txt', diff }] });
  assert.equal(Object.hasOwn(result.indexed[0], 'diff'), false);
  assert.equal(searchDiffRows(result.indexed, 'world').length, 1);
});

test('closed-search cache expires and log history stays bounded', () => {
  const h = harness();
  h.api.seedCache({ indexed: ['large data'] });
  h.api.expireDiffCache(); h.flush();
  assert.equal(h.api.cache(), null);
  for (let i = 0; i < 1000; i++) h.api.recordBlock({ label: 'test' }, 'https://example.com/' + i);
  assert.equal(h.api.stats.blocked.length, 100);
  assert.equal(h.api.stats.blocked[0].url, 'example.com/900');
});

test('declutter scans added subtrees instead of the full page and cancels pending work', () => {
  const h = harness();
  let fullScans = 0, localScans = 0;
  h.context.document.body = {};
  h.context.document.querySelectorAll = () => { fullScans++; return []; };
  const node = { nodeType: 1, isConnected: true, matches: () => false,
    querySelector: () => ({}), querySelectorAll: () => { localScans++; return []; } };
  h.api.declutter();
  const initial = fullScans;
  for (let i = 0; i < 20; i++) { h.mutate([{ addedNodes: [node] }]); h.flush(); }
  assert.equal(fullScans, initial);
  assert.ok(localScans > 0);
  h.mutate([{ addedNodes: [node] }]);
  h.api.stopDeclutter(); h.flush();
  assert.equal(h.timers.size, 0);
});

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

test('slow expansion never clicks the same button again', () => {
  const h = harness();
  let clicks = 0;
  h.setButton({ dispatchEvent() { clicks++; } });
  h.api.autoExpandPRComments();
  for (let i = 0; i < 80; i++) { h.mutate(); h.flush(); }
  assert.equal(clicks, 1);
  h.setButton({ dispatchEvent() { clicks++; } });
  h.mutate(); h.flush();
  assert.equal(clicks, 2, 'newly loaded nested buttons still expand');
  h.api.cancel();
  h.mutate(); h.flush();
  assert.equal(clicks, 2);
});

test('nearby expansion waits for scrolling, pauses in background and cancels listeners', () => {
  const h = harness(); let clicks = 0, top = 4000;
  h.setButton({ dispatchEvent() { clicks++; }, getBoundingClientRect: () => ({ top, bottom: top + 20, width: 100, height: 20, left: 0, right: 100 }) });
  h.api.autoExpandPRComments(); h.flush();
  assert.equal(clicks, 0, 'distant content stays folded');
  top = 200; h.event('scroll'); h.flush();
  assert.equal(clicks, 1);
  h.setButton({ dispatchEvent() { clicks++; } });
  h.context.document.visibilityState = 'hidden'; h.mutate(); h.flush();
  assert.equal(clicks, 1, 'background tab does not expand content');
  h.context.document.visibilityState = 'visible'; h.event('visibilitychange'); h.flush();
  assert.equal(clicks, 2);
  h.api.cancel(); h.event('scroll'); h.event('resize', true); h.flush();
  assert.equal(h.listenerCount('scroll'), 0);
  assert.equal(h.listenerCount('visibilitychange'), 0);
  assert.equal(h.listenerCount('resize', true), 0);
  assert.equal(h.timers.size, 0);
});

test('explicit all mode keeps distant expansion; hidden blocks stay untouched in nearby mode', () => {
  const h = harness(); let clicks = 0;
  h.api.settings.pr.expandMode = 'all';
  h.setButton({ dispatchEvent() { clicks++; }, getBoundingClientRect: () => ({ top: 4000, bottom: 4020, width: 100, height: 20 }) });
  h.api.autoExpandPRComments(); h.flush(); assert.equal(clicks, 1);
  h.api.cancel(); h.api.settings.pr.expandMode = 'nearby';
  h.setButton({ dispatchEvent() { clicks++; }, getClientRects: () => [] });
  h.api.autoExpandPRComments(); h.flush(); assert.equal(clicks, 1);
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
    id: 'icon-' + i, outerHTML: `<symbol id="icon-${i}"><path/><path/></symbol>`, getElementsByTagName: () => [1, 2], remove() {},
  }));
  const restored = [];
  const sprite = { nodeType: 1, tagName: 'svg', isConnected: true, querySelectorAll: () => symbols, appendChild: s => restored.push(s) };
  h.context.document.createElementNS = namespaceURI => ({
    set innerHTML(markup) { this.firstElementChild = { id: markup.match(/id="([^"]*)"/)?.[1], localName: 'symbol', namespaceURI, outerHTML: markup }; },
  });
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
  assert.notEqual(restored[0], symbols[0], 'restores from data instead of retaining the removed node');
  assert.equal(restored[0].outerHTML, symbols[0].outerHTML);
  assert.equal(h.api.stats.spriteNodesRemoved, 150);
});

test('sprite pruning leaves native icons untouched if safe restoration is unavailable', () => {
  for (const unavailable of ['WeakRef', 'parsing']) {
    const h = harness();
    let scans = 0;
    h.context.document.body = { querySelectorAll() { scans++; return []; } };
    if (unavailable === 'WeakRef') h.context.WeakRef = undefined;
    h.context.document.createElementNS = () => ({
      set innerHTML(_) { throw new TypeError('TrustedHTML required'); },
    });
    h.api.installIconSpritePruner();
    assert.equal(scans, 0);
    assert.equal(h.api.stats.spritePruned, 0);
    assert.equal(h.observers.length, 0);
  }
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


test('coverage distinguishes empty files from deferred and truncated diffs', () => {
  const { indexDiffSnapshot } = harness().api;
  const result = indexDiffSnapshot({total: 3, files: [
    {path: 'empty.py', diff: '', isEmpty: true, addedLines: 0, removedLines: 0},
    {path: 'lazy.py', diff: '', collapsed: true},
    {path: 'code.py', diff: '@@ -0,0 +1 @@\n+needle\n'},
  ]});
  assert.equal(result.empty, 1);
  assert.equal(result.indexed.length, 1);
  assert.equal(result.incomplete, 1);
  assert.match(result.issues.join(' '), /lazy.py.*尚未加载/);
  const truncated = indexDiffSnapshot({total: 1, files: [{path:'bad.py',diff:'@@ -0,0 +1,2 @@\n+one\n'}]});
  assert.equal(truncated.incomplete, 1);
  const ambiguous = indexDiffSnapshot({total: 1, files: [{path:'unknown.py',diff:''}]});
  assert.equal(ambiguous.incomplete, 1);
});


test('search starts at the current file and wraps without changing the shared index', () => {
  const { prioritizeDiffFiles, searchDiffRows } = harness().api;
  const files = ['a','b','c'].map(path => ({path,rows:[{kind:'+',text:'needle',newLine:1}]}));
  assert.equal(searchDiffRows(prioritizeDiffFiles(files,'b'),'needle').map(h=>h.file.path).join(','),'b,c,a');
  assert.equal(files.map(f=>f.path).join(','),'a,b,c');
  assert.equal(prioritizeDiffFiles(files,'absent'),files);
  assert.equal(prioritizeDiffFiles([], 'b').length,0);
});

test('incremental indexing yields and stops after cancellation', async () => {
  const { indexDiffSnapshotAsync, indexDiffSnapshot } = harness().api;
  const snapshot = {total:9,files:Array.from({length:9},(_,i)=>({path:String(i),diff:'@@ -0,0 +1 @@\n+needle\n'}))};
  let yields=0;
  const result=await indexDiffSnapshotAsync(snapshot,()=>false,async()=>{yields++;});
  assert.equal(yields,2);
  assert.equal(JSON.stringify(result),JSON.stringify(indexDiffSnapshot(snapshot)));
  let cancelled=false;
  assert.equal(await indexDiffSnapshotAsync(snapshot,()=>cancelled,async()=>{cancelled=true;}),null);
});

 test('highlight ranges cover every occurrence across syntax token boundaries', () => {
  const {api,context}=harness();
  const nodes=['to','rch torch',' TORCH'].map(textContent=>({textContent}));
  context.document.createTreeWalker=()=>{let i=0;return {nextNode:()=>nodes[i++]};};
  context.document.createRange=()=>({setStart(node,offset){this.start=[nodes.indexOf(node),offset];},setEnd(node,offset){this.end=[nodes.indexOf(node),offset];}});
  const ranges=api.codeTextRanges({},'torch',false);
  assert.equal(ranges.length,3);
  assert.deepEqual(ranges.map(r=>r.start).flat().join(','),'0,0,1,4,2,1');
  assert.equal(ranges[0].end.join(','),'1,3');
  assert.equal(api.codeTextRanges({},'torch',true).length,2);
  assert.equal(api.codeTextRanges({},'',false).length,0);
});
 test('global highlight lookup respects matched files and both diff sides', () => {
  const {hitLineLookup}=harness().api;
  const hits=[{file:{path:'a'},row:{kind:'-',oldLine:2,newLine:null}},{file:{path:'a'},row:{kind:'+',oldLine:null,newLine:4}},{file:{path:'b'},row:{kind:' ',oldLine:8,newLine:9}}];
  const lookup=hitLineLookup(hits);
  assert.equal([...lookup.get('a')].join(','),'old:2,new:4');
  assert.equal([...lookup.get('b')].join(','),'old:8,new:9');
  assert.equal(hitLineLookup([]).size,0);
  const batches = hitLineLookup(hits.slice(0, 1));
  hitLineLookup(hits.slice(1), batches);
  assert.deepEqual(batches, lookup);
});

test('expanded context merges in file order without duplicating patch lines or crossing commits', () => {
  const { mergeExpandedContext, searchDiffRows } = harness().api;
  const row = (oldLine, newLine, kind, text) => ({oldLine, newLine, kind, text});
  const base = [{path:'a', rows:[row(5,5,' ','base'), row(10,null,'-','before'), row(null,10,'+','after')]}];
  const additions = [row(15,15,' ','last'), row(4,4,' ','first'), row(5,5,' ','base'), row(9,9,' ','middle')];
  const source = new Map([['a',{commit:'abc',rows:new Map(additions.map(r=>[r.newLine,r]))}]]);
  const merged = mergeExpandedContext(base, source, 'abc');
  assert.equal(merged.added,3);
  assert.equal(merged.indexed[0].rows.map(r=>r.text).join(','),'first,base,middle,before,after,last');
  assert.equal(searchDiffRows(merged.indexed,'middle',false,true).length,0);
  assert.equal(mergeExpandedContext(base,source,'other').added,0);
  assert.equal(mergeExpandedContext(base,source,'').added,0);
  assert.equal(base[0].rows.length,3);
});
test('review tracking preserves the first bottom below the reading line across jumps and hidden files', () => {
  const {findReviewFileIndex} = harness().api;
  const count = 128;
  let reads = 0;
  function filesAt(scroll, hidden) {
    return Array.from({length:count}, (_, i) => {
      const top = i * 80 - scroll;
      const rect = hidden.has(i) ? {top:0,bottom:0,height:0} : {top,bottom:top+65,height:65};
      return {rect, node:{getBoundingClientRect(){reads++;return rect;}}};
    });
  }
  assert.equal(findReviewFileIndex([], 10), -1);
  for (const hidden of [new Set(),new Set([0, 16, 62, 63, 64, 65, 127])]) {
    for (const scroll of [-500, 0, 4, 5000, 5030, 5070, 5074, 5075, 9800, 12000]) {
      const files = filesAt(scroll, hidden);
      const expected = files.findIndex(f=>f.rect.bottom>221);
      for (const hint of [-1, 0, 16, 62, 63, 64, 65, 126, 127, 200]) {
        assert.equal(findReviewFileIndex(files,hint), expected<0 ? count-1 : expected);
      }
    }
  }
  const files=filesAt(8000,new Set());
  reads=0;assert.equal(findReviewFileIndex(files,102),102);assert.equal(reads,1);
  reads=0;assert.equal(findReviewFileIndex(files,101),102);assert.equal(reads,2);
  reads=0;assert.equal(findReviewFileIndex(files,0),102);assert.ok(reads<=10);
});
test('line-relative search crosses one-sided changes at the reading anchor', () => {
  const { atSearchOrigin } = harness().api;
  const file = {path:'a'};
  const pos = {path:'a', oldLine:null, newLine:10};
  assert.ok(!atSearchOrigin(file,{oldLine:9,newLine:null},pos));
  assert.ok(atSearchOrigin(file,{oldLine:null,newLine:10},pos));
  assert.ok(!atSearchOrigin(file,{oldLine:15,newLine:15},{...pos,afterFile:true}));
  assert.ok(atSearchOrigin({path:'b'},{newLine:1},pos));
});

test('loading a partial diff preserves order and both sides of replacements', () => {
  const { mergeDiffRows } = harness().api;
  const a = {kind:' ', oldLine:2, newLine:2}, b = {kind:'-', oldLine:5, newLine:null};
  const c = {kind:'+', oldLine:null, newLine:5}, d = {kind:' ', oldLine:8, newLine:8};
  assert.deepEqual(Array.from(mergeDiffRows([a,b,c],[b,c,d])),[a,b,c,d]);
  assert.deepEqual(Array.from(mergeDiffRows([b,c,d],[a,b,c])),[a,b,c,d]);
});

test('unexpanded head lines keep CRLF numbering and stay out of changes-only results', () => {
  const { sourceContextRows, searchDiffRows, hitLineLookup } = harness().api;
  const rows = sourceContextRows('same\r\nnew\r\nfolded needle\r\n', [{newLine:1},{newLine:null},{newLine:2}], 1);
  assert.deepEqual(Array.from(rows, r => [r.newLine,r.text]),[[3,'folded needle']]);
  const files = [{path:'a',rows}];
  assert.equal(searchDiffRows(files,'needle',false,true).length,0);
  assert.deepEqual(Array.from(hitLineLookup(searchDiffRows(files,'needle')).get('a')),['new:3']);
  assert.throws(() => sourceContextRows('a\nb',[],1));
});

test('full text must come from the selected path and revision and be available in the blob viewer', () => {
  const {readBlobText} = harness().api;
  const tables = [{'blob:o/r:abc:a':1},{raw:2,analyzed:3,isLimited:4,auditStatus:5,plainContent:6},
    {path:7,ref:8},{isBinary:4,isLfs:4},false,0,'example','a','abc'];
  const read = () => readBlobText(JSON.stringify(tables),'o/r','abc','a');
  assert.equal(read(),'example');
  tables[8] = 'different'; assert.equal(read(),null); tables[8] = 'abc';
  tables[4] = true; assert.equal(read(),null); tables[4] = false;
  tables[5] = 1; assert.equal(read(),null);
});

test('Ctrl+F only consumes a nonblank single-line selection inside diff code', () => {
  const {api, context} = harness();
  let code = true, text = 'variable', consumed = 0;
  const parentElement = {closest: () => code ? parentElement : null};
  context.getSelection = () => ({
    rangeCount: 1, isCollapsed: false, toString: () => text,
    getRangeAt: () => ({commonAncestorContainer: {nodeType: 3, parentElement}}),
    removeAllRanges: () => consumed++,
  });
  assert.equal(api.selectedDiffText(), 'variable');
  for (text of ['a\nb', 'a\rb', '   ']) assert.equal(api.selectedDiffText(), '');
  code = false; text = 'a comment';
  assert.equal(api.selectedDiffText(), '');
  assert.equal(consumed, 1);
});

test('comment submit keys use the active PR editor and do not submit twice or during IME', () => {
  const { api } = harness('/a/b/pull/1/diffs');
  let clicks = 0, inline = false;
  const button = {click() { clicks++; }, getAttribute: () => null, getClientRects: () => [{}]};
  const editor = {closest: () => inline, querySelectorAll: () => [button]};
  const target = {closest: () => ({closest: () => editor})};
  function press(extra = {}) {
    let consumed = false;
    api.handleCommentShortcut({key:'Enter', ctrlKey:true, metaKey:false, composedPath:() => [target],
      preventDefault() { consumed = true; }, stopPropagation() {}, ...extra});
    return consumed;
  }
  assert.ok(press());
  assert.ok(press({ctrlKey:false,metaKey:true}));
  assert.ok(!press({shiftKey:true}));
  inline = true;
  assert.ok(press({shiftKey:true}));
  assert.ok(!press({altKey:true}));
  assert.ok(!press({isComposing:true}));
  assert.ok(!press({defaultPrevented:true}));
  assert.ok(press({repeat:true}));
  button.disabled = true;
  assert.ok(press());
  assert.equal(clicks,3);
});
