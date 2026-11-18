/* ---------- תפריט הקליק הימני של זוג (T57): לשונית למעלה ופריט ברשימה בתפריט הצד ---------- */
// רק פעולות שכבר קיימות: שינוי שם, השהיה/המשך, וסגירה (שמובילה ללוח הזוג, שם הכפתור הדו-שלבי השקט כבר מגן על מצב הזוג שנמחק בסגירה).
import { openMenu } from '../menu.js';
import { send } from '../connection.js';
import { selectDuo, setView, renameDuo, duoName } from './data.js';

export function openDuoMenu(d, where, nameEl) {
  openMenu({
    ...where,
    label: `פעולות על ${duoName(d)}`,
    items: [
      { id: 'rename', label: 'שינוי שם', run: () => renameDuo(d, nameEl) },
      { id: 'pause', label: d.paused ? 'המשך עבודה' : 'השהיית הזוג', description: d.paused ? '' : 'אף אחד לא יתעורר', run: () => send({ t: 'duo', op: d.paused ? 'resume' : 'pause', duoId: d.id }) },
      { separator: true },
      {
        id: 'close', label: 'סגירת הזוג…', danger: true, description: 'הטרמינלים נסגרים, קבצי .duo נשארים',
        run: () => { selectDuo(d.id); setView('duo'); requestAnimationFrame(() => { const b = document.querySelector('.db-close'); if (b) b.click(); }); },
      },
    ],
  });
}
