/* ---------- מסך הפתיחה (אין טרמינלים): הדרך המהירה לחזור לעבודה ---------- */
// כפתור ראשי "Claude חדש ב-<תיקייה>", PowerShell, "המשך מאיפה שעצרת" (4 השיחות השמורות האחרונות) ו"תיקיות אחרונות" (4).
// השיחות נטענות כשהמסך מוצג (layout.js מכריז empty-shown). בזמן הטעינה מראים שורות שלד רק אם התשובה מתעכבת (בלי הבהוב), ובמחשב חדש
// (אין שיחות ואין תיקיות) נשארים שני הכפתורים. כש-claude לא נמצא ב-PATH: הודעה ברורה ו"בדיקה מחדש".
import { state, bus } from './state.js';
import { $ } from './dom.js';
import { basename, relTime } from './util.js';
import { getSetting, onSetting } from './settings.js';
import { fetchHistory, recentSessions } from './history-data.js';
import { openClaude, setCwd, getCwd, openFolderPop, refreshInfo } from './launch.js';
import { openCreate } from './duo/create.js';

const card = $('.empty-card.start');
const primary = $('#startClaude');
const label = $('#startClaudeLabel');
const missing = $('#startMissing');
const resumeBox = $('#startResume');
const resumeList = $('#startResumeList');
const foldersBox = $('#startFolders');
const foldersList = $('#startFoldersList');
const SKELETON_AFTER_MS = 150;
const MAX_ITEMS = 4;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function paintMain() {
  const folder = basename(getCwd());
  label.textContent = 'Claude חדש';
  if (folder) {
    label.append(' ב-');
    label.append(Object.assign(document.createElement('bdi'), { textContent: folder }));
  }
  const noClaude = state.info.claude === false;
  missing.hidden = !noClaude;
  primary.disabled = noClaude;
  primary.title = noClaude ? 'הפקודה claude לא נמצאה ב-PATH' : `פתיחת שיחה חדשה בתיקייה ${getCwd()}`;
}

function item(kind, title, meta, data) {
  const li = el('li');
  const b = el('button', 'start-item');
  b.type = 'button';
  b.dataset.kind = kind;
  Object.assign(b.dataset, data);
  b.append(el('span', 'start-item-title', title), el('span', 'start-item-meta', meta));
  b.firstChild.setAttribute('dir', 'auto');
  li.append(b);
  return li;
}

function skeleton(list) {
  list.replaceChildren(...[0, 1, 2].map(() => { const li = el('li', 'start-skeleton'); li.setAttribute('aria-hidden', 'true'); return li; }));
}

function paintFolders() {
  const recents = getSetting('ui.recents').slice(0, MAX_ITEMS);
  foldersBox.hidden = recents.length === 0;
  foldersList.replaceChildren(...recents.map((p) => item('folder', basename(p) || p, p, { path: p })));
  for (const li of foldersList.children) li.querySelector('.start-item-meta').setAttribute('dir', 'ltr');
}

async function paintResume() {
  const timer = setTimeout(() => { resumeBox.hidden = false; skeleton(resumeList); }, SKELETON_AFTER_MS);
  const history = await fetchHistory();
  clearTimeout(timer);
  const list = history ? recentSessions(history, MAX_ITEMS) : [];
  resumeBox.hidden = list.length === 0;
  resumeList.replaceChildren(...list.map((s) => item('session', s.title, `${s.folder} · ${relTime(s.last)}`, { cwd: s.cwd, id: s.id })));
}

function show() {
  paintMain();
  paintFolders();
  paintResume();
  // המיקוד מתחיל בכפתור הראשי (אלא אם משהו אחר כבר פתוח, כמו חלון הגדרות)
  if (!document.querySelector('dialog[open]') && (document.activeElement === document.body || !document.activeElement)) primary.focus({ preventScroll: true });
}

export function initStartScreen() {
  bus.on('empty-shown', show);
  onSetting('ui.cwd', paintMain);
  bus.on('tabs', paintMain);
  bus.on('cwd', paintMain);
  onSetting('ui.recents', paintFolders);
  $('#startFolder').addEventListener('click', () => openFolderPop());
  $('#startDuo').addEventListener('click', () => openCreate());
  $('#startRecheck').addEventListener('click', async () => { await refreshInfo(); paintMain(); });
  card.addEventListener('click', (e) => {
    const b = e.target.closest('.start-item');
    if (!b) return;
    if (b.dataset.kind === 'session') openClaude(b.dataset.cwd, b.dataset.id);
    else { setCwd(b.dataset.path); openClaude(b.dataset.path); }
  });
}
