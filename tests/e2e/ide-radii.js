'use strict';
// @slow
/*
 * T73: בסגנון IDE כל הפינות כמעט מרובעות. הבדיקה סורקת את כל האלמנטים הנראים במסכים השונים (רשת, הגדרות, תפריט הקשר, לוח זוג, מסך פתיחה)
 * וטוענת שאף רדיוס מחושב לא עולה על 4px (חריגים: מתג ההדלקה ונקודות המצב). Classic ו-Paper נשארים עגולים כמו קודם.
 * צילומי מסך: docs/screens/T73-settings-ide.png, T73-board-ide.png
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('IDE style: square corners everywhere');
  const shots = path.join(__dirname, '..', '..', 'docs', 'screens');
  fs.mkdirSync(shots, { recursive: true });
  const project = path.join(TMP, 'ide-radii');
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — done\n  Result: ok\n');
  fs.writeFileSync(path.join(project, '.duo', 'CHAT.md'), '\n### architect · 09:00\nAll set.\n');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: project, name: 'one' });
  keeper.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'r' });
  await poll(() => keeper.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 820 });
  const { ev } = page;
  await page.appReady(1);
  const shot = async (name) => fs.writeFileSync(path.join(shots, name), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await ev(`import('/js/settings.js').then((m) => { m.setSetting('appearance.style', 'ide'); return true; })`);
  await sleep(600);

  // סורק: כל אלמנט נראה, הרדיוס הגדול ביותר מבין ארבע הפינות; מתג ונקודות (ריבוע קטן שהרדיוס שלו חצי מהצלע) מותרים
  const SCAN = `(() => {
    const bad = []; let n = 0;
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const c = getComputedStyle(e);
      if (c.visibility === 'hidden' || c.display === 'none') continue;
      n++;
      const m = Math.max(...['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].map((k) => parseFloat(c[k]) || 0));
      if (m <= 4) continue;
      const isDot = Math.max(r.width, r.height) <= 14; // נקודת מצב / ידית המתג
      const isSwitch = e.matches('.switch, .sw, [role=switch], .tk, .spin') || !!e.closest('[role=switch], .switch, .st-prev[data-style=classic], .st-prev[data-style=paper]'); // .tk/.spin: מחוון משימה ומסתובב (מצב); תצוגות Classic/Paper בכרטיסי הסגנון מראות במכוון את הסגנון שלהן
      if (isDot || isSwitch) continue;
      bad.push((e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ').join('.') + ' ' + m + 'px');
    }
    return { n, bad: bad.slice(0, 12) };
  })()`;
  const scan = async (label) => { const r = await ev(SCAN); t.check(`${label}: no corner above 4px (${r.n} elements scanned)`, r.bad.length === 0, r.bad.join(' | ')); };

  await scan('grid');
  // תפריט הקשר של חלונית
  await ev(`document.querySelector('.pane-head').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 100 })); true`);
  await sleep(300);
  await scan('context menu');
  await page.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
  // הגדרות
  await ev(`document.querySelector('#settingsBtn').click(); true`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  await sleep(400);
  await scan('settings dialog');
  const dlg = await ev(`(() => { const c = getComputedStyle(document.querySelector('#settingsDlg')); return parseFloat(c.borderTopLeftRadius); })()`);
  t.check('the settings dialog has a 3-4px radius (not a website-like rounded dialog)', dlg >= 2 && dlg <= 4, String(dlg));
  await shot('T73-settings-ide.png');
  await ev(`document.querySelector('#settingsDlg').close(); true`);
  // לוח זוג
  await ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`!!document.querySelector('.db-agent[data-role="architect"]')`, 20000);
  await sleep(500);
  await scan('pair board');
  await shot('T73-board-ide.png');
  // מסך פתיחה (לשונית ריקה)
  await ev(`document.querySelector('.duo-tab-new').click(); true`);
  await sleep(500);
  await scan('start screen');

  // Classic ו-Paper לא השתנו: עדיין עגולים
  for (const [st, min] of [['classic', 10], ['paper', 10]]) {
    await ev(`import('/js/settings.js').then((m) => { m.setSetting('appearance.style', '${st}'); return true; })`);
    await sleep(600);
    const r = await ev(`(() => { const g = (s) => { const e = document.querySelector(s); return e ? parseFloat(getComputedStyle(e).borderTopLeftRadius) : 0; }; return { tab: g('.duo-tab'), radius: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius-lg')) }; })()`);
    t.check(`${st}: still round (large radius token ${r.radius}px >= ${min})`, r.radius >= min, JSON.stringify(r));
  }
  await ev(`import('/js/settings.js').then((m) => { m.setSetting('appearance.style', 'ide'); return true; })`);

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
