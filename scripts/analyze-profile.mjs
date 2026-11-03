// Offline Chromium trace analysis; no browser connection or page mutation.
import fs from 'node:fs';
import path from 'node:path';

const round = n => Math.round(n * 100) / 100;
const rank = map => [...map].map(([name, ms]) => ({ name, ms: round(ms) })).sort((a, b) => b.ms - a.ms);
function category(frame = {}) {
  const url = frame.url || '';
  if (/userscript\.html.*GitCode-Enhance/.test(url)) return 'userscript';
  if (url.startsWith('chrome-extension:')) return 'extension';
  if (/gitcode\.com/.test(url)) return 'site';
  if (url.startsWith('http')) return 'third-party';
  if (/idle|program|garbage collector|root/.test(frame.functionName || '')) return frame.functionName;
  return 'native-or-anonymous';
}
const add = (map, key, value) => map.set(key, (map.get(key) || 0) + value);
const windowArg = process.argv.find(arg => arg.startsWith('--window-ms='));
const windowMs = windowArg ? Number(windowArg.split('=')[1]) : null;
function analyze(events) {
  const rootCommits = events.filter(e => e.name === 'CommitLoad' && e.args?.data?.isOutermostMainFrame);
  if (windowMs !== null && (!Number.isFinite(windowMs) || windowMs <= 0 || !rootCommits.length)) throw new Error('Positive window and root CommitLoad required');
  const startUs = windowMs === null ? -Infinity : rootCommits.at(-1).ts;
  const endUs = windowMs === null ? Infinity : startUs + windowMs * 1000;
  const rootThreads = new Set(rootCommits.map(e => `${e.pid}:${e.tid}`));
  const mainThreads = rootThreads.size ? rootThreads : new Set(events.filter(e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map(e => `${e.pid}:${e.tid}`));
  const main = events.filter(e => mainThreads.has(`${e.pid}:${e.tid}`));
  const durations = new Map(), callbacks = new Map();
  for (const e of main) {
    if (e.ph !== 'X' || !e.dur) continue;
    const duration = Math.max(0, Math.min(e.ts + e.dur, endUs) - Math.max(e.ts, startUs)) / 1000;
    if (!duration) continue;
    add(durations, e.name, duration);
    if (e.name === 'FunctionCall') {
      const d = e.args?.data || {};
      add(callbacks, `${d.functionName || '(anonymous)'} ${d.url || ''}:${d.lineNumber || 0}`, duration);
    }
  }
  // ProfileChunk is emitted by a profiler thread, not the sampled thread.
  // Correlate by process + profile ID; use Profile to locate the actual thread.
  const profiles = new Map();
  for (const e of events) if (e.name === 'Profile' && mainThreads.has(`${e.pid}:${e.tid}`)) {
    profiles.set(`${e.pid}:${e.id}`, { nodes: new Map(), samples: [], deltas: [], time: e.args.data.startTime });
  }
  for (const e of events) if (e.name === 'ProfileChunk') {
    const p = profiles.get(`${e.pid}:${e.id}`), data = e.args?.data;
    if (!p || !data) continue;
    for (const n of data.cpuProfile?.nodes || []) p.nodes.set(n.id, n);
    p.samples.push(...(data.cpuProfile?.samples || []));
    p.deltas.push(...(data.timeDeltas || []));
  }
  const self = new Map(), attribution = new Map(), functions = new Map();
  let samples = 0, missingNodes = 0, sampledMs = 0;
  for (const p of profiles.values()) {
    let timestamp = p.time, previous = p.time;
    // V8 can deliver samples out of time order (negative timeDeltas).
    // Sort reconstructed timestamps so those intervals are not double-counted.
    const timed = p.samples.map((id, i) => ({ id, time: timestamp += p.deltas[i] || 0 })).sort((a, b) => a.time - b.time);
    for (const { id, time } of timed) {
      const before = previous;
      previous = time;
      const ms = Math.max(0, Math.min(time, endUs) - Math.max(before, startUs)) / 1000;
      if (!ms) continue;
      let node = p.nodes.get(id);
      if (!node) { missingNodes++; continue; }
      sampledMs += ms; samples++;
      const f = node.callFrame || {};
      add(self, category(f), ms);
      add(functions, `${f.functionName || '(anonymous)'} ${f.url || ''}:${(f.lineNumber ?? -1) + 1}`, ms);
      // Nearest identifiable script ancestor attributes native work to its caller.
      let owner = category(f), hops = 0;
      while (node && hops++ < 1000) {
        const c = category(node.callFrame);
        if (['userscript', 'site', 'third-party', 'extension'].includes(c)) { owner = c; break; }
        node = p.nodes.get(node.parent);
      }
      add(attribution, owner, ms);
    }
  }
  const requests = new Map();
  for (const e of main) {
    if (e.ts < startUs || e.ts > endUs) continue;
    const d = e.args?.data;
    if (!d?.requestId) continue;
    if (e.name === 'ResourceSendRequest') {
      let url = d.url;
      try { const u = new URL(url); url = u.origin + u.pathname; } catch {}
      requests.set(d.requestId, { url, startUs: e.ts, method: d.requestMethod });
    }
    const request = requests.get(d.requestId);
    if (!request) continue;
    if (e.name === 'ResourceReceiveResponse') { request.responseMs = round((e.ts - request.startUs) / 1000); request.status = d.statusCode; request.fromCache = d.fromCache; }
    if (e.name === 'ResourceFinish') { request.durationMs = round((e.ts - request.startUs) / 1000); request.encodedBytes = d.encodedDataLength; request.failed = d.didFail; }
  }
  return { mainThreads: [...mainThreads], windowMs, rootUrls: rootCommits.map(e => e.args.data.url), events: events.length, samples, missingNodes, sampledMs: round(sampledMs),
    network: [...requests.values()].map(({ startUs, ...r }) => r).sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0)),
    sampleSelfMs: rank(self), sampleAttributionMs: rank(attribution), topSampleFunctions: rank(functions).slice(0, 25),
    // Inclusive event durations overlap across event names: do NOT add rows.
    inclusiveEventMs: rank(durations).slice(0, 25), topCallbacks: rank(callbacks).slice(0, 25),
    userscriptCallbacks: rank(callbacks).filter(e => /userscript\.html.*GitCode-Enhance/.test(e.name)) };
}

for (const file of process.argv.slice(2).filter(arg => !arg.startsWith('--'))) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = analyze(data.traceEvents);
  const out = file.replace(/-trace\.json$/, windowMs === null ? '-analysis.json' : `-${windowMs}ms-analysis.json`);
  if (out === file) throw new Error('Input must end in -trace.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ file: path.basename(file), samples: result.samples,
    attribution: result.sampleAttributionMs, events: result.inclusiveEventMs.slice(0, 7),
    userscriptCallbacks: result.userscriptCallbacks.slice(0, 5) }));
}
