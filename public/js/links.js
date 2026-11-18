/* ---------- קישורים בטרמינל (T47): רק Ctrl+לחיצה, ורק קישורי web נפתחים ---------- */
// Claude Code מדפיס קישורי OSC 8 (כתובת מייל, נתיב קובץ, כתובת אתר) ו-xterm הופך אותם ללחיצים. בלחיצה רגילה, גם בטעות (בחירת טקסט, מיקוד פאן), לא נפתח כלום.
// Ctrl+לחיצה: http/https נפתח בלשונית חדשה (noopener, noreferrer); כל סכמה אחרת (mailto:, file:, ms-settings:, vscode: ...) לא מנווטים אליה לעולם, אלא מעתיקים ללוח עם הודעה.
// ריחוף מעל קישור מציג צ'יפ קטן בפינת הפאן עם היעד ואיך לפתוח אותו. אין חלונות confirm.
import { toast } from './toast.js';

const WEB = ['http:', 'https:'];
const isWeb = (uri) => { try { return WEB.includes(new URL(uri).protocol); } catch { return false; } };
const short = (s) => (s.length > 70 ? s.slice(0, 67) + '…' : s);

function activate(event, uri, text) {
  if (!(event && (event.ctrlKey || event.metaKey))) return; // לחיצה רגילה לא פותחת כלום
  if (isWeb(uri)) { window.open(uri, '_blank', 'noopener,noreferrer'); return; }
  const copy = text && text !== uri ? text : uri.replace(/^mailto:/i, '');
  navigator.clipboard.writeText(copy).then(() => toast('הקישור הועתק (לא נפתח אוטומטית)'), () => toast('הקישור לא נפתח (אפשר להעתיק אותו ידנית)', 'error'));
}

// מטפלים לטרמינל אחד: linkHandler של xterm (קישורי OSC 8), ומטפל + אפשרויות לתוסף WebLinks (כתובות בטקסט). paneOf מחזיר את אלמנט הפאן (לצ'יפ)
export function paneLinks(paneOf) {
  let chip = null;
  const show = (uri) => {
    const pane = paneOf();
    const body = pane && pane.querySelector('.pane-body');
    if (!body) return;
    hide();
    chip = document.createElement('div');
    chip.className = 'link-chip';
    chip.innerHTML = '<span class="lc-hint"></span><bdi class="lc-uri" dir="ltr"></bdi>';
    chip.firstChild.textContent = isWeb(uri) ? 'Ctrl+לחיצה לפתיחה: ' : 'Ctrl+לחיצה להעתקה (לא נפתח): ';
    chip.lastChild.textContent = short(uri);
    body.appendChild(chip);
  };
  const hide = () => { if (chip) { chip.remove(); chip = null; } };
  return {
    // allowNonHttpProtocols: בלי זה xterm מתעלם מקישורי mailto/file לגמרי; עם זה הם קישורים (עם הצ'יפ), אבל לעולם לא מנווטים אליהם
    handler: { allowNonHttpProtocols: true, activate: (e, text) => activate(e, text, text), hover: (e, text) => show(text), leave: hide },
    webActivate: (e, uri) => activate(e, uri, uri),
    webOptions: { hover: (e, text) => show(text), leave: hide },
  };
}

// חגורת בטיחות לכל העמוד: לחיצה על עוגן (a) שהיעד שלו אינו http/https נחסמת. היום אין כאלה בממשק
export function initLinks() {
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { e.preventDefault(); return; }
    if (!WEB.includes(u.protocol)) e.preventDefault();
  }, true);
}
