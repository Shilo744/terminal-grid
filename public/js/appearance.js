/* ---------- מראה (T36): סגנון וצבע הדגשה, מיד ובלי טעינה מחדש ---------- */
// ההגדרות appearance.style / appearance.accent הופכות למאפייני data על :root, ושם tokens.css מחליף את כל הצבעים.
// הטרמינלים לא מכירים CSS, ולכן הצבעים שלהם (רקע, טקסט, סמן, בחירה) נקראים מאותם משתנים ומוזנים ל-THEME ול-xterm.
// 16 צבעי ה-ANSI לא משתנים לעולם: Claude Code נראה זהה בכל מראה.
import { THEME, APPEARANCE_STYLES, ACCENTS } from './constants.js';
import { state } from './state.js';
import { getSetting, onSetting } from './settings.js';

const root = document.documentElement;
let animTimer = 0;

// ערך שמור שאינו ברשימה (אחסון פגום, או גרסה אחרת) חוזר לברירת המחדל
const pick = (value, list) => (list.includes(value) ? value : list[0]);

// הצבעים של הטרמינל מתוך המשתנים של המראה הנוכחי (המקור היחיד: tokens.css)
export function readTerminalTheme() {
  const cs = getComputedStyle(root);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const background = v('--term-bg', THEME.background);
  return {
    background, cursorAccent: background,
    foreground: v('--term-fg', THEME.foreground),
    cursor: v('--term-cursor', THEME.cursor),
    selectionBackground: v('--term-select', THEME.selectionBackground),
  };
}

function apply(animate) {
  const style = pick(getSetting('appearance.style'), APPEARANCE_STYLES);
  const accent = pick(getSetting('appearance.accent'), ACCENTS);
  if (root.dataset.style === style && root.dataset.accent === accent && !animate) return syncTerminals();
  // מעבר צבע קצר רק בהחלפה חיה, לא בטעינה (אז הציור הראשון כבר במראה הנכון)
  if (animate) {
    root.classList.add('theme-anim');
    clearTimeout(animTimer);
    animTimer = setTimeout(() => root.classList.remove('theme-anim'), 280);
  }
  root.dataset.style = style;
  root.dataset.accent = accent;
  syncTerminals();
}

// THEME הוא אובייקט משותף (גם שכבת ה-RTL מציירת איתו), לכן מעדכנים אותו במקום, ואז כל xterm פתוח מקבל עותק ומצייר מחדש
function syncTerminals() {
  Object.assign(THEME, readTerminalTheme());
  for (const p of state.panes.values()) {
    if (p.term) p.term.options.theme = { ...THEME };
    if (p.rtl) p.rtl.update();
  }
}

export function initAppearance() {
  apply(false);
  onSetting('appearance.style', () => apply(true));
  onSetting('appearance.accent', () => apply(true));
}
