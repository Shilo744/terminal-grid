'use strict';
/*
 * בדיקת תחביר לכל מודולי הממשק (public/js/*.js) כמודולי ES.
 * `node --check` מתייחס לקבצי .js כאל CommonJS ולכן נכשל על import/export; לכן מעתיקים זמנית לסיומת .mjs.
 *
 *   node tests/tools/check-esm.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', '..', 'public', 'js');
const tmp = path.join(__dirname, '..', '.tmp', 'esmcheck');
fs.mkdirSync(tmp, { recursive: true });

const walk = (rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.posix.join(rel, e.name)) : e.name.endsWith('.js') ? [path.posix.join(rel, e.name)] : []));
const files = walk();
let bad = 0;
for (const f of files) {
  const out = path.join(tmp, f.replace(/\//g, '__').replace(/\.js$/, '.mjs'));
  fs.copyFileSync(path.join(dir, f), out);
  const r = spawnSync(process.execPath, ['--check', out], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.log('SYNTAX ERROR in ' + f + '\n' + r.stderr.split('\n').slice(0, 6).join('\n')); }
}
console.log(bad ? `${bad} file(s) with errors` : `all ${files.length} modules parse OK`);
process.exit(bad ? 1 : 0);
