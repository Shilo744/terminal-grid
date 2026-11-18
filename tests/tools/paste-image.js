'use strict';
/*
 * מדידת הדבקת תמונה (T45): מרגע אירוע ההדבקה בדפדפן ועד (1) שההעלאה נענתה (השרת כתב את הקובץ ועונה בנתיב) ו-(2) שהנתיב נראה בקלט של התוכנית
 * (claude מדומה שמדפיס [Image #N] כשהוא מקבל הדבקה מסוגרת של נתיב קובץ קיים). המטרה: פחות מ-150ms לתמונה של 2MB, בלי קשר ל-Claude.
 *
 *   node tests/tools/paste-image.js [--mb 2] [--runs 5]
 *
 * המסלול הישן (Alt+V, Claude מפעיל PowerShell וקורא את הלוח) לא נמדד כאן: הוא בתוך Claude Code עצמו, שניות לפי המשתמש.
 */
const path = require('path');
const { FIXTURES, sleep, poll, startServer, connect, openPage } = require('../lib/harness');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const MB = arg('mb', 2), RUNS = arg('runs', 5);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-img') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'cl' });
  await poll(() => keeper.sessions.size === 1, 15000);
  const id = [...keeper.sessions.values()][0].id;
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(1);
  await page.waitFor(`document.querySelector('.pane-startup').hidden`, 15000);
  await sleep(1000);
  const { ev } = page;
  await ev(`(() => { window.__blob = new Uint8Array(${MB} * 1024 * 1024); crypto.getRandomValues(window.__blob.subarray(0, 65536)); const orig = window.fetch.bind(window); window.fetch = async (...a) => { const r = await orig(...a); if (String(a[0]).includes('/api/paste-image')) window.__upDone = performance.now(); return r; }; return true; })()`);
  const up = [], seen = [];
  for (let i = 1; i <= RUNS; i++) {
    const res = await ev(`(async () => {
      const { state } = await import('/js/state.js'); const p = state.panes.get('${id}');
      const screen = () => { const b = p.term.buffer.active; let t = ''; for (let y = 0; y < b.length; y++) { const l = b.getLine(y); if (l) t += l.translateToString(true); } return t; };
      const dt = new DataTransfer(); dt.items.add(new File([window.__blob], 'shot.png', { type: 'image/png' }));
      const host = document.querySelector('.pane[data-id="${id}"] .term-host');
      const t0 = performance.now(); window.__upDone = 0;
      host.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      while (!screen().includes('[Image #${i}]') && performance.now() - t0 < 10000) await new Promise((r) => requestAnimationFrame(r));
      return { upload: Math.round(window.__upDone - t0), visible: Math.round(performance.now() - t0) };
    })()`);
    up.push(res.upload); seen.push(res.visible);
    await sleep(300);
  }
  console.log(`\nImage paste, ${MB} MB, ${RUNS} runs (ms from the paste event):`);
  console.log(`  upload answered (file written, path returned): ${up.join(', ')}  -> median ${med(up)}`);
  console.log(`  path visible in the program input ("[Image #N]" printed): ${seen.join(', ')}  -> median ${med(seen)}`);
  console.log(med(seen) < 150 ? '  target (< 150 ms): MET' : '  target (< 150 ms): NOT met on this machine / load');
  page.close(); keeper.close(); srv.stop();
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
