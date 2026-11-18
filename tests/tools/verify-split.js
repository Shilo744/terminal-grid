'use strict';
/*
 * מוודא שפיצול app.js ו-rtl.js למודולים לא איבד ולא שיבש אף שורת קוד: כל שורה (בלי רווחים בקצוות) מהקבצים המקוריים
 * ב-git חייבת להופיע בקבצי public/js (אחרי שמורידים "export "). מה שנספר כאובדן:
 *   - שורה עם תו שאינו ASCII (מחרוזות עבריות, גרשיים, תווים מיוחדים) שנעלמה או שונתה - כושל.
 *   - שורת ASCII שנעלמה - "שינוי מבני" (הכרזה שהפכה לייצוא, switch של הודעות שהפך לרישום מטפלים): מדווח, לא כושל.
 * כותרות סעיפים (/* ---- ... ---- *\/) והמעטפת הישנה (IIFE, window.TGRtl) מוחרגות.
 *
 *   node tests/tools/verify-split.js [ref] [--show-structural] [--show-new]
 *   ref = הקומיט שלפני הפיצול (ברירת מחדל: 4f231d1)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const ref = args.find((a) => !a.startsWith('--')) || '4f231d1'; // הקומיט האחרון לפני הפיצול (עדיין עם public/app.js)
const root = path.join(__dirname, '..', '..');
const git = (p) => execFileSync('git', ['show', `${ref}:${p}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).replace(/\r\n/g, '\n');

const oldLines = [...git('public/app.js').split('\n'), ...git('public/rtl.js').split('\n')];
const dir = path.join(root, 'public', 'js');
const newLines = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').split('\n'));

const norm = (l) => l.trim().replace(/^export (async )?/, (m, a) => (a ? 'async ' : ''));
const count = (lines) => { const m = new Map(); for (const l of lines) { const t = norm(l); if (t) m.set(t, (m.get(t) || 0) + 1); } return m; };
const A = count(oldLines), B = count(newLines);

const sectionHeader = /^\/\* -{5,} .* -{5,} \*\/$/;
const wrapper = /^(\(\(\) => \{|\}\)\(\);|'use strict';|window\.TGRtl = \{ attach \};)$/;
const nonAscii = /[^\x00-\x7f]/;

let lost = 0, structural = 0;
for (const [l, n] of A) {
  const have = B.get(l) || 0;
  if (have >= n || wrapper.test(l) || sectionHeader.test(l)) continue;
  if (nonAscii.test(l)) { lost++; console.log(`LOST non-ASCII line (${n - have}x): ${l.slice(0, 140)}`); }
  else { structural++; if (args.includes('--show-structural')) console.log(`structural change (${n - have}x): ${l.slice(0, 140)}`); }
}
const withNonAscii = [...A.keys()].filter((l) => nonAscii.test(l) && !sectionHeader.test(l)).length;
console.log(`old: ${A.size} distinct lines, ${withNonAscii} of them with non-ASCII characters (section headers excluded)`);
console.log(`lost non-ASCII lines: ${lost}   |   ASCII lines restructured (declarations / message dispatch / wiring): ${structural}`);

const fresh = [...B.entries()].filter(([l, n]) => (A.get(l) || 0) < n).map(([l]) => l);
console.log(`new lines that did not exist before: ${fresh.length} (imports, init wiring, comments)`);
if (args.includes('--show-new')) for (const l of fresh) console.log('  + ' + l.slice(0, 140));
process.exit(lost ? 1 : 0);
