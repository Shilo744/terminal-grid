'use strict';
/*
 * הסצנות שכלי הצילום (scenes.js) יודע לצלם. סצנה = שם + הגדרה:
 *   panes   - טרמינלים שנפתחים בשרת לפני העמוד: claude('שם') או ps('שם', 'פקודה להקלדה')
 *   view    - { expanded: מספר (מ-1) של טרמינל מוגדל, focus: מספר }  (נשמר בשרת, העמוד מחזיר אותו בטעינה)
 *   duo     - true: נפתח זוג סוכנים מזויף ומחכים לסבב עבודה (הסוכנים המזויפים של bin-duo)
 *   stubs   - { '/api/...': json } תשובות דמה ל-fetch בעמוד (ברירת מחדל: היסטוריה וסוכנים פתוחים, כדי שלא יוצג מידע אישי)
 *   settings - תיקון חלקי להגדרות המשתמש (מקונן, כמו ב-server/settings.js), נשלח לשרת לפני שהעמוד נפתח: { ui: { recents: [...] } }
 *   storage - { מפתח: ערך } ל-localStorage של העמוד (מפתחות tg.*; הגדרות עוברות דרך settings, כי השרת גובר על localStorage)
 *   page    - קוד JS שרץ בעמוד אחרי שהטרמינלים מוכנים; זמינים $, $$, sleep, waitFor, click(sel), cfg
 *   settle  - כמה מילישניות לחכות לפני ה-page (ברירת מחדל 2500)
 *   bin / env - תיקיית ה-claude המדומה (ברירת מחדל bin-heb) ומשתני סביבה לשרת של הסצנה (למשל STARTUP_SILENT לשלב ההפעלה)
 * סצנה חדשה בכמה שורות: scene('settings', { panes: four, page: "await click('#settingsBtn'); await sleep(300);" });
 */

const claude = (name) => ({ kind: 'claude', name });
const ps = (name, input) => ({ kind: 'powershell', name, input });

const LIST_BUILD = '1..14 | % { "[{0:D2}/14] compile module-$_ ... ok" -f $_ }';
const LIST_FILES = 'Get-ChildItem C:\\Windows -File | Select-Object -First 12 Name,Length | Format-Table -AutoSize';
const LIST_DATE = 'Get-Date; "node " + (node -v)';

const NOW = Date.now();
const MIN = 60 * 1000;
const sess = (id, title, ago) => ({ id, title, last: NOW - ago, open: null, live: false });

// נתוני דמה להיסטוריית השיחות בתפריט הצד (במקום השיחות האמיתיות של המשתמש)
const HISTORY = {
  liveReady: true,
  projects: [
    { cwd: 'C:\\work\\shop-app', name: 'shop-app', parent: 'C:\\work', exists: true, last: NOW, sessions: [
      sess('11111111-1111-4111-8111-111111111111', 'תיקון באג בעגלת הקניות', 4 * MIN),
      sess('11111111-1111-4111-8111-111111111112', 'הוספת תשלום בביט', 180 * MIN),
      sess('11111111-1111-4111-8111-111111111113', 'Refactor checkout flow', 26 * 60 * MIN)] },
    { cwd: 'C:\\work\\api-server', name: 'api-server', parent: 'C:\\work', exists: true, last: NOW, sessions: [
      sess('22222222-2222-4222-8222-222222222221', 'מעבר מ-Express ל-Fastify', 50 * MIN),
      sess('22222222-2222-4222-8222-222222222222', 'בדיקות עומס לנקודת הקצה /orders', 5 * 24 * 60 * MIN)] },
    { cwd: 'C:\\work\\docs-site', name: 'docs-site', parent: 'C:\\work', exists: true, last: NOW, sessions: [
      sess('33333333-3333-4333-8333-333333333331', 'כתיבת מדריך התקנה', 9 * 24 * 60 * MIN)] },
    { cwd: 'C:\\old\\prototype', name: 'prototype', parent: 'C:\\old', exists: false, last: NOW, sessions: [
      sess('44444444-4444-4444-8444-444444444441', 'ניסוי עם WebGL', 40 * 24 * 60 * MIN)] },
  ],
};

const EXTERNAL = {
  sessions: [
    { pid: 4101, sessionId: '55555555-5555-4555-8555-555555555551', cwd: 'C:\\work\\shop-app', name: '', status: 'busy', inGrid: false },
    { pid: 4102, sessionId: '55555555-5555-4555-8555-555555555552', cwd: 'C:\\work\\api-server', name: '', status: 'idle', inGrid: false },
    { pid: 4103, sessionId: '55555555-5555-4555-8555-555555555553', cwd: 'C:\\work\\docs-site', name: '', status: 'idle', inGrid: false },
  ],
};

const DEFAULT_STUBS = {
  '/api/history': HISTORY,
  '/api/claude-sessions': EXTERNAL,
  '/api/info': { home: 'C:\\work\\shop-app', claude: true, clients: 1 },
};

const RECENTS = ['C:\\work\\shop-app', 'C:\\work\\api-server', 'C:\\work\\docs-site', 'C:\\Users\\dev\\Desktop\\prototype'];

const four = [claude('shop-app'), ps('build', LIST_BUILD), claude('api-server'), ps('files', LIST_FILES)];

const scenes = [];

// רישום סצנה (גם מתוך משימה מאוחרת יותר): scene('name', {...}); שם קיים מוחלף
function scene(name, def = {}) {
  const full = { name, ...def, stubs: { ...DEFAULT_STUBS, ...(def.stubs || {}) } };
  const i = scenes.findIndex((s) => s.name === name);
  if (i >= 0) scenes[i] = full; else scenes.push(full);
  return full;
}

scene('empty');
// מסך הפתיחה (T14) בשלושה מצבים: עם שיחות ותיקיות אחרונות, מחשב חדש, ו-claude לא נמצא
scene('start-screen', { settings: { ui: { recents: RECENTS } } });
scene('start-screen-fresh', { stubs: { '/api/history': { liveReady: true, projects: [] } } });
scene('start-screen-noclaude', { settings: { ui: { recents: RECENTS } }, stubs: { '/api/info': { home: 'C:\\work\\shop-app', claude: false, clients: 1 } } });
scene('grid-1', { panes: [claude('shop-app')] });
scene('grid-2', { panes: [claude('shop-app'), ps('build', LIST_BUILD)] });
scene('grid-3', { panes: [claude('shop-app'), ps('build', LIST_BUILD), claude('api-server')] });
scene('grid-4', { panes: four });
scene('grid-6', { panes: [...four, claude('docs-site'), ps('date', LIST_DATE)] });
scene('expanded', { panes: [...four, claude('docs-site')], view: { expanded: 3, focus: 3 } });
scene('tiles-8', { panes: [claude('shop-app'), claude('api-server'), claude('docs-site'), ps('build', LIST_BUILD), ps('files', LIST_FILES), ps('date', LIST_DATE), claude('mobile-app'), claude('billing'), ps('tests', LIST_BUILD)], view: { expanded: 1, focus: 1 } });
scene('attention', {
  panes: [claude('api-server'), claude('shop-app'), claude('docs-site'), claude('billing'), ps('build', LIST_BUILD), ps('old-shell', 'exit')],
  view: { focus: 4 },
  page: "const ev = (p, b) => fetch('/api/agent/event', { method: 'POST', headers: { 'x-tg': '1', 'content-type': 'application/json' }, body: JSON.stringify({ paneId: p, ...b }) }); for (const p of ['1', '2', '3', '4']) await ev(p, { event: 'start' }); await ev('1', { event: 'submit' }); await ev('1', { event: 'notify', notificationType: 'permission_prompt', message: 'permission' }); await ev('2', { event: 'submit' }); await ev('2', { event: 'stop' }); await ev('3', { event: 'submit' }); await sleep(1200);",
});
scene('attention-tiles', { ...scenes.find((x) => x.name === 'attention'), name: 'attention-tiles', view: { expanded: 4, focus: 4 } });
scene('pane-menu', { panes: [claude('shop-app'), ps('build', LIST_BUILD), claude('api-server'), ps('old-shell', 'exit')], view: { focus: 2 }, page: "await sleep(1500); await click('.pane[data-id=\"1\"] [data-act=menu]'); await sleep(400);" });
scene('settings-general', { panes: four, page: "await click('#settingsBtn'); await sleep(300); document.querySelector('[data-group=general]').scrollIntoView({ block: 'center' }); await sleep(400);" });
scene('settings-trust', { panes: four, page: "await click('#settingsBtn'); await sleep(300); document.querySelector('[data-group=claude]').scrollIntoView({ block: 'start' }); await sleep(400);" });
// שלב ההפעלה (T41): בזמן השלב (claude שקט, ללא timeout) ומיד אחריו (המסך הראשי של Claude)
scene('startup-phase', { bin: 'bin-trust', env: { STARTUP_SILENT: '1', TG_STARTUP_TIMEOUT_MS: '600000', TG_STARTUP_QUIET_MS: '0' }, panes: [claude('shop-app'), claude('api-server')], settle: 1500 });
scene('startup-ready', { bin: 'bin-trust', env: { TG_STARTUP_QUIET_MS: '0', TG_STARTUP_TIMEOUT_MS: '30000' }, panes: [claude('shop-app'), claude('api-server')], settle: 4500 });
// הדבקת תמונה (T45): הצ'יפ בזמן ההעלאה (ההעלאה נתקעת בכוונה) וכיתוב הגרירה
scene('paste-chip', { bin: 'bin-img', panes: [claude('shop-app')], settle: 2500, page: "const orig = window.fetch.bind(window); window.fetch = (u, ...r) => (String(u).includes('paste-image') ? new Promise(() => {}) : orig(u, ...r)); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(100)], 'a.png', { type: 'image/png' })); document.querySelector('.term-host').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); await sleep(400);" });
scene('drop-hint', { bin: 'bin-img', panes: [claude('shop-app')], settle: 2500, page: "const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(100)], 'a.png', { type: 'image/png' })); document.querySelector('.pane').dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })); await sleep(300);" });
// קישור בריחוף (T47): הצ'יפ "Ctrl+לחיצה לפתיחה"
scene('link-hover', { bin: 'bin-links', panes: [claude('shop-app')], settle: 2500, page: "const { state } = await import('/js/state.js'); const p = [...state.panes.values()][0]; const b = p.term.buffer.active; const scr = p.el.querySelector('.xterm-screen'); const r = scr.getBoundingClientRect(); for (let y = 0; y < p.term.rows; y++) { const l = b.getLine(b.baseY + y); if (l && l.translateToString(true).includes('the docs')) { const x = l.translateToString(true).indexOf('the docs') + 2; const ev = { clientX: r.left + x * r.width / p.term.cols, clientY: r.top + (y + 0.5) * r.height / p.term.rows, bubbles: true }; scr.dispatchEvent(new MouseEvent('mousemove', ev)); await sleep(150); scr.dispatchEvent(new MouseEvent('mousemove', { ...ev, clientX: ev.clientX + 1 })); break; } } await sleep(400);" });
scene('toasts', { panes: four, page: "const m = await import('/js/toast.js'); m.toast('הנתיב הועתק'); m.toast('התיקייה לא נמצאה', 'error'); m.toast('סוכן חיכה לך בזמן שהחלון לא היה ממוקד. להפעיל התראות?', 'info', { action: { label: 'להפעיל התראות', onClick() {} }, ms: 60000 }); await sleep(600);" });
// כפתורי הסרגל במצבים (T38): לחוץ (תפריט הצד פתוח, יישור עברית דלוק) וממוקד (טבעת מיקוד מלאה)
scene('topbar-states', { panes: four, page: "await click('#sideBtn'); await sleep(300); document.querySelector('#settingsBtn').focus({ focusVisible: true }); await sleep(200);", settle: 800 });
scene('side-open', { panes: four, page: "await click('#sideBtn'); await waitFor(() => $$('.grp').length > 0, 4000);", settle: 500 });
// 41 משימות (T43): 24 הושלמו, אחת בעבודה, 14 ממתינות, 2 חסומות
scene('duo-board-many', { duo: true, duoSeed: 'many', page: "await click('.duo-tab[data-id]'); await sleep(800);", settle: 500 });
scene('duo-board', { duo: true, duoSeed: true, page: "await click('.duo-tab[data-id]'); await sleep(800);", settle: 500 });
scene('folder-popover', { panes: four, settings: { ui: { recents: RECENTS } }, page: "await click('#folderBtn');" });
scene('adopt-popover', { panes: four, page: "await click('#newMenuBtn'); await click('.menu [data-id=adopt]'); await waitFor(() => $$('.adopt-item').length > 0, 4000);" });
scene('duo-dialog', { panes: four, page: "await click('#newMenuBtn'); await click('.menu [data-id=duo]'); await sleep(200);" });
scene('settings', { panes: four, page: "await click('#settingsBtn'); await sleep(400);" });
scene('settings-advanced', { panes: four, page: "await click('#settingsBtn'); await click('.st-adv-toggle'); await sleep(300);" });
scene('settings-changed', { panes: four, page: "await click('#settingsBtn'); await click('.st-adv-toggle'); for (const [id, v] of [['fontSize', 17], ['lineHeight', 1.3]]) { const r = $('[data-row=\"' + id + '\"] input[type=range]'); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); } await sleep(900);" });
scene('menu', { panes: four, page: "await click('#newMenuBtn'); await sleep(300);" });
scene('settings-claude', { panes: four, page: "await click('#settingsBtn'); await click('[data-row=autoCompactMode] [data-value=early]'); await click('.st-help summary'); $('.st-help').scrollIntoView({ block: 'center' }); await sleep(400);" });

module.exports = { scenes, scene, claude, ps };
