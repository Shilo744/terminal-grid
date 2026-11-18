'use strict';
/*
 * השוואת "אפס שינוי" בין שתי גרסאות של הממשק (למשל לפני ואחרי פיצול למודולים).
 *
 *   node tests/tools/dump-dom.js dump <תיקיית-אפליקציה> <out.json>   מריץ את האפליקציה בדפדפן ושומר:
 *        לכל אלמנט בדף: תגית, מזהה, מחלקות, תכונות, טקסט, וכל ה-computed style (חוץ מתוכן xterm/canvas)
 *        וגם שגיאות קונסול, חריגות לא תפוסות ובקשות שנכשלו.
 *   node tests/tools/dump-dom.js compare <a.json> <b.json>          מדפיס הבדלים (יציאה 1 אם יש)
 *
 * הדף נבדק עם תפריט הצד פתוח, שני טרמינלים (Claude מזויף + PowerShell), וכל החלונות הקופצים והמסכים הנסתרים
 * (תיקייה, ייבוא, מסך ריק, באנר, הודעות) מוצגים בכוח כדי שגם הם ייבדקו. אנימציות מושבתות כדי שהערכים יהיו יציבים.
 *
 * הערה: הכלי מתחבר ל-Chrome ישירות (CDP) ולא דרך harness.openPage, כי הוא צריך גם את אירועי הקונסול והרשת.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { TMP, FIXTURES, WS, CHROME, sleep, freePort, startServer, connect, getJson, tracker } = require('../lib/harness');
const { installExternalGuard } = require('../lib/external-guard');

const [mode, a, b] = process.argv.slice(2);

async function dump(appDir, out) {
  const stateFile = path.join(TMP, 'dump-state.json');
  try { fs.unlinkSync(stateFile); } catch { /* אין */ }
  const srv = await startServer({ cwd: path.resolve(appDir), stateFile, binDir: path.join(FIXTURES, 'bin-heb') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'Claude' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'PS' });
  await sleep(2500);

  const debugPort = await freePort();
  const profile = path.join(TMP, 'chrome-profile-dump');
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1500,900',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  tracker.record(chrome.pid, 'chrome.exe', 'dump-dom chrome'); // T58: נסגר בסוף גם אם הכלי נעצר באמצע
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await getJson(`http://127.0.0.1:${debugPort}/json`)).find((t) => t.type === 'page'); } catch { /* עדיין לא */ } }
  const ws = new WS(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.once('open', r));
  let seq = 0; const pending = new Map(); const problems = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) problems.push('console.' + m.params.type + ': ' + m.params.args.map((x) => x.value || x.description || '').join(' ').slice(0, 300));
    if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level) && !/GL Driver Message/.test(m.params.entry.text)) problems.push('log.' + m.params.entry.level + ': ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    if (m.method === 'Network.loadingFailed') problems.push('request failed: ' + (m.params.errorText || ''));
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) problems.push('HTTP ' + m.params.response.status + ' ' + m.params.response.url);
  });
  const call = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
  await call('Page.enable'); await call('Runtime.enable'); await call('Log.enable'); await call('Network.enable');
  await installExternalGuard(call); // T50: גם כאן הדפדפן לא יכול להפעיל תוכנה חיצונית
  await call('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `http://127.0.0.1:${srv.port}/` });
  await sleep(6000);
  await ev(`document.querySelector('#sideBtn').click()`);
  await sleep(5000); // היסטוריה + בדיקת "רצה בחוץ"

  // מציגים בכוח את כל מה שנסתר, ומשביתים אנימציות
  await ev(`(() => {
    const st = document.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(st);
    for (const id of ['folderPop', 'adoptPop', 'empty', 'offline']) { const e = document.getElementById(id); if (e) e.hidden = false; }
    document.getElementById('toasts').innerHTML = '<div class="toast">info</div><div class="toast error">error</div>';
    const g = document.createElement('div'); g.className = 'gone'; g.innerHTML = '<div><h1>x</h1><p>y</p></div>'; g.id = '__gone_probe'; g.style.position = 'static'; document.body.appendChild(g);
  })()`);
  await sleep(500);

  const data = await ev(`(() => {
    const skip = (e) => e.closest('.xterm') || e.closest('.tg-rtl') || e.tagName === 'CANVAS' || e.tagName === 'SCRIPT' || e.tagName === 'STYLE' || e.tagName === 'LINK' || e.tagName === 'NOSCRIPT';
    const out = [];
    const walk = (el, path) => {
      // האינדקס נספר רק על אלמנטים שנמדדים (תגיות script/link לא נספרות), כדי ששינוי בתגיות הטעינה לא יזיז נתיבים
      let i = -1;
      [...el.children].forEach((c) => {
        if (skip(c)) return;
        i++;
        const p = path + '/' + c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') + '[' + i + ']';
        const cs = getComputedStyle(c); const style = {};
        for (let k = 0; k < cs.length; k++) { const n = cs.item(k); style[n] = cs.getPropertyValue(n); }
        const attrs = {}; for (const a of c.attributes) if (a.name !== 'style') attrs[a.name] = a.value;
        const own = [...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('|');
        const timey = c.classList.contains('ses-time') || c.id === 'summary';
        out.push({ p, cls: c.className && c.className.baseVal === undefined ? c.className : '', attrs, text: timey ? '' : own.slice(0, 120), inline: c.getAttribute('style') || '', style });
        walk(c, p);
      });
    };
    walk(document.body, 'body');
    return { count: out.length, title: document.title, lang: document.documentElement.lang, dir: document.documentElement.dir, elements: out };
  })()`);

  data.problems = problems;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data));
  console.log(`dumped ${data.count} elements, ${problems.length} problems -> ${path.resolve(out)}`);
  for (const p of problems) console.log('  PROBLEM', p);
  ws.close(); tracker.killTree(chrome.pid); tracker.forget(chrome.pid); keeper.close(); srv.stop();
  process.exit(problems.length ? 3 : 0);
}

function compare(fa, fb) {
  const A = JSON.parse(fs.readFileSync(fa, 'utf8')), B = JSON.parse(fs.readFileSync(fb, 'utf8'));
  let diffs = 0; const say = (s) => { if (diffs++ < 60) console.log('DIFF ' + s); };
  if (A.count !== B.count) say(`element count ${A.count} vs ${B.count}`);
  for (const k of ['title', 'lang', 'dir']) if (A[k] !== B[k]) say(`${k}: ${JSON.stringify(A[k])} vs ${JSON.stringify(B[k])}`);
  const byPath = new Map(B.elements.map((e) => [e.p, e]));
  let compared = 0, props = 0;
  for (const ea of A.elements) {
    const eb = byPath.get(ea.p);
    if (!eb) { say('missing in B: ' + ea.p); continue; }
    compared++;
    if (ea.cls !== eb.cls) say(`${ea.p} class "${ea.cls}" vs "${eb.cls}"`);
    if (ea.text !== eb.text) say(`${ea.p} text ${JSON.stringify(ea.text)} vs ${JSON.stringify(eb.text)}`);
    if (ea.inline !== eb.inline) say(`${ea.p} inline style "${ea.inline}" vs "${eb.inline}"`);
    if (JSON.stringify(ea.attrs) !== JSON.stringify(eb.attrs)) say(`${ea.p} attrs ${JSON.stringify(ea.attrs)} vs ${JSON.stringify(eb.attrs)}`);
    for (const n of new Set([...Object.keys(ea.style), ...Object.keys(eb.style)])) {
      props++;
      if (ea.style[n] !== eb.style[n]) say(`${ea.p} style ${n}: ${ea.style[n]} vs ${eb.style[n]}`);
    }
  }
  for (const eb of B.elements) if (!A.elements.some((e) => e.p === eb.p)) say('extra in B: ' + eb.p);
  console.log(`${compared} elements, ${props} style values compared; ${diffs} differences`);
  process.exit(diffs ? 1 : 0);
}

(async () => {
  if (mode === 'dump' && a && b) return dump(a, b);
  if (mode === 'compare' && a && b) return compare(a, b);
  console.error('usage: dump <appDir> <out.json> | compare <a.json> <b.json>');
  process.exit(2);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
