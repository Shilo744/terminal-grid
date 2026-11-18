/* ---------- כפתור "חדש" מפוצל: הפעולה הראשית נשארת "Claude חדש", והחץ פותח תפריט עם שאר הפתיחות ---------- */
import { $, stage } from './dom.js';
import { basename } from './util.js';
import { openMenu } from './menu.js';
import { openTerminal, openFolderPop, getCwd } from './launch.js';
import { openAdopt } from './adopt.js';
import { openCreate } from './duo/create.js';
import { newTab, MAX_TABS } from './tabs.js';
import { state } from './state.js';
import { setView } from './duo/data.js';

const btn = $('#newMenuBtn');
let menu = null;

// הפריטים משותפים לכפתור "חדש" ולקליק ימני על שטח ריק ברשת (T57)
function newItems() {
  const cwd = getCwd();
  // התיקייה מוצגת בשורה השנייה של שני הפריטים שנפתחים בה: זה המקום שבו הטרמינל החדש ייפתח
  const where = cwd ? `${basename(cwd)} · ${cwd}` : '';
  return [
      { id: 'claude', label: 'Claude חדש', icon: 'asterisk', description: where, run: () => openTerminal('claude') },
      { id: 'powershell', label: 'PowerShell חדש', icon: 'terminal', description: where, run: () => openTerminal('powershell') },
      { id: 'tab', label: 'לשונית רשת חדשה', icon: 'plus', description: 'קבוצת טרמינלים נוספת', disabled: state.tabs.length >= MAX_TABS, run: () => { setView('grid'); newTab(); } },
      { id: 'duo', label: 'זוג סוכנים…', icon: 'duo', run: () => openCreate() },
      { id: 'adopt', label: 'ייבוא סוכנים…', icon: 'import', run: () => openAdopt(btn) },
      { separator: true },
      { id: 'folder', label: 'בחירת תיקיית עבודה…', icon: 'folder', run: () => openFolderPop() },
  ];
}

function open(focus) {
  menu = openMenu({ anchor: btn, focus, label: 'פתיחה חדשה', items: newItems() });
}

export function initNewMenu() {
  // קליק ימני על שטח ריק ברשת (לא על טרמינל, כפתור, רשימה או שדה): אותו תפריט "חדש" (T57)
  stage.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented || e.target.closest('.pane, button, a, input, textarea, select, .start-item, .pending-card')) return;
    e.preventDefault();
    openMenu({ point: { x: e.clientX, y: e.clientY }, label: 'פתיחה חדשה', items: newItems() });
  });
  btn.addEventListener('click', () => { if (menu && menu.isOpen()) menu.close('api'); else open('first'); });
  // מהמקלדת: חץ למטה/למעלה פותח ומתמקד בפריט הראשון/האחרון (Enter ורווח כבר מפעילים לחיצה)
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (!(menu && menu.isOpen())) open(e.key === 'ArrowDown' ? 'first' : 'last');
  });
}
