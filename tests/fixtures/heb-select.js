'use strict';
// "claude" מדומה לבדיקת בחירה וקישורים בשורות עברית מוזזות (T70): שורות בסדר חזותי, יישור שמאלי, כמו Claude Code האמיתי.
const HEB = /[֐-׿]/;
const visualWord = (t) => (HEB.test(t) ? [...t].reverse().join('') : t);
const visualRow = (words) => {
  const groups = [];
  for (const w of words) {
    const heb = HEB.test(w), g = groups[groups.length - 1];
    if (!heb && g && !g.heb) g.words.push(w); else groups.push({ heb, words: [w] });
  }
  return groups.reverse().map((g) => (g.heb ? visualWord(g.words[0]) : g.words.join(' '))).join(' ');
};
const out = (s) => process.stdout.write(s + '\r\n');
out('Claude Code v2.0 (fake)');
out('');
out('● ' + visualRow('הקישור למסמכים נמצא כאן https://example.com/docs ואפשר ללחוץ עליו'.split(' ')));
out('');
out(visualRow('זה משפט בעברית עם מילה English באמצע ועוד מילים'.split(' ')));
out('');
out('plain English row stays on the left');
out('');
out('? for shortcuts');
process.stdin.resume();
setInterval(() => {}, 1 << 30);
