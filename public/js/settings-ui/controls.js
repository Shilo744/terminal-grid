/* ---------- רכיבי בקרה לפאנל ההגדרות ---------- */
// כל פונקציה מחזירה { el, set(value), focus() }. הערך משתנה דרך onChange(value); set() מעדכן את התצוגה בלי לקרוא ל-onChange.
// הנגישות מובנית: switch הוא button עם role="switch", המחוון הוא input range, והבחירה המקוטעת היא radiogroup עם חצים.
import { icon } from '../icons.js';

function node(tag, className, attrs = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
}

// מתג: Space/Enter מהכפתור עצמו, לחיצה מחליפה
export function createSwitch({ labelledBy, value, onChange }) {
  const el = node('button', 'sw', { type: 'button', role: 'switch', 'aria-labelledby': labelledBy });
  el.innerHTML = '<span class="sw-thumb" aria-hidden="true"></span>';
  const set = (v) => el.setAttribute('aria-checked', String(!!v));
  el.addEventListener('click', () => { const next = el.getAttribute('aria-checked') !== 'true'; set(next); onChange(next); });
  set(value);
  return { el, set, focus: () => el.focus() };
}

// מחוון: input range מקורי (מקלדת וקורא מסך בחינם) עם תצוגת ערך, ומילוי מסלול דרך משתנה CSS.
// הדפדפן עצמו תופס את המצביע בזמן גרירה ומחשב את הערך ממלבן המסלול הנוכחי בכל תנועה (אין מלבן שמור); כאן מוסיפים שני דברים (T38):
// (1) בזמן גרירה או הקלדה (ועוד 300ms אחרי) set() מתעלם: הד ישן מהשרת לא מחזיר את הידית אחורה; (2) רוחב קבוע לתווית הערך (settings.css), כדי שהמסלול לא יזוז באמצע גרירה.
export function createSlider({ labelledBy, value, min, max, step = 1, format = String, onChange }) {
  const wrap = node('div', 'slider');
  const input = node('input', 'rng', { type: 'range', min, max, step, 'aria-labelledby': labelledBy });
  const out = node('output', 'rng-val');
  out.setAttribute('dir', 'ltr');
  wrap.append(input, out);
  const paint = () => {
    out.textContent = format(Number(input.value));
    wrap.style.setProperty('--pct', ((Number(input.value) - min) / (max - min)) * 100 + '%');
  };
  let holding = false, releaseTimer = 0;
  const hold = () => { holding = true; clearTimeout(releaseTimer); };
  const release = () => { clearTimeout(releaseTimer); releaseTimer = setTimeout(() => { holding = false; }, 300); };
  for (const ev of ['pointerdown', 'keydown']) input.addEventListener(ev, hold);
  for (const ev of ['pointerup', 'pointercancel', 'keyup', 'blur']) input.addEventListener(ev, release);
  input.addEventListener('input', () => { paint(); onChange(Number(input.value)); });
  const set = (v) => { if (holding) return; input.value = v; paint(); };
  input.value = value; paint();
  return { el: wrap, set, focus: () => input.focus() };
}

// מספר: מתקבל בסיום ההקלדה (change), מוגבל לטווח; ערך לא תקין חוזר לערך הקודם
export function createNumber({ labelledBy, value, min, max, step = 1, unit = '', onChange }) {
  const wrap = node('div', 'numfield');
  const input = node('input', 'num', { type: 'number', min, max, step, inputmode: 'numeric', 'aria-labelledby': labelledBy });
  input.setAttribute('dir', 'ltr');
  wrap.append(input);
  if (unit) wrap.append(Object.assign(node('span', 'num-unit'), { textContent: unit }));
  let last = value;
  input.addEventListener('change', () => {
    const n = Number(input.value);
    if (input.value === '' || !Number.isFinite(n)) { input.value = last; return; }
    const v = Math.min(max, Math.max(min, Math.round(n / step) * step));
    input.value = v;
    if (v !== last) { last = v; onChange(v); }
  });
  const set = (v) => { last = v; if (document.activeElement !== input) input.value = v; }; // לא דורסים מספר שמקלידים כרגע
  last = value; input.value = value;
  return { el: wrap, set, focus: () => input.focus() };
}

// רשימה נפתחת (select מקורי). options: [{ value, label }]; הערך הנוכחי נשמר גם אם הוא לא ברשימה (למשל גופן שהוסר)
export function createSelect({ labelledBy, value, options, number = false, onChange }) {
  const el = node('select', 'sel', { 'aria-labelledby': labelledBy });
  // בחירה של מספרים (סף הדחיסה) מתויגת בעברית: מציגים אותה מימין לשמאל, כדי שהמספר בתחילת התווית ("400K טוקנים (מומלץ...)") לא יברח לקצה. גופנים באנגלית נשארים LTR
  if (number) el.classList.add('sel-rtl');
  for (const o of options) el.append(Object.assign(node('option'), { value: o.value, textContent: o.label }));
  el.addEventListener('change', () => onChange(number ? Number(el.value) : el.value));
  const set = (v) => {
    v = String(v);
    if (![...el.options].some((o) => o.value === v)) el.append(Object.assign(node('option'), { value: v, textContent: v }));
    el.value = v;
  };
  set(value);
  return { el, set, focus: () => el.focus() };
}

// בחירה מקוטעת: radiogroup עם tabindex מתגלגל וחצים (בעברית החץ הימני מתקדם אחורה, כי הכיוון הפוך)
// variant: 'cards' (כרטיסים עם תצוגה מקדימה: option.style = שם סגנון, מצויר בידי tokens.css) או 'dots' (עיגולי צבע לפי --sw-<value> ב-tokens.css; "default" = ההדגשה של הסגנון); בלי variant: כפתורי טקסט
export function createSegmented({ labelledBy, value, options, variant, onChange }) {
  const el = node('div', 'segmented' + (variant ? ' seg-' + variant : ''), { role: 'radiogroup', 'aria-labelledby': labelledBy });
  const buttons = options.map((o) => {
    const b = node('button', 'seg-opt', { type: 'button', role: 'radio' });
    b.dataset.value = o.value;
    if (variant === 'cards') {
      b.innerHTML = `<span class="st-prev" data-style="${o.style}" aria-hidden="true"><i class="pv-side"></i><i class="pv-main"><b></b><b></b><b class="pv-acc"></b></i><i class="pv-bar"></i></span>`;
      b.append(Object.assign(node('span', 'seg-name'), { textContent: o.label }));
    } else if (variant === 'dots') {
      b.style.setProperty('--sw', `var(--sw-${o.value})`); // הצבעים עצמם ב-tokens.css
      b.innerHTML = icon('check', 14);
      b.title = o.label;
      b.setAttribute('aria-label', o.label);
    } else b.textContent = o.label;
    el.append(b);
    return b;
  });
  const set = (v) => {
    for (const b of buttons) { const on = b.dataset.value === v; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
  };
  const pick = (b) => { set(b.dataset.value); b.focus(); onChange(b.dataset.value); };
  el.addEventListener('click', (e) => { const b = e.target.closest('.seg-opt'); if (b) pick(b); });
  el.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    let next = null;
    if (e.key === 'ArrowRight') next = i + (rtl ? -1 : 1);
    else if (e.key === 'ArrowLeft') next = i + (rtl ? 1 : -1);
    else if (e.key === 'ArrowDown') next = i + 1;
    else if (e.key === 'ArrowUp') next = i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    if (next == null) return;
    e.preventDefault();
    pick(buttons[(next + buttons.length) % buttons.length]);
  });
  set(value);
  return { el, set, focus: () => (buttons.find((b) => b.tabIndex === 0) || buttons[0]).focus() };
}

export const CONTROLS = { switch: createSwitch, slider: createSlider, number: createNumber, select: createSelect, segmented: createSegmented };
