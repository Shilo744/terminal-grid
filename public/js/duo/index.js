/* ---------- זוג סוכנים (ארכיטקט + עובד): נקודת הכניסה של התכונה ---------- */
// ארכיטקט (מימין) מתכנן ובודק, עובד (משמאל) כותב קוד, ובאמצע המסמך המשותף שלהם. הלוגיקה בשרת (server/duo).
import { initData } from './data.js';
import { initCreate } from './create.js';
import { initView, renderView } from './view.js';
import { initList } from './list.js';

export function initDuo() {
  initData();
  initCreate();
  initView();
  initList();
  renderView();
}
