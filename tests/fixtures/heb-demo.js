// Prints what Claude Code prints for Hebrew: rows already in VISUAL order, left-aligned, bullet at the left,
// 2-space indent on continuation rows, parentheses NOT mirrored; then the input box with the cursor inside it.
const HEB = /[֐-׿]/;
const COLS = Number(process.env.DEMO_COLS) || 110;
const visualWord = (t) => (HEB.test(t) ? [...t].reverse().join('') : t);
// like the real Claude Code (captured from v2.1.301): Hebrew words reversed, runs of non-Hebrew words ("Terminal Grid", "server.js") stay in order as ONE phrase, groups in reverse order
const visualRow = (words) => {
  const groups = [];
  for (const w of words) {
    const heb = HEB.test(w), g = groups[groups.length - 1];
    if (!heb && g && !g.heb) g.words.push(w); else groups.push({ heb, words: [w] });
  }
  return groups.reverse().map((g) => (g.heb ? visualWord(g.words[0]) : g.words.join(' '))).join(' ');
};
function wrap(text, width) {
  const rows = []; let cur = [];
  for (const w of text.split(' ')) {
    if ([...cur, w].join(' ').length > width && cur.length) { rows.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) rows.push(cur);
  return rows;
}
const out = (s) => process.stdout.write(s + '\r\n');
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const para = (text, marker) => {
  wrap(text, COLS - 4).forEach((r, i) => out((i === 0 ? marker + ' ' : '  ') + visualRow(r)));
};

for (let k = 0; k < (Number(process.env.DEMO_FILL) || 0); k++) para('שורה מספר ' + k + ' בהיסטוריה של הטרמינל, עם מילים בעברית ועוד קצת טקסט כדי שהשורה תהיה ארוכה מספיק', '●');
out('');
para('אני מסתכל על המסך האמיתי שלך, כמו שביקשת. קודם בודק אם V2 רץ ומה כתוב בלוג, ובמקביל מחפש את חלון Terminal Grid כדי לצלם אותו כמו שצריך.', '●');
out('');
out('  ' + dim('Ran 2 shell commands'));
out('');
para('שרת V2 סגור, אבל יש חלון פתוח בלי שרת מחובר, וזה מסביר למה הוא ריק. אני מעביר אותו לחזית ומצלם מה שמוצג בפועל.', '●');
out('');
out('● ' + [visualWord('בתיקייה'), visualWord('נשמר'), ')app.js(', visualWord('הקובץ')].join(' ')); // parentheses arrive reversed
out('● ' + bold('Read 1 file') + ', ran 2 shell commands');
out('  ' + dim('L  src/server.js (English only, must stay on the left)'));
out('- ' + visualRow('פריט ראשון ברשימה'.split(' ')));
out('- ' + visualRow('פריט שני, קצת יותר ארוך מהראשון בשביל הבדיקה'.split(' ')));
out('');
out('\x1b[33m✻\x1b[0m Scampering… ' + dim('(12s)'));
out('');
const sep = '─'.repeat(COLS - 2);
out(dim(sep));
const typed = visualRow('זה טקסט שהמשתמש מקליד עכשיו'.split(' '));
process.stdout.write('❯ ' + typed);
process.stdout.write('\r\n' + dim(sep) + '\r\n  ' + dim('⏵⏵ auto mode on (shift+tab to cycle)'));
process.stdout.write('\x1b[2A\x1b[' + (2 + typed.length + 1) + 'G'); // cursor back into the prompt row
