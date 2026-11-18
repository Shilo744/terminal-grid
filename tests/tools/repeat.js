'use strict';
/*
 * מריץ את הסוויטה n פעמים ומדפיס טבלת עובר/נכשל לכל קובץ בדיקה: כך רואים איזו בדיקה לא יציבה (ולא רק "נכשל פעם אחת").
 *   node tests/tools/repeat.js <n> [filter]      למשל: node tests/tools/repeat.js 3        או: node tests/tools/repeat.js 5 rtl
 * כל הרצה היא `node tests/run.js` רגיל (כולל ניסיון שני לקובץ שנכשל), אבל כאן ניסיון שני נחשב ככישלון של ההרצה:
 * המטרה היא לגלות חוסר יציבות, לא להסתיר אותו. לוג מלא לכל הרצה נשמר ב-tests/.tmp/repeat-<i>.log.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const n = Math.max(1, Number(process.argv[2]) || 3);
const filter = process.argv[3] && process.argv[3].split(String.fromCharCode(92)).join('/'); // אפשר לכתוב e2e/ui או e2e\ui
const root = path.resolve(__dirname, '..');
const SKIP = new Set(['lib', 'fixtures', 'tools', '.tmp']);
const files = [];
for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory() || SKIP.has(dir.name)) continue;
  for (const f of fs.readdirSync(path.join(root, dir.name))) if (f.endsWith('.js') && !f.endsWith('-real.js') && (!filter || (dir.name + '/' + f).includes(filter))) files.push(path.join(dir.name, f));
}
files.sort();

const table = new Map(files.map((f) => [f, []]));
const fails = new Map();
for (let i = 1; i <= n; i++) {
  console.log(`\n===== run ${i}/${n} =====`);
  for (const f of files) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(root, f)], { encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
    const ok = r.status === 0;
    table.get(f).push(ok);
    fs.appendFileSync(path.join(root, '.tmp', `repeat-${i}.log`), `\n##### ${f}\n${r.stdout || ''}${r.stderr || ''}`);
    const failing = (r.stdout || '').split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.slice(0, 160));
    if (!ok) fails.set(f, [...(fails.get(f) || []), ...failing, ...(failing.length ? [] : [`exit ${r.status}`])]);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${f} (${Math.round((Date.now() - t0) / 1000)}s)${ok ? '' : '  ' + failing.join(' | ')}`);
  }
}

console.log('\n===== summary =====');
let allGreen = true;
for (const [f, res] of table) {
  const pass = res.filter(Boolean).length;
  if (pass !== n) allGreen = false;
  console.log(`${pass === n ? 'ok  ' : 'FLAKY'} ${f.padEnd(28)} ${res.map((x) => (x ? '✓' : '✗')).join(' ')}  ${pass}/${n}`);
}
for (const [f, list] of fails) console.log(`\n${f}:\n  ` + [...new Set(list)].join('\n  '));
console.log(allGreen ? `\nALL ${n} RUNS GREEN` : '\nNOT STABLE');
process.exit(allGreen ? 0 : 1);
