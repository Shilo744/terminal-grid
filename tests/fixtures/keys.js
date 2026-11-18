'use strict';
// "claude" מדומה לבדיקת מקשים (T54): מדפיס את הבתים שקיבל כל קלט, בהקסה, בשורה "KEYS <hex ...>".
// כך אפשר לראות מה בדיוק נשלח לתוכנית כשהמשתמש לוחץ Enter, Shift+Enter וכדומה (Shift+Enter צריך להגיע כ-1b 0d, Enter כ-0d)
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
console.log('KEYS-FIXTURE ready');
process.stdin.on('data', (d) => console.log('KEYS ' + [...d].map((b) => b.toString(16).padStart(2, '0')).join(' ')));
setInterval(() => {}, 1 << 30);
