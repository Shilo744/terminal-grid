'use strict';
/*
 * כלי צילום סצנות (ידני, לא חלק מ-`npm test`): צילום מסך אמיתי של האפליקציה במצבים קבועים, בכמה גדלים.
 *
 *   node tests/tools/scenes.js [scene ...] [--size 1920x1080] [--size 1100x700] [--out docs/screens/before] [--style classic|graphite|midnight] [--accent teal|blue|violet|green|amber|rose]
 *
 *   בלי שמות סצנות (או "all") = כל הסצנות. בלי --size = 1920x1080 ו-1100x700 (אפשר גם --size 1920x1080,1100x700).
 *   הקבצים: <out>/<scene>-<רוחב>x<גובה>.png. רשימת הסצנות והגדרתן: tests/tools/scene-defs.js.
 *
 * איך זה עובד: כל סצנה מקבלת שרת זמני משלה (פורט חופשי, מצב נפרד, claude מזויף מ-tests/fixtures) על העתק של האפליקציה.
 * הטרמינלים נפתחים בשרת לפני העמוד, ואחר כך Chrome אמיתי (chromeScreenshot) טוען את העמוד. מצבים שדורשים לחיצה
 * (תפריטים, חלונות) נעשים על ידי סקריפט שמוזרק ל-index.html של ההעתק בלבד (scene-client.js + קוד ה-page של הסצנה).
 * נתוני היסטוריה וסוכנים פתוחים מוחלפים בנתוני דמה, כדי שלא יופיע מידע אישי בצילומים.
 */
const path = require('path');
const fs = require('fs');
const { APP, TMP, FIXTURES, sleep, startServer, connect, chromeScreenshot } = require('../lib/harness');
const { makeAppCopy } = require('./lib/app-copy');
const { scenes } = require('./scene-defs');

const DEFAULT_SIZES = ['1920x1080', '1100x700'];
const COPY = path.join(TMP, 'scenes-app');
const WORK = path.join(TMP, 'scenes-work');

const FRAME = '__frame.html';
// זמן וירטואלי: הצילום נלקח רק כשהוא נגמר, אז הוא צריך להיות ארוך מזמן הטעינה והתסריט, כדי שפריסה שמחכה לפריים הבא תסתיים
const BUDGET = 40000;
// בלי שינוי מתמיד על המסך, Chrome שבלי ראש לא מצייר פריים נוסף אחרי השינוי האחרון, ופריסה שמחכה ל-requestAnimationFrame
// (למשל אחרי פתיחת תפריט הצד) לא הייתה מסתיימת לפני הצילום. אנימציה זעירה ובלתי נראית מחזיקה את הפריימים רצים.
// כל שאר האנימציות והמעברים מושבתים (חוץ מזו): צילום שנתפס באמצע פתיחת חלון הוא לא דטרמיניסטי
const KEEP_FRAMES = '@keyframes tgFrames{from{opacity:.99}to{opacity:1}} html::after{content:"";position:fixed;inset-inline-end:0;bottom:0;width:1px;height:1px;pointer-events:none;animation:tgFrames 50ms linear infinite}' +
  ' *:not(html),*:not(html)::before,*:not(html)::after{animation-duration:1ms !important;animation-delay:0s !important;animation-iteration-count:1 !important;transition-duration:0s !important;transition-delay:0s !important}';

// חלון Chrome שבלי ראש (headless=new) הוא חלון אמיתי עם מסגרת: אזור התצוגה קטן ב-22x98 פיקסלים מגודל החלון, ואחרי הטעינה
// הצילום נמתח לגודל החלון. הפריסה של האפליקציה (JS, ResizeObserver) נמדדה על האזור הקטן ולכן נחתכה או נשארה קטנה.
// iframe בגודל המדויק שביקשנו נותן לאפליקציה אזור תצוגה אמיתי של WxH, גם ל-media queries.
const frameHtml = (w, h) => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:#0a0d13}iframe{position:absolute;left:0;top:0;width:${w}px;height:${h}px;border:0}</style><iframe src="/"></iframe>`;

function parseArgs(argv) {
  const opts = { names: [], sizes: [], out: path.join(APP, 'docs', 'screens', 'scenes') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--size') opts.sizes.push(...String(argv[++i] || '').split(','));
    else if (a === '--out') opts.out = path.resolve(argv[++i] || '');
    else if (a === '--style') opts.style = argv[++i];   // קלאסי/גרפיט/חצות: classic | graphite | midnight (T36)
    else if (a === '--accent') opts.accent = argv[++i]; // teal | blue | violet | green | amber | rose
    else if (a.startsWith('--')) throw new Error('דגל לא מוכר: ' + a);
    else opts.names.push(a);
  }
  if (!opts.sizes.length) opts.sizes = DEFAULT_SIZES;
  for (const s of opts.sizes) if (!/^\d{3,5}x\d{3,5}$/.test(s)) throw new Error('גודל לא תקין: ' + s + ' (למשל 1920x1080)');
  return opts;
}

// מידות קובץ PNG מתוך הכותרת, כדי לוודא שהצילום באמת בגודל שביקשנו
function pngSize(file) {
  const b = fs.readFileSync(file);
  return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
}

function injectScene(def, expectPanes) {
  const cfg = { name: def.name, stubs: def.stubs, storage: def.storage || {}, expectPanes, settle: def.settle };
  const file = path.join(COPY, 'public', 'index.html');
  let html = fs.readFileSync(path.join(APP, 'public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, 'scene-client.js'), 'utf8');
  // לפני כל סקריפט של האפליקציה: הגדרות הסצנה ועוזרים (מודולים רצים בדחייה, אז זה קורה קודם)
  // החלפה עם פונקציה: במחרוזת החלפה רגילה "$$" ו-"$'" הם תחביר מיוחד והיו משבשים את הקוד המוזרק
  html = html.replace('</head>', () => `<style>${KEEP_FRAMES}</style>\n<script>window.__SCENE__ = ${JSON.stringify(cfg)};</script>\n<script>${client}</script>\n</head>`);
  const body = `<script>(async () => {
  const { $, $$, sleep, waitFor, click, ready, fail } = window.__sceneHelpers;
  const cfg = window.__SCENE__;
  try { await ready(); ${def.page || ''}
  } catch (e) { fail(e); }
})();</script>`;
  html = html.replace('</body>', () => body + '\n</body>');
  fs.writeFileSync(file, html);
}

async function openPanes(keeper, def) {
  const dirs = [];
  for (const p of def.panes || []) {
    const cwd = path.join(WORK, p.name);
    fs.mkdirSync(cwd, { recursive: true });
    keeper.send({ t: 'create', kind: p.kind, cwd, name: p.name });
    dirs.push(cwd);
    await sleep(250);
  }
  await sleep(2500); // PowerShell ו-claude המזויף צריכים רגע להדפיס את הפתיחה
  const ids = [...keeper.sessions.keys()];
  (def.panes || []).forEach((p, i) => { if (p.input) keeper.send({ t: 'input', id: ids[i], d: p.input + '\r' }); });
  if ((def.panes || []).some((p) => p.input)) await sleep(2200);
  if (def.view) {
    const pick = (n) => (n ? ids[n - 1] : null);
    keeper.send({ t: 'view', order: ids, expanded: pick(def.view.expanded), focus: pick(def.view.focus) });
    await sleep(500);
  }
  return ids;
}

// זוג לצילום. seed: הלוח מקבל משימות והודעות קבועות (הזמנים יחסיים לעכשיו) והזוג מושהה מיד, כדי שהסוכנים המזויפים לא ישנו את התמונה
const hhmm = (ms) => { const d = new Date(Date.now() - ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
// 41 משימות שנראות אמיתיות (T43): 24 הושלמו, אחת בעבודה, 14 ממתינות ושתיים חסומות: כך נראית רשימה של לילה ארוך
function manyTasks() {
  const titles = ['מבנה הפרויקט והגדרות בסיס', 'מערכת עיצוב: צבעים, גופנים ורווחים', 'עמוד הבית: כותרת, מחירון ו-CTA', 'ניווט עליון רספונסיבי', 'טופס הרשמה עם אימות שדות', 'שליחת מייל אישור הרשמה', 'חיבור לשירות התשלומים (Bit) כולל טיפול בכשלים וחזרות', 'עמוד אזור אישי', 'עריכת פרופיל והעלאת תמונה', 'רשימת מנויים עם סינון וחיפוש', 'ייצוא דוח חודשי ל-CSV', 'מנגנון הרשאות: מנהל, מאמן, מתאמן', 'לוח שעות שבועי', 'הרשמה לשיעור ואישור מקום', 'תור המתנה לשיעור מלא', 'התראות דחיפה לפני שיעור', 'עמוד מאמנים עם תמונות ותיאורים', 'בלוג: רשימה ועמוד מאמר', 'SEO: כותרות, תיאורים ו-sitemap', 'נגישות: מקלדת, ניגודיות וקוראי מסך', 'בדיקות יחידה לשכבת התשלומים', 'בדיקות קצה-לקצה להרשמה', 'אופטימיזציית תמונות וטעינה עצלה', 'תרגום ממשק לאנגלית ולערבית', 'בדיקות עומס לנקודת הקצה /orders', 'ניהול קופונים והנחות', 'דוחות הכנסות לפי חודש', 'שמירת העדפות משתמש בענן', 'אינטגרציה עם יומן Google', 'עמוד שאלות נפוצות', 'מדיניות פרטיות ותנאי שימוש', 'גיבוי אוטומטי של מסד הנתונים', 'ניטור שגיאות והתראות לצוות', 'מעבר לגרסה חדשה של מסגרת הבדיקות', 'תיעוד API לצוות החיצוני', 'סקריפט פריסה לסביבת בדיקות', 'סקריפט פריסה לייצור', 'בדיקת אבטחה: הזרקות, CSRF ו-XSS', 'עמוד 404 ועמוד שגיאה כללי', 'תיקון באגי RTL בטפסים', 'ליטוש סופי וסקירת עיצוב'];
  const lines = ['# Tasks', ''];
  titles.forEach((title, i) => {
    const n = i + 1;
    const mark = n <= 24 ? 'x' : n === 25 ? '~' : (n === 31 || n === 37) ? '!' : ' ';
    lines.push(`- [${mark}] T${n} — ${title}`);
    if (mark === 'x') lines.push('  Result: הושלם ונבדק');
    else if (mark === '!') lines.push('  חסום: ממתין להחלטה');
  });
  return lines;
}

function seedDuo(project, seed) {
  const dir = path.join(project, '.duo');
  fs.mkdirSync(dir, { recursive: true });
  const MIN = 60 * 1000;
  fs.writeFileSync(path.join(dir, 'TASKS.md'), seed === 'many' ? manyTasks().join('\n') + '\n' : [
    '# Tasks', '',
    '- [x] T1 — מבנה הפרויקט והגדרות בסיס', '  Result: נוצרו התיקיות והקובץ הראשי',
    '- [x] T2 — עמוד הבית: כותרת, מחירון ו-CTA', '  Result: מוכן, נבדק במובייל',
    '- [~] T3 — טופס הרשמה עם אימות שדות', '  בעבודה',
    '- [ ] T4 — חיבור לשירות התשלומים (Bit)', '  ממתין ל-T3',
    '- [!] T5 — בדיקות עומס לנקודת הקצה /orders', '  חסום: אין סביבת בדיקות',
    '- [ ] T6 — עמוד שאלות נפוצות', '  אחרי הטופס',
    '',
  ].join('\n'));
  // הפעילות בלוח (T78): בלי שיחה, רק STATUS.json עם ה-feed (המשימות שהסתיימו עוברות לארכיון בהפעלה הראשונה של הזוג)
  const ev = (author, ago, text, kind) => ({ t: Date.now() - ago * MIN, author, kind, text });
  fs.writeFileSync(path.join(dir, 'STATUS.json'), JSON.stringify({ v: 1, done: 0, doneIds: [], archiveSeq: 1, archiveCount: 0, recent: [], pendingReview: [], reportedBlocked: ['T5'], feed: [
    ev('user', 95, 'לבנות אתר מנוי לחדר כושר לפי המסמך שבתיקייה'),
    ev('architect', 93, 'הכנתי תוכנית של חמש משימות (T1-T5). העובד מקבל אותן אחת אחת, ואני אבדוק כשהתור יתרוקן.'),
    ev('worker', 71, 'T1 — מבנה הפרויקט והגדרות בסיס\nנוצרו התיקיות והקובץ הראשי; package.json והגדרות ה-lint.'),
    ev('worker', 69, 'T2 — עמוד הבית: כותרת, מחירון ו-CTA\nמוכן, נבדק ב-375px וב-1440px. המחירון עוד כתוב בקוד.'),
    ev('worker', 50, 'T5 — בדיקות עומס לנקודת הקצה /orders\nחסום: אין סביבת בדיקות', 'blocked'),
    ev('user', 12, 'אפשר להוסיף גם עמוד שאלות נפוצות? אחרי הטופס.'),
    ev('architect', 11, 'הוספתי את T6 לרשימה (עמוד שאלות נפוצות). T3 קודם.'),
  ] }));
}

async function openDuo(keeper, seed) {
  const project = path.join(WORK, 'duo-project');
  fs.mkdirSync(project, { recursive: true });
  try { fs.rmSync(path.join(project, '.duo'), { recursive: true, force: true }); } catch { /* אין */ }
  if (seed) seedDuo(project, seed);
  keeper.send({ t: 'duo', op: 'create', project, goal: seed ? '' : 'לבנות אתר מנוי לחדר כושר לפי המסמך שבתיקייה', permissionMode: 'auto', reqId: 'scene' });
  if (seed) {
    for (let i = 0; i < 100 && !keeper.messages.find((m) => m.t === 'duo' && m.op === 'created'); i++) await sleep(100);
    const created = keeper.messages.find((m) => m.t === 'duo' && m.op === 'created');
    if (created) keeper.send({ t: 'duo', op: 'pause', duoId: created.duoId });
    await sleep(8000); // הסוכנים המזויפים עולים ומדווחים "פנוי"
    return;
  }
  await sleep(14000); // מספיק לסבב מלא של הסוכנים המזויפים
}

// כל גודל מקבל שרת וטרמינלים חדשים: שינוי גודל של טרמינל חי בין שני צילומים מעוות את הטקסט שלו (הפריסה מחדש של ה-PTY)
async function renderOne(def, size, opts) {
  const stateFile = path.join(TMP, `scene-state-${def.name}.json`);
  const srv = await startServer({ cwd: COPY, stateFile, binDir: path.join(FIXTURES, def.bin || (def.duo ? 'bin-duo' : 'bin-heb')), env: def.env });
  const keeper = await connect(srv.port);
  try {
    const patch = { ...def.settings };
    if (opts.style || opts.accent) patch.appearance = { ...patch.appearance, ...(opts.style && { style: opts.style }), ...(opts.accent && { accent: opts.accent }) };
    if (Object.keys(patch).length) { keeper.send({ t: 'settings:set', patch }); await sleep(300); }
    if (def.duo) await openDuo(keeper, def.duoSeed); else await openPanes(keeper, def);
    injectScene(def, def.duo ? 2 : (def.panes || []).length);
    const [w, h] = size.split('x').map(Number);
    const out = path.join(opts.out, `${def.name}${opts.style ? '-' + opts.style : ''}${opts.accent ? '-' + opts.accent : ''}-${size}.png`);
    try { fs.unlinkSync(out); } catch { /* אין קובץ ישן */ }
    fs.writeFileSync(path.join(COPY, 'public', FRAME), frameHtml(w, h));
    const ok = chromeScreenshot(`http://127.0.0.1:${srv.port}/${FRAME}`, out, { width: w, height: h, budget: BUDGET });
    const dims = ok ? pngSize(out) : '';
    console.log(`${ok && dims === size ? 'OK  ' : 'FAIL'} ${def.name} ${size}${ok ? '  -> ' + path.relative(APP, out) + (dims !== size ? `  (גודל בפועל ${dims})` : '') : '  (אין צילום)'}`);
    return ok && dims === size;
  } finally {
    keeper.close();
    srv.stop();
  }
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const wanted = opts.names.length && !opts.names.includes('all') ? opts.names : scenes.map((s) => s.name);
  const unknown = wanted.filter((n) => !scenes.some((s) => s.name === n));
  if (unknown.length) { console.error('סצנה לא קיימת: ' + unknown.join(', ') + '\nקיימות: ' + scenes.map((s) => s.name).join(', ')); process.exit(2); }
  fs.mkdirSync(opts.out, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  makeAppCopy(COPY, { allowFraming: true });
  let bad = 0;
  for (const name of wanted) for (const size of opts.sizes) if (!(await renderOne(scenes.find((s) => s.name === name), size, opts))) bad++;
  console.log(bad ? `\n${bad} סצנות נכשלו` : '\nכל הסצנות צולמו');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
