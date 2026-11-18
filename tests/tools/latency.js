'use strict';
/*
 * מדידת חביון הקלדה תחת עומס (T26): N טרמינלים רועשים (tests/fixtures/flood.js, כמה MB לשנייה בסך הכול) וטרמינל "echo" שמחזיר כל תו מיד.
 * כותבים תווים אמיתיים (CDP Input.dispatchKeyEvent) לטרמינל ה-echo וקוראים בעמוד: זמן מ-keydown עד שהתו מופיע ב-DOM של הטרמינל,
 * משימות ארוכות (PerformanceObserver longtask) ברשת הלקוח, והשהיית לולאת האירועים בשרת (/api/health).
 *
 *   node tests/tools/latency.js [--noisy 8] [--keys 60] [--label name]      מדפיס טבלה ו-JSON; --label שומר ב-tests/.tmp/latency-<label>.json
 *
 * חשוב: המחשב רועש (תוכנות אחרות משתמשות ב-50-90% מה-CPU), אז משווים לפני/אחרי באותם תנאים ומסתכלים גם על הפיזור (p50 מול p99).
 */
const path = require('path');
const fs = require('fs');
const { TMP, FIXTURES, sleep, poll, startServer, connect, getJson, openPage } = require('../lib/harness');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : process.argv[i + 1]; };
const NOISY = Number(arg('noisy', 8));
const KEYS = Number(arg('keys', 60));
const LABEL = arg('label', '');
// js = ממקדים את ה-textarea בלבד (הגדרה ברירת מחדל, כמו במדידות ה"לפני"); click = pointerdown על הפאן כמו לחיצה אמיתית: האפליקציה מגדילה אותו כשיש יותר מ-4 טרמינלים (תצוגת אריחים), וזה עולה יותר
const FOCUS = arg('focus', 'js');

const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const r1 = (n) => Math.round(n * 10) / 10;

(async () => {
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-flood') });
  const keeper = await connect(srv.port);
  const work = path.join(TMP, 'latency-work');
  const dir = (n) => { const d = path.join(work, n); fs.mkdirSync(d, { recursive: true }); return d; };
  for (let i = 1; i <= NOISY; i++) { keeper.send({ t: 'create', kind: 'claude', cwd: dir('noise' + i), name: 'noise' + i }); await sleep(150); }
  keeper.send({ t: 'create', kind: 'claude', cwd: dir('echo'), name: 'echo' });
  await poll(() => keeper.sessions.size === NOISY + 1, 30000);
  const echoId = [...keeper.sessions.values()].find((s) => s.name === 'echo').id;

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1920, height: 1080 });
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__lat = { down: [], echo: [], long: [] };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lat.long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
    document.addEventListener('keydown', (e) => { if (e.isTrusted && e.key === 'Q') window.__lat.down.push(performance.now()); }, true);
    window.__watch = (id) => {
      const rows = document.querySelector('.pane[data-id="' + id + '"] .xterm-rows'); let count = 0;
      new MutationObserver(() => { const c = (rows.textContent.match(/Q/g) || []).length; while (count < c) { count++; window.__lat.echo.push(performance.now()); } }).observe(rows, { childList: true, subtree: true, characterData: true });
    };` });
  await page.call('Page.reload');
  await page.appReady(NOISY + 1);
  await page.waitFor(`document.querySelector('.pane[data-id="${echoId}"] .xterm-rows') && document.querySelector('.pane[data-id="${echoId}"] .xterm-rows').textContent.includes('ECHO')`, 30000);
  await sleep(3000); // כל הרעשנים כבר זורמים
  await page.ev(`window.__lat.down.length = 0; window.__lat.echo.length = 0; window.__lat.long.length = 0; window.__watch('${echoId}'); ${FOCUS === 'click' ? "document.querySelector('.pane[data-id=\"" + echoId + "\"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));" : "document.querySelector('.pane[data-id=\"" + echoId + "\"] textarea').focus();"} true`);
  await getJson(`http://127.0.0.1:${srv.port}/api/health?reset=1`);

  for (let i = 0; i < KEYS; i++) {
    await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Q', code: 'KeyQ', text: 'Q', windowsVirtualKeyCode: 81 });
    await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Q', code: 'KeyQ', windowsVirtualKeyCode: 81 });
    await sleep(120);
  }
  await sleep(1500);
  const lat = await page.ev(`JSON.stringify(window.__lat)`).then(JSON.parse);
  const health = await getJson(`http://127.0.0.1:${srv.port}/api/health`);
  const n = Math.min(lat.down.length, lat.echo.length);
  const lats = []; for (let i = 0; i < n; i++) lats.push(lat.echo[i] - lat.down[i]);
  const res = {
    label: LABEL, noisy: NOISY, keysSent: KEYS, echoed: lat.echo.length,
    echoMs: { p50: r1(pct(lats, 50)), p95: r1(pct(lats, 95)), p99: r1(pct(lats, 99)), max: r1(Math.max(0, ...lats)) },
    clientLongTasks: { count: lat.long.length, totalMs: Math.round(lat.long.reduce((a, b) => a + b, 0)), maxMs: Math.round(Math.max(0, ...lat.long)) },
    serverLoopDelayMs: health.loopDelayMs, serverBlocked: health.blocked, serverRssMB: health.rssMB,
  };
  console.log(JSON.stringify(res, null, 2));
  if (LABEL) fs.writeFileSync(path.join(TMP, `latency-${LABEL}.json`), JSON.stringify(res, null, 2));
  page.close(); keeper.close(); srv.stop();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
