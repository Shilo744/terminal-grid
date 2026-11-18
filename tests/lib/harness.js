'use strict';
/*
 * Shared helpers for the end-to-end tests: start a throw-away server on a free port, talk to it over WebSocket/HTTP,
 * drive headless Chrome over CDP, and report PASS/FAIL. Everything temporary lives in tests/.tmp (git-ignored).
 *
 * Gotchas learned the hard way (see tests/README.md): never spawn powershell.exe/cmd.exe from a test script and never
 * fs.cpSync onto an existing dir (both hard-kill node on this machine); use fs.symlinkSync(..., 'junction') instead.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const tracker = require('./tracker'); // T58: כל שרת ודפדפן שנפתחים כאן נרשמים ונסגרים בסוף (גם בכישלון ובפסק זמן), לפי pid מדויק

// שכן מנומס: גם בדיקה שמורצת ביד רצה בעדיפות מתחת לרגילה (הילדים - שרת הבדיקה ו-Chrome - יורשים אותה)
if (!process.env.TG_TEST_NORMAL_PRIORITY) { try { os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* לא נתמך */ } }

const APP = path.resolve(__dirname, '..', '..');
const TMP = path.join(APP, 'tests', '.tmp');
const FIXTURES = path.join(APP, 'tests', 'fixtures');
fs.mkdirSync(TMP, { recursive: true });

// בידוד מהבית האמיתי של המשתמש (T43): בדיקה שמופעלת דרך ה-harness, וכל שרת בדיקה שהיא מפעילה, רצים עם בית זמני (USERPROFILE / HOME / HOMEDRIVE / HOMEPATH).
// בלי זה בדיקה שיצרה זוג סוכנים בתיקיית הבית כתבה .duo\CHAT.md ו-TASKS.md מזויפים לבית האמיתי (ואותם ראה המשתמש בזוג שלו), וגם קראה את ~/.claude האמיתי.
// process.env.USERPROFILE בתוך בדיקה הוא כבר הבית הזמני. הבית האמיתי נשמר ב-REAL_HOME (ובמשתנה TG_REAL_USERPROFILE כדי ששרשור תהליכים לא יאבד אותו) רק לשומר שבסוף tests/run.js.
const REAL_HOME = process.env.TG_REAL_USERPROFILE || process.env.USERPROFILE || os.homedir();
const REAL_APPDATA = { LOCALAPPDATA: process.env.TG_REAL_LOCALAPPDATA || process.env.LOCALAPPDATA || '', APPDATA: process.env.TG_REAL_APPDATA || process.env.APPDATA || '' };
const TEST_HOME = path.join(TMP, 'home');
fs.mkdirSync(path.join(TEST_HOME, 'Downloads'), { recursive: true });
{
  const drive = path.parse(TEST_HOME).root.replace(/[\\/]+$/, '');
  // גם LOCALAPPDATA ו-APPDATA: PowerShell שמופעל בבדיקה כותב שם (ModuleAnalysisCache); כשהמשתנים הם של הבית האמיתי או ריקים הוא כתב לתיקיית הפרויקט (Microsoft/Windows/PowerShell/ModuleAnalysisCache הגיע ל-git)
  const local = path.join(TEST_HOME, 'AppData', 'Local'), roaming = path.join(TEST_HOME, 'AppData', 'Roaming');
  fs.mkdirSync(local, { recursive: true }); fs.mkdirSync(roaming, { recursive: true });
  Object.assign(process.env, { TG_REAL_USERPROFILE: REAL_HOME, TG_REAL_LOCALAPPDATA: REAL_APPDATA.LOCALAPPDATA, TG_REAL_APPDATA: REAL_APPDATA.APPDATA, USERPROFILE: TEST_HOME, HOME: TEST_HOME, HOMEDRIVE: drive, HOMEPATH: TEST_HOME.slice(drive.length), LOCALAPPDATA: local, APPDATA: roaming });
}
// Chrome לא עולה כש-USERPROFILE מצביע על תיקייה זמנית, ולכן רק הוא מקבל את משתני הבית האמיתיים. הוא כותב רק לתיקיית הפרופיל הזמנית שלו (--user-data-dir), לא לבית
const chromeEnv = () => {
  const drive = path.parse(REAL_HOME).root.replace(/[\\/]+$/, '');
  return { ...process.env, USERPROFILE: REAL_HOME, HOME: REAL_HOME, HOMEDRIVE: drive, HOMEPATH: REAL_HOME.slice(drive.length), LOCALAPPDATA: REAL_APPDATA.LOCALAPPDATA, APPDATA: REAL_APPDATA.APPDATA };
};
// שיחה מדומה (קובץ jsonl עם מזהה תקין) בבית הזמני, לבדיקות שצריכות שיחה שמורה (resume) בלי לגעת ב-~/.claude האמיתי
function fakeTranscript(home = TEST_HOME) {
  const id = require('crypto').randomUUID();
  const dir = path.join(home, '.claude', 'projects', '-test-project');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + '.jsonl'), JSON.stringify({ type: 'summary', summary: 'fake conversation for tests' }) + '\n');
  return id;
}
// היסטוריית שיחות מדומה בבית הזמני (T43): בדיקות של תפריט הצד ומסך הפתיחה לא קוראות עוד את ~/.claude האמיתי. projects x perProject שיחות קטנות, כל פרויקט בתיקייה אמיתית (כדי שיהיה אפשר לפתוח אותן)
function seedHistory(home = TEST_HOME, { projects = 3, perProject = 3 } = {}) {
  const root = path.join(home, '.claude', 'projects');
  const out = [];
  for (let p = 1; p <= projects; p++) {
    const cwd = path.join(home, 'work', 'proj' + p);
    fs.mkdirSync(cwd, { recursive: true });
    const dir = path.join(root, cwd.replace(/[:\\/]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 1; n <= perProject; n++) {
      const id = require('crypto').randomUUID();
      fs.writeFileSync(path.join(dir, id + '.jsonl'), [JSON.stringify({ type: 'user', cwd, message: { content: 'question ' + p + '-' + n } }), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } })].join('\n') + '\n');
      const when = new Date(Date.now() - (p * 10 + n) * 60000);
      fs.utimesSync(path.join(dir, id + '.jsonl'), when, when);
      out.push({ id, cwd, title: 'question ' + p + '-' + n });
    }
  }
  return out;
}
const WS = require(path.join(APP, 'node_modules', 'ws'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ממתין עד ש-fn (סינכרונית או אסינכרונית) מחזירה ערך אמת, עד ms מילישניות; מחזיר את הערך (או false). במקום sleep קבוע לפני בדיקה
const poll = async (fn, ms = 10000, step = 100) => {
  const t0 = Date.now();
  for (;;) { let v = false; try { v = await fn(); } catch { /* עוד לא מוכן */ } if (v) return v; if (Date.now() - t0 >= ms) return false; await sleep(step); }
};
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/[\r\n]+/g, ' | ');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

function checker(title) {
  const results = [];
  console.log(`\n=== ${title} ===`);
  return {
    check(name, ok, extra = '') { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); return !!ok; },
    finish() { const ok = results.every(Boolean); console.log(ok ? '\nALL PASSED' : '\nSOME FAILED'); return ok; },
  };
}

/**
 * Start the app's server. Returns { child, port, stateFile, stop() }. `binDir` is prepended to PATH (fake `claude`).
 * The state file is deleted first (a clean server) unless `keepState` is true: restore tests that restart a server
 * on purpose pass it. Without this a test would silently restore the terminals left by the previous run.
 */
async function startServer({ stateFile, settingsFile, binDir, env = {}, cwd = APP, port, keepState = false } = {}) {
  port = port || await freePort();
  stateFile = stateFile || path.join(TMP, `state-${port}.json`);
  settingsFile = settingsFile || path.join(TMP, `settings-${port}.json`); // כל שרת בדיקה עם קובץ הגדרות משלו (אף פעם לא settings.json של הפרויקט)
  if (!keepState) for (const f of [stateFile, stateFile + '.tmp', settingsFile, settingsFile + '.tmp', settingsFile + '.bak']) { try { fs.unlinkSync(f); } catch { /* none */ } }
  const PATH = (binDir ? binDir + ';' : '') + process.env.PATH;
  const child = spawn(process.execPath, ['server.js'], { cwd, env: { ...process.env, PORT: String(port), TG_STATE_FILE: stateFile, TG_SETTINGS_FILE: settingsFile, PATH, TG_STARTUP_TIMEOUT_MS: '1200', TG_TEST_BOOT_SETTLE_MS: '50', TG_STARTUP_QUIET_MS: '600', TG_REWIND: '0', ...env }, stdio: 'ignore' });
  child.exited = false;
  tracker.record(child.pid, 'node.exe', 'test server :' + port);
  child.on('exit', () => { child.exited = true; tracker.forget(child.pid); });
  // stop: השרת והעץ שלו (הטרמינלים הם תהליכי ילדים) נסגרים לפי ה-pid שלו
  return { child, port, stateFile, settingsFile, stop() { if (!child.exited) tracker.killTree(child.pid); tracker.forget(child.pid); try { child.kill(); } catch { /* gone */ } } };
}

/** A WebSocket client that behaves like the page: collects sessions, output per session and the view state. */
async function connect(port, { tries = 40 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const ws = new WS(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: `http://127.0.0.1:${port}` } });
      const c = { ws, sessions: new Map(), out: new Map(), view: null, settings: null, errors: [], messages: [] };
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        c.messages.push(m);
        if (m.t === 'list') { m.sessions.forEach((s) => c.sessions.set(s.id, s)); c.view = m.view; if (m.settings) c.settings = m.settings; }
        if (m.t === 'settings') c.settings = m.settings;
        if (m.t === 'created') c.sessions.set(m.session.id, m.session);
        if (m.t === 'closed') c.sessions.delete(m.id);
        if (m.t === 'view') c.view = m.view;
        if (m.t === 'data') c.out.set(m.id, (c.out.get(m.id) || '') + m.d);
        if (m.t === 'error') c.errors.push(m);
      });
      await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
      c.send = (o) => ws.send(JSON.stringify(o));
      c.close = () => ws.terminate();
      return c;
    } catch { await sleep(250); }
  }
  throw new Error('cannot connect to the test server on port ' + port);
}

function post(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const rq = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { Origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    rq.on('error', reject); rq.end(data);
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject));
}

const { installExternalGuard, allowExternalSchemes } = require('./external-guard');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));

/** Headless Chrome with a CDP session. Good for DOM/canvas measurements; screenshots through CDP are unreliable here. */
// gpu: false (ברירת מחדל) = בלי WebGL: xterm מצייר ב-DOM (האפליקציה תומכת בזה), וה-Chrome זול בהרבה מ-SwiftShader (WebGL בתוכנה).
// gpu: true (או TG_TEST_GPU=1) רק לבדיקה שבאמת תלויה ב-WebGL.
async function openPage(url, { width = 1500, height = 900, gpu = !!process.env.TG_TEST_GPU } = {}) {
  if (!CHROME) throw new Error('Chrome not found');
  const debugPort = await freePort();
  const profile = path.join(TMP, 'chrome-profile-' + debugPort);
  const gl = gpu ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu', '--disable-software-rasterizer'];
  // נפתח על about:blank ורק אחרי שמגן הניווט החיצוני (T50) מותקן עוברים לכתובת: גם המסמך הראשון של האפליקציה כבר מוגן
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, ...gl,
    '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--mute-audio', '--renderer-process-limit=2', 'about:blank'], { stdio: 'ignore', env: chromeEnv() });
  tracker.record(chrome.pid, 'chrome.exe', 'test chrome :' + debugPort);
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await getJson(`http://127.0.0.1:${debugPort}/json`)).find((t) => t.type === 'page'); } catch { /* not up yet */ } }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WS(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.once('open', r));
  let seq = 0; const pending = new Map();
  const listeners = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method && listeners.has(m.method)) for (const fn of listeners.get(m.method)) fn(m.params);
  });
  const call = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
  await call('Page.enable'); await call('Runtime.enable'); await call('Log.enable');
  await installExternalGuard(call);
  // העמוד נחשב ממוקד מההתחלה (כמו כשהכתובת הייתה בשורת הפקודה של Chrome): בלי זה document.hasFocus() שקר עד האירוע הראשון, והאפליקציה מזיזה מיקוד לטרמינל בשעת ה-focus הראשון
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  // מחכים שהדף ייטען (כולל המודולים): בלי זה, על מחשב עמוס טעינה איטית של Chrome שוברת בדיקות שמניחות שהאפליקציה כבר רצה
  // ממתין עד ש-JS אמיתי מתקיים בדף (תנאי כביטוי JS) עד ms מילישניות; מחזיר true/false בלי לזרוק, כדי שהבדיקה תדווח הודעת כשל ברורה
  const waitFor = async (expression, ms = 15000) => {
    for (let i = 0; i < ms / 100; i++) { try { if (await ev(expression)) return true; } catch { /* הדף באמצע טעינה */ } await sleep(100); }
    return false;
  };
  const loaded = () => waitFor(`document.readyState === 'complete' && location.href.startsWith('http')`, 30000);
  if (/^https?:/.test(url)) { await call('Page.navigate', { url }); await loaded(); }
  const errors = [];
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); };
  on('Runtime.exceptionThrown', (p) => errors.push('exception: ' + ((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || '')));
  on('Log.entryAdded', (p) => { if (p.entry && p.entry.level === 'error') errors.push('log: ' + p.entry.text + ' ' + (p.entry.url || '')); });
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return {
    call, ev, errors, on, waitFor,
    // האפליקציה סיימה את הסנכרון הראשון עם השרת: יש לפחות minPanes טרמינלים בדף, או (כש-minPanes הוא 0) מסך "אין טרמינלים"
    appReady: (minPanes = 1, ms = 30000) => waitFor(minPanes > 0 ? `document.querySelectorAll('.pane').length >= ${minPanes}` : `(() => { const e = document.querySelector('#empty'); return !!e && !e.hidden; })()`, ms),
    // טעינה מחדש שמחכה לדף עצמו (במקום sleep קבוע): מחזירה כשה-DOM נטען; הבדיקה ממשיכה לחכות לתנאים הספציפיים שלה עם waitFor
    async reload() { await call('Page.reload'); await sleep(300); return loaded(); },
    // בדיקה שבאמת צריכה לפתוח משהו מחוץ לדף (mailto:, file:, ...): מרימה את מגן הניווט (T50) לסכמות האלה בעמוד הזה בלבד, רושמת למה, וכל חלון מערכת שייפתח נסגר בסוף (tracker.js)
    async allowExternal(schemes, { reason, images = [] } = {}) {
      if (!reason) throw new Error('allowExternal needs a reason');
      await allowExternalSchemes(call, schemes);
      tracker.watchImages(images);
      tracker.declareOptIn({ schemes, reason, images });
      console.log(`ALLOWED EXTERNAL: ${schemes.join(',')} (${reason})`);
    },
    resize: (w, h) => call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }),
    mouse: (type, x, y, extra = {}) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra }),
    close() {
      try { ws.close(); } catch { /* ignore */ }
      tracker.killTree(chrome.pid); // Chrome והתהליכים שלו, לפי ה-pid שנפתח כאן ולא לפי שם (ה-Chrome של המשתמש לא נוגעים בו)
      tracker.forget(chrome.pid);
      try { chrome.kill(); } catch { /* ignore */ }
      // הפרופיל הזמני נמחק אחרי ש-Chrome שחרר אותו (נשאר רק אם התהליך נהרג באמצע: tests/run.js מנקה בהתחלה)
      chrome.once('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* עוד נעול */ } });
    },
  };
}

/** Windows' real Chrome screenshot (works; CDP screenshots do not): `chrome --screenshot` with a virtual-time budget. */
function chromeScreenshot(url, out, { width = 1500, height = 900, budget = 20000 } = {}) {
  const { spawnSync } = require('child_process');
  const profile = path.join(TMP, 'chrome-profile-shot');
  spawnSync(CHROME, ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, `--screenshot=${out}`, `--virtual-time-budget=${budget}`, `--timeout=${budget}`, '--no-first-run', url], { stdio: 'ignore', timeout: 90000, env: chromeEnv() });
  return fs.existsSync(out);
}

module.exports = { tracker, APP, TMP, FIXTURES, REAL_HOME, TEST_HOME, fakeTranscript, seedHistory, WS, sleep, poll, strip, freePort, checker, startServer, connect, post, getJson, openPage, chromeScreenshot, CHROME };
