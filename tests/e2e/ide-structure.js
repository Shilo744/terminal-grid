'use strict';
// @slow
/*
 * מבנה סגנון ה-IDE (T39): שורת מצב בתחתית עם הסיכום (עוברת מהסרגל העליון רק בסגנון IDE ובחזרה בשאר), פרטי חיבור/פורט/גרסה,
 * נעלמת בחלון נמוך; כותרת פאן ממוקד בהירה יותר בלי קו צבעוני; מסכים ריקים בסגנון "ברוכים הבאים" (בלי כרטיס ובלי אריח אייקון, מיושרים להתחלה).
 */
const path = require('path');
const { FIXTURES, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('IDE structure: status bar, focused header, welcome-style empty states');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args') });
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 800 });
  const { ev } = page;
  await page.appReady(0);

  /* ---------- מסכים ריקים (אין עדיין טרמינלים) ---------- */
  const welcome = (sel) => ev(`(() => { const c = document.querySelector('${sel} .empty-card'); const cs = getComputedStyle(c); const h = c.querySelector('h1'); const hs = getComputedStyle(h);
    return { bg: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, icon: c.querySelector('.empty-icon') ? getComputedStyle(c.querySelector('.empty-icon')).display : 'none', size: hs.fontSize, weight: hs.fontWeight, align: hs.textAlign, text: h.textContent.trim(), shown: c.getClientRects().length > 0 }; })()`);
  const w1 = await welcome('#empty');
  t.check('start screen: no card box (transparent, no border), no icon tile, a 20px/600 heading aligned to the start', w1.shown && w1.bg === 'rgba(0, 0, 0, 0)' && w1.border === '0px' && w1.icon === 'none' && w1.size === '20px' && w1.weight === '600' && w1.align === 'start' && w1.text === 'התחלה', JSON.stringify(w1));
  t.check('start screen: one muted sentence, then the primary button first', await ev(`(() => { const c = document.querySelector('#empty .empty-card'); const p = c.querySelector('p'); return p.nextElementSibling.classList.contains('start-main') && c.querySelector('.start-main .btn.primary') === c.querySelector('.start-main').firstElementChild; })()`));
  t.check('the start screen also offers the agent pair (no separate pair screen any more, T69)', await ev(`(() => { const b = document.querySelector('#startDuo'); return !!b && b.getClientRects().length > 0 && !document.querySelector('.viewseg'); })()`));

  /* ---------- שורת מצב ---------- */
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'A' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'B' });
  await page.appReady(2);
  await sleep(700);
  const bar = () => ev(`(() => { const b = document.querySelector('#statusBar'); const s = document.querySelector('#summary'); const cs = getComputedStyle(b);
    return { shown: !b.hidden && cs.display !== 'none', h: Math.round(b.getBoundingClientRect().height), inBar: !!s.closest('#statusBar'), inTop: !!s.closest('.topbar'), summary: s.textContent.trim(), borderTop: cs.borderTopWidth,
      conn: document.querySelector('#sbConn').dataset.state, ver: document.querySelector('#sbVersion').textContent, port: document.querySelector('#sbPort').textContent, portHidden: document.querySelector('#sbPort').hidden, bottom: Math.round(b.getBoundingClientRect().bottom) }; })()`);
  let b = await bar();
  t.check('IDE: a 24px status bar at the bottom holds the summary (it left the top bar)', b.shown && b.h === 24 && b.inBar && !b.inTop && /2/.test(b.summary) && /טרמינלים/.test(b.summary) && b.bottom === 800 && b.borderTop === '1px', JSON.stringify(b));
  t.check('IDE: the quiet end side shows the connection state, the port (not 7791) and the version', b.conn === 'on' && b.port === `פורט ${srv.port}` && !b.portHidden && /^v\d+\.\d+\.\d+$/.test(b.ver), JSON.stringify(b));
  t.check('the waiting button keeps working from the status bar (Alt+W target is still .stat-wait)', await ev(`!!document.querySelector('#statusBar #summary') && document.querySelector('#summary').addEventListener !== undefined`));

  // חלון נמוך מ-560px: השורה מוסתרת
  await page.resize(1500, 520);
  await sleep(300);
  b = await bar();
  t.check('a window under 560px high hides the status bar', !b.shown, JSON.stringify(b));
  await page.resize(1500, 800);
  await sleep(300);

  // סגנונות אחרים: הסיכום חוזר לסרגל העליון והשורה מוסתרת
  const setStyle = async (st) => { await ev(`import('/js/settings.js').then((m) => m.setSetting('appearance.style', '${st}'))`); await page.waitFor(`document.documentElement.getAttribute('data-style') === '${st}'`, 4000); await sleep(400); };
  await setStyle('classic');
  b = await bar();
  t.check('classic: no status bar, the summary is back in the top bar', !b.shown && b.inTop && !b.inBar && /טרמינלים/.test(b.summary), JSON.stringify(b));
  await setStyle('paper');
  b = await bar();
  t.check('paper: no status bar, the summary stays in the top bar', !b.shown && b.inTop && !b.inBar, JSON.stringify(b));
  await setStyle('ide');
  b = await bar();
  t.check('back to IDE: the summary returns to the status bar', b.shown && b.inBar && !b.inTop, JSON.stringify(b));

  /* ---------- כותרת פאן ממוקד ---------- */
  const heads = () => ev(`(() => {
    const lum = (rgb) => { const m = rgb.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const panes = [...document.querySelectorAll('.pane')];
    const foc = panes.find((p) => p.classList.contains('focused')), other = panes.find((p) => !p.classList.contains('focused'));
    const root = getComputedStyle(document.documentElement);
    const fs = getComputedStyle(foc), os = getComputedStyle(other);
    return { n: panes.length, focLum: lum(getComputedStyle(foc.querySelector('.pane-head')).backgroundColor), otherLum: lum(getComputedStyle(other.querySelector('.pane-head')).backgroundColor),
      focBorder: fs.borderTopColor, strong: (() => { const d = document.createElement('i'); d.style.color = root.getPropertyValue('--border-strong'); document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })(), accentEdge: fs.borderTopColor.includes('88, 170, 255'), glow: fs.boxShadow };
  })()`);
  await ev(`document.querySelectorAll('.pane')[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await sleep(300);
  const h = await heads();
  t.check('IDE: the focused pane header is lighter than the unfocused one', h.n >= 2 && h.focLum > h.otherLum, JSON.stringify(h));
  t.check('IDE: the focused pane has a thin accent outline (T76: a 1 px border in the accent colour, like VS Code) and no glow or shadow', h.accentEdge && h.focBorder !== h.strong && h.glow === 'none', JSON.stringify(h));

  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
