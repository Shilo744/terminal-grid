'use strict';
// @slow
/*
 * הפעלה אוטומטית עם Windows (T30), מצד השרת, תמיד בתיקייה זמנית (TG_TEST_STARTUP_DIR) ועם הקיצור המדומה (TG_TEST_AUTOSTART_STUB=1):
 * GET /api/autostart מדווח את המצב האמיתי (הקובץ קיים או לא), POST {enabled} יוצר/מוחק, ההגדרה system.autostart בכל חלון משקפת את הקובץ
 * ומתעדכנת בשידור, מקור זר נדחה, גוף לא תקין נדחה, וכשאי אפשר ליצור את הקיצור חוזרת הודעה ברורה והמצב לא משתנה.
 * התיקייה האמיתית של Windows (Startup) לא נוגעים בה אף פעם.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { TMP, APP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

function req(port, method, urlPath, body, origin) {
  return new Promise((resolve, reject) => {
    const data = body == null ? '' : JSON.stringify(body);
    const headers = { Origin: origin || `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) };
    const rq = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { /* not json */ } resolve({ status: r.statusCode, json: j }); });
    });
    rq.on('error', reject); rq.end(data);
  });
}

(async () => {
  const t = checker('autostart (startup shortcut, stubbed, temp folder only)');
  const dir = path.join(TMP, 'startup-test');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const env = { TG_TEST_STARTUP_DIR: dir, TG_TEST_AUTOSTART_STUB: '1' };

  let srv = await startServer({ env });
  let c = await connect(srv.port);
  const lnk = path.join(dir, `Terminal Grid (${srv.port}).lnk`);
  const autostartOf = () => { const m = c.messages.filter((x) => x.t === 'settings' || x.t === 'list').map((x) => x.settings).filter(Boolean).pop(); return m && m.system && m.system.autostart; };

  await poll(() => c.settings, 8000);
  t.check('the setting system.autostart exists and is off when there is no shortcut', c.settings.system && c.settings.system.autostart === false);
  let r = await req(srv.port, 'GET', '/api/autostart');
  t.check('GET /api/autostart reports the real state (off)', r.status === 200 && r.json.enabled === false && r.json.file === lnk, JSON.stringify(r.json));

  r = await req(srv.port, 'POST', '/api/autostart', { enabled: true });
  t.check('POST enabled:true creates the shortcut file in the startup folder (named by port when not 7791)', r.status === 200 && r.json.enabled === true && fs.existsSync(lnk), JSON.stringify(r.json));
  let spec = {};
  try { spec = JSON.parse(fs.readFileSync(lnk, 'utf8')); } catch { /* checked below */ }
  t.check('target is conhost.exe running powershell headless', /conhost\.exe$/i.test(spec.target || '') && (spec.arguments || '').startsWith('--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "'), JSON.stringify(spec));
  t.check('arguments run THIS project start.ps1 with -NoBrowser and the non-default -Port', (spec.arguments || '').includes(`"${path.join(APP, 'start.ps1')}" -NoBrowser -Port ${srv.port}`), spec.arguments);
  t.check('working directory is the project root and the icon is the app icon', spec.workingDirectory === APP && spec.icon === path.join(APP, 'terminal-grid.ico'), JSON.stringify([spec.workingDirectory, spec.icon]));
  t.check('every open window is told (settings broadcast): system.autostart = true', await poll(() => autostartOf() === true, 6000, 100));
  r = await req(srv.port, 'GET', '/api/autostart');
  t.check('GET now says enabled', r.json.enabled === true);

  // המצב האמיתי נקבע לפי הקובץ: חיבור חדש רואה true, גם אחרי שהשרת עלה מחדש
  c.close(); srv.stop();
  await sleep(800);
  srv = await startServer({ env, port: undefined });
  // פורט חדש => שם קובץ אחר; יוצרים ידנית את הקובץ של הפורט החדש כדי לבדוק שהמצב נקרא מהדיסק
  const lnk2 = path.join(dir, `Terminal Grid (${srv.port}).lnk`);
  fs.writeFileSync(lnk2, '{}');
  c = await connect(srv.port);
  await poll(() => c.settings, 8000);
  t.check('a server that starts with the file already there reports system.autostart = true (the disk is the truth)', c.settings.system.autostart === true);
  r = await req(srv.port, 'POST', '/api/autostart', { enabled: false });
  t.check('POST enabled:false removes the file', r.status === 200 && r.json.enabled === false && !fs.existsSync(lnk2));
  t.check('and the windows are told', await poll(() => autostartOf() === false, 6000, 100));
  r = await req(srv.port, 'POST', '/api/autostart', { enabled: false });
  t.check('removing when there is nothing to remove is fine', r.status === 200 && r.json.enabled === false);

  // הגנות
  r = await req(srv.port, 'POST', '/api/autostart', { enabled: true }, 'http://evil.example');
  t.check('a request from another origin is refused (403) and creates nothing', r.status === 403 && !fs.existsSync(lnk2));
  r = await req(srv.port, 'POST', '/api/autostart', { enabled: 'yes' });
  t.check('a body without a boolean enabled is refused (400)', r.status === 400);
  // הגדרה רגילה לא מסוגלת לשנות את המצב (אין דרך לעקוף את הקובץ)
  c.send({ t: 'settings:set', patch: { system: { autostart: true } } });
  await sleep(700);
  t.check('settings:set cannot flip system.autostart (only the file decides)', !fs.existsSync(lnk2) && autostartOf() === false);
  const saved = fs.existsSync(srv.settingsFile) ? JSON.parse(fs.readFileSync(srv.settingsFile, 'utf8')) : {};
  t.check('the value is never written to settings.json', !saved.system || saved.system.autostart === undefined, JSON.stringify(saved.system));

  c.close(); srv.stop();
  await sleep(800);

  // שגיאה: תיקיית ההפעלה לא ניתנת ליצירה (הנתיב הוא קובץ)
  const blocker = path.join(TMP, 'startup-blocker.txt');
  fs.writeFileSync(blocker, 'not a folder');
  srv = await startServer({ env: { TG_TEST_STARTUP_DIR: path.join(blocker, 'inner'), TG_TEST_AUTOSTART_STUB: '1' } });
  c = await connect(srv.port);
  await poll(() => c.settings, 8000);
  r = await req(srv.port, 'POST', '/api/autostart', { enabled: true });
  t.check('when the shortcut cannot be created the answer is a clear Hebrew message and the state stays off', r.status >= 400 && r.json && /תיקיית ההפעלה|הקיצור/.test(r.json.error || '') && c.settings.system.autostart === false, JSON.stringify(r.json));
  r = await req(srv.port, 'GET', '/api/autostart');
  t.check('GET still says off', r.json.enabled === false);
  c.close(); srv.stop();

  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
