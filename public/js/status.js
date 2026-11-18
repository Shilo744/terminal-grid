/* ---------- סטטוס: סיכום בסרגל, כותרת החלון, ומסך "השרת נסגר" ---------- */
import { BUSY_MS } from './constants.js';
import { state, bus } from './state.js';
import { $, stage } from './dom.js';
import { plural, ago } from './util.js';
import { icon } from './icons.js';
import { onMessage } from './connection.js';
import { isFocused } from './layout.js';
import { focusNextWaiting } from './attention.js';
import { setWaitingMark } from './favicon.js';

const summaryEl = $('#summary');
let lastSummary = '', lastTitle = '';

// מצב אחד ברור בכותרת הפאן: עובד / צריך אישור / סיים וממתין לך / הסתיים. "פנוי" בלי תווית (הנקודה האפורה מספיקה).
// המפתח (busy, attn, done, idle, exit) הוא המצב המלא; p.status נשאר 'wait' גם ל-attn וגם ל-done (מי שמחכה לך), ו-p.attn מבדיל ביניהם.
const LABELS = { busy: 'עובד…', attn: 'צריך אישור', done: 'סיים — ממתין לך', exit: 'הסתיים', pend: 'הודעה ממתינה', idle: '' };
const ICONS = { attn: 'alert', done: 'check' };
const SHORT = { busy: 'busy', attn: 'wait', done: 'wait', idle: 'idle', exit: 'exit', pend: 'idle' };

// מצב מדויק מ-hooks (server/agent-status.js). "צריך אישור" נשאר גם בפאן ממוקד כי הסוכן חסום, עד שהמשתמש עונה:
// Claude לא שולח hook כשההרשאה ניתנה, ולכן הקלדה בפאן אחרי ההתראה היא הסימן היחיד שהסוכן חזר לעבוד. "סיים" מתנקה כשמסתכלים בפאן.
function hookKey(p) {
  const m = p.meta;
  if (m.agentState === 'working') return 'busy';
  if (m.agentPending && m.agentState === 'idle') return 'pend'; // T62: הוראה של הזוג ממתינה כי המשתמש כותב לסוכן; הסוכן עצמו פנוי
  if (m.agentState === 'attention') return p.lastKey > m.agentSince ? 'busy' : 'attn';
  if (isFocused(p)) p.waiting = false;
  return p.waiting ? 'done' : 'idle';
}

function paintStatus(p, key, now) {
  p.key = key;
  p.status = SHORT[key];
  p.attn = key === 'attn';
  // מאז מתי: אצל hooks הזמן שהשרת רשם, אחרת מהרגע שהבדיקה הבחינה בשינוי
  p.statusSince = p.meta.agentSource === 'hooks' && p.meta.agentSince && key !== 'idle' && key !== 'exit' ? p.meta.agentSince : now;
  p.el.classList.remove('s-busy', 's-wait', 's-exit', 's-idle', 'k-attn', 'k-done');
  p.el.classList.add('s-' + p.status);
  if (key === 'attn' || key === 'done') p.el.classList.add('k-' + key);
  const label = $('.pstatus', p.el);
  label.className = 'pstatus k-' + key;
  label.hidden = !LABELS[key];
  label.title = key === 'pend' ? 'יש הודעה ממתינה, תישלח כשתסיים לכתוב' : '';
  label.innerHTML = '';
  if (ICONS[key]) label.insertAdjacentHTML('beforeend', icon(ICONS[key], 12));
  label.append(LABELS[key]);
}

function tick() {
  const now = Date.now();
  let busy = 0, wait = 0;
  for (const p of state.panes.values()) {
    let key;
    if (p.meta.startup) { p.dirty = false; p.waiting = false; key = 'idle'; } // T41: מתחיל עכשיו: לא "ממתין לך" ולא נספר
    else if (p.meta.exited) key = 'exit';
    else if (p.meta.agentSource === 'hooks') key = hookKey(p);
    else {
      // טרמינל בלי hooks (PowerShell, או Claude שלא הגיע ממנו אירוע): ההיגיון הישן לפי תזמון הפלט והפעמון. "ממתין" = סיים (done)
      if (now - p.lastData < BUSY_MS) key = 'busy';
      else {
        if (p.dirty && !isFocused(p)) p.waiting = true;
        key = p.waiting ? 'done' : 'idle';
      }
      if (isFocused(p) && key === 'done') { p.waiting = false; p.dirty = false; key = 'idle'; }
    }
    if (key === 'busy') busy++;
    if (key === 'attn' || key === 'done') wait++;
    if (p.key !== key) paintStatus(p, key, now);
  }
  const n = state.panes.size; // כולל הסוכנים של זוגות: סוכן שמחכה לאישור נספר גם כשאין טרמינלים ברשת (T43)
  // כותבים ל-DOM רק כשהטקסט השתנה: הבדיקה רצה כל 400ms ולא צריכה לבנות מחדש אלמנטים שלא השתנו
  const html = n
    ? `<span class="stat"><b>${n}</b> ${plural(n, 'טרמינל', 'טרמינלים')}</span>` +
      `<span class="stat">${busy ? '<span class="dot busy"></span>' : ''}<b>${busy}</b> ${plural(busy, 'פעיל', 'פעילים')}</span>` +
      (wait ? `<button type="button" class="stat stat-wait" title="מעבר לטרמינל שממתין לך (Alt+W)" aria-label="${wait} ${plural(wait, 'ממתין לך', 'ממתינים לך')}. מעבר לטרמינל הבא"><span class="dot wait"></span><b>${wait}</b> ${plural(wait, 'ממתין לך', 'ממתינים לך')}</button>` : '')
    : '';
  if (html !== lastSummary) { lastSummary = html; summaryEl.innerHTML = html; }
  const title = (wait ? `(${wait}) ` : '') + 'Terminal Grid\u200C';
  if (title !== lastTitle) { lastTitle = title; document.title = title; }
  setWaitingMark(wait);
  bus.emit('status-tick');
}

// כתיבת הזמן ב-title רק כשמעבירים עכבר מעל הכותרת: לא עובדים על זה בכל בדיקה
function hoverTitle(e) {
  const head = e.target.closest('.pane-head');
  const p = head && state.panes.get(head.parentElement.dataset.id);
  if (!p || !p.key) return;
  const t = (LABELS[p.key] || 'פנוי') + ' · ' + ago(Date.now() - (p.statusSince || Date.now()));
  $('.dot', p.el).title = t;
  $('.pstatus', p.el).title = t;
}

// השרת נסגר (לא כיבוי ידני: כפתור כיבוי כבר אין). הכול נשמר, ופתיחה מחדש מחזירה את אותו מצב.
function showGone() {
  state.quitting = true;
  if ($('.gone')) return;
  const el = document.createElement('div');
  el.className = 'gone';
  el.innerHTML = '<div><h1>השרת נסגר</h1><p>פותחים שוב את Terminal Grid וכל השיחות חוזרות.</p></div>';
  document.body.appendChild(el);
}

// שורת מצב (T39, סגנון IDE בלבד): הסיכום עובר אליה מהסרגל העליון ובחזרה כשהסגנון משתנה; בצד השני נקודת חיבור, פורט (כשהוא לא 7791) וגרסה
const root = document.documentElement;
const barEl = $('#statusBar');
const summaryHome = { parent: summaryEl.parentElement, next: summaryEl.nextSibling };
let lastBar = '';
function placeSummary() {
  const inBar = root.dataset.style === 'ide' || !root.dataset.style;
  barEl.hidden = !inBar;
  const target = inBar ? $('#sbStart') : summaryHome.parent;
  if (summaryEl.parentElement !== target) (inBar ? target.appendChild(summaryEl) : target.insertBefore(summaryEl, summaryHome.next));
}
function tickBar() {
  const info = state.info || {};
  const sig = [state.connected, info.port, info.version].join('|');
  if (sig === lastBar) return;
  lastBar = sig;
  $('#sbConn').dataset.state = state.connected ? 'on' : 'off';
  $('.sb-conn-text', barEl).textContent = state.connected ? 'מחובר' : 'מתחבר מחדש…';
  const port = $('#sbPort'), ver = $('#sbVersion');
  port.hidden = !info.port || Number(info.port) === 7791;
  port.textContent = info.port ? `פורט ${info.port}` : '';
  ver.hidden = !info.version;
  ver.textContent = info.version ? `v${info.version}` : '';
}

export function initStatus() {
  placeSummary();
  new MutationObserver(placeSummary).observe(root, { attributes: true, attributeFilter: ['data-style'] });
  setInterval(tickBar, 400);
  tickBar();
  bus.on('focus', tick);
  onMessage('bye', showGone);
  summaryEl.addEventListener('click', (e) => { if (e.target.closest('.stat-wait')) focusNextWaiting(); });
  stage.addEventListener('mouseover', hoverTitle);
  setInterval(tick, 400);
}
