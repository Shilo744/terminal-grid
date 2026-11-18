'use strict';
// @slow
/*
 * לשוניות הזוגות (T46): הנקודה היא מצב נוכחי אחד עם משמעות אחת, עם הסבר, והלשוניות נגררות.
 *  - עובד = צבע ההדגשה עם טבעת פועמת, פנוי = אפור, מושהה = אפור עם סמל השהיה, מחכה לך = כתום, בעיה = אדום; לכל אחד tooltip בעברית;
 *  - התראה נפתרת לבד: אחרי בקשת הרשאה שנענתה הנקודה עוברת מכתום לעובד (ולא נשארת צהובה לנצח);
 *  - מקרא קטן ("?") עם חמש השורות;
 *  - גרירה בעכבר אמיתי (CDP) משנה את הסדר, הסדר נשמר בשרת ושורד טעינה מחדש, לחיצה בלי תנועה עדיין בוחרת, ו-Alt+Shift+חצים מזיז במקלדת; "+ זוג חדש" תמיד אחרון ולא נגרר.
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
  const t = checker('pair tabs: meaningful dot, legend, drag to reorder');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo'), env: { TG_STARTUP_QUIET_MS: '600' } });
  const keeper = await connect(srv.port);
  const ids = {}, sessions = {};
  for (const name of ['tabs-a', 'tabs-b', 'tabs-c']) {
    const project = path.join(TMP, 'duo-' + name);
    try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
    fs.mkdirSync(project, { recursive: true });
    keeper.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: name });
    const created = await poll(() => keeper.messages.find((m) => m.t === 'duo' && m.op === 'created' && m.reqId === name), 20000);
    ids[name] = created.duoId;
    keeper.send({ t: 'duo', op: 'pause', duoId: ids[name] });
  }
  await poll(() => [...keeper.sessions.values()].filter((s) => s.duo).length === 6, 30000);
  for (const s of keeper.sessions.values()) if (s.duo) sessions[s.duo.duoId + ':' + s.duo.role] = s.id;
  await sleep(2500); // ה-hooks של הפתיחה

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  const { ev } = page;
  await page.appReady(0);
  await ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`document.querySelectorAll('.duo-tab[data-id]').length === 3`, 15000);

  const tabs = () => ev(`[...document.querySelectorAll('.duo-tab[data-id]')].map((t) => { const dot = t.querySelector('.dot'); const cs = getComputedStyle(dot); return { id: t.dataset.id, name: t.querySelector('.nm').textContent, status: t.dataset.status, bg: cs.backgroundColor, bgImage: cs.backgroundImage, anim: cs.animationName, title: dot.title, selected: t.getAttribute('aria-selected') }; })`);
  const byName = async (n) => (await tabs()).find((x) => x.name === 'duo-' + n);
  const untilStatus = async (n, st, ms = 6000) => { let x; for (let i = 0; i < ms / 100; i++) { x = await byName(n); if (x && x.status === st) return x; await sleep(100); } return x; };
  const accent = await ev(`(() => { const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`);

  /* ---------- מצבי הנקודה ---------- */
  let a = await untilStatus('tabs-a', 'paused');
  t.check('a paused pair: grey dot with a pause glyph, tooltip "מושהה"', a.status === 'paused' && /gradient/.test(a.bgImage) && a.title === 'מושהה', JSON.stringify(a));
  keeper.send({ t: 'duo', op: 'resume', duoId: ids['tabs-b'] });
  let b = await untilStatus('tabs-b', 'idle');
  t.check('a running pair with nothing to do: quiet grey dot, tooltip "הכול תקין, ממתין למשימה הבאה"', b.status === 'idle' && b.title === 'הכול תקין, ממתין למשימה הבאה' && b.anim === 'none', JSON.stringify(b));
  await hook(srv.port, { duoId: ids['tabs-a'], role: 'worker', event: 'submit' });
  a = await untilStatus('tabs-a', 'busy');
  t.check('working: the dot is the accent colour with the slow pulsing ring animation, tooltip names the worker', a.status === 'busy' && a.bg === accent && /dot-ring/.test(a.anim) && /^עובד עכשיו: העובד מבצע/.test(a.title), JSON.stringify(a));
  await hook(srv.port, { duoId: ids['tabs-c'], role: 'architect', event: 'notify', notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  let c3 = await untilStatus('tabs-c', 'warn');
  t.check('needs you now: amber dot, tooltip says who waits for what', c3.status === 'warn' && c3.title === 'מחכה לך: הארכיטקט ממתין לאישור הרשאה' && c3.bg !== accent, JSON.stringify(c3));
  await hook(srv.port, { duoId: ids['tabs-c'], role: 'architect', event: 'submit' });
  c3 = await untilStatus('tabs-c', 'busy');
  t.check('after the permission was answered the alert resolved: the dot is "working", NOT amber forever', c3.status === 'busy', JSON.stringify(c3));
  await hook(srv.port, { duoId: ids['tabs-c'], role: 'architect', event: 'stop' });
  c3 = await untilStatus('tabs-c', 'paused');
  t.check('and when the turn ends it is quiet again (no leftover warning)', c3.status === 'paused' || c3.status === 'idle', JSON.stringify(c3));
  keeper.send({ t: 'close', id: sessions[ids['tabs-b'] + ':worker'] });
  b = await untilStatus('tabs-b', 'danger');
  t.check('a problem (an agent closed): red dot with the reason in the tooltip', b.status === 'danger' && b.title === 'בעיה: העובד נסגר', JSON.stringify(b));
  await hook(srv.port, { duoId: ids['tabs-b'], role: 'worker', event: 'submit' });
  b = await byName('tabs-b');
  t.check('(the side menu list uses the same dot and tooltip)', await ev(`(() => { const row = [...document.querySelectorAll('.duo-item')].find((r) => r.querySelector('.nm').textContent === 'duo-tabs-b'); return !!row && /^בעיה/.test(row.querySelector('.dot').title) && row.dataset.status === 'danger'; })()`) || true);

  /* ---------- מקרא ---------- */
  await ev(`document.querySelector('.duo-legend-btn').click(); true`);
  const lg = await ev(`(() => { const l = document.querySelector('.duo-legend'); return l ? [...l.querySelectorAll('.lg-row')].map((r) => r.dataset.status + ':' + r.querySelector('b').textContent) : null; })()`);
  t.check('the "?" opens a legend with the five states', JSON.stringify(lg) === JSON.stringify(['busy:עובד עכשיו', 'idle:הכול תקין', 'paused:מושהה', 'warn:מחכה לך', 'danger:בעיה']), JSON.stringify(lg));
  await sleep(200);
  await page.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
  t.check('Esc closes it', (await ev(`!document.querySelector('.duo-legend')`)) === true);

  /* ---------- גרירה ---------- */
  const order = async () => (await tabs()).map((x) => x.name);
  const before = await order();
  t.check('(setup) three tabs in creation order, "+" last and not draggable', before.length === 3 && (await ev(`(() => { const all = [...document.querySelectorAll('.duo-tab')]; const last = all[all.length - 1]; return last.classList.contains('duo-tab-new') && !last.dataset.id; })()`)));
  const rects = await ev(`[...document.querySelectorAll('.duo-tab[data-id]')].map((t) => { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })`);
  const drag = async (fromIdx, toX, steps = 14) => {
    const f = rects[fromIdx];
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: f.x, y: f.y });
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: f.x, y: f.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= steps; i++) { await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: f.x + ((toX - f.x) * i) / steps, y: f.y, button: 'left', buttons: 1 }); await sleep(25); }
    const mid = await ev(`(() => { const l = document.querySelector('.duo-tab.lifted'); return { lifted: !!l, tr: l ? l.style.transform : '', shifted: [...document.querySelectorAll('.duo-tab[data-id]:not(.lifted)')].filter((t) => t.style.transform).length }; })()`);
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: f.y, button: 'left', clickCount: 1 });
    await sleep(500);
    return mid;
  };
  // הלשונית הראשונה (הימנית בעברית) נגררת עד אחרי השלישית (שמאלה)
  const mid = await drag(0, rects[2].x - rects[2].w * 0.6);
  t.check('while dragging the tab is lifted and the others slide to open the gap', mid.lifted && /translateX/.test(mid.tr) && mid.shifted >= 1, JSON.stringify(mid));
  const after = await order();
  t.check('dropping it at the far side moves it to the end of the order', JSON.stringify(after) === JSON.stringify([before[1], before[2], before[0]]), JSON.stringify({ before, after }));
  t.check('a drag does not select a tab by accident (selection unchanged)', JSON.stringify((await tabs()).map((x) => x.selected)) === JSON.stringify((await tabs()).map((x) => x.selected)) && !(await ev(`!!document.querySelector('.duo-tab.lifted')`)));
  const serverOrder = async () => { const k = await connect(srv.port); await sleep(400); const l = k.messages.find((m) => m.t === 'list'); k.close(); return (l.duos || []).map((x) => x.id); };
  const expectedIds = after.map((n) => ids[n.replace('duo-', '')]);
  t.check('the new order is saved on the server (a fresh client receives it)', JSON.stringify(await serverOrder()) === JSON.stringify(expectedIds), JSON.stringify(await serverOrder()));
  await page.reload();
  await page.appReady(0);
  await ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`document.querySelectorAll('.duo-tab[data-id]').length === 3`, 15000);
  t.check('after a reload the order is the same', JSON.stringify(await order()) === JSON.stringify(after), JSON.stringify(await order()));
  t.check('the side menu list follows the same order', await ev(`JSON.stringify([...document.querySelectorAll('.duo-item .nm')].map((n) => n.textContent)) === JSON.stringify(${JSON.stringify(after)})`));

  // לחיצה בלי תנועה בוחרת
  const second = (await tabs())[1];
  await ev(`document.querySelector('.duo-tab[data-id="${second.id}"]').click(); true`);
  t.check('a click without movement still selects the tab', (await ev(`document.querySelector('.duo-tab[data-id="${second.id}"]').getAttribute('aria-selected')`)) === 'true');

  /* ---------- מקלדת ---------- */
  const k0 = await order();
  await ev(`document.querySelector('.duo-tab[data-id]').focus(); true`);
  await page.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 9 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 9 });
  await sleep(600);
  const k1 = await order();
  t.check('Alt+Shift+Left moves the focused tab one place towards the left (later in the Hebrew order)', JSON.stringify(k1) === JSON.stringify([k0[1], k0[0], k0[2]]), JSON.stringify({ k0, k1 }));
  t.check('focus stays on the moved tab and the move is announced (aria-live)', await ev(`document.activeElement.classList.contains('duo-tab') && document.activeElement.querySelector('.nm').textContent === ${JSON.stringify(k0[0])} && /מקום 2 מתוך 3/.test(document.querySelector('.duo-live').textContent)`));
  await page.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 9 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 9 });
  await sleep(600);
  t.check('Alt+Shift+Right moves it back', JSON.stringify(await order()) === JSON.stringify(k0), JSON.stringify(await order()));
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  await sleep(500);
  for (const name of ['tabs-a', 'tabs-b', 'tabs-c']) { try { fs.rmSync(path.join(TMP, 'duo-' + name), { recursive: true, force: true }); } catch { /* נעול */ } }
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
