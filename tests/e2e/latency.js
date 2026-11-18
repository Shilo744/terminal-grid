'use strict';
// Typing under load (T26, light version of tests/tools/latency.js): 4 noisy terminals + one echo terminal, 25 real keystrokes.
// Every key must echo, in order, and the latency must stay in a sane range even on a loaded machine; the server loop must not stall.
const path = require('path');
const fs = require('fs');
const { TMP, FIXTURES, sleep, poll, checker, startServer, connect, getJson, openPage } = require('../lib/harness');

(async () => {
  const t = checker('typing latency under load (light)');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-flood') });
  const keeper = await connect(srv.port);
  const dir = (n) => { const d = path.join(TMP, 'latency-e2e', n); fs.mkdirSync(d, { recursive: true }); return d; };
  for (let i = 1; i <= 4; i++) { keeper.send({ t: 'create', kind: 'claude', cwd: dir('noise' + i), name: 'noise' + i }); await sleep(150); }
  keeper.send({ t: 'create', kind: 'claude', cwd: dir('echo'), name: 'echo' });
  await poll(() => keeper.sessions.size === 5, 30000);
  const echoId = [...keeper.sessions.values()].find((s) => s.name === 'echo').id;

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1600, height: 900 });
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__d = []; window.__e = [];
    document.addEventListener('keydown', (e) => { if (e.isTrusted && e.key === 'Q') window.__d.push(performance.now()); }, true);
    window.__watch = (id) => { const rows = document.querySelector('.pane[data-id="' + id + '"] .xterm-rows'); let n = 0;
      new MutationObserver(() => { const c = (rows.textContent.match(/Q/g) || []).length; while (n < c) { n++; window.__e.push(performance.now()); } }).observe(rows, { childList: true, subtree: true, characterData: true }); };` });
  await page.reload();
  await page.appReady(5);
  await page.waitFor(`document.querySelector('.pane[data-id="${echoId}"] .xterm-rows') && document.querySelector('.pane[data-id="${echoId}"] .xterm-rows').textContent.includes('ECHO')`, 30000);
  await sleep(1500);
  await page.ev(`window.__d.length = 0; window.__e.length = 0; window.__watch('${echoId}'); document.querySelector('.pane[data-id="${echoId}"] textarea').focus(); true`);
  await getJson(`http://127.0.0.1:${srv.port}/api/health?reset=1`);
  for (let i = 0; i < 25; i++) {
    await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Q', code: 'KeyQ', text: 'Q', windowsVirtualKeyCode: 81 });
    await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Q', code: 'KeyQ', windowsVirtualKeyCode: 81 });
    await sleep(100);
  }
  await page.waitFor(`window.__e.length >= 25`, 15000);
  const [d, e] = JSON.parse(await page.ev(`JSON.stringify([window.__d, window.__e])`));
  const lats = d.map((x, i) => e[i] - x).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const p95 = lats[Math.floor(lats.length * 0.95)];
  t.check('all 25 keystrokes were echoed', e.length >= 25 && d.length === 25, `${d.length} keys, ${e.length} echoes`);
  t.check('echoes arrive in order (each after its key)', lats.length === 25 && lats[0] >= 0);
  t.check('p95 echo latency under load stays below 800ms (generous: the box is shared)', p95 < 800, `p95 ${Math.round(p95)}ms, p50 ${Math.round(lats[12])}ms`);
  const h = await getJson(`http://127.0.0.1:${srv.port}/api/health`);
  t.check('the server event loop did not stall (no block over 1s)', h.blocked.worstMs < 1000, JSON.stringify(h.blocked));
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
