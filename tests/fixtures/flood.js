'use strict';
// A fake terminal for latency tests. In a folder named "echo" it echoes every typed character at once (raw mode);
// anywhere else it floods the terminal with mixed ANSI colour and Hebrew (about 0.6 MB/s per terminal).
const path = require('path');

const name = path.basename(process.cwd());
if (name === 'echo') {
  process.stdout.write('ECHO READY\r\n> ');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => process.stdout.write(d.replace(/\r/g, '\r\n> ')));
} else {
  const colors = [31, 32, 33, 34, 35, 36, 91, 92, 93, 94, 95, 96];
  const words = ['שלום', 'עולם', 'בדיקה', 'הודעה', 'compile', 'module', 'ok', 'warning', 'שגיאה', 'deploy'];
  let n = 0;
  const chunk = () => {
    let s = '';
    for (let i = 0; i < 40; i++, n++) {
      s += `\x1b[${colors[n % colors.length]}m[${String(n).padStart(7, '0')}]\x1b[0m ${words[n % words.length]} ${'x'.repeat(n % 50)} \x1b[1m${words[(n + 3) % words.length]}\x1b[0m\r\n`;
    }
    return s;
  };
  setInterval(() => process.stdout.write(chunk()), 5);
}
