'use strict';
/*
 * בדיקה סטטית של גרף הייבוא במודולי הממשק (public/js):
 *   1. כל שם שמיובא (import { a, b } from './x.js') באמת מיוצא מהקובץ ההוא.
 *   2. אין מעגלי ייבוא (A מייבא B שמייבא בחזרה את A, גם בעקיפין).
 *   3. כל קובץ מיובא קיים, ואין קובץ שאף אחד לא מייבא (חוץ מ-main.js).
 * מדפיס גם את שכבות המודולים (לפי עומק התלות), כדי שאפשר יהיה לראות את כיוון התלויות.
 *
 *   node tests/tools/check-imports.js
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'public', 'js');
// כולל תתי-תיקיות (למשל duo/). השמות הם נתיבים יחסיים עם / כדי שאפשר יהיה לפתור ייבוא יחסי ('../state.js').
const walk = (rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.posix.join(rel, e.name)) : e.name.endsWith('.js') ? [path.posix.join(rel, e.name)] : []));
const files = walk();
const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

const exportsOf = {}, importsOf = {};
let problems = 0;
const fail = (msg) => { problems++; console.log('PROBLEM ' + msg); };

for (const f of files) {
  const s = src[f];
  const ex = new Set();
  for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm)) ex.add(m[1]);
  for (const m of s.matchAll(/^export\s*\{([^}]*)\}/gm)) m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean).forEach((n) => ex.add(n));
  exportsOf[f] = ex;
}
for (const f of files) {
  importsOf[f] = [];
  for (const m of src[f].matchAll(/^import\s+(?:\{([^}]*)\}|(\*\s+as\s+\w+)|(\w+))\s+from\s+'([^']+)';/gm)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[4]));
    if (!files.includes(target)) { fail(`${f} imports a missing file ${m[4]}`); continue; }
    importsOf[f].push(target);
    if (m[1]) {
      for (const part of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        const name = part.split(/\s+as\s+/)[0];
        if (!exportsOf[target].has(name)) fail(`${f} imports "${name}" but ${target} does not export it`);
      }
    }
  }
}

// מעגלים
const state = {};
const stack = [];
function visit(f) {
  if (state[f] === 2) return;
  if (state[f] === 1) { fail('import cycle: ' + [...stack.slice(stack.indexOf(f)), f].join(' -> ')); return; }
  state[f] = 1; stack.push(f);
  for (const t of importsOf[f]) visit(t);
  stack.pop(); state[f] = 2;
}
files.forEach(visit);

// שכבות: עומק התלות הארוך ביותר מהקובץ כלפי מטה (0 = אין תלות במודולים אחרים)
const depth = {};
const depthOf = (f) => (f in depth ? depth[f] : (depth[f] = importsOf[f].length ? 1 + Math.max(...importsOf[f].map(depthOf)) : 0));
files.forEach(depthOf);

const imported = new Set(Object.values(importsOf).flat());
for (const f of files) if (f !== 'main.js' && !imported.has(f)) fail(`${f} is never imported`);

const byDepth = {};
for (const f of files) (byDepth[depth[f]] = byDepth[depth[f]] || []).push(f.replace(/\.js$/, ''));
for (const d of Object.keys(byDepth).sort((a, b) => a - b)) console.log(`layer ${d}: ${byDepth[d].sort().join(', ')}`);
console.log(problems ? `${problems} problem(s)` : `OK: ${files.length} modules, no cycles, every import resolves`);
process.exit(problems ? 1 : 0);
