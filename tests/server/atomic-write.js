'use strict';
// writeFileAtomic: normal write, and the Windows case where rename fails with EPERM because another process has the target open.
const path = require('path');
const fs = require('fs');
const { TMP, checker } = require('../lib/harness');
const { writeFileAtomic } = require('../../server/atomic-write');

const t = checker('atomic write');
const file = path.join(TMP, 'atomic-write-test.json');
for (const f of [file, file + '.tmp']) { try { fs.unlinkSync(f); } catch { /* none */ } }

writeFileAtomic(file, 'one');
t.check('writes the file and leaves no .tmp', fs.readFileSync(file, 'utf8') === 'one' && !fs.existsSync(file + '.tmp'));
writeFileAtomic(file, 'two');
t.check('overwrites an existing file', fs.readFileSync(file, 'utf8') === 'two');

const realRename = fs.renameSync;
let failures = 0;
const eperm = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
try {
  fs.renameSync = (...a) => { if (failures < 3) { failures++; throw eperm(); } return realRename(...a); };
  writeFileAtomic(file, 'three');
  t.check('a rename that fails with EPERM is retried and succeeds', fs.readFileSync(file, 'utf8') === 'three' && failures === 3 && !fs.existsSync(file + '.tmp'));

  fs.renameSync = () => { throw eperm(); };
  writeFileAtomic(file, 'four');
  t.check('if rename keeps failing the data is written directly instead of being lost', fs.readFileSync(file, 'utf8') === 'four' && !fs.existsSync(file + '.tmp'));

  fs.renameSync = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  writeFileAtomic(file, 'five');
  t.check('an unrelated error does not loop: direct write as well', fs.readFileSync(file, 'utf8') === 'five');
} finally { fs.renameSync = realRename; }

process.exit(t.finish() ? 0 : 1);
