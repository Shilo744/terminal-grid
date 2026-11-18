/* ---------- פתיחת טרמינלים חדשים ובחירת תיקיית עבודה ---------- */
import { MAX_RECENTS } from './constants.js';
import { state, bus, activeTab } from './state.js';
import { sendView } from './layout.js';
import { $, stage } from './dom.js';
import { basename } from './util.js';
import { toast } from './toast.js';
import { send, onMessage } from './connection.js';
import { getSetting, setSetting, onSetting } from './settings.js';
import { addPending, removePending, restoreAllBusy } from './pending.js';
import { pickFolder } from './pick-folder.js';

const addClaudeBtn = $('#addClaude');
const folderBtn = $('#folderBtn');
const folderLabel = $('#folderLabel');
const folderPop = $('#folderPop');
const pathInput = $('#pathInput');
const recentList = $('#recentList');
const browseBtn = $('#browseBtn');
const browseLabel = $('#browseLabel');

/* ---------- מידע על השרת ---------- */
export async function refreshInfo() {
  try {
    const info = await (await fetch('/api/info')).json();
    state.info = info;
    if (info.claude) addClaudeBtn.removeAttribute('title');
  } catch { /* offline: connect() will handle */ }
}

// בטעינת הדף: מידע על השרת ותיקיית עבודה ראשונית (נקראת פעם אחת מ-main.js)
export async function loadInitialInfo() {
  renderFolder();
  try {
    state.info = await (await fetch('/api/info')).json();
    if (!state.info.claude) addClaudeBtn.title = 'הפקודה claude לא נמצאה ב-PATH';
  } catch { /* offline: connect() will handle */ }
  renderFolder();
}

/* ---------- פתיחת טרמינלים ---------- */
export async function openTerminal(kind) {
  if (!state.connected) { toast('אין חיבור לשרת כרגע', 'error'); return; }
  // המידע נבדק רק בטעינת הדף; אם claude הותקן/תוקן מאז, בודקים שוב לפני שמסרבים
  if (kind === 'claude' && !state.info.claude) await refreshInfo();
  if (kind === 'claude' && !state.info.claude) { toast('הפקודה claude לא נמצאה ב-PATH של המחשב', 'error'); return; }
  const reqId = Math.random().toString(36).slice(2);
  state.reqs.add(reqId);
  const cwd = getCwd();
  adoptTabCwd(cwd);
  send({ t: 'create', kind, cwd, reqId });
  addPending(reqId, kind === 'powershell' ? 'PowerShell' : `Claude · ${basename(cwd)}`);
}

// שיחת Claude בתיקייה מסוימת: חדשה, או המשך של שיחה שמורה (resume)
export function openClaude(cwd, resume) {
  if (!state.connected) { toast('אין חיבור לשרת כרגע', 'error'); return; }
  if (!state.info.claude) { toast('הפקודה claude לא נמצאה ב-PATH של המחשב', 'error'); return; }
  const reqId = Math.random().toString(36).slice(2);
  state.reqs.add(reqId);
  adoptTabCwd(cwd);
  send({ t: 'create', kind: 'claude', cwd, resume, reqId });
  addPending(reqId, `Claude · ${basename(cwd)}`);
}

/* ---------- בחירת תיקייה ---------- */
// תיקיית העבודה של הטרמינל הבא: לכל לשונית רשת תיקייה משלה. כל מה שנפתח באותה לשונית (טרמינל, Claude, PowerShell) נפתח באותה תיקייה.
// לשונית שנבחרה בה תיקייה: היא. אחרת התיקייה של הטרמינל הראשון שבה. לשונית חדשה וריקה לא יורשת תיקייה מלשונית אחרת: מתחילה מתיקיית הבית עד שבוחרים.
export function getCwd() {
  const t = activeTab();
  if (t && t.cwd) return t.cwd;
  for (const id of (t ? t.order : [])) { const p = state.panes.get(id); if (p && p.meta.cwd) return p.meta.cwd; }
  return state.info.home || '';
}

// לשונית בלי תיקייה שנפתח בה משהו: התיקייה הזאת הופכת לתיקייה שלה (כדי שהבא אחריו ייפתח באותה תיקייה)
function adoptTabCwd(cwd) {
  const t = activeTab();
  if (t && !t.cwd && cwd) { t.cwd = cwd; sendView(); bus.emit('cwd'); }
}

export function setCwd(p) {
  const t = activeTab();
  if (t) { t.cwd = p; sendView(); }
  const recents = [p, ...getSetting('ui.recents').filter((x) => x.toLowerCase() !== p.toLowerCase())].slice(0, MAX_RECENTS);
  setSetting('ui.cwd', p); // התיקייה האחרונה שנבחרה (ברירת מחדל לכלים אחרים); הפתיחה עצמה לפי הלשונית
  setSetting('ui.recents', recents);
  bus.emit('cwd');
}

function renderFolder() {
  const cwd = getCwd();
  const recents = getSetting('ui.recents');
  folderLabel.textContent = basename(cwd) || '…';
  folderBtn.title = cwd ? `תיקיית עבודה: ${cwd}` : 'בחירת תיקיית עבודה';
  recentList.innerHTML = '';
  const items = recents.length ? recents : (cwd ? [cwd] : []);
  for (const path of items) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = path.toLowerCase() === cwd.toLowerCase() ? 'current' : '';
    b.innerHTML = '<span class="r-name"></span><span class="r-path"></span>';
    $('.r-name', b).textContent = basename(path) || path;
    $('.r-path', b).textContent = path;
    b.addEventListener('click', () => { setCwd(path); closePop(); });
    li.appendChild(b);
    recentList.appendChild(li);
  }
}

// נפתח מתחת לכפתור התיקייה (גם כשנקרא מתפריט "חדש")
export function openFolderPop() {
  const r = folderBtn.getBoundingClientRect();
  folderPop.hidden = false;
  folderPop.style.top = (r.bottom + 8) + 'px';
  folderPop.style.right = Math.max(8, innerWidth - r.right) + 'px';
  folderPop.style.left = 'auto';
  folderBtn.setAttribute('aria-expanded', 'true');
  pathInput.value = '';
}
function closePop() {
  folderPop.hidden = true;
  folderBtn.setAttribute('aria-expanded', 'false');
}

export function initLaunch() {
  // החיבור לשרת נפתח: מרעננים מידע (למשל אם claude הותקן מאז)
  bus.on('connected', refreshInfo);
  // תיקייה נבחרה כאן או בחלון אחר
  onSetting('ui.cwd', renderFolder);
  onSetting('ui.recents', renderFolder);
  bus.on('tabs', renderFolder); // מעבר בין לשוניות: התיקייה שמוצגת היא של הלשונית
  bus.on('cwd', renderFolder);
  // שגיאה על בקשה שהתחלנו (למשל תיקייה שלא קיימת)
  onMessage('error', (m) => {
    if (m.reqId) { state.reqs.delete(m.reqId); removePending(m.reqId); }
    restoreAllBusy(); // בקשה בלי reqId (הפעלה מחדש): הכפתורים שחיכו חוזרים לעצמם
    toast(m.message || 'משהו השתבש', 'error');
  });

  // כפתור "Claude חדש" בסרגל (שאר הפתיחות בתפריט שלידו), ו"פתיחת ..." במסך הריק
  addClaudeBtn.addEventListener('click', () => openTerminal('claude'));
  stage.addEventListener('click', (e) => {
    const launch = e.target.closest('[data-launch]');
    if (launch) openTerminal(launch.dataset.launch);
  });

  folderBtn.addEventListener('click', () => (folderPop.hidden ? openFolderPop() : closePop()));
  document.addEventListener('pointerdown', (e) => {
    if (!folderPop.hidden && !folderPop.contains(e.target) && !folderBtn.contains(e.target)) closePop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !folderPop.hidden) { closePop(); folderBtn.focus(); } });
  pathInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = pathInput.value.trim().replace(/^"|"$/g, '');
    if (v) { setCwd(v); closePop(); }
  });
  browseBtn.addEventListener('click', async () => {
    browseBtn.disabled = true;
    browseLabel.textContent = 'ממתין לבחירה בחלון שנפתח…';
    try {
      const picked = await pickFolder(getCwd());
      if (picked) { setCwd(picked); closePop(); }
    } catch {
      toast('לא ניתן לפתוח את בורר התיקיות', 'error');
    } finally {
      browseBtn.disabled = false;
      browseLabel.textContent = 'בחירת תיקייה מהמחשב…';
    }
  });
}
