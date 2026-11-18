'use strict';
// כתיבה אטומית של קובץ: קובץ זמני ואז rename. ב-Windows ה-rename נכשל ב-EPERM/EBUSY כשתהליך אחר (סורק וירוסים, אינדקס חיפוש,
// עורך טקסט, בדיקה שקוראת את הקובץ) פותח את היעד בדיוק באותו רגע. לכן מנסים כמה פעמים עם המתנה קצרה, ואם עדיין נכשל כותבים ישירות
// (לא אטומי, אבל עדיף על אובדן השינוי). זורק רק אם גם הכתיבה הישירה נכשלה.
const fs = require('fs');

const RETRY_CODES = /^(EPERM|EBUSY|EACCES)$/;
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* אין SharedArrayBuffer: ממשיכים בלי המתנה */ } };

function writeFileAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i < 5 && RETRY_CODES.test(String(e && e.code))) { sleepSync(20 * (i + 1)); continue; }
      try { fs.writeFileSync(file, data); } finally { try { fs.unlinkSync(tmp); } catch { /* אין קובץ זמני */ } }
      return;
    }
  }
}

module.exports = { writeFileAtomic };
