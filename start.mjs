#!/usr/bin/env node
// Terminal Grid: מפעיל אחד לכל מערכת ההפעלה.
//
//   node start.mjs                      מוודא שהשרת רץ ופותח (או משאיר) חלון
//   node start.mjs /path/to/folder      בנוסף פותח טרמינל חדש בתיקייה הזאת
//   node start.mjs --kind powershell    טרמינל רגיל במקום Claude (בכל מערכת: ה-shell הרגיל שלה)
//   node start.mjs --port 7795          מופע נפרד בפורט אחר (מצב והגדרות משלו, בתיקיית .state-<פורט>)
//   node start.mjs --no-browser         בלי חלון (לבדיקות ולהפעלה אוטומטית)
//
// Windows: מעביר ל-start.ps1 (שמרים חלון קיים, ממקם ועוד). macOS / Linux: מפעיל את השרת ברקע ופותח חלון אפליקציה ב-Chrome / Edge / Brave.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let dir = '', kind = 'claude', port = 7791, noBrowser = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--kind' || a === '-Kind') kind = argv[++i];
  else if (a === '--port' || a === '-Port') port = Number(argv[++i]);
  else if (a === '--no-browser' || a === '-NoBrowser') noBrowser = true;
  else if (!a.startsWith('-') && !dir) dir = a;
}
if (!['claude', 'powershell'].includes(kind)) kind = 'claude';
if (!(port >= 1024 && port <= 65535)) { console.error('פורט לא תקין'); process.exit(1); }

if (process.platform === 'win32') {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'start.ps1')];
  if (dir) args.push(dir);
  args.push('-Kind', kind, '-Port', String(port));
  if (noBrowser) args.push('-NoBrowser');
  const r = spawnSync('powershell.exe', args, { stdio: 'inherit', windowsHide: true });
  process.exit(r.status ?? 1);
}

const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => { try { const r = await fetch(base + p, { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; } catch { return null; } };

// 1. שרת
let info = await get('/api/info');
if (!info) {
  const env = { ...process.env };
  if (port !== 7791) {
    const stateDir = path.join(root, '.state-' + port);
    fs.mkdirSync(stateDir, { recursive: true });
    env.PORT = String(port);
    env.TG_STATE_FILE = path.join(stateDir, 'state.json');
    env.TG_SETTINGS_FILE = path.join(stateDir, 'settings.json');
  }
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env, detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 50 && !info; i++) { await sleep(200); info = await get('/api/info'); }
}
if (!info) { console.error('השרת לא עלה. הפרטים ב-server.log'); process.exit(1); }

// 2. טרמינל חדש בתיקייה
if (dir) {
  const cwd = path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()));
  try {
    await fetch(base + '/api/open', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', 'x-tg': '1' },
      body: JSON.stringify({ cwd, kind }), signal: AbortSignal.timeout(10000),
    });
  } catch (e) { console.error('פתיחת הטרמינל נכשלה:', e.message); }
}

if (noBrowser) process.exit(0);

// 3. חלון: אם כבר יש חלון מחובר, לא פותחים עוד אחד
info = await get('/api/info');
if (info && info.clients > 0) process.exit(0);

const mac = process.platform === 'darwin';
const candidates = mac
  ? ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'].filter((n) => fs.existsSync(`/Applications/${n}.app`))
  : ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'brave-browser', 'chromium', 'chromium-browser'].filter((c) => spawnSync('which', [c]).status === 0);
const profile = path.join(root, '.chrome-' + port); // פרופיל נפרד: החלון לא תלוי בתוספים ובהגדרות של הדפדפן היומיומי
const flags = [`--app=${base}/`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check'];
if (candidates.length) {
  if (mac) spawn('open', ['-na', candidates[0], '--args', ...flags], { detached: true, stdio: 'ignore' }).unref();
  else spawn(candidates[0], flags, { detached: true, stdio: 'ignore' }).unref();
} else {
  // אין דפדפן מבוסס Chromium: דפדפן ברירת המחדל (בלשונית רגילה)
  spawn(mac ? 'open' : 'xdg-open', [base + '/'], { detached: true, stdio: 'ignore' }).unref();
}
