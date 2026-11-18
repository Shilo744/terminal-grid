/* ---------- שורות ההגדרות (הצהרתי): הוספת הגדרה לפאנל = אובייקט אחד כאן ---------- */
// group: 'display' (פתוח תמיד) או 'advanced' (מקופל כברירת מחדל); id, label, description,
// control (switch | select | slider | number | segmented), path (נתיב ההגדרה ב-settings.js; מינימום, מקסימום וצעד נלקחים מהסכמה של השרת),
// options (לבחירה), format/unit (לתצוגת הערך), sample: true (מציג מתחת לשורה תצוגה מקדימה חיה של הגופן והסמן).
// stack: true (הרכיב מתחת לטקסט, לרכיבים רחבים), number: true (select של מספרים), showWhen: { path, equals } (השורה מוצגת רק כשהערך כזה),
// control: 'custom' + build() (אלמנט משלכם: הערות והסברים). variant (ל-segmented): 'cards' | 'dots' (ראו controls.js).
// apply: async (value) => ({ ok, note }): במקום setSetting. לערכים שהשרת קובע (הפעלה אוטומטית): השרת משדר את הערך החדש, והתג לא נכלל באיפוס הכול.
// guard: async () => ({ ok, note }): רץ לפני שהתג מופעל (בתוך הלחיצה); אם ok הוא false ההגדרה לא משתנה והערה מוצגת מתחת לשורה.
import { installedFonts } from '../fonts.js';
import { compactNote, compactHelp } from './claude-group.js';
import { requestNotifications } from '../attention.js';
import { autostartNote, setAutostart } from './general-group.js';

export const GROUPS = [
  { id: 'display', title: 'תצוגה' },
  { id: 'claude', title: 'סוכני Claude' },
  { id: 'general', title: 'כללי' },
  { id: 'advanced', title: 'מתקדם', collapsible: true },
];

export const ROWS = [
  { id: 'style', group: 'display', control: 'segmented', variant: 'cards', path: 'appearance.style', stack: true,
    options: [{ value: 'ide', style: 'ide', label: 'IDE' }, { value: 'classic', style: 'classic', label: 'קלאסי' }, { value: 'paper', style: 'paper', label: 'נייר' }],
    label: 'מראה', description: 'חל מיד על כל הממשק ועל הטרמינלים. אפשר להחליף בכל רגע.' },
  { id: 'accent', group: 'display', control: 'segmented', variant: 'dots', path: 'appearance.accent',
    options: [{ value: 'default', label: 'ברירת המחדל של הסגנון' }, { value: 'blue', label: 'כחול' }, { value: 'teal', label: 'טורקיז' }, { value: 'violet', label: 'סגול' }, { value: 'green', label: 'ירוק' }, { value: 'amber', label: 'כתום' }, { value: 'rose', label: 'ורוד' }],
    label: 'צבע הדגשה' },
  { id: 'fontFamily', group: 'display', control: 'select', path: 'terminal.fontFamily', options: installedFonts,
    label: 'גופן', description: 'מוצגים רק גופנים שמותקנים במחשב.' },
  { id: 'fontSize', group: 'display', control: 'slider', path: 'terminal.fontSize', format: (n) => `${n}px`, sample: true,
    label: 'גודל גופן', description: 'משפיע מיד על כל הטרמינלים הפתוחים.' },
  { id: 'rtlLayer', group: 'display', control: 'switch', path: 'appearance.rtlLayer', preview: 'rtl',
    label: 'יישור עברית לימין', description: 'לסוכני Claude בלבד. אזור ההקלדה לא משתנה.' },
  { id: 'notifyWaiting', group: 'display', control: 'switch', path: 'ui.notifyWaiting', guard: requestNotifications,
    label: 'התראה כשסוכן מחכה לך', description: 'כשהחלון לא ממוקד: סוכן שצריך אישור, או שסיים עבודה ארוכה.' },

  { id: 'autoCompactMode', group: 'claude', control: 'segmented', path: 'claude.autoCompact.mode', stack: true,
    options: [{ value: 'default', label: 'ברירת המחדל של Claude' }, { value: 'early', label: 'מוקדם יותר' }, { value: 'off', label: 'כבוי' }],
    label: 'דחיסת שיחה אוטומטית', description: 'מתי Claude מסכם את השיחה כדי לפנות הקשר ולהמשיך לעבוד.' },
  { id: 'autoCompactWindow', group: 'claude', control: 'select', path: 'claude.autoCompact.window', number: true, showWhen: { path: 'claude.autoCompact.mode', equals: 'early' },
    options: [{ value: 150000, label: '150K טוקנים' }, { value: 250000, label: '250K טוקנים' }, { value: 400000, label: '400K טוקנים (מומלץ לריצות ארוכות)' }, { value: 600000, label: '600K טוקנים' }],
    label: 'לדחוס כשההקשר מגיע ל-' },
  { id: 'autoCompactNote', group: 'claude', control: 'custom', build: compactNote },
  { id: 'autoCompactHelp', group: 'claude', control: 'custom', build: compactHelp },

  { id: 'autostart', group: 'general', control: 'switch', path: 'system.autostart', apply: setAutostart,
    label: 'הפעלה אוטומטית עם Windows', description: 'Terminal Grid יופעל ברקע כשנכנסים ל-Windows, ישחזר את הטרמינלים ואת זוגות הסוכנים (Claude ממשיך את אותן שיחות), ויתחיל לעבוד בלי לפתוח חלון. את החלון פותחים בקיצור הרגיל.' },
  { id: 'autostartNote', group: 'general', control: 'custom', build: autostartNote },

  { id: 'lineHeight', group: 'advanced', control: 'slider', path: 'terminal.lineHeight', format: (n) => n.toFixed(2),
    label: 'גובה שורה', description: '1.00 הוא הצפוף ביותר.' },
  { id: 'cursorStyle', group: 'advanced', control: 'segmented', path: 'terminal.cursorStyle',
    options: [{ value: 'block', label: 'בלוק' }, { value: 'bar', label: 'קו' }, { value: 'underline', label: 'קו תחתון' }],
    label: 'צורת הסמן' },
  { id: 'cursorBlink', group: 'advanced', control: 'switch', path: 'terminal.cursorBlink', label: 'סמן מהבהב' },
  { id: 'scrollback', group: 'advanced', control: 'number', path: 'terminal.scrollback', unit: 'שורות',
    label: 'היסטוריית גלילה', description: 'חל מיד על טרמינלים פתוחים, ובטרמינלים חדשים גם השרת שומר כך.' },
];
