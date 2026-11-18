/* ---------- כפתור "עוד" (⋯) בסרגל: ייבוא סוכנים, זוג חדש, ואודות ---------- */
import { $ } from './dom.js';
import { openMenu } from './menu.js';
import { openAdopt } from './adopt.js';
import { openCreate } from './duo/create.js';

const btn = $('#moreBtn');
const dlg = $('#aboutDlg');
let menu = null;

// "אודות": גרסה, פורט, ואיפה נשמרות ההגדרות והמצב (שימושי כשמריצים כמה מופעים במקביל)
async function showAbout() {
  try {
    const info = await (await fetch('/api/info')).json();
    $('#aboutLine').textContent = `גרסה ${info.version} · פורט ${info.port}`;
    $('#aboutSettings').textContent = info.settingsFile || '';
    $('#aboutState').textContent = info.stateFile || '';
  } catch {
    $('#aboutLine').textContent = 'לא ניתן לקרוא את פרטי השרת כרגע';
    $('#aboutSettings').textContent = '';
    $('#aboutState').textContent = '';
  }
  dlg.showModal();
}

function open(focus) {
  menu = openMenu({
    anchor: btn,
    focus,
    label: 'עוד פעולות',
    items: [
      { id: 'adopt', label: 'ייבוא סוכנים…', icon: 'import', description: 'להביא סוכן שרץ בחלון אחר', run: () => openAdopt(btn) },
      { id: 'duo', label: 'זוג סוכנים חדש…', icon: 'duo', run: () => openCreate() },
      { separator: true },
      { id: 'about', label: 'אודות Terminal Grid', icon: 'terminal', run: showAbout },
    ],
  });
}

export function initMoreMenu() {
  btn.addEventListener('click', () => { if (menu && menu.isOpen()) menu.close('api'); else open('first'); });
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (!(menu && menu.isOpen())) open(e.key === 'ArrowDown' ? 'first' : 'last');
  });
}
