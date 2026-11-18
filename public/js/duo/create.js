/* ---------- יצירת זוג סוכנים חדש (חלון בחירה) ---------- */
import { $ } from '../dom.js';
import { state } from '../state.js';
import { send } from '../connection.js';
import { toast } from '../toast.js';
import { basename } from '../util.js';
import { setCwd, getCwd } from '../launch.js';
import { setView, startCreating } from './data.js';
import { dropEmptyTab } from '../tabs.js';
import { pickFolder } from '../pick-folder.js';

const dlg = $('#duoDlg');
const folderLabel = $('#duoFolderLabel');
const folderPath = $('#duoFolderPath');
const pickBtn = $('#duoPick');
const goalEl = $('#duoGoal');
const modeEl = $('#duoMode');
const modeHint = $('#duoModeHint');

const HINTS = {
  auto: 'מצב אוטומטי: Claude מחליט לבד מה בטוח, ועוצר רק כשצריך. מתאים לעבודה לילית.',
  acceptEdits: 'עריכות קבצים מאושרות מראש, ופקודות אחרות ממתינות לאישור שלך. הסוכן יכול להיתקע בלילה.',
  bypassPermissions: 'בלי שום בדיקת הרשאות. מסוכן: הסוכנים יכולים להריץ כל פקודה. השתמש רק בתיקייה שאפשר לאבד.',
};

let folder = '';

function renderFolder() {
  folderLabel.textContent = basename(folder) || folder || '…';
  folderPath.textContent = folder;
  folderPath.title = folder;
}

export function openCreate(project) {
  folder = project || getCwd() || '';
  renderFolder();
  modeHint.textContent = HINTS[modeEl.value];
  dlg.showModal();
  goalEl.focus();
}

export function initCreate() {
  modeEl.addEventListener('change', () => { modeHint.textContent = HINTS[modeEl.value]; });

  pickBtn.addEventListener('click', async () => {
    pickBtn.disabled = true;
    try {
      const picked = await pickFolder(folder || state.info.home);
      if (picked) { folder = picked; setCwd(picked); renderFolder(); }
    } catch {
      toast('לא ניתן לפתוח את בורר התיקיות', 'error');
    } finally {
      pickBtn.disabled = false;
    }
  });

  // "התחל" סוגר את החלון עם returnValue = ok; ביטול / Escape לא שולחים כלום
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    if (!state.connected) { toast('אין חיבור לשרת כרגע', 'error'); return; }
    if (!state.info.claude) { toast('הפקודה claude לא נמצאה ב-PATH של המחשב', 'error'); return; }
    const reqId = Math.random().toString(36).slice(2);
    send({ t: 'duo', op: 'create', project: folder, goal: goalEl.value.trim(), permissionMode: modeEl.value, reqId });
    goalEl.value = '';
    dropEmptyTab(); // הלשונית החדשה הריקה שממנה נבחר "זוג" נעלמת: הזוג מקבל לשונית משלו (T69)
    setView('duo');
    startCreating(reqId, folder);
  });
}
