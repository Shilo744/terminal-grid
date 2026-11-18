/* ---------- הדבקה וגרירה של תמונות ושל טקסט ארוך לטרמינל Claude (T45, T53): מיידי, בלי לחכות ל-Claude ---------- */
// בעבר תמונה בלוח הפכה למקש Alt+V, ו-Claude Code עצמו הפעיל PowerShell כדי לקרוא את הלוח (שניות). עכשיו הדפדפן קורא את התמונה מאירוע ההדבקה או הגרירה
// (מילישניות), שולח את הבייטים ל-POST /api/paste-image, מקבל נתיב של קובץ זמני ומדביק אותו לטרמינל (term.paste: הדבקה מסוגרת), כמו גרירת קובץ תמונה לטרמינל:
// Claude מזהה נתיב של תמונה ומצרף אותה מיד. אם ההעלאה נכשלת בהדבקה, חוזרים להתנהגות הישנה (Alt+V). גרירה: עד 5 תמונות, שאר הקבצים מתעלמים מהם.
// טקסט ארוך (T53) עובר באותו אופן: הטקסט לא עובר דרך ConPTY (15-20KB לשנייה, שניות של המתנה), נשמר כקובץ בשרת, ובטרמינל מודבקת שורת הפניה אחת.
// כל תמונה נשמרת ברשימה של הפאן (pane.images: n, נתיב, שם, גודל, כתובת blob) לשימוש תצוגה מקדימה בהמשך.
import { state } from './state.js';
import { send } from './connection.js';
import { toast } from './toast.js';

const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_FILES = 5;
const MAX_LIST = 30;
// ספי הטקסט הארוך (T53), במקום אחד: יותר מ-4000 תווים או יותר מ-50 שורות. ConPTY מעביר כ-15-20KB לשנייה: 4000 תווים (עברית: ~8KB) הם כחצי שנייה, מתחת לזה
// ההמתנה לא מורגשת וההדבקה נשארת כמו שהייתה; 50 שורות של קוד הן בדרך כלל 2-3KB, והן כבר מציפות את תיבת ההקלדה של Claude בטקסט שאי אפשר לקרוא.
export const TEXT_FILE_MIN_CHARS = 4000;
export const TEXT_FILE_MIN_LINES = 50;
const TEXT_MAX_BYTES = 20 * 1024 * 1024; // כמו בשרת: מעל זה ההדבקה נשארת טקסט רגיל
const CHIP_MS = 8000;
export const lineCount = (text) => text.split(/\r\n|\r|\n/).length;
export const shouldFileText = (text) => typeof text === 'string' && (text.length > TEXT_FILE_MIN_CHARS || lineCount(text) > TEXT_FILE_MIN_LINES);

// Ctrl+Shift+V = "הדבק את הטקסט עצמו": pane-terminal.js מסמן את המקש, ואירוע ההדבקה שבא אחריו מדלג על שמירת הקובץ
let plainUntil = 0;
export const markPlainPaste = () => { plainUntil = Date.now() + 1500; };
export const isPlainPaste = () => Date.now() < plainUntil;
const isImage = (f) => !!f && TYPES.includes(f.type);
const quote = (p) => (/\s/.test(p) ? `"${p}"` : p); // נתיב עם רווח (תיקיית משתמש עם רווח) בגרשיים

// קבצי התמונה שבלוח או בגרירה: קודם items (צילום מסך), ואז files (קובץ שהועתק בסייר); בלי כפילויות
export function imagesIn(dt) {
  if (!dt) return [];
  const out = [];
  for (const it of dt.items || []) {
    if (it.kind !== 'file') continue;
    const f = it.getAsFile();
    if (isImage(f)) out.push(f);
  }
  if (!out.length) for (const f of dt.files || []) if (isImage(f)) out.push(f);
  return out.slice(0, MAX_FILES);
}

async function upload(file, paneId) {
  const name = encodeURIComponent((file.name || '').slice(0, 80));
  const r = await fetch(`/api/paste-image?id=${encodeURIComponent(paneId)}&name=${name}`, {
    method: 'POST', headers: { 'content-type': file.type, 'x-tg': '1' }, body: file,
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || 'upload failed');
  return (await r.json()).path;
}

// הצ'יפ בשורת הכותרת של הפאן (לא מעל טקסט הטרמינל): ספינר וטקסט, ובהדבקת טקסט אחרי השמירה גם שתי פעולות
function chip(paneEl, text) {
  const head = paneEl && paneEl.querySelector('.pane-head');
  if (!head) return null;
  const el = document.createElement('div');
  el.className = 'paste-chip';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span class="spin" aria-hidden="true"></span><span class="pc-text"></span>';
  el.querySelector('.pc-text').textContent = text;
  head.insertBefore(el, head.querySelector('.pstatus'));
  return el;
}

function remember(pane, file, path) {
  if (!pane) return;
  const list = pane.images || (pane.images = []);
  let url = '';
  try { url = URL.createObjectURL(file); } catch { /* אין blob */ }
  list.push({ n: (pane.imageSeq = (pane.imageSeq || 0) + 1), path, name: file.name || '', size: file.size, url });
  while (list.length > MAX_LIST) { const old = list.shift(); if (old.url) URL.revokeObjectURL(old.url); }
}

// טוקנים [Image #N] נמחקו מתיבת ההקלדה (Ctrl+A ומחיקה): הרשימה של הפאן מפסיקה להחזיק אותם (T74), בלי כתובות blob תלויות
export function dropImages(pane, numbers) {
  if (!pane || !pane.images) return;
  const gone = new Set(numbers);
  for (const i of pane.images) if (gone.has(i.n) && i.url) URL.revokeObjectURL(i.url);
  pane.images = pane.images.filter((i) => !gone.has(i.n));
}

export function releaseImages(pane) {
  for (const i of pane.images || []) if (i.url) URL.revokeObjectURL(i.url);
  pane.images = [];
}

// viaPaste: בהדבקה, כשל בהעלאה חוזר ל-Alt+V (Claude קורא את הלוח בעצמו, לאט אבל עובד); בגרירה אין לוח, רק הודעה
export async function attachImages(term, meta, files, { viaPaste = false } = {}) {
  const pane = state.panes.get(meta.id);
  const c = chip(pane && pane.el, files.length > 1 ? `מצרף ${files.length} תמונות…` : 'מצרף תמונה…');
  try {
    const paths = await Promise.all(files.map((f) => upload(f, meta.id)));
    files.forEach((f, i) => remember(pane, f, paths[i]));
    term.paste(paths.map(quote).join(' '));
  } catch (e) {
    if (viaPaste && meta.kind === 'claude') {
      send({ t: 'input', id: meta.id, d: '\x1bv' });
      toast('העלאת התמונה נכשלה, Claude יקרא אותה מהלוח (לאט יותר)', 'error');
    } else toast('העלאת התמונה נכשלה', 'error');
  } finally {
    if (c) c.remove();
  }
}

/* ---------- טקסט ארוך כקובץ (T53) ---------- */
// ההדבקה נבלעת באותו רגע, צ'יפ "שומר…" מופיע מיד, והשרת שומר קובץ. בטרמינל מודבקת שורה אחת: [text file: "<נתיב>" (N lines)]. בכל כשל (שרת לא זמין, מעל 20MB)
// חוזרים להדבקה הרגילה של הטקסט עצמו. אחרי השמירה הצ'יפ מציע "הצגה בסייר" ו"הדבקת הטקסט עצמו" ונעלם אחרי כ-8 שניות.
// ההתנהגות הבטוחה של "הדבקת הטקסט עצמו": מוחקים את שורת ההפניה במספר הרווחים-אחורה (Backspace) המדויק של אורכה, ורק כל עוד המשתמש לא הקליד כלום אחריה
// (Claude לא מזיז את הסמן מעצמו, ולכן הסמן עדיין צמוד להפניה). הקלדה כלשהי מסתירה את הפעולה: לא מנחשים מה יש בתיבת ההקלדה.
export async function attachText(term, meta, text) {
  const pane = state.panes.get(meta.id);
  if (new Blob([text]).size > TEXT_MAX_BYTES) { term.paste(text); return; }
  const c = chip(pane && pane.el, 'שומר את הטקסט כקובץ…');
  let res;
  try {
    const r = await fetch(`/api/paste-text?id=${encodeURIComponent(meta.id)}`, { method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8', 'x-tg': '1' }, body: text });
    if (r.status === 413) throw new Error('too large');
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || 'save failed');
    res = await r.json();
  } catch (e) {
    if (c) c.remove();
    term.paste(text);
    toast(e && e.message === 'too large' ? 'הטקסט גדול מדי כדי להישמר כקובץ, הודבק כמו שהוא' : 'שמירת הטקסט כקובץ נכשלה, הטקסט הודבק כמו שהוא', e && e.message === 'too large' ? 'info' : 'error');
    return;
  }
  const ref = `[text file: "${res.path}" (${res.lines} lines)]`;
  term.paste(ref);
  const at = Date.now();
  if (!c) return;
  c.replaceChildren();
  c.classList.add('done');
  c.innerHTML = '<span class="pc-ok" aria-hidden="true">✓</span><span class="pc-text"></span><button type="button" class="pc-act" data-act="reveal"></button><button type="button" class="pc-act" data-act="inline"></button>';
  const label = `הטקסט נשמר כקובץ (${res.lines} ${res.lines === 1 ? 'שורה' : 'שורות'})`;
  c.querySelector('.pc-text').textContent = label;
  c.title = `${label}\nהטקסט עצמו לא הועבר דרך הטרמינל. להדבקת הטקסט המלא כמו שהוא: Ctrl+Shift+V`; // בפאן צר הטקסט נחתך, והטולטיפ מציג אותו במלואו
  const reveal = c.querySelector('[data-act="reveal"]'), inline = c.querySelector('[data-act="inline"]');
  reveal.textContent = 'הצגה בסייר';
  reveal.title = 'פותח את תיקיית הקובץ בסייר הקבצים, עם הקובץ מסומן';
  inline.textContent = 'הדבקת הטקסט עצמו';
  inline.title = 'מחליף את שורת ההפניה בטקסט המלא (איטי יותר: הטקסט עובר דרך הטרמינל)';
  let timer = 0, watch = 0;
  const done = () => { clearTimeout(timer); clearInterval(watch); c.remove(); };
  reveal.addEventListener('click', () => {
    fetch('/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: meta.id, file: res.name }) })
      .then((r) => { if (!r.ok) toast('אי אפשר לפתוח את הקובץ בסייר', 'error'); }, () => toast('אי אפשר לפתוח את הקובץ בסייר', 'error'));
  });
  inline.addEventListener('click', () => {
    if (pane && pane.lastKey > at) { inline.hidden = true; return; }
    term.input('\x7f'.repeat([...ref].length)); // Backspace לכל תו של ההפניה
    term.paste(text);
    done();
  });
  // הקלדה אחרי ההפניה: אי אפשר למחוק אותה בבטחה, והפעולה נעלמת
  watch = setInterval(() => { if (pane && pane.lastKey > at) inline.hidden = true; }, 200);
  timer = setTimeout(done, CHIP_MS);
}

/* ---------- גרירה של קבצי תמונה על פאן ---------- */
const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

export function wireImageDrop(paneEl, term, meta) {
  if (!paneEl) return;
  const claude = true; // גרירת תמונה עובדת בכל טרמינל: בטרמינל רגיל הנתיב מודבק לשורת הפקודה
  let depth = 0, hint = null;
  const show = () => {
    if (hint) return;
    const body = paneEl.querySelector('.pane-body');
    hint = document.createElement('div');
    hint.className = 'drop-hint';
    hint.textContent = 'שחררו להדבקת נתיב התמונה';
    body.appendChild(hint);
  };
  const hide = () => { depth = 0; if (hint) { hint.remove(); hint = null; } };
  paneEl.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    if (claude) show();
  });
  paneEl.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // בלי זה הדפדפן היה פותח את הקובץ במקום האפליקציה
    e.dataTransfer.dropEffect = claude ? 'copy' : 'none';
  });
  paneEl.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) hide();
  });
  paneEl.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hide();
    if (!claude) { toast('גרירת תמונות עובדת רק בטרמינל של Claude', 'error'); return; }
    const all = [...e.dataTransfer.files];
    const imgs = all.filter(isImage).slice(0, MAX_FILES);
    if (!imgs.length) { toast('אפשר לגרור לכאן רק קבצי תמונה (png, jpg, gif, webp)', 'error'); return; }
    if (all.length > imgs.length) toast(all.length > MAX_FILES && all.filter(isImage).length > MAX_FILES ? `הודבקו ${MAX_FILES} תמונות (המקסימום)` : 'הודבקו רק קבצי התמונה');
    attachImages(term, meta, imgs);
  });
}
