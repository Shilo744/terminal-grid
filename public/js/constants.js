/* ---------- קבועים משותפים ---------- */

// כמו Windows Terminal: אותו גופן ואותה פלטה (Campbell), כדי שמה שרצים בו ייראה בדיוק כמו שאתה מכיר.
// Cascadia לא כולל עברית, לכן Segoe UI בא אחריו (אחרת האותיות נופלות על Courier New הדק והמרוחק).
export const MONO = "'TG Cascadia','Cascadia Mono','Cascadia Code',Consolas,'Segoe UI','Courier New',monospace";

// מראה (T36): הערכים האפשריים; הצבעים עצמם ב-tokens.css. צבעי הטרמינל ב-THEME (background, foreground, cursor, cursorAccent, selectionBackground) נקראים משם ב-appearance.js
export const APPEARANCE_STYLES = ['ide', 'classic', 'paper'];
export const ACCENTS = ['default', 'blue', 'teal', 'violet', 'green', 'amber', 'rose'];

export const THEME = {
  background: '#1e1e1e', foreground: '#cccccc', cursor: '#aeafad', cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00',
  blue: '#0037da', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc',
  brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c', brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff', brightMagenta: '#b4009e', brightCyan: '#61d6d6', brightWhite: '#f2f2f2',
};

// גופנים לבחירה (רק מה שמותקן במחשב מוצג). גופן בלי עברית נופל לגופן של Windows Terminal בשביל האותיות העבריות.
export const FONTS = [
  ['TG Cascadia', 'Cascadia (כמו Windows Terminal)'],
  ['Courier New', 'Courier New'],
  ['Miriam Fixed', 'Miriam Fixed'],
  ['Consolas', 'Consolas'],
  ['Cascadia Code', 'Cascadia Code'],
  ['Lucida Console', 'Lucida Console'],
];

// מידות הפריסה (פיקסלים)
export const GAP = 10;
export const HEAD_H = 36;
export const TILE_HEAD_H = 26;
export const TILE_H = 76; // גובה אריח: כותרת + שתי שורות תצוגה (tile-preview.js)

export const MAX_RECENTS = 8;
export const BUSY_MS = 1500;

// ברירות מחדל של ההגדרות לציור הראשון, לפני שהשרת ענה (המקור האמיתי: server/settings.js; tests/server/settings.js בודק שהן זהות)
export const SETTINGS_FALLBACK = {
  'terminal.fontFamily': 'TG Cascadia',
  'terminal.fontSize': 14,
  'terminal.lineHeight': 1,
  'terminal.cursorStyle': 'block',
  'terminal.cursorBlink': true,
  'terminal.scrollback': 5000,
  'appearance.rtlLayer': true,
  'appearance.style': 'ide',
  'appearance.accent': 'default',
  'ui.sideOpen': false,
  'ui.advancedOpen': false,
  'ui.notifyWaiting': false,
  'system.autostart': false,
  'claude.autoCompact.mode': 'default',
  'claude.autoCompact.window': 400000,
  'ui.cwd': '',
  'ui.recents': [],
};
