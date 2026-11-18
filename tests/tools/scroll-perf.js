'use strict';
// T52: frame times while scrolling a terminal with the mouse wheel (real CDP wheel events at 60 Hz).
// Usage: node tests/tools/scroll-perf.js [--json]   (about 30 s; run it with nothing else heavy open)
// Cases: 1 pane / 4 panes, small trackpad deltas / 100-px mouse notches, RTL layer on / off.
// Per case: p50 / p95 / max of requestAnimationFrame deltas during the scroll, dropped frames (> 33 ms), long tasks,
// and how far the viewport jumps per frame (a big jump per frame = stepped, not smooth, even when every frame is on time).
const path = require('path');
const { FIXTURES, TMP, sleep, startServer, connect, openPage } = require('../lib/harness');

const WANT_JSON = process.argv.includes('--json');
const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

async function run(cases) {
  const srv = await startServer({ stateFile: path.join(TMP, 'scroll-perf-state.json'), binDir: path.join(FIXTURES, 'bin-heb'), env: { DEMO_COLS: '80', DEMO_FILL: '300' } });
  const keeper = await connect(srv.port);
  for (let i = 0; i < 4; i++) keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'P' + i });
  const page = await openPage(`http://127.0.0.1:${srv.port}/`);
  const { ev } = page;
  await page.waitFor(`document.querySelectorAll('.pane').length >= 4`, 30000);
  await page.waitFor(`import('/js/state.js').then(({ state }) => [...state.panes.values()].every((p) => p.term.buffer.active.baseY > 200))`, 60000);
  await ev(`(() => { window.__lt = 0; try { new PerformanceObserver((l) => { window.__lt += l.getEntries().length; }).observe({ entryTypes: ['longtask'] }); } catch {} return true; })()`);
  const out = [];
  for (const c of cases) {
    await ev(`import('/js/layout.js').then((m) => { m.setExpanded(${c.panes === 1 ? "document.querySelector('.pane').dataset.id" : 'null'}); return true; })`);
    await ev(`document.querySelector('#rtl${c.rtl ? 'On' : 'Off'}').click()`);
    await sleep(800);
    const r = await ev(`(() => { const p = [...document.querySelectorAll('.pane')].find((e) => e.offsetParent !== null); const s = p.querySelector('.xterm-screen').getBoundingClientRect(); return { x: s.left + s.width / 2, y: s.top + s.height / 2, id: p.dataset.id }; })()`);
    await ev(`import('/js/state.js').then(({ state }) => { const t = state.panes.get('${r.id}').term; t.scrollToBottom(); window.__t = t; window.__d = []; window.__j = []; window.__run = true; window.__rs = state.panes.get('${r.id}').rtl ? state.panes.get('${r.id}').rtl.stats : null; if (window.__rs) { window.__rs.n = 0; window.__rs.total = 0; window.__rs.max = 0; } window.__y0 = t.buffer.active.viewportY;
      let last = performance.now(); const tick = (n) => { if (!window.__run) return; window.__d.push(n - last); window.__j.push(t.buffer.active.viewportY); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })`);
    await sleep(200);
    const lt0 = await ev('window.__lt');
    const n = Math.round(c.seconds * 60);
    for (let i = 0; i < n; i++) {
      // פעם למעלה ופעם למטה (בלוקים של 25 אירועים) כדי לא להיתקע בקצה ההיסטוריה
      const up = Math.floor(i / 25) % 2 === 0;
      await page.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: up ? -c.delta : c.delta });
      await sleep(16);
    }
    await sleep(300);
    const res = await ev(`(() => { window.__run = false; return { d: window.__d.slice(5), j: window.__j.slice(5), lt: window.__lt, draws: window.__rs ? { n: window.__rs.n, avg: window.__rs.n ? window.__rs.total / window.__rs.n : 0, max: window.__rs.max } : null }; })()`);
    const steps = res.j.slice(1).map((y, k) => Math.abs(y - res.j[k])).filter((x) => x > 0);
    const jumpMax = Math.max(0, ...steps), jumpAvg = steps.length ? +(steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(1) : 0, movingFrames = steps.length;
    out.push({ name: c.name, p50: +pct(res.d, 0.5).toFixed(1), p95: +pct(res.d, 0.95).toFixed(1), max: +Math.max(...res.d).toFixed(1), dropped: res.d.filter((x) => x > 33).length, frames: res.d.length, longtasks: res.lt - lt0, jumpMax, jumpAvg, movingFrames, drawAvg: res.draws ? +res.draws.avg.toFixed(2) : null, drawMax: res.draws ? +res.draws.max.toFixed(1) : null, draws: res.draws ? res.draws.n : null });
  }
  page.close(); keeper.close(); srv.stop();
  return out;
}

const CASES = [
  { name: '1 pane, trackpad (40px), RTL on', panes: 1, delta: 40, rtl: true, seconds: 2.5 },
  { name: '1 pane, mouse notch (100px), RTL on', panes: 1, delta: 100, rtl: true, seconds: 2.5 },
  { name: '1 pane, trackpad (40px), RTL off', panes: 1, delta: 40, rtl: false, seconds: 2.5 },
  { name: '4 panes, trackpad (40px), RTL on', panes: 4, delta: 40, rtl: true, seconds: 2.5 },
  { name: '4 panes, mouse notch (100px), RTL on', panes: 4, delta: 100, rtl: true, seconds: 2.5 },
];

module.exports = { run, CASES };
if (require.main === module) {
  run(CASES).then((rows) => {
    if (WANT_JSON) console.log(JSON.stringify(rows));
    else {
      console.log('| case | p50 ms | p95 ms | max ms | dropped | longtasks | max lines/frame | avg lines/frame | frames that moved | RTL draws (n / avg ms / max ms) |\n|---|---|---|---|---|---|---|---|---|---|');
      for (const r of rows) console.log(`| ${r.name} | ${r.p50} | ${r.p95} | ${r.max} | ${r.dropped}/${r.frames} | ${r.longtasks} | ${r.jumpMax} | ${r.jumpAvg} | ${r.movingFrames}/${r.frames} | ${r.draws == null ? '-' : r.draws + ' / ' + r.drawAvg + ' / ' + r.drawMax} |`);
    }
    process.exit(0);
  }).catch((e) => { console.error('ERROR', e); process.exit(2); });
}
