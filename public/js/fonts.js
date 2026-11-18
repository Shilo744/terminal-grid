/* ---------- גופן הטרמינלים: סוג וגודל, כולל זום מהמקלדת ומהגלגלת ---------- */
import { MONO, FONTS } from './constants.js';
import { state } from './state.js';
import { getSetting, setSetting, onSetting, defaultOf } from './settings.js';
import { scheduleLayout } from './layout.js';

// רשימת מקבילות: הגופן שנבחר, ואחריו Cascadia של Windows Terminal (יש בו עברית), ואז שאר הברירות
export function fontStack() {
  const family = getSetting('terminal.fontFamily');
  const first = family && family !== 'TG Cascadia' ? `'${family}',` : '';
  return first + MONO;
}

// גודל חדש (מההגדרות, מהמקלדת או מחלון אחר): כל הטרמינלים עוקבים
// גרירת מחוון מייצרת עשרות שינויים בשנייה: ההחלה על כל הטרמינלים (ומדידה מחדש) פעם אחת לפריים, עם הערך האחרון (T38)
let sizeFrame = 0;
function applyFontSize() {
  if (sizeFrame) return;
  sizeFrame = requestAnimationFrame(() => {
    sizeFrame = 0;
    const size = getSetting('terminal.fontSize');
    for (const p of state.panes.values()) { p.term.options.fontSize = size; p.lastVW = 0; }
    scheduleLayout();
  });
}

const setFontSize = (n) => setSetting('terminal.fontSize', Math.max(9, Math.min(24, n)));

// גופן "מותקן" אם הרוחב של טקסט איתו שונה מהרוחב בגופן הברירת מחדל (שיטה רגילה, כי הדפדפן לא מציג רשימת גופנים)
function fontInstalled(name) {
  if (name === 'TG Cascadia') return true;
  const ctx = document.createElement('canvas').getContext('2d');
  const probe = 'mmmmmmmmmmlliWW@#';
  return ['monospace', 'serif'].some((base) => {
    ctx.font = `40px ${base}`;
    const w0 = ctx.measureText(probe).width;
    ctx.font = `40px '${name}',${base}`;
    return ctx.measureText(probe).width !== w0;
  });
}

// הגופנים מ-FONTS שמותקנים במחשב (הרשימה נמדדת פעם אחת): [{ value, label }]
let installed = null;
export function installedFonts() {
  if (!installed) installed = FONTS.filter(([value]) => fontInstalled(value)).map(([value, label]) => ({ value, label }));
  return installed;
}

function applyFontFamily() {
  for (const p of state.panes.values()) { p.term.options.fontFamily = fontStack(); p.lastVW = 0; }
  scheduleLayout();
}

/* ---------- זום: Ctrl + = / - / 0 וגלגלת עם Ctrl מעל טרמינל ---------- */
// שדות טקסט רגילים (חיפוש, שם) לא מושפעים; הטקסטארה של xterm היא שדה טקסט, אבל שם הקיצור צריך לעבוד
const typingField = (t) => !!t && t.matches && t.matches('input, textarea, select, [contenteditable]') && !t.classList.contains('xterm-helper-textarea');

function onZoomKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || typingField(e.target)) return;
  let handled = true;
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=') setFontSize(getSetting('terminal.fontSize') + 1);
  else if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') setFontSize(getSetting('terminal.fontSize') - 1);
  else if (e.code === 'Digit0' || e.code === 'Numpad0' || e.key === '0') setSetting('terminal.fontSize', defaultOf('terminal.fontSize'));
  else handled = false;
  // מבטלים גם את זום הדפדפן (Ctrl + = / - / 0 שייך לו כברירת מחדל)
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

let lastWheel = 0;
function onZoomWheel(e) {
  if (!e.ctrlKey || !e.target.closest || !e.target.closest('.pane-body')) return;
  e.preventDefault();
  const now = Date.now();
  if (now - lastWheel < 60) return; // גלגלת חופשית שולחת עשרות אירועים בשנייה: צעד אחד לכל ~60ms
  lastWheel = now;
  setFontSize(getSetting('terminal.fontSize') + (e.deltaY < 0 ? 1 : -1));
}

export function initFonts() {
  onSetting('terminal.fontFamily', applyFontFamily);
  onSetting('terminal.fontSize', applyFontSize);
  window.addEventListener('keydown', onZoomKey, true);
  document.addEventListener('wheel', onZoomWheel, { passive: false, capture: true });
}
