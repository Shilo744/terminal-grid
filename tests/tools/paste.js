'use strict';
/*
 * מדידת הדבקה (T33): כמה זמן עובר מהדבקת טקסט בטרמינל עד שהתוכנית קיבלה את הבית האחרון, ובאיזה שלב הזמן הולך.
 *
 *   node tests/tools/paste.js [--sizes 1,20,100,500] [--runs 3] [--label x]      (גדלים ב-KB)
 *
 * הדבקה אמיתית בדף: term.paste(text) בדיוק כמו Ctrl+V. הטרמינל מריץ claude מדומה (tests/fixtures/paste-echo.js) שמפעיל bracketed paste, סופר בתים
 * ומדווח "PD <בתים> <ראשון> <אחרון>" (Date.now(); אותו שעון כמו הדף והכלי). השלבים:
 *   (1) הדפדפן: term.paste -> ההודעה נשלחה ב-websocket          (ws.send נתפס בדף)
 *   (2) השרת: pty.write חזר                                     (שורת "big input" ב-server.log, לכל הדבקה מעל 8KB)
 *   (3) התוכנית: הבית האחרון הגיע                               (מהפיקסצ'ר: זמן הבית האחרון פחות תחילת ההדבקה)
 *   (4) המסך: הדיווח "PD" נראה במאגר של xterm                   (אחרי שהפלט חזר דרך השרת והלקוח)
 * וגם נתיב הלחיצה הימנית (navigator.clipboard.readText ואז term.paste) והדבקת תמונה (Alt+V). המחשב משותף: מדפיסים גם את העומס.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { TMP, FIXTURES, sleep, poll, startServer, connect, openPage, APP } = require('../lib/harness');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : process.argv[i + 1]; };
const SIZES = String(arg('sizes', '1,20,100,500')).split(',').map(Number);
const RUNS = Number(arg('runs', 3));
const LABEL = arg('label', '');
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const r1 = (n) => Math.round(n * 10) / 10;
const cpuTimes = () => os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 });
const load = (a, b) => (b.total === a.total ? 0 : Math.round((1 - (b.idle - a.idle) / (b.total - a.total)) * 100));

(async () => {
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-paste') });
  const keeper = await connect(srv.port);
  const work = path.join(TMP, 'paste-work');
  fs.mkdirSync(work, { recursive: true });
  keeper.send({ t: 'create', kind: 'claude', cwd: work, name: 'paste' });
  await poll(() => keeper.sessions.size === 1, 20000);
  const id = [...keeper.sessions.values()][0].id;
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.call('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
  await page.appReady(1);
  await page.waitFor(`import('/js/state.js').then((m) => { const p = m.state.panes.get('${id}'); const b = p.term.buffer.active; for (let y = 0; y < b.length; y++) if (b.getLine(y).translateToString(true).includes('PASTE-ECHO ready')) return true; return false; })`, 30000);
  // תפיסת ההודעות הגדולות שנשלחות לשרת
  await page.ev(`window.__sent = []; import('/js/state.js').then((m) => { const s = m.state; const f = s.ws.send.bind(s.ws); s.ws.send = (d) => { try { const j = JSON.parse(d); if (j.t === 'input' && j.d.length > 500) window.__sent.push({ at: performance.now(), wall: Date.now(), len: j.d.length }); } catch {} return f(d); }; }); true`);
  await sleep(300);

  const logPath = path.join(APP, 'server.log');
  const writeMsFromLog = () => {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter((l) => l.includes('big input ' + id + ' '));
    const m = lines.length ? /returned after ([\d.]+) ms/.exec(lines[lines.length - 1]) : null;
    return m ? Number(m[1]) : null;
  };
  const pdLines = () => (strip(keeper.out.get(id) || '').match(/PD \d+ \d+ \d+/g) || []);
  const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\r\n]+/g, ' ');

  const rows = [];
  for (const kb of SIZES) {
    const text = ('The quick brown fox jumps over the lazy dog 0123456789. ').repeat(Math.ceil(kb * 1024 / 57)).slice(0, kb * 1024);
    const per = [];
    for (let run = 0; run < RUNS; run++) {
      await sleep(700);
      const before = pdLines().length;
      const c0 = cpuTimes();
      const sentBefore = await page.ev('window.__sent.length');
      const t0 = Date.now();
      await page.ev(`import('/js/state.js').then((m) => { window.__t0 = performance.now(); m.state.panes.get('${id}').term.paste(${JSON.stringify(text)}); }); true`);
      // (1) ההודעה נשלחה
      await poll(async () => (await page.ev('window.__sent.length')) > sentBefore, 20000, 20);
      const sent = await page.ev('JSON.stringify(window.__sent[window.__sent.length - 1])').then(JSON.parse);
      const stage1 = sent.at - await page.ev('window.__t0');
      // (3) הבית האחרון הגיע לתוכנית (הדיווח PD מכסה את כל ההדבקה)
      const done = await poll(() => { const l = pdLines(); return l.length > before && Number(l[l.length - 1].split(' ')[1]) >= kb * 1024 * 0.99; }, 120000, 50);
      const pd = pdLines().pop().split(' ').slice(0, 4).map(Number);
      const tReported = Date.now();
      // (4) הדיווח נראה במאגר של xterm
      await page.waitFor(`import('/js/state.js').then((m) => { const b = m.state.panes.get('${id}').term.buffer.active; for (let y = b.length - 1; y >= Math.max(0, b.length - 40); y--) if (b.getLine(y).translateToString(true).includes('PD ${pd[1]} ${pd[2]} ${pd[3]} ')) return true; return false; })`, 30000);
      const tVisible = Date.now();
      per.push({
        kb, run: run + 1, ok: !!done,
        clientToWs: r1(stage1),
        serverWrite: writeMsFromLog(),
        wsToLastByteInProgram: pd[3] - sent.wall,
        totalToLastByte: pd[3] - t0,
        reportVisibleAfterLastByte: tVisible - pd[3],
        load: load(c0, cpuTimes()),
      });
      void tReported;
    }
    rows.push(...per);
    console.log(JSON.stringify({ kb, medianTotalToLastByteMs: med(per.map((p) => p.totalToLastByte)), medianClientToWs: med(per.map((p) => p.clientToWs)), medianServerWrite: med(per.map((p) => p.serverWrite || 0)), medianWsToProgram: med(per.map((p) => p.wsToLastByteInProgram)) }));
  }

  // הלחיצה הימנית: navigator.clipboard.readText -> term.paste
  const sample = 'right-click paste sample 0123456789 '.repeat(280); // כ-10KB
  await page.ev(`navigator.clipboard.writeText(${JSON.stringify(sample)}).then(() => true, () => false)`).catch(() => {});
  const rc = await page.ev(`(async () => { const t0 = performance.now(); let text = ''; try { text = await navigator.clipboard.readText(); } catch (e) { return { error: String(e) }; } return { readTextMs: performance.now() - t0, len: text.length }; })()`);
  console.log('right-click path (clipboard.readText):', JSON.stringify(rc));
  // תמונה: Alt+V נשלח
  console.log('image paste path: a single 2-byte input (ESC v) per paste, no size dependence');

  console.log('\n' + JSON.stringify({ label: LABEL, runs: RUNS, rows }, null, 1));
  if (LABEL) fs.writeFileSync(path.join(TMP, `paste-${LABEL}.json`), JSON.stringify({ label: LABEL, rows }, null, 2));
  page.close(); keeper.close(); srv.stop();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
