/* ---------- הלוח האמצעי של זוג: תור המשימות, פעילות (לקריאה בלבד), בקרה והתראות ---------- */
// עיצוב (T34): בלי פסי צבע בצד. תפקיד מסומן באווטאר עגול עם אייקון, מצב משימה באייקון, הודעות מקובצות לפי כותב, זמן יחסי עם השעה המדויקת ב-tooltip.
import { icon } from '../icons.js';
import { send } from '../connection.js';
import { toast } from '../toast.js';
import { busy } from '../pending.js';
import { focusTerm } from '../layout.js';
import { basename, ago } from '../util.js';
import { store } from '../store.js';
import { ROLES, roleLabel, stateLabel, duoName, renameDuo } from './data.js';
import { isRenameKey } from '../rename.js';

const drafts = new Map();   // duoId -> טיוטת ההודעה שהמשתמש התחיל לכתוב (לא הולכת לאיבוד כשהלוח מתעדכן)
const view = { id: null, els: null, feedKey: '', tasksKey: '', statusSig: '', nextAll: false, metaKey: '', dismissed: new Set() };

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
// כיוון של טקסט מעורב לפי מה שרוב האותיות בו: עברית שמתחילה במונח באנגלית ("T1 הושלם") נשארת מימין לשמאל
const dirOf = (s) => { const he = (s.match(/[֐-׿]/g) || []).length; const la = (s.match(/[A-Za-z]/g) || []).length; return he >= la ? 'rtl' : 'ltr'; };
const hhmmss = (t) => new Date(t).toLocaleTimeString('he-IL', { hour12: false });

// אייקון (או אות) לכל תפקיד: האווטאר של הכותב בשיחה ושל הסוכן בכרטיס
const AVATAR = { architect: () => icon('panel', 14), worker: () => icon('terminal', 14), system: () => icon('zap', 14), user: () => 'א' };
const avatar = (role, size = '') => `<span class="db-av ${size} r-${role}" aria-hidden="true">${(AVATAR[role] || AVATAR.system)()}</span>`;

/* זמני השיחה מגיעים כ-HH:MM בלבד: מחשבים כמה זמן עבר לפי היום (ואם השעה "בעתיד", זה היה אתמול). יום חדש = השעה חזרה אחורה */
const toMinutes = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function minutesAgo(hhmm) {
  const t = toMinutes(hhmm);
  if (t == null) return null;
  const now = new Date();
  const n = now.getHours() * 60 + now.getMinutes();
  return (n - t + 1440) % 1440;
}
function relative(hhmm) {
  const d = minutesAgo(hhmm);
  if (d == null) return hhmm || '';
  if (d < 1) return 'עכשיו';
  if (d < 60) return `לפני ${d} דק׳`;
  if (d < 720) return `לפני ${Math.floor(d / 60)} שע׳`;
  return hhmm;
}

/** שלד קבוע לכל זוג: נבנה פעם אחת, ואחר כך רק מעדכנים את חלקיו (כך שתיבת הכתיבה לא מתאפסת) */
function build(host, duo) {
  host.replaceChildren();
  const els = {};
  els.head = el('header', 'db-head', `
    <div class="db-title"><b class="db-name"></b><bdi class="db-path" dir="ltr"></bdi></div>
    <button type="button" class="db-cost" hidden aria-expanded="false">פרטים</button>
    <div class="db-actions">
      <button type="button" class="icon-btn db-pause"></button>
      <button type="button" class="icon-btn db-close" title="סגירת הזוג (הטרמינלים נסגרים, קבצי .duo נשארים)" aria-label="סגירת הזוג"></button>
    </div>
    <div class="db-agents"></div>`);
  els.alerts = el('div', 'db-alerts');
  els.progress = el('div', 'db-progress', '<div class="db-progress-head"><h3>משימות</h3><span class="db-progress-text"></span></div><div class="db-bar"><i></i></div>');
  els.tasksSec = el('section', 'db-sec db-tasks-sec', '<div class="db-tasks"></div>');
  els.doneSec = el('section', 'db-sec db-done-sec', '');
  els.chatSec = el('section', 'db-sec db-chat-sec', '<h3>פעילות</h3><div class="db-chat"></div>');
  els.activity = el('details', 'db-activity', '<summary>אירועים אחרונים</summary><ul class="db-events"></ul>');
  els.compose = el('form', 'db-compose', '<textarea rows="2" dir="auto" placeholder="כתבו לארכיטקט (מעיר אותו)…" aria-label="הודעה לארכיטקט"></textarea><button type="submit" class="btn primary db-send" title="שליחה (Enter)" aria-label="שליחה"></button>');
  els.tech = el('details', 'db-activity db-tech', '<summary>פרטים טכניים</summary><ul class="db-events"></ul>');
  els.tech.hidden = true;
  els.tech.open = !!store.get('duoTechOpen', false);
  els.tech.addEventListener('toggle', () => store.set('duoTechOpen', els.tech.open));
  els.usage = el('section', 'db-usage', '');
  els.usage.hidden = true;
  host.append(els.head, els.usage, els.alerts, els.progress, els.tasksSec, els.doneSec, els.chatSec, els.activity, els.tech, els.compose);

  els.name = els.head.querySelector('.db-name');
  els.path = els.head.querySelector('.db-path');
  els.cost = els.head.querySelector('.db-cost');
  els.cost.addEventListener('click', () => { view.usageOpen = !view.usageOpen; updateCost(els, view.duo); });
  els.agents = els.head.querySelector('.db-agents');
  els.pause = els.head.querySelector('.db-pause');
  els.close = els.head.querySelector('.db-close');
  els.close.innerHTML = icon('x', 15);
  els.bar = els.progress.querySelector('.db-bar i');
  els.progressText = els.progress.querySelector('.db-progress-text');
  els.tasks = els.tasksSec.querySelector('.db-tasks');
  els.chat = els.chatSec.querySelector('.db-chat');
  els.events = els.activity.querySelector('.db-events');
  els.techList = els.tech.querySelector('.db-events');
  els.text = els.compose.querySelector('textarea');
  els.send = els.compose.querySelector('.db-send');
  els.send.innerHTML = icon('send', 15);

  els.name.textContent = duoName(duo);
  els.name.title = 'לחיצה או F2: שינוי שם';
  els.name.addEventListener('click', () => renameDuo(view.duo, els.name)); // the hover pencil promises a click, so one click is enough
  els.head.addEventListener('keydown', (e) => { if (isRenameKey(e)) { e.preventDefault(); renameDuo(view.duo, els.name); } });
  els.path.textContent = duo.project;
  els.path.title = duo.project;
  els.text.value = drafts.get(duo.id) || '';

  // סוכן: כרטיס קטן (אווטאר, שם, מצב וכמה זמן במצב הזה) וכפתור שקט "העיר עכשיו"
  for (const role of ROLES) {
    const chip = el('div', 'db-agent', `<span class="db-av-wrap">${avatar(role, 'md')}<i class="db-dot" aria-hidden="true"></i></span><div class="db-agent-text"><b>${roleLabel[role]}</b><span class="st"></span></div><button type="button" class="chip-wake" title="העירו את ${roleLabel[role]} עכשיו" aria-label="העירו את ${roleLabel[role]}">${icon('zap', 14)}</button>`);
    chip.dataset.role = role;
    // סוכן שנסגר (T51): במקום "העיר" מופיע "הפעלה מחדש" (אותה שיחה); ספינר מיד, עד שהמצב מגיע מהשרת (updateAgents מנקה)
    const restart = el('button', 'chip-restart', `${icon('restart', 14)}<span>הפעלה מחדש</span>`);
    restart.type = 'button';
    restart.hidden = true;
    restart.title = `הפעלה מחדש של ${roleLabel[role]}: ממשיך את אותה שיחה`;
    restart.addEventListener('click', () => {
      send({ t: 'duo', op: 'restartAgent', duoId: view.duo.id, role });
      chip.restoreRestart = busy(restart, 'מפעיל מחדש…', 'ההפעלה מחדש לא הושלמה');
    });
    chip.appendChild(restart);
    const wake = chip.querySelector('.chip-wake');
    wake.addEventListener('click', () => {
      send({ t: 'duo', op: 'wake', duoId: duo.id, role });
      // אין אישור נפרד מהשרת (הסוכן פשוט מתחיל לעבוד): ספינר קצר ומניעת לחיצה כפולה, כדי שהלחיצה תיראה (T38)
      const html = wake.innerHTML;
      wake.disabled = true;
      wake.innerHTML = '<span class="spin" aria-hidden="true"></span>';
      setTimeout(() => { wake.innerHTML = html; wake.disabled = false; }, 1500);
    });
    els.agents.appendChild(chip);
  }

  // לחוץ: ספינר מיד, עד שמצב הזוג מגיע מהשרת (updateAgents מנקה); אם לא הגיע תוך 10 שניות הכפתור חוזר
  els.pause.addEventListener('click', () => {
    const d = view.duo;
    send({ t: 'duo', op: d.paused ? 'resume' : 'pause', duoId: d.id });
    els.pause.disabled = true;
    els.pause.setAttribute('aria-busy', 'true');
    els.pause.innerHTML = '<span class="spin" aria-hidden="true"></span>';
    clearTimeout(els.pauseTimer);
    els.pauseTimer = setTimeout(() => { if (els.pause.disabled) updateAgents(els, view.duo); }, 10000);
  });

  // סגירה בשני צעדים (כמו סגירת טרמינל): לחיצה ראשונה מבקשת אישור
  let armed = null;
  els.close.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed); armed = null; els.close.classList.remove('armed');
      send({ t: 'duo', op: 'close', duoId: view.duo.id });
      els.close.disabled = true; // הזוג נעלם כשהשרת מאשר
      els.close.setAttribute('aria-busy', 'true');
      setTimeout(() => { els.close.disabled = false; els.close.removeAttribute('aria-busy'); }, 10000);
      return;
    }
    els.close.classList.add('armed');
    armed = setTimeout(() => { armed = null; els.close.classList.remove('armed'); }, 3000);
  });

  els.text.addEventListener('input', () => drafts.set(duo.id, els.text.value));
  els.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); els.compose.requestSubmit(); }
  });
  els.compose.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.text.value.trim();
    if (!text) return;
    send({ t: 'duo', op: 'say', duoId: view.duo.id, text });
    els.text.value = '';
    drafts.delete(view.duo.id);
  });

  els.paths = { tasks: duo.files && duo.files.tasks, status: duo.files && duo.files.status };
  return els;
}

function updateAgents(els, duo) {
  for (const chip of els.agents.children) {
    const a = duo.agents[chip.dataset.role];
    chip.dataset.state = a.state;
    // המצב מסומן בנקודה צבעונית ליד האווטאר (עובד: צבע ההדגשה עם טבעת פועמת; מחכה לאישור: כתום; נסגר: אדום), במילה ברורה, ובזמן "מזה N" שקט (T43)
    const st = chip.querySelector('.st');
    st.innerHTML = '<span class="stw"></span><span class="sts"></span>';
    // T62: הוראה ממתינה כי המשתמש כותב לסוכן הזה: שורה אחת רגועה במקום "פנוי"
    const pend = a.pending && a.state === 'idle';
    st.firstChild.textContent = pend ? 'הודעה ממתינה' : (stateLabel[a.state] || a.state);
    chip.dataset.pending = pend ? 'true' : '';
    st.lastChild.textContent = ` · ${ago(Date.now() - (a.since || Date.now()))}`;
    chip.title = pend ? 'יש הודעה ממתינה, תישלח כשתסיים לכתוב' : `הופעל ${a.wakes} פעמים`;
    const gone = a.state === 'exited';
    chip.querySelector('.chip-wake').hidden = gone;
    const restart = chip.querySelector('.chip-restart');
    restart.hidden = !gone;
    if (!gone && chip.restoreRestart) { chip.restoreRestart(); chip.restoreRestart = null; }
  }
  els.pause.disabled = false;
  els.pause.removeAttribute('aria-busy');
  els.pause.innerHTML = icon(duo.paused ? 'play' : 'pause', 15);
  els.pause.title = duo.paused ? 'המשך עבודה' : 'השהיית הזוג (אף אחד לא יתעורר)';
  els.pause.setAttribute('aria-label', duo.paused ? 'המשך עבודה' : 'השהיית הזוג');
  els.head.classList.toggle('is-paused', duo.paused);
}

// התראות (T65): רק מה שדורש את המשתמש. לכל התראה משפט קצר אחד וכפתור שעושה את מה שצריך (פתיחת הטרמינל של הסוכן, הפעלה מחדש, כתיבת הערה), בלי טקסט שנחתך ובלי "פחות/עוד".
// X מסתיר התראה מסוימת עד שהיא נפתרת ושבה (זו התראה חדשה). תקלות פנימיות שמתאוששות לבד לא מגיעות לכאן בכלל: הן ב"פרטים טכניים" שבסוף.
const ACTION_LABEL = {
  open: (act) => `פתיחת הטרמינל של ה${roleLabel[act.role] || 'סוכן'}`,
  restart: (act) => `הפעלה מחדש של ה${roleLabel[act.role] || 'סוכן'}`,
  note: () => 'כתיבת הערה',
};
function alertButton(act, duo, els) {
  const label = ACTION_LABEL[act.type];
  if (!label) return null;
  const b = el('button', 'db-alert-act', '');
  b.type = 'button';
  b.textContent = label(act);
  b.addEventListener('click', () => {
    if (act.type === 'open') { const a = duo.agents[act.role]; if (a && a.sessionId) focusTerm(a.sessionId); }
    else if (act.type === 'restart') { send({ t: 'duo', op: 'restartAgent', duoId: duo.id, role: act.role }); busy(b, 'מפעיל מחדש…', 'ההפעלה מחדש לא הושלמה'); }
    else if (act.type === 'note') { els.text.focus(); }
  });
  return b;
}
function updateAlerts(els, duo) {
  const shown = (duo.alerts || []).filter((a) => !view.dismissed.has(a.t));
  els.alerts.replaceChildren();
  els.alerts.hidden = !shown.length;
  for (const a of shown.slice(-3)) {
    const row = el('div', 'db-alert ' + a.level, `${icon('alert', 15)}<span class="msg"></span>`);
    row.querySelector('.msg').textContent = a.text;
    for (const act of a.actions || []) { const b = alertButton(act, duo, els); if (b) row.append(b); }
    const close = el('button', 'db-alert-x', icon('x', 13));
    close.type = 'button';
    close.title = 'הסתרה';
    close.setAttribute('aria-label', 'הסתרת ההתראה');
    close.addEventListener('click', () => { view.dismissed.add(a.t); updateAlerts(els, view.duo); });
    row.append(close);
    els.alerts.append(row);
  }
}

const TASK_ICON = { done: () => icon('check', 12), doing: () => '', todo: () => '', blocked: () => icon('alert', 13) };
const STATUS_TIP = { done: 'הושלמה', doing: 'בעבודה', todo: 'ממתינה', blocked: 'חסומה' };
const NEXT_SHOWN = 5;

// רשימת משימות שמסתדרת גם עם 40 משימות (T43): מקבצים לפי מצב, והמעניין למעלה: "בעבודה", "הבאות" (חמש הראשונות), "חסומות", ו"הושלמו (N)" מקופל (הבחירה נשמרת לכל זוג).
// כותרות הקבוצות נדבקות למעלה בגלילה, כותרת של משימה עוטפת לשתי שורות לכל היותר (המלאה ב-tooltip), והמשימה הנוכחית נגללת לתצוגה בפעם הראשונה ובכל שינוי מצב.
// tokens and estimated cost of the whole pair (every conversation of the project since it was created, /clear included)
const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));
function updateCost(els, duo) {
  const u = duo.usage;
  els.cost.hidden = !u;
  const open = !!u && !!view.usageOpen;
  els.cost.setAttribute('aria-expanded', String(open));
  els.usage.hidden = !open;
  if (!open) return;
  const money = (c) => '$' + (c < 10 ? c.toFixed(2) : Math.round(c));
  const rows = [];
  for (const [model, m] of Object.entries(u.models || {})) {
    rows.push(`<div class="du-model"><b dir="ltr"></b><span>${money(m.cost)}</span></div>`);
    rows.push(`<div class="du-row"><span>קלט</span><span>${fmtTokens(m.input)}</span></div>`);
    rows.push(`<div class="du-row"><span>פלט (כולל חשיבה)</span><span>${fmtTokens(m.output)}</span></div>`);
    rows.push(`<div class="du-row"><span>קריאה ממטמון</span><span>${fmtTokens(m.cacheRead)}</span></div>`);
    rows.push(`<div class="du-row"><span>כתיבה למטמון (5 דקות / שעה)</span><span>${fmtTokens(m.cacheWrite5m)} / ${fmtTokens(m.cacheWrite1h)}</span></div>`);
  }
  els.usage.innerHTML = rows.join('') + `<div class="du-total"><span>סה"כ עלות</span><b>${money(u.cost)}</b></div><p class="du-note"></p>`;
  [...els.usage.querySelectorAll('.du-model b')].forEach((b, i) => { b.textContent = Object.keys(u.models || {})[i]; });
  els.usage.querySelector('.du-note').textContent = 'כל השיחות בתיקיית הפרויקט מאז שהזוג נוצר, כולל אלה שאחרי ניקוי הקשר. לפי המחירון של Claude Code.' + (u.unknownModels && u.unknownModels.length ? ` דגם ללא מחירון ידוע (חושב כמו Sonnet 5.5): ${u.unknownModels.join(', ')}.` : '');
}

function updateTasks(els, duo) {
  const { items, counts } = duo.tasks;
  const total = duo.tasks.total; // כולל משימות שכבר בארכיון (T78): ברשימה רק הפתוחות והאחרונות שהסתיימו
  const pct = total ? Math.round((counts.done / total) * 100) : 0;
  els.bar.style.width = pct + '%';
  els.progress.hidden = !total;
  els.progressText.textContent = total ? `${counts.done} מתוך ${total}${counts.blocked ? ` · ${counts.blocked} חסומות` : ''}` : '';
  const key = JSON.stringify([items.map((i) => [i.id, i.status, i.title, (i.detail || '').length]), counts.done, total, store.get('duoTaskFilter', 'all')]);
  if (key === view.tasksKey) return;
  view.tasksKey = key;
  const statusSig = items.map((i) => i.id + ':' + i.status).join(',');
  const first = view.statusSig === '';
  const stateChanged = statusSig !== view.statusSig;
  view.statusSig = statusSig;
  const scroller = els.tasksSec, keepTop = scroller.scrollTop;
  els.tasks.replaceChildren();
  if (!total) { els.tasks.appendChild(el('div', 'db-none', `${icon('check', 16)}<span>הארכיטקט עוד לא כתב משימות. כשהוא יכתוב, הן יופיעו כאן.</span>`)); return; }

  const row = (it) => {
    const li = el('li', 'db-task s-' + it.status, `<span class="tk" aria-hidden="true">${(TASK_ICON[it.status] || TASK_ICON.todo)()}</span><span class="tid"></span><span class="ttl" dir="auto"></span>`);
    li.querySelector('.tid').textContent = it.id;
    const title = it.title || it.text || '';
    li.querySelector('.ttl').textContent = title;
    li.title = `${it.id} · ${title} · ${STATUS_TIP[it.status] || ''}`;
    if (it.detail) {
      // click opens the full text of the task (details, Result, Review) under the title; click again closes it
      view.openTasks = view.openTasks || new Set();
      li.classList.add('has-detail');
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      const box = el('div', 'tdetail', '');
      box.textContent = it.detail;
      box.dir = 'auto';
      const setOpen = (on) => { li.classList.toggle('open', on); li.setAttribute('aria-expanded', String(on)); if (on) view.openTasks.add(it.id); else view.openTasks.delete(it.id); };
      li.appendChild(box);
      setOpen(view.openTasks.has(it.id));
      li.addEventListener('click', (e) => { if (window.getSelection && String(window.getSelection())) return; setOpen(!li.classList.contains('open')); });
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!li.classList.contains('open')); } });
    }
    return li;
  };
  // one list in the natural order (finished first, then the current task, then the upcoming ones) with a filter on top: finished / all / not finished
  const filter = store.get('duoTaskFilter', 'all');
  const cap = el('div', 'tf-cap', '');
  cap.textContent = 'הצג';
  const bar = el('div', 'tf-bar', '');
  bar.setAttribute('role', 'tablist');
  for (const [k, label] of [['done', 'הושלמו'], ['all', 'הכל'], ['open', 'לא הושלמו']]) {
    const b = el('button', 'tf-opt' + (k === filter ? ' on' : ''), '');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(k === filter));
    b.textContent = label;
    b.addEventListener('click', () => { store.set('duoTaskFilter', k); view.tasksKey = ''; view.statusSig = ''; updateTasks(els, view.duo); });
    bar.appendChild(b);
  }
  const list = el('ul', 'tg-list tg-flat', '');
  const shown = items.filter((it) => (filter === 'all' ? true : filter === 'done' ? it.status === 'done' : it.status !== 'done'));
  for (const it of shown) list.appendChild(row(it));
  if (!shown.length) list.appendChild(el('li', 'db-none', '<span>אין משימות בתצוגה הזו.</span>'));
  els.tasks.append(cap, bar, list);
  els.doneSec.hidden = true;
  scroller.scrollTop = keepTop;
  const current = els.tasks.querySelector('.db-task.s-doing');
  if (current && (first || stateChanged)) current.scrollIntoView({ block: 'center' });
}

// שיחה: הודעות רצופות של אותו כותב בטווח של 3 דקות מקובצות תחת כותרת אחת; הודעת מערכת היא שורה מרכזית אחת; מעבר יום = קו מפריד
function groupChat(chat) {
  const groups = [];
  let prevMin = null;
  for (const m of chat) {
    const min = toMinutes(m.time);
    const newDay = prevMin != null && min != null && min < prevMin;
    const last = groups[groups.length - 1];
    const close = last && !newDay && last.author === m.author && m.author !== 'system' && min != null && last.lastMin != null && min - last.lastMin >= 0 && min - last.lastMin <= 3;
    if (close) { last.items.push(m); last.lastMin = min; } else groups.push({ author: m.author, time: m.time, lastMin: min, items: [m], dayBefore: newDay });
    if (min != null) prevMin = min;
  }
  return groups;
}

function updateFeed(els, duo) {
  const feed = duo.feed || [];
  const key = JSON.stringify(feed);
  if (key === view.feedKey) return;
  view.feedKey = key;
  const atBottom = els.chat.scrollHeight - els.chat.scrollTop - els.chat.clientHeight < 48;
  els.chat.replaceChildren();
  if (!feed.length) els.chat.appendChild(el('div', 'db-none', `${icon('send', 16)}<span>עוד אין פעילות.</span>`));
  for (const g of groupChat(feed)) {
    if (g.dayBefore) els.chat.appendChild(el('div', 'db-day', '<span>יום קודם</span>'));
    if (g.author === 'system') {
      const sys = el('div', 'db-sys');
      sys.textContent = g.items.map((m) => m.body).join(' · ');
      sys.title = g.time;
      els.chat.appendChild(sys);
      continue;
    }
    const grp = el('div', 'db-group r-' + g.author, `${avatar(g.author)}<div class="db-group-main"><div class="db-group-head"><b></b><time></time></div><div class="db-bubbles"></div></div>`);
    grp.querySelector('b').textContent = roleLabel[g.author] || g.author;
    const time = grp.querySelector('time');
    time.textContent = relative(g.time);
    time.title = g.time;
    const bubbles = grp.querySelector('.db-bubbles');
    for (const m of g.items) { const b = el('div', 'db-bubble'); b.dir = dirOf(m.body); b.textContent = m.body; if (m.kind === 'blocked') b.classList.add('is-blocked'); bubbles.appendChild(b); }
    els.chat.appendChild(grp);
  }
  if (atBottom) els.chat.scrollTop = els.chat.scrollHeight;
}

function updateEvents(els, duo) {
  // פרטים טכניים (T65): תקלות פנימיות שמתאוששות לבד; מקופל כברירת מחדל, ומוסתר כשאין מה להראות
  els.techList.replaceChildren();
  const tech = duo.tech || [];
  els.tech.hidden = !tech.length;
  for (const e of tech.slice(-12).reverse()) {
    const li = el('li', null, '<time></time><b></b><span></span>');
    li.querySelector('time').textContent = hhmmss(e.t);
    li.querySelector('b').textContent = e.role ? roleLabel[e.role] : '';
    li.querySelector('span').textContent = e.text;
    els.techList.appendChild(li);
  }
  els.events.replaceChildren();
  for (const e of duo.events.slice(-12).reverse()) {
    const li = el('li', null, '<time></time><b></b><span></span>');
    li.querySelector('time').textContent = hhmmss(e.t);
    li.querySelector('b').textContent = e.role ? roleLabel[e.role] : '';
    li.querySelector('span').textContent = e.text + (e.detail ? ' — ' + e.detail : '');
    els.events.appendChild(li);
  }
}

/** מצייר את הלוח של הזוג הנבחר בתוך host (בונה שלד חדש רק כשעוברים לזוג אחר) */
export function renderBoard(host, duo) {
  if (!duo) { host.replaceChildren(); view.id = null; view.els = null; return; }
  if (view.id !== duo.id) {
    view.id = duo.id; view.feedKey = ''; view.tasksKey = ''; view.statusSig = ''; view.nextAll = false; view.dismissed = new Set();
    view.duo = duo;
    view.els = build(host, duo);
  }
  view.duo = duo;
  const els = view.els;
  els.name.textContent = duoName(duo); // השם יכול להשתנות (T56)
  updateCost(els, duo);
  updateAgents(els, duo);
  updateAlerts(els, duo);
  updateTasks(els, duo);
  updateFeed(els, duo);
  updateEvents(els, duo);
}
