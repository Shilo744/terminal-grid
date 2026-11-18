'use strict';
// renderer-pool.js: תקציב WebGL (לכל היותר 8, מי שהמיקוד אצלו ישן ממנו מפסיד) והסתרת פאנים שלא נראים; tile-preview.js: שתי שורות הפלט האחרונות.
// המודולים של הלקוח הם ES modules בלי תלות בדפדפן בלוגיקה עצמה, והתוסף של WebGL מוזרק, ולכן אפשר לבדוק אותם כאן בלי Chrome.
const path = require('path');
const { pathToFileURL } = require('url');
const { checker } = require('../lib/harness');

const load = (f) => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', f)).href);
const t = checker('renderer pool + tile preview (unit)');

// פאן מדומה: host עם style, term עם loadAddon/refresh/rows
function fakePane(name, focusedAt = 0) {
  const p = {
    name, focusedAt, webgl: null, rendering: null, lastVW: 99, host: { style: {} },
    term: {
      rows: 24, refreshed: 0, loadAddon() {}, refresh() { p.term.refreshed++; },
      buffer: { active: { viewportY: 50, baseY: 50 } }, scrolls: [], handlers: [],
      scrollToBottom() { p.term.buffer.active.viewportY = p.term.buffer.active.baseY; p.term.scrolls.push('bottom'); },
      scrollToLine(y) { p.term.buffer.active.viewportY = y; p.term.scrolls.push(y); },
      onScroll(fn) { p.term.handlers.push(fn); return { dispose() { p.term.handlers = p.term.handlers.filter((h) => h !== fn); } }; },
    },
  };
  return p;
}

(async () => {
  const { createRendererPool, MAX_WEBGL } = await load('renderer-pool.js');
  t.check('the budget is 8 WebGL contexts', MAX_WEBGL === 8);

  // תוסף מדומה שסופר כמה חיים
  let live = 0, created = 0;
  const frames = [];
  const makeAddon = () => { created++; live++; let lost = null; return { onContextLoss(fn) { lost = fn; }, dispose() { live--; }, lose() { lost && lost(); } }; };
  const pool = createRendererPool({ max: 8, createAddon: makeAddon, raf: (f) => frames.push(f) });
  const flush = () => { while (frames.length) frames.shift()(); };

  // 12 פאנים שנראים: ראשון נכנס ראשון, רק 8 מקבלים
  const panes = Array.from({ length: 12 }, (_, i) => fakePane('p' + i));
  for (const p of panes) pool.setRendering(p, true);
  t.check('12 visible panes: only 8 hold WebGL', pool.count() === 8 && live === 8, `count=${pool.count()} live=${live}`);
  t.check('the first 8 hold it, the rest use the DOM renderer', panes.slice(0, 8).every((p) => p.webgl) && panes.slice(8).every((p) => !p.webgl));
  t.check('a pane that becomes visible always has its size re-measured (lastVW reset)', panes.every((p) => p.lastVW === 0));

  // המיקוד עובר לפאן ללא WebGL: הוא מקבל, מי שהמיקוד אצלו הכי ישן מפסיד (ולא ב-8 הממוקדים לאחרונה)
  panes.forEach((p, i) => { p.focusedAt = i + 1; }); // p0 הכי ישן
  panes[10].focusedAt = 100;
  flush();
  const r0 = panes[0].term.refreshed, r10 = panes[10].term.refreshed;
  pool.promote(panes[10]);
  t.check('focusing a DOM pane gives it WebGL', !!panes[10].webgl);
  t.check('the pane focused longest ago lost it (p0), others kept', !panes[0].webgl && panes.slice(1, 8).every((p) => p.webgl));
  t.check('count never exceeds 8 after the swap', pool.count() === 8 && live === 8);
  flush();
  t.check('the pane that lost WebGL is redrawn from its buffer', panes[0].term.refreshed === r0 + 1 && panes[10].term.refreshed === r10 + 1);

  // פאן עם מיקוד ישן יותר מכולם לא גונב
  panes[11].focusedAt = 0;
  pool.promote(panes[11]);
  t.check('an older-focused pane cannot steal a context', !panes[11].webgl && pool.count() === 8);

  // הסתרה משחררת הקשר ומסתירה את ה-host; חזרה מציירת מחדש
  const hiddenBefore = pool.count();
  pool.setRendering(panes[1], false);
  t.check('a hidden pane releases its WebGL context and hides its host', !panes[1].webgl && panes[1].host.style.display === 'none' && pool.count() === hiddenBefore - 1 && live === hiddenBefore - 1);
  t.check('setRendering reports a change only once', pool.setRendering(panes[1], false) === false);
  flush();
  const before = panes[1].term.refreshed;
  pool.setRendering(panes[1], true);
  flush();
  t.check('showing it again restores the host, a context, and redraws', panes[1].host.style.display === '' && !!panes[1].webgl && panes[1].term.refreshed === before + 1 && panes[1].lastVW === 0);

  // גלילה: host מוסתר מאפס את הגלילה של xterm; בחזרה מחזירים את המקום (למטה / השורה שהייתה) ותופסים קפיצה מאוחרת לראש ההיסטוריה
  const sp = fakePane('scroll');
  pool.setRendering(sp, true); flush();
  pool.setRendering(sp, false); // היה למטה (50/50)
  pool.setRendering(sp, true); flush();
  t.check('a pane that was at the bottom is scrolled to the bottom when shown again', sp.term.scrolls.includes('bottom'));
  sp.term.buffer.active.viewportY = 0; sp.term.handlers.forEach((h) => h()); // הקפיצה המאוחרת לראש, כמו ש-xterm עושה אחרי הציור מחדש
  t.check('a late jump to the top is caught and undone', sp.term.buffer.active.viewportY === sp.term.buffer.active.baseY);
  const sq = fakePane('scrolled-up');
  pool.setRendering(sq, true); flush();
  sq.term.buffer.active.viewportY = 20; // המשתמש גלל למעלה
  sq.term.scrolls.length = 0;
  pool.setRendering(sq, false);
  pool.setRendering(sq, true); flush();
  t.check('a pane the user had scrolled up keeps that line (not forced to the bottom)', sq.term.scrolls.includes(20) && !sq.term.scrolls.includes('bottom'));
  sq.term.buffer.active.viewportY = 0; sq.term.handlers.forEach((h) => h());
  t.check('and a jump to the top is undone there too', sq.term.buffer.active.viewportY === 20);

  // אובדן הקשר מצד הדפדפן: משחררים בשקט וחוזרים ל-DOM
  const lostPane = panes[2];
  lostPane.webgl.lose();
  t.check('a lost context is released (falls back to DOM)', !lostPane.webgl && pool.count() === 7);

  // הקשר שלא ניתן ליצור (אין WebGL במחשב): הפאן ממשיך, בלי חריגה
  const noGl = createRendererPool({ max: 8, createAddon() { throw new Error('no webgl'); }, raf: (f) => f() });
  const q = fakePane('q');
  let threw = false;
  try { noGl.setRendering(q, true); } catch { threw = true; }
  t.check('without WebGL support the pane still renders (DOM) and nothing throws', !threw && !q.webgl && q.rendering === true && noGl.count() === 0);

  // מחסום: הפאנים הנסתרים לא סופרים. 30 פאנים, רק 3 נראים
  const many = Array.from({ length: 30 }, (_, i) => fakePane('m' + i));
  const pool2 = createRendererPool({ max: 8, createAddon: makeAddon, raf: (f) => f() });
  for (const p of many) pool2.setRendering(p, false);
  for (const p of many.slice(0, 3)) pool2.setRendering(p, true);
  t.check('hidden panes never hold contexts: 30 panes, 3 visible = 3 contexts', pool2.count() === 3);

  // ---------- שתי שורות הפלט האחרונות ----------
  const { lastLines } = await load('tile-preview.js');
  const term = (lines) => ({ buffer: { active: { length: lines.length, getLine: (y) => (lines[y] == null ? undefined : { translateToString: () => lines[y] }) } } });
  const blank = (n) => Array(n).fill('');
  t.check('the last two non-empty lines, oldest first', JSON.stringify(lastLines(term(['one', 'two', 'three', '', '  ', ...blank(3)]))) === JSON.stringify(['two', 'three']));
  t.check('a single line gives one line', JSON.stringify(lastLines(term(['only', ...blank(5)]))) === '["only"]');
  t.check('an empty screen gives nothing', lastLines(term(blank(10))).length === 0);
  const claudeBottom = ['● Reading the file', 'סיימתי את הבדיקה', '╭──────────────╮', '│ >            │', '╰──────────────╯', '  ? for shortcuts'];
  t.check('Claude input box and the shortcuts hint are not content', JSON.stringify(lastLines(term(claudeBottom))) === JSON.stringify(['● Reading the file', 'סיימתי את הבדיקה']));
  t.check('box characters around text are trimmed', lastLines(term(['│ build finished │']))[0] === 'build finished');
  t.check('long runs of spaces (table columns) are collapsed so the useful text fits', lastLines(term(['mib.bin                         4096']))[0] === 'mib.bin  4096');
  t.check('long histories only look at the bottom (bounded scan)', lastLines(term([...Array(500).fill('old line'), ...blank(200)])).length === 0);

  // paintTile כותב ל-DOM רק כשהטקסט השתנה
  const { paintTile } = await load('tile-preview.js');
  let writes = 0;
  const tl = () => { let v = ''; return { set textContent(x) { writes++; v = x; }, get textContent() { return v; }, title: '' }; };
  const els = [tl(), tl()];
  const tp = { tileSig: '', el: { querySelectorAll: () => els }, term: term(['alpha', 'beta']) };
  paintTile(tp);
  t.check('paintTile shows the two lines', els[0].textContent === 'alpha' && els[1].textContent === 'beta');
  const w1 = writes;
  paintTile(tp);
  t.check('same text: no DOM writes', writes === w1);
  tp.term = term(['alpha', 'beta', 'gamma']);
  paintTile(tp);
  t.check('new output: lines move up', els[0].textContent === 'beta' && els[1].textContent === 'gamma' && writes > w1);

  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
