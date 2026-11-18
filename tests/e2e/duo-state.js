'use strict';
// @slow
/*
 * מצב אחד לסוכן בזוג (T43): המצב מה-hooks של הזוג (starting | idle | working | attention | exited) הוא המצב של כותרת הפאן של הסוכן, של הכרטיס שלו בלוח,
 * של הנקודה בלשונית ושל הסיכום בסרגל, והם מסכימים תמיד. אירועי hook אמיתיים נשלחים ל-/api/duo/event (כמו hook-cli של הסוכן), והזוג מושהה כדי שהסוכנים
 * המזויפים לא ישנו מצב מעצמם. וגם: רשימת משימות מקובצת של 41 משימות (בעבודה, הבאות, חסומות, הושלמו מקופל), שכוללת גלילה למשימה הנוכחית.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

const hook = (port, body) => new Promise((resolve) => {
  const data = JSON.stringify(body);
  const rq = http.request({ host: '127.0.0.1', port, path: '/api/duo/event', method: 'POST', headers: { Origin: `http://127.0.0.1:${port}`, 'x-tg': '1', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
  rq.on('error', () => resolve(0)); rq.end(data);
});

(async () => {
  const t = checker('one pair state everywhere + scalable task list');
  const project = path.join(TMP, 'duo-state-project');
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול מריצה קודמת */ }
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  // 41 משימות: 24 הושלמו, אחת בעבודה (T25), 14 ממתינות (T26-T39 פחות שתי חסומות... כאן: T31 ו-T37 חסומות), 2 חסומות
  const lines = ['# Tasks', ''];
  for (let n = 1; n <= 41; n++) {
    const mark = n <= 24 ? 'x' : n === 25 ? '~' : (n === 31 || n === 37) ? '!' : ' ';
    lines.push(`- [${mark}] T${n} — ${n === 25 ? 'בדיקות עומס לנקודת הקצה /orders עם כותרת ארוכה מאוד שאמורה להיעטף לשתי שורות ולהיחתך אחר כך כי היא מכילה הרבה מילים נוספות וחוזרת על עצמה עוד ועוד' : 'משימה מספר ' + n}`);
  }
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), lines.join('\n') + '\n');

  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo'), env: { TG_STARTUP_QUIET_MS: '600' } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'st' });
  const created = await poll(() => keeper.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const duoId = created && created.duoId;
  keeper.send({ t: 'duo', op: 'pause', duoId }); // הסוכנים המזויפים לא מתעוררים ולא משנים מצב
  await poll(() => [...keeper.sessions.values()].filter((s) => s.duo).length === 2, 20000);
  const sess = {}; for (const s of keeper.sessions.values()) if (s.duo) sess[s.duo.role] = s.id;

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1920, height: 1080 });
  const { ev } = page;
  await page.appReady(0);
  await ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`!!document.querySelector('.db-agent[data-role="worker"]')`, 15000);
  await sleep(2500); // ה-hooks של הפתיחה ("start") של הסוכנים המזויפים, וה-startup של הפאנים

  // כל מה שמופיע ב-UI על סוכן אחד, מכל המקומות
  const seen = (role) => ev(`(() => {
    const pane = document.querySelector('.pane[data-duo="${role}"]');
    const card = document.querySelector('.db-agent[data-role="${role}"]');
    const tab = document.querySelector('.duo-tab:not(.duo-tab-new)');
    const label = pane ? pane.querySelector('.pstatus') : null;
    return {
      paneClass: pane ? pane.className : null,
      paneLabel: label && !label.hidden ? label.textContent.trim() : '',
      card: card ? card.dataset.state : null,
      word: card ? card.querySelector('.stw').textContent : null,
      dot: card ? getComputedStyle(card.querySelector('.db-dot')).backgroundColor : null,
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
      tab: tab ? tab.dataset.status : null,
      summary: (document.querySelector('#summary') || {}).textContent || '',
      waitStat: !!document.querySelector('#summary .stat-wait'),
    };
  })()`);
  const until = async (role, pred, ms = 6000) => { let s; for (let i = 0; i < ms / 100; i++) { s = await seen(role); if (pred(s)) return s; await sleep(100); } return s; };
  const accent = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`);

  /* ---------- פנוי ---------- */
  let w = await until('worker', (s) => s.card === 'idle' && /s-idle/.test(s.paneClass || ''));
  t.check('idle: the card says "פנוי" with a grey dot, the pane header shows no work label, the tab is the paused/idle one', w.card === 'idle' && w.word === 'פנוי' && !/עובד|אישור/.test(w.paneLabel) && /s-idle/.test(w.paneClass) && (w.tab === 'paused' || w.tab === 'idle'), JSON.stringify(w));

  /* ---------- עובד ---------- */
  t.check('(setup) the hook endpoint accepts the event', (await hook(srv.port, { duoId, role: 'worker', event: 'submit' })) === 200);
  w = await until('worker', (s) => s.card === 'working' && /עובד/.test(s.paneLabel) && s.tab === 'busy' && /1\s*פעיל/.test(s.summary));
  t.check('working: the card says "עובד…" and its dot is the accent colour', w.card === 'working' && w.word === 'עובד…', JSON.stringify(w));
  const accRgb = await ev(`(() => { const d = document.createElement('i'); d.style.color = '${accent}'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`);
  t.check('the working dot is painted in the accent colour and the working card has an accent-tinted background', w.dot === accRgb && w.cardBg !== (await ev(`getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim()`)), `${w.dot} vs ${accRgb}; card ${w.cardBg}`);
  t.check('the SAME state in the pane header of that agent ("עובד…") and in the tab dot (busy)', /עובד/.test(w.paneLabel) && /s-busy/.test(w.paneClass) && w.tab === 'busy', JSON.stringify(w));
  t.check('and in the top summary (1 working)', /1\s*פעיל/.test(w.summary), w.summary);
  const arch0 = await seen('architect');
  t.check('the other agent is unaffected (still idle in the card and the pane)', arch0.card === 'idle' && !/עובד/.test(arch0.paneLabel));

  /* ---------- מחכה לאישור ---------- */
  await hook(srv.port, { duoId, role: 'architect', event: 'notify', notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  const a1 = await until('architect', (s) => s.card === 'attention' && /אישור/.test(s.paneLabel) && s.tab === 'warn' && s.waitStat);
  t.check('attention: the card says "מחכה לאישור" with an amber dot', a1.card === 'attention' && a1.word === 'מחכה לאישור', JSON.stringify(a1));
  t.check('the pane header of that agent shows "צריך אישור", the tab dot is the warn one and the summary counts someone waiting', /אישור/.test(a1.paneLabel) && a1.tab === 'warn' && a1.waitStat === true, JSON.stringify(a1));

  /* ---------- סיום תור: חוזרים לפנוי ---------- */
  await hook(srv.port, { duoId, role: 'worker', event: 'stop' });
  w = await until('worker', (s) => s.card === 'idle' && /s-idle/.test(s.paneClass || ''));
  t.check('after the worker finishes its turn it is idle again in the card and the pane header (no "waiting for you" pill for pair agents)', w.card === 'idle' && !/עובד|ממתין/.test(w.paneLabel) && /s-idle/.test(w.paneClass), JSON.stringify(w));
  await hook(srv.port, { duoId, role: 'architect', event: 'submit' }); // הוא ענה לבקשת ההרשאה ועובד
  const a2 = await until('architect', (s) => s.card === 'working' && /עובד/.test(s.paneLabel) && s.tab === 'busy');
  t.check('the architect that was waiting for approval and continues is "working" everywhere again, and the tab dot is busy, not amber (the permission alert resolved itself: T46)', a2.card === 'working' && /עובד/.test(a2.paneLabel) && a2.tab === 'busy', JSON.stringify(a2));
  await hook(srv.port, { duoId, role: 'architect', event: 'stop' });
  await until('architect', (s) => s.card === 'idle');

  /* ---------- נסגר ---------- */
  keeper.send({ t: 'close', id: sess.worker });
  w = await until('worker', (s) => s.card === 'exited' && s.tab === 'danger');
  t.check('exited: the card says "נסגר" with a red dot and the tab shows the problem state', w.card === 'exited' && w.word === 'נסגר' && w.tab === 'danger', JSON.stringify(w));

  /* ---------- רשימת משימות מקובצת ---------- */
  const tasks = () => ev(`(() => {
    const q = (s) => document.querySelector(s);
    const li = q('.db-task.s-doing');
    const sec = q('.db-tasks-sec').getBoundingClientRect(), r = li ? li.getBoundingClientRect() : null;
    return {
      headers: [...document.querySelectorAll('.tg')].map((g) => g.className.replace('tg tg-', '').replace(' open', '') + ':' + g.querySelector('.tg-n').textContent),
      nextRows: document.querySelectorAll('.tg-next .db-task').length,
      more: (q('.tg-more') || {}).textContent || null,
      doneOpen: q('.tg-toggle') ? q('.tg-toggle').getAttribute('aria-expanded') : null,
      doneHidden: q('.tg-done .tg-list') ? q('.tg-done .tg-list').hidden : null,
      progress: q('.db-progress-text').textContent,
      inView: !!r && r.top >= sec.top - 1 && r.bottom <= sec.bottom + 1,
      clamp: li ? getComputedStyle(li.querySelector('.ttl')).webkitLineClamp : null,
      ttlH: li ? Math.round(li.querySelector('.ttl').getBoundingClientRect().height) : null,
      tip: li ? li.title : '',
      sticky: getComputedStyle(q('.tg-h')).position,
    };
  })()`);
  let k = await tasks();
  t.check('41 tasks are grouped: בעבודה (1), הבאות (14), חסומות (2), הושלמו (24) in this order', JSON.stringify(k.headers.map((h) => h.split(':')[0])) === JSON.stringify(['doing', 'next', 'blocked', 'done']) && k.headers[0].endsWith(':1') && k.headers[1].endsWith(':14') && k.headers[2].endsWith(':2') && /^\(24\)$/.test(k.headers[3].split(':')[1]), JSON.stringify(k.headers));
  t.check('only the next 5 are listed, with "ועוד 9 בהמשך"; the finished ones are collapsed', k.nextRows === 5 && k.more === 'ועוד 9 בהמשך' && k.doneOpen === 'false' && k.doneHidden === true, JSON.stringify(k));
  t.check('the progress line is still "24 מתוך 41" with the blocked count', /24 מתוך 41/.test(k.progress) && /2 חסומות/.test(k.progress), k.progress);
  t.check('the current task is in view, its long title wraps to two lines at most and the full title is in the tooltip', k.inView && Number(k.clamp) === 2 && k.ttlH <= 46 && /T25/.test(k.tip) && /חוזרת על עצמה עוד ועוד/.test(k.tip), JSON.stringify(k));
  t.check('group headers are sticky', k.sticky === 'sticky');
  await ev(`document.querySelector('.tg-more').click(); true`);
  k = await tasks();
  t.check('"ועוד 9 בהמשך" shows all 14 next tasks', k.nextRows === 14 && /הצגת פחות/.test(k.more || ''), JSON.stringify(k));
  await ev(`document.querySelector('.tg-toggle').click(); true`);
  k = await tasks();
  t.check('clicking "הושלמו (24)" expands the finished tasks', k.doneOpen === 'true' && k.doneHidden === false);
  t.check('the choice is remembered per pair (survives a reload)', await (async () => { await page.reload(); await page.appReady(0); await ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`); await page.waitFor(`!!document.querySelector('.tg-toggle')`, 15000); const x = await tasks(); return x.doneOpen === 'true'; })());
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול (Windows): נמחק בריצה הבאה */ }
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
