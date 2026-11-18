/* ---------- תפריט קופץ משותף ---------- */
// openMenu({ anchor | point, items, onSelect, onClose, align, focus, label }) -> { el, close(), isOpen() }.
//   items: { id, label, description?, icon?, hint? (טקסט קיצור, מוצג משמאל לימין), disabled?, danger?, checked?, run?, separator? }
//   anchor: אלמנט שהתפריט נפתח תחתיו (או מעליו אם אין מקום); point: { x, y } בלחיצה ימנית. align: 'start' (ברירת מחדל) | 'end' ביחס לכיוון הדף.
// בעברית (RTL) התפריט נפתח לכיוון סוף השורה (שמאלה), וחוזר פנימה אם אין מקום. תפריט אחד פתוח בכל רגע.
// מקלדת: חצים, Home/End, הקלדת אות לקפיצה, Enter/רווח מפעילים, Esc סוגר ומחזיר מיקוד, Tab סוגר. עכבר: לחיצה בחוץ סוגרת.
import { icon } from './icons.js';

const MARGIN = 8;   // מרווח מינימלי מקצה החלון
const GAP = 6;      // רווח בין העוגן לתפריט

let current = null;

export function closeMenu(reason = 'api') { if (current) current.close(reason); }

function node(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function buildItem(item, leading) {
  if (item.separator) { const s = node('div', 'menu-sep'); s.setAttribute('role', 'separator'); return s; }
  const checkable = item.checked !== undefined;
  const b = node('button', 'menu-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : ''));
  b.type = 'button';
  b.tabIndex = -1;
  b.dataset.id = item.id;
  b.setAttribute('role', checkable ? 'menuitemcheckbox' : 'menuitem');
  if (checkable) b.setAttribute('aria-checked', String(!!item.checked));
  if (item.disabled) b.setAttribute('aria-disabled', 'true');
  if (leading) {
    const lead = node('span', 'mi-lead');
    lead.innerHTML = item.icon ? icon(item.icon, 16) : (item.checked ? icon('check', 16) : '');
    b.append(lead);
  }
  const text = node('span', 'mi-text');
  text.append(node('span', 'mi-label', item.label));
  if (item.description) { const d = node('bdi', 'mi-desc', item.description); d.setAttribute('dir', 'auto'); text.append(d); b.title = item.description; }
  b.append(text);
  if (item.hint) { const h = node('span', 'mi-hint', item.hint); h.setAttribute('dir', 'ltr'); b.append(h); }
  return b;
}

// מיקום: מתחת לעוגן (או מעליו), או בנקודה; מצמידים לחלון ובודקים צד חלופי לפני שמצמידים
function place(menu, { anchor, point, align }) {
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  menu.style.maxHeight = `${vh - 2 * MARGIN}px`;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
  let left, top;

  if (anchor) {
    const r = anchor.getBoundingClientRect();
    // start: קצה ההתחלה של התפריט מיושר לקצה ההתחלה של העוגן, והוא נפתח לכיוון הסוף. end: ההפך.
    const startAligned = align !== 'end';
    const leftIfStart = rtl ? r.right - w : r.left;
    const leftIfEnd = rtl ? r.left : r.right - w;
    left = startAligned ? leftIfStart : leftIfEnd;
    const fits = (x) => x >= MARGIN && x + w <= vw - MARGIN;
    if (!fits(left)) { const other = startAligned ? leftIfEnd : leftIfStart; if (fits(other)) left = other; }
    top = r.bottom + GAP;
    if (top + h > vh - MARGIN && r.top - GAP - h >= MARGIN) top = r.top - GAP - h;
  } else {
    const p = point || { x: 0, y: 0 };
    // בלחיצה ימנית ב-RTL התפריט נפתח שמאלה מהסמן, וב-LTR ימינה; בלי מקום - לצד השני
    left = rtl ? p.x - w : p.x;
    if (left < MARGIN || left + w > vw - MARGIN) { const flipped = rtl ? p.x : p.x - w; if (flipped >= MARGIN && flipped + w <= vw - MARGIN) left = flipped; }
    top = p.y;
    if (top + h > vh - MARGIN && p.y - h >= MARGIN) top = p.y - h;
  }
  left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - w - MARGIN));
  top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - h - MARGIN));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

export function openMenu({ anchor = null, point = null, items, onSelect, onClose, align = 'start', focus = 'first', label = '' }) {
  if (current) current.close('replace');

  const opener = document.activeElement;
  const leading = items.some((i) => !i.separator && (i.icon || i.checked !== undefined));
  const menu = node('div', 'menu' + (leading ? ' has-lead' : ''));
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  if (label) menu.setAttribute('aria-label', label);
  for (const it of items) menu.append(buildItem(it, leading));
  // תפריט שנפתח מתוך חלון modal חייב להיות בתוכו, אחרת השכבה העליונה של ה-<dialog> מכסה אותו (position: fixed נשאר יחסי לחלון)
  (document.querySelector('dialog[open]') || document.body).append(menu);
  place(menu, { anchor, point, align });

  const enabled = () => [...menu.querySelectorAll('.menu-item:not(.disabled)')];
  const setActive = (el, doFocus = true) => {
    for (const b of menu.querySelectorAll('.menu-item')) b.tabIndex = b === el ? 0 : -1;
    if (el && doFocus) el.focus({ preventScroll: false });
  };
  const move = (delta) => {
    const list = enabled();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    setActive(list[i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length]);
  };

  let closed = false;
  const handle = {
    el: menu,
    isOpen: () => !closed,
    // reason: 'select' | 'escape' | 'outside' | 'replace' | 'api' | 'tab' | 'resize'; במקרים שהמשתמש לא בחר מחזירים מיקוד לפותח
    close(reason = 'api') {
      if (closed) return;
      closed = true;
      if (current === handle) current = null;
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('contextmenu', onOutside, true);
      document.removeEventListener('wheel', onOutside, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
      menu.remove();
      if (anchor) anchor.setAttribute('aria-expanded', 'false');
      // המיקוד חוזר לעוגן (הכפתור שפתח), ואם אין עוגן למי שהיה ממוקד: לחיצה בעכבר על כפתור לא תמיד ממקדת אותו (בדפדפנים אחרים), ואז opener הוא ה-body
      const back = anchor && anchor.isConnected ? anchor : (opener && opener.isConnected ? opener : null);
      if ((reason === 'escape' || reason === 'select' || reason === 'tab') && back && back.focus) back.focus();
      if (onClose) onClose({ reason });
    },
  };
  // לחיצה על העוגן עצמו לא נחשבת "בחוץ": ה-click של העוגן סוגר את התפריט (toggle), ואחרת הוא היה נסגר ונפתח מחדש מיד
  const onOutside = (e) => { if (menu.contains(e.target) || (anchor && e.type === 'pointerdown' && anchor.contains(e.target))) return; handle.close('outside'); };
  const onResize = () => handle.close('resize');
  const onBlur = () => handle.close('outside');

  const choose = (el) => {
    if (!el || el.classList.contains('disabled')) return;
    const item = items.find((i) => i.id === el.dataset.id);
    handle.close('select');
    if (!item) return;
    if (item.run) item.run(item);
    if (onSelect) onSelect(item);
  };

  menu.addEventListener('click', (e) => { const b = e.target.closest('.menu-item'); if (b) choose(b); });
  // העכבר והמקלדת חולקים את אותו פריט פעיל
  menu.addEventListener('mousemove', (e) => { const b = e.target.closest('.menu-item:not(.disabled)'); if (b && b !== document.activeElement) setActive(b); });

  let typed = '', typedTimer = null;
  menu.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowDown') move(1);
    else if (k === 'ArrowUp') move(-1);
    else if (k === 'Home') setActive(enabled()[0]);
    else if (k === 'End') setActive(enabled().at(-1));
    else if (k === 'Enter' || k === ' ') choose(document.activeElement.closest('.menu-item'));
    else if (k === 'Escape') handle.close('escape');
    else if (k === 'Tab') handle.close('tab');
    else if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // הקלדת אות (או כמה ברצף) קופצת לפריט שמתחיל בה
      typed += k.toLowerCase();
      clearTimeout(typedTimer);
      typedTimer = setTimeout(() => { typed = ''; }, 700);
      const list = enabled();
      const from = Math.max(0, list.indexOf(document.activeElement)) + (typed.length === 1 ? 1 : 0);
      const hit = [...list.slice(from), ...list.slice(0, from)].find((b) => $label(b).toLowerCase().startsWith(typed));
      if (hit) setActive(hit);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('contextmenu', onOutside, true);
  document.addEventListener('wheel', onOutside, { capture: true, passive: true }); // גלילה מחוץ לתפריט סוגרת אותו (T57)
  window.addEventListener('resize', onResize);
  window.addEventListener('blur', onBlur);

  if (anchor) anchor.setAttribute('aria-expanded', 'true');
  const list = enabled();
  if (focus !== 'none' && list.length) setActive(focus === 'last' ? list.at(-1) : list[0]); else menu.focus();
  current = handle;
  return handle;
}

const $label = (b) => (b.querySelector('.mi-label') || b).textContent.trim();
