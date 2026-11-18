'use strict';
// "claude" מדומה לבדיקות הדבקת תמונות (T45): מפעיל הדבקה מסוגרת (כמו Claude Code) ומדפיס כל מה שהוא מקבל כשורה אחת בטקסט קריא:
//   GOT:<JSON של הנתונים הגולמיים>   (ESC מופיע כ-\u001b: הדבקה מסוגרת היא \u001b[200~...\u001b[201~, והמקש Alt+V הוא \u001bv)
// בנוסף, כשמגיעה הדבקה מסוגרת שהתוכן שלה נתיב של קובץ תמונה קיים, מדפיס [Image #N] כמו Claude (ובודק שהקובץ באמת קיים ומה גודלו).
const fs = require('fs');
const ESC = String.fromCharCode(27);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdout.write(ESC + '[?2004h'); // bracketed paste on
process.stdout.write('Claude Code v2.0 (fake)\r\n╭' + '─'.repeat(40) + '╮\r\n│ > ' + ' '.repeat(36) + '│\r\n╰' + '─'.repeat(40) + '╯\r\n  ? for shortcuts\r\n');
let images = 0;
process.stdin.on('data', (d) => {
  console.log('GOT:' + JSON.stringify(d).replace(/\x7f/g, '\\u007f')); // DEL would vanish on a terminal screen (T53 counts Backspaces)
  const m = /\u001b\[200~([\s\S]*?)\u001b\[201~/.exec(d);
  if (m) {
    // נתיבים בגרשיים או בלי, מופרדים ברווח
    const paths = [...m[1].matchAll(/"([^"]+)"|(\S+)/g)].map((x) => x[1] || x[2]);
    for (const p of paths) {
      try { const st = fs.statSync(p); images++; console.log('[Image #' + images + '] ' + p.split(/[\\/]/).pop() + ' (' + st.size + ' bytes)'); } catch { console.log('NOT_A_FILE: ' + p); }
    }
  }
});
setInterval(() => {}, 1 << 30);
