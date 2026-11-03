// Isolated Chromium fixture: never attaches to the user's browser/profile.
// node scripts/profile-memory.mjs <browser.exe> <source.js> <output.json> [--expect-optimized]
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const [executable, sourcePath, outputPath] = process.argv.slice(2);
if (!executable || !sourcePath || !outputPath) throw new Error('Expected browser executable, source and output paths');
const source = await fs.readFile(sourcePath, 'utf8');
const boundary = source.indexOf('  installHeaderButton();');
assert.ok(boundary > 0, 'UI/bootstrap boundary must exist');
const instrumented = source.slice(0, boundary) + '\nwindow.fixtureApi = { installIconSpritePruner, autoExpandPRComments, cancel: () => cancelPRExpansion(), stats, settings }; })();';
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/source.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(instrumented); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><title>GitCode memory fixture</title><script src="/source.js"></script><body></body>'); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const tempRoot = path.resolve(os.tmpdir());
const profile = await fs.mkdtemp(path.join(tempRoot, 'gitcode-enhance-memory-'));
const browser = spawn(executable, ['--headless=new', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
browser.stderr.resume();
let socket, browserExited = false, sequence = 0;
browser.once('exit', () => { browserExited = true; });
const pending = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function send(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  let endpoint;
  for (let i = 0; i < 100 && !endpoint; i++) {
    if (browserExited) throw new Error('Owned browser exited before startup');
    try { const [port, resource] = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); endpoint = `ws://127.0.0.1:${port}${resource}`; } catch { await sleep(100); }
  }
  assert.ok(endpoint, 'Owned browser must expose DevTools');
  socket = new WebSocket(endpoint); await once(socket, 'open');
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error))); else waiter.resolve(message.result);
  });
  const version = await send('Browser.getVersion');
  const { targetId } = await send('Target.createTarget', { url: origin + '/org/repo/pull/1/discuss' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  for (let i = 0; i < 100 && !await evaluate('!!window.fixtureApi'); i++) await sleep(50);
  assert.equal(await evaluate('!!window.fixtureApi'), true);
  async function memory() {
    // Different protocol jobs plus GC: do not keep WeakRef.deref() targets alive.
    await sleep(50);
    await send('HeapProfiler.collectGarbage', {}, sessionId);
    await send('HeapProfiler.collectGarbage', {}, sessionId);
    return { heap: await send('Runtime.getHeapUsage', {}, sessionId), dom: await send('Memory.getDOMCounters', {}, sessionId) };
  }
  const empty = await memory();
  const built = await evaluate(`(()=>{
    const NS='http://www.w3.org/2000/svg', svg=document.createElementNS(NS,'svg');svg.id='fixture-sprite';svg.setAttribute('style','position:absolute;width:0;height:0;overflow:hidden');
    const symbols=[];for(let i=0;i<1600;i++){const symbol=document.createElementNS(NS,'symbol');symbol.id='icon-'+i;symbol.setAttribute('viewBox','0 0 24 24');
      for(let j=0;j<2;j++){const p=document.createElementNS(NS,'path');p.setAttribute('d','M0 0L20 0L20 20L0 20Z '.repeat(16));p.setAttribute('fill',j?'currentColor':'#168a60');symbol.appendChild(p);}svg.appendChild(symbol);symbols.push(symbol);}
    document.body.appendChild(svg);window.fixtureWeak=symbols.map(n=>new WeakRef(n));window.fixtureRootWeak=new WeakRef(svg);
    window.fixtureExpected=symbols.slice(0,200).map(n=>n.outerHTML);return {symbols:symbols.length,nodes:svg.querySelectorAll('*').length,markupChars:svg.outerHTML.length};})()`);
  const before = await memory();
  const pruneMs = await evaluate('(()=>{const start=performance.now();fixtureApi.installIconSpritePruner();return performance.now()-start})()');
  const pruned = await memory();
  const retainedOriginalSymbols = await evaluate('fixtureWeak.filter(ref=>ref.deref()).length');
  const restore = await evaluate(`(async()=>{const start=performance.now();const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='fixture-uses';
    for(let i=0;i<200;i++){const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href','#icon-'+i);svg.appendChild(use);}document.body.appendChild(svg);
    await new Promise(r=>setTimeout(r,0));return {ms:performance.now()-start,exact:fixtureExpected.every((s,i)=>document.getElementById('icon-'+i)?.outerHTML===s),width:svg.getBBox().width,restored:fixtureApi.stats.spriteRestored};})()`);
  assert.equal(restore.exact, true, 'SVG markup and namespaces must round-trip');
  assert.ok(restore.width > 0, 'Restored SVG references must render geometry');
  assert.equal(restore.restored, 200, 'Each referenced symbol restored once');
  const restored = await memory();
  await evaluate("document.getElementById('fixture-sprite').remove();document.getElementById('fixture-uses').remove();fixtureExpected=null");
  const removed = await memory();
  const retainedRemovedRoot = await evaluate('!!fixtureRootWeak.deref()');
  const fallback = await evaluate(`(async()=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href','#icon-201');svg.appendChild(use);document.body.appendChild(svg);await new Promise(r=>setTimeout(r,0));return {connected:!!document.getElementById('icon-201'),width:svg.getBBox().width};})()`);
  const expansion = await evaluate(`(async()=>{fixtureApi.cancel();document.body.replaceChildren();document.body.style.height='7000px';scrollTo(0,0);fixtureApi.settings.pr.expandMode='nearby';
    const clicks={near:0,far:0,afterCancel:0};function button(name,top){const b=document.createElement('button');b.className='collapse-btn__more';b.textContent='更多';b.style.cssText='position:absolute;left:20px;top:'+top+'px';b.onclick=()=>clicks[name]++;document.body.appendChild(b);return b;}
    button('near',80);button('far',6000);fixtureApi.autoExpandPRComments();await new Promise(r=>setTimeout(r,1200));const first={...clicks};
    scrollTo(0,5800);await new Promise(r=>setTimeout(r,650));const scrolled={...clicks};fixtureApi.cancel();button('afterCancel',6050);await new Promise(r=>setTimeout(r,650));return {first,scrolled,cancelled:{...clicks}};})()`);
  const compatibility = await evaluate(`(async()=>{const NS='http://www.w3.org/2000/svg', XLINK='http://www.w3.org/1999/xlink';
    const svg=document.createElementNS(NS,'svg');svg.style.cssText='position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML='<symbol id="fixture-complex" viewBox="0 0 24 24"><title>A &amp; B &lt; C</title><defs><linearGradient id="fixture-gradient" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="currentColor"/></linearGradient><clipPath id="fixture-clip"><path d="M0 0H24V24H0Z"/></clipPath></defs><path fill="url(#fixture-gradient)" clip-path="url(#fixture-clip)" d="M0 0H24V24H0Z"/></symbol>';
    for(let i=0;i<51;i++){const symbol=document.createElementNS(NS,'symbol');symbol.id='fixture-extra-'+i;symbol.innerHTML='<path d="M0 0H24V24H0Z"/>';svg.appendChild(symbol);}
    const nested=document.createElementNS(NS,'use');nested.setAttributeNS(XLINK,'xlink:href','#fixture-extra-0');svg.firstElementChild.appendChild(nested);
    const expected=svg.firstElementChild.outerHTML;document.body.appendChild(svg);await new Promise(r=>setTimeout(r,0));
    const pruned=!document.getElementById('fixture-complex');const visible=document.createElementNS(NS,'svg'),use=document.createElementNS(NS,'use');
    visible.style.color='rgb(255, 0, 0)';use.setAttributeNS(XLINK,'xlink:href','#fixture-complex');visible.appendChild(use);document.body.appendChild(visible);await new Promise(r=>setTimeout(r,0));
    const restored=document.getElementById('fixture-complex');const exact=restored?.outerHTML===expected, namespaces=restored?.querySelector('use')?.getAttributeNS(XLINK,'href')==='#fixture-extra-0';
    const gradient=restored?.querySelector('linearGradient')?.getAttribute('gradientUnits')==='userSpaceOnUse', width=visible.getBBox().width;
    const firstColor=getComputedStyle(use).color;visible.style.color='rgb(0, 0, 255)';const nextColor=getComputedStyle(use).color;
    use.setAttributeNS(XLINK,'xlink:href','#fixture-extra-1');await new Promise(r=>setTimeout(r,0));const changedNamespacedReference=!!document.getElementById('fixture-extra-1');
    use.setAttribute('href','#fixture-extra-1');await new Promise(r=>setTimeout(r,0));return {pruned,exact,namespaces,gradient,width,firstColor,nextColor,changedNamespacedReference,changedReference:!!document.getElementById('fixture-extra-1')};})()`);
  assert.equal(compatibility.pruned, true);
  assert.equal(compatibility.exact, true);
  assert.equal(compatibility.namespaces, true);
  assert.equal(compatibility.gradient, true);
  assert.ok(compatibility.width > 0);
  assert.equal(compatibility.firstColor, 'rgb(255, 0, 0)');
  assert.equal(compatibility.nextColor, 'rgb(0, 0, 255)');
  assert.equal(compatibility.changedReference, true);
  const result = { context: 'Isolated synthetic SVG and expansion fixture; not real-site or process-total memory', version: version.product, sourcePath, sourceSha256: createHash('sha256').update(source).digest('hex'), built, empty, before, pruned, retainedOriginalSymbols, pruneMs, restore, restored, removed, retainedRemovedRoot, fallback, expansion, compatibility };
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (process.argv.includes('--expect-optimized')) {
    assert.equal(retainedOriginalSymbols, 0, 'Unused original symbol DOM must be collectable');
    assert.equal(retainedRemovedRoot, false, 'Removed sprite root must be collectable');
    assert.equal(fallback.connected, true, 'Cached icon must restore after its old root is removed');
    assert.ok(fallback.width > 0);
    assert.deepEqual(expansion.first, { near: 1, far: 0, afterCancel: 0 });
    assert.deepEqual(expansion.scrolled, { near: 1, far: 1, afterCancel: 0 });
    assert.deepEqual(expansion.cancelled, expansion.scrolled);
  }
} finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} socket.close(); }
  for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Browser stopped')); } pending.clear();
  for (let i = 0; i < 100 && !browserExited; i++) await sleep(50);
  if (!browserExited) browser.kill();
  server.close();
  assert.equal(path.dirname(path.resolve(profile)), tempRoot);
  assert.ok(path.basename(profile).startsWith('gitcode-enhance-memory-'));
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}
