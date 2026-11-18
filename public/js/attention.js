/* ---------- מי מחכה לך: מעבר בין הטרמינלים שממתינים, והתראות שולחן עבודה ---------- */
// "ממתין לך" נקבע ב-status.js (p.status === 'wait', ובו p.attn = צריך אישור, אחרת סיים ממתין). כאן:
//  - focusNextWaiting: לחיצה על "N ממתינים לך" או Alt+W. הדחוף ראשון (צריך אישור, ואז מי שסיים הכי מזמן), ולחיצות חוזרות עוברות הלאה במעגל.
//  - התראות: מתג בהגדרות (כבוי כברירת מחדל). נשלחות רק כשהחלון לא ממוקד: צריך אישור, או סיים אחרי עבודה של 20 שניות לפחות.
//  - הצעה חד-פעמית: בפעם הראשונה שטרמינל חיכה כשהחלון לא היה ממוקד, ובחזרה לחלון מציעים להפעיל התראות.
import { state, bus } from './state.js';
import { activate } from './layout.js';
import { getSetting, setSetting } from './settings.js';
import { toast } from './toast.js';
import { store } from './store.js';

export const NOTIFY_SETTING = 'ui.notifyWaiting';
export const LONG_WORK_MS = 20000;

const supported = () => typeof Notification !== 'undefined';

/* ---------- מעבר לטרמינל הממתין הבא ---------- */
export function waitingPanes() {
  return [...state.panes.values()]
    .filter((p) => p.status === 'wait') // גם סוכן בזוג שמחכה לאישור (T43): הלחיצה פותחת את מסך הזוגות באותו זוג
    .sort((a, b) => (Number(!!b.attn) - Number(!!a.attn)) || ((a.statusSince || 0) - (b.statusSince || 0)));
}

/** מעביר מיקוד לטרמינל הממתין הבא (הדחוף ראשון, אחר כך במעגל). מחזיר false כשאין מי שמחכה. */
export function focusNextWaiting() {
  const list = waitingPanes();
  if (!list.length) return false;
  const i = list.findIndex((p) => p.id === state.focusId);
  activate(list[(i + 1) % list.length].id);
  return true;
}

/* ---------- התראות שולחן עבודה ---------- */
/** מבקש הרשאה (חייב לרוץ בתוך לחיצה של המשתמש). { ok, note } כש-note הוא הסבר בעברית כשלא הצליח. */
export async function requestNotifications() {
  if (!supported()) return { ok: false, note: 'הדפדפן הזה לא תומך בהתראות.' };
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm === 'granted') return { ok: true };
  return { ok: false, note: 'הדפדפן חסם התראות לאתר הזה. אפשר לאפשר אותן בהגדרות האתר (הסמל שליד הכתובת).' };
}

function notify(p, body) {
  if (!getSetting(NOTIFY_SETTING) || !supported() || Notification.permission !== 'granted') return;
  // tag לכל טרמינל: התראה חדשה מחליפה את הקודמת שלו ולא נערמת
  const n = new Notification(p.meta.name || 'Terminal Grid', { body, tag: 'tg-' + p.id });
  n.onclick = () => { try { window.focus(); } catch { /* ignore */ } activate(p.id); n.close(); };
}

function offerOnce() {
  if (store.get('notifyOffered', false) || getSetting(NOTIFY_SETTING) || !supported() || Notification.permission !== 'default') return;
  store.set('notifyOffered', true);
  // מציעים כשחוזרים לחלון (בזמן שהוא לא ממוקד אף אחד לא רואה את ההודעה)
  window.addEventListener('focus', () => {
    toast('סוכן חיכה לך בזמן שהחלון לא היה ממוקד. להפעיל התראות שולחן עבודה?', 'info', {
      action: { label: 'להפעיל התראות', onClick: async () => { const r = await requestNotifications(); if (r.ok) setSetting(NOTIFY_SETTING, true); else if (r.note) toast(r.note, 'error'); } },
      ms: 15000,
    });
  }, { once: true });
}

// מצב סוכן מדויק (hooks) השתנה: panes.js מכריז prev (המצב הקודם ו-prevSince, מתי התחיל) ו-state החדש
function onAgentChange({ pane, prev, prevSince, state: s }) {
  if (document.hasFocus()) return;
  if (s === 'attention') { notify(pane, 'צריך אישור'); offerOnce(); }
  else if (s === 'done' && prev === 'working') {
    if (Date.now() - prevSince >= LONG_WORK_MS) notify(pane, 'סיים — ממתין לך');
    offerOnce();
  }
}

export function initAttention() {
  bus.on('agent-change', onAgentChange);
}
