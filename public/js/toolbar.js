/* ---------- כפתורים בסרגל: חזרה לרשת, ושכבת יישור עברית לימין ---------- */
import { state } from './state.js';
import { $, gridBtn } from './dom.js';
import { setExpanded } from './layout.js';
import { getSetting, setSetting, onSetting } from './settings.js';

// ההגדרה השתנתה (כאן, או בחלון אחר): הבקרה בסרגל והשכבה בכל הטרמינלים מתעדכנות. החלפת צד: השורות העבריות מחליקות 120ms (rtl.js)
function paintRtl() {
  const on = getSetting('appearance.rtlLayer');
  $('#rtlOn').setAttribute('aria-checked', String(on));
  $('#rtlOff').setAttribute('aria-checked', String(!on));
  $('#rtlOn').tabIndex = on ? 0 : -1;
  $('#rtlOff').tabIndex = on ? -1 : 0;
  $('#rtlBtn').dataset.on = String(on);
}
function applyRtl() {
  paintRtl();
  const on = getSetting('appearance.rtlLayer');
  for (const p of state.panes.values()) if (p.rtl) p.rtl.transition(on);
}

export function initToolbar() {
  gridBtn.addEventListener('click', () => setExpanded(null));

  paintRtl();
  $('#rtlOn').addEventListener('click', () => setSetting('appearance.rtlLayer', true));
  $('#rtlOff').addEventListener('click', () => setSetting('appearance.rtlLayer', false));
  // רדיו: חצים מחליפים בין שני המצבים (כמו בהגדרות)
  $('#rtlBtn').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = !getSetting('appearance.rtlLayer');
    setSetting('appearance.rtlLayer', next);
    $(next ? '#rtlOn' : '#rtlOff').focus();
  });
  onSetting('appearance.rtlLayer', applyRtl);
}
