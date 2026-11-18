'use strict';
// "claude" מדומה למדידת הדבקה (T33): מפעיל bracketed paste כמו Claude Code, סופר כמה בתים הגיעו ומתי, ומדווח:
//   PD <בתים> <זמן הבית הראשון> <זמן הבית האחרון> <sha1 מצטבר>   (אחרי 150ms בלי קלט חדש; הזמנים ב-Date.now(), אותו שעון כמו הבדיקה)
const crypto = require('crypto');
const t = () => Date.now();
const hash = crypto.createHash('sha1'); // מצטבר על כל מה שהתקבל, כדי שאפשר יהיה לוודא שההדבקה הגיעה שלמה ובסדר
process.stdout.write('\x1b[?2004h');
console.log('PASTE-ECHO ready');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
let bytes = 0, first = 0, last = 0, timer = null;
process.stdin.on('data', (d) => {
  const now = t();
  if (!first) first = now;
  last = now;
  bytes += d.length;
  hash.update(d);
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`PD ${bytes} ${first} ${last} ${hash.copy().digest('hex')}`);
    bytes = 0; first = 0; last = 0;
  }, 150);
});
setInterval(() => {}, 1 << 30);
