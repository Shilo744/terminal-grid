/* ---------- זוגות סוכנים: המצב שמגיע מהשרת, הבחירה והתצוגה הנוכחית ---------- */
// כל שאר מודולי הזוג קוראים מכאן. השרת שולח את מצב הזוג כולו (משימות, שיחה, סוכנים, התראות) בכל שינוי.
import { store } from '../store.js';
import { bus } from '../state.js';
import { onMessage } from '../connection.js';
import { toast } from '../toast.js';
import { send } from '../connection.js';
import { overlayRename } from '../rename.js';

// השם המוצג של זוג (T56): שם מותאם, ובברירת מחדל שם תיקיית הפרויקט (השרת שולח name; גיבוי לשרת ישן)
export const duoName = (d) => d.name || (d.project || '').split(/[\\/]/).filter(Boolean).pop() || d.project;

export const closedDuos = [];                        // זוגות שנסגרו וניתן לשחזר (מהשרת): { id, name, project, closedAt, done, total }
export const duos = new Map();                       // duoId -> המצב האחרון מהשרת
export const duoState = {
  selectedId: store.get('duoSelected', null),
  view: store.get('view', 'grid'),                  // 'grid' = הרשת הרגילה, 'duo' = מסך הזוגות
  creating: null,                                   // { reqId, project, timer }: זוג שנוצר עכשיו (השרת מפעיל שני סוכנים: כמה שניות)
};

// משוב מיידי: מרגע ההתחלה מוצגת לשונית "יוצר..." וכרטיס הסבר, עד שהשרת עונה (created / error) או 10 שניות
export function startCreating(reqId, project) {
  finishCreating(reqId, true);
  const timer = setTimeout(() => { if (finishCreating(reqId)) toast('יצירת הזוג לא הושלמה: השרת לא ענה', 'error'); }, 10000);
  duoState.creating = { reqId, project, timer };
  bus.emit('duo:changed');
}

export function finishCreating(reqId, silent) {
  const c = duoState.creating;
  if (!c || (reqId && c.reqId !== reqId)) return false;
  clearTimeout(c.timer);
  duoState.creating = null;
  if (!silent) bus.emit('duo:changed');
  return true;
}

export const ROLES = ['architect', 'worker'];
export const roleLabel = { architect: 'ארכיטקט', worker: 'עובד', user: 'אתה', system: 'מערכת', other: 'אחר' };
export const stateLabel = { starting: 'מתחיל…', idle: 'פנוי', working: 'עובד…', attention: 'מחכה לאישור', exited: 'נסגר' };

export function selectedDuo() {
  const d = duos.get(duoState.selectedId);
  if (d) return d;
  // בחירה שעוד לא הגיעה מהשרת (זוג שנוצר הרגע): לא מציגים זוג אחר באמצע
  return duoState.selectedId ? null : ([...duos.values()][0] || null);
}

export function selectDuo(id) {
  duoState.selectedId = id;
  store.set('duoSelected', id);
  bus.emit('duo:selected');
}

export function setView(view) {
  duoState.view = view;
  store.set('view', view);
  bus.emit('duo:view');
}

/** מצב מסכם של זוג להצגה בנקודה צבעונית: מה הדבר הכי דחוף שקורה בו. מצב נוכחי אחד בלבד (T46): עובד = צבע ההדגשה עם טבעת פועמת, פנוי = אפור, מושהה = אפור עם סמל השהיה,
 *  מחכה לך = כתום (סוכן ממתין לאישור, או התראה שעדיין נכונה), בעיה = אדום (סוכן נסגר). השרת שולח רק התראות פעילות: אחרי שבעיה נפתרה היא כבר לא צובעת את הנקודה. */
export function duoStatus(d) {
  const st = ROLES.map((r) => d.agents[r].state);
  if (st.includes('exited') || d.alerts.some((a) => a.level === 'error')) return 'danger'; // סוכן שנסגר הוא תקלה: אדום, לפני כל התראה אחרת (T43)
  if (st.includes('attention') || d.alerts.length) return 'warn';
  if (st.includes('working')) return 'busy';
  if (d.paused) return 'paused';
  return 'idle';
}

/** משפט אחד בעברית שמסביר את הנקודה (tooltip בלשונית וברשימה בתפריט הצד) */
export function duoReason(d) {
  const ex = ROLES.find((r) => d.agents[r].state === 'exited');
  if (ex) return `בעיה: ה${roleLabel[ex]} נסגר`;
  const att = ROLES.find((r) => d.agents[r].state === 'attention');
  if (att) return `מחכה לך: ה${roleLabel[att]} ממתין לאישור הרשאה`;
  if (d.alerts.length) return `מחכה לך: ${d.alerts[d.alerts.length - 1].text}`;
  const working = ROLES.filter((r) => d.agents[r].state === 'working');
  if (working.length) {
    const cur = d.tasks.items.find((i) => i.status === 'doing');
    return working.includes('worker') ? `עובד עכשיו: העובד מבצע ${cur ? cur.id : 'משימה'}` : 'עובד עכשיו: הארכיטקט בודק ומתכנן';
  }
  if (d.paused) return 'מושהה';
  return 'הכול תקין, ממתין למשימה הבאה';
}

/** סדר חדש של הלשוניות (גרירה, או Alt+Shift+חצים): מיד אצלנו, ונשמר בשרת (state.json) כך שחלונות אחרים, תפריט הצד ושחזור אחרי הפעלה מחדש מכבדים אותו */
export function reorderDuos(ids) {
  applyOrder(ids);
  send({ t: 'duo', op: 'reorder', ids });
}
function applyOrder(ids) {
  const next = new Map();
  for (const id of ids) if (duos.has(id)) next.set(id, duos.get(id));
  for (const [id, d] of duos) if (!next.has(id)) next.set(id, d);
  if ([...next.keys()].join() === [...duos.keys()].join()) return; // אותו סדר (למשל ההד מהשרת אחרי שינוי מקומי): בלי בנייה מחדש של הלשוניות
  duos.clear();
  for (const [id, d] of next) duos.set(id, d);
  bus.emit('duo:changed');
}

export function initData() {
  // לחיצה על "N ממתינים לך" (או Alt+W) כשמי שמחכה הוא סוכן בזוג: מציגים את הזוג שלו
  bus.on('duo:reveal', (id) => { selectDuo(id); setView('duo'); });
  onMessage('error', (m) => { if (m.reqId) finishCreating(m.reqId); }); // launch.js מציג את ההודעה
  onMessage('list', (m) => {
    duos.clear();
    for (const d of m.duos || []) duos.set(d.id, d);
    closedDuos.splice(0, closedDuos.length, ...(m.duosClosed || []));
    bus.emit('duo:changed');
  });
  onMessage('duo', (m) => {
    if (m.op === 'state' && m.duo) {
      duos.set(m.duo.id, m.duo);
      bus.emit('duo:changed');
    } else if (m.op === 'order' && Array.isArray(m.ids)) {
      applyOrder(m.ids);
    } else if (m.op === 'closed' && Array.isArray(m.list)) {
      closedDuos.splice(0, closedDuos.length, ...m.list);
      bus.emit('duo:changed');
    } else if (m.op === 'removed') {
      duos.delete(m.id);
      if (duoState.selectedId === m.id) { duoState.selectedId = null; store.set('duoSelected', null); }
      bus.emit('duo:changed');
    } else if (m.op === 'created') {
      finishCreating(m.reqId, true);
      selectDuo(m.duoId);
      setView('duo');
    }
  });
}

// שינוי שם של זוג (T56): שדה צף מעל השם; השרת מאמת, שומר ומשדר את המצב החדש. תפקידי הסוכנים (ארכיטקט / עובד) קבועים
export function renameDuo(d, anchor) {
  if (!anchor) return;
  const kind = anchor.closest('.duo-tab') ? `.duo-tab[data-id="${d.id}"] .nm` : anchor.classList.contains('db-name') ? '.db-name' : '.duo-item.current .nm, .duo-item .nm';
  overlayRename(anchor, { find: () => document.querySelector(kind), value: duoName(d), onCommit: (name) => send({ t: 'duo', op: 'rename', duoId: d.id, name }) });
}
