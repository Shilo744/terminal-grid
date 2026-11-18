'use strict';
// The Hebrew right-alignment layer, measured from the canvas pixels (no screenshots).
const path = require('path');
const { FIXTURES, TMP, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('RTL layer');
  const srv = await startServer({ stateFile: path.join(TMP, 'rtl-state.json'), binDir: path.join(FIXTURES, 'bin-heb'), env: { DEMO_COLS: '60' } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'Claude' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'PS' });
  await sleep(2500);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`);
  const { ev } = page;
  // ממתין לתנאי אמיתי (השכבה צוירה) במקום להמתנה קבועה
  await page.waitFor(`document.querySelectorAll('.tg-rtl').length === 1`, 30000);

  const stats = () => ev(`(() => { const cs = [...document.querySelectorAll('.tg-rtl')]; if (!cs.length) return { canvases: 0, n: 0, left: 0, right: 0 };
    const c = cs[0]; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, left = 0, right = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i + 3] > 0) { n++; if (d[i] > 90 || d[i + 1] > 90 || d[i + 2] > 90) { if (x < c.width / 2) left++; else right++; } } }
    return { canvases: cs.length, w: c.width, n, left, right, pe: getComputedStyle(c).pointerEvents, inScreen: !!c.closest('.xterm-screen') }; })()`);
  // סטטיסטיקה אחרי שהציור התייצב: לא סיכום באמצע ציור מחדש. מחכה עד שהתנאי מתקיים (עד 8 שניות), ומחזירה את הקריאה האחרונה
  const until = async (pred, ms = 8000) => { let r = await stats(); for (let i = 0; i < ms / 150 && !pred(r); i++) { await sleep(150); r = await stats(); } return r; };
  let s = await until((x) => x.n > 500);
  t.check('only the Claude pane has the layer', s.canvases === 1);
  t.check('layer lives inside the terminal screen and is mouse-transparent', s.inScreen && s.pe === 'none');
  t.check('layer draws Hebrew rows', s.n > 500, `${s.n} px`);
  t.check('drawn text sits on the RIGHT side', s.right > s.left * 2 && s.right > 200, `left=${s.left} right=${s.right}`);
  t.check('the right-aligned segment is the active one by default', await ev(`document.querySelector('#rtlOn').getAttribute('aria-checked') === 'true' && document.querySelector('#rtlOff').getAttribute('aria-checked') === 'false'`) === true);

  await ev(`document.querySelector('#rtlOff').click()`);
  s = await until((x) => x.n === 0); t.check('choosing the left segment (OFF) clears the layer', s.n === 0);
  t.check('OFF is remembered', (await ev(`localStorage.getItem('tg.rtlLayer')`)) === 'false');
  await ev(`document.querySelector('#rtlOn').click()`);
  s = await until((x) => x.n > 500); t.check('choosing the right segment (ON) draws it again', s.n > 500);

  const wBig = s.w;
  await page.resize(1100, 700);
  s = await until((x) => x.w !== wBig && x.n > 300 && x.right > x.left * 1.3); t.check('after a window resize it is still on the right', s.n > 300 && s.right > s.left * 1.3, `left=${s.left} right=${s.right}`);
  const wNoSide = s.w;
  await ev(`document.querySelector('#sideBtn').click()`);
  s = await until((x) => x.w !== wNoSide && x.n > 300 && x.right > x.left * 1.3); t.check('with the side menu open it is still on the right', s.n > 300 && s.right > s.left * 1.3, `left=${s.left} right=${s.right}`);

  await page.resize(1500, 900);
  // 'לפני' נמדד רק כשהציור יציב (שתי קריאות רצופות כמעט זהות), אחרת ההשוואה לאחר מכן משווה לאמצע ציור
  let before = (await until((x) => x.n > 500)).n;
  for (let i = 0; i < 40; i++) { await sleep(200); const cur = (await stats()).n; if (Math.abs(cur - before) < 50) { before = cur; break; } before = cur; }
  const rect = await ev(`(() => { const r = document.querySelector('.pane .xterm-screen').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
  const px = rect.x + 70, py = rect.y + 24;
  for (const cc of [1, 2]) { await page.mouse('mousePressed', px, py, { clickCount: cc }); await page.mouse('mouseReleased', px, py, { clickCount: cc }); }
  await sleep(500);
  s = await stats();
  t.check('selecting a Hebrew row keeps it mirrored (T70: the layer is NOT hidden any more; the selection colour is painted on the canvas)', s.n >= before - 500, `${s.n} vs ${before}`);
  await page.mouse('mousePressed', rect.x + 300, rect.y + 500); await page.mouse('mouseReleased', rect.x + 300, rect.y + 500);
  s = await until((x) => x.n >= before - 200);
  t.check('clearing the selection brings it back', s.n >= before - 200, `${s.n} vs ${before}`);

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
