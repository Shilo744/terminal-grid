'use strict';
// "claude" מדומה לבדיקת הקישורים בטרמינל (T47): מדפיס קישורי OSC 8 (mailto, file, https) וכתובת רגילה בטקסט, בשורות קבועות.
const ESC = String.fromCharCode(27), BEL = String.fromCharCode(7);
const link = (uri, text) => ESC + ']8;;' + uri + BEL + text + ESC + ']8;;' + BEL;
const out = [
  'Claude Code v2.0 (fake)',
  '',
  'mail: ' + link('mailto:worker@local', 'worker@local'),
  'file: ' + link('file:///C:/Windows/notepad.exe', 'open notepad'),
  'web:  ' + link('https://example.com/docs', 'the docs'),
  'text: https://example.org/plain-url',
  '',
  '? for shortcuts',
];
process.stdout.write(out.join('\r\n') + '\r\n');
process.stdin.resume();
setInterval(() => {}, 1 << 30);
