'use strict';
// T58: the launch tracker. Everything a test opens is closed by EXACT pid when the experiment ends (clean exit, failure, or a hard kill swept up by run.js),
// and nothing that was already running is ever touched.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { checker, sleep, poll, TMP } = require('../lib/harness');
const tracker = require('../lib/tracker');

const FIX = path.join(__dirname, '..', 'fixtures', 'tracker-owner.js');
const isAlive = (pid, image = 'node.exe') => (tracker.processTable().get(pid) || '').toLowerCase() === image.toLowerCase();
const runOwner = (mode, runId) => new Promise((resolve) => {
  const child = spawn(process.execPath, [FIX, mode], { env: { ...process.env, TG_TEST_RUN_ID: runId }, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('exit', () => resolve({ ownerPid: child.pid, helper: Number((/HELPER (\d+)/.exec(out) || [])[1]) }));
});

(async () => {
  const t = checker('launch tracker (unit)');
  const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); // already running before any experiment: must never be touched
  await sleep(300);

  /* ---------- יציאה רגילה: היציאה סוגרת את מה שנרשם ---------- */
  const clean = await runOwner('clean', 'unit-clean-' + process.pid);
  t.check('a helper started through the tracker was alive while the experiment ran (its pid was reported)', clean.helper > 0);
  t.check('after a clean exit the exit handler closed the helper by its exact pid', !!(await poll(() => !isAlive(clean.helper), 8000, 100)));

  /* ---------- נהרג בלי לנקות (פסק זמן): הקבצים מאפשרים לנקות אחריו ---------- */
  const runId = 'unit-kill-' + process.pid;
  const dir = path.join(TMP, 'run-' + runId);
  const killed = await runOwner('kill', runId);
  t.check('a hard-killed experiment leaves its helper alive (this is the leak)', killed.helper > 0 && isAlive(killed.helper));
  const rows = tracker.readRegistry(dir, killed.ownerPid);
  t.check('but the helper is in the run registry under its owner', rows.length === 1 && rows[0].pid === killed.helper && rows[0].image === 'node.exe', JSON.stringify(rows));
  const swept = tracker.sweep(dir, killed.ownerPid);
  t.check('sweep closes it by exact pid and reports it (run.js prints LEFTOVER for each)', swept.length === 1 && swept[0].pid === killed.helper && !!(await poll(() => !isAlive(killed.helper), 8000, 100)), JSON.stringify(swept));
  t.check('a second sweep finds nothing', tracker.sweep(dir, killed.ownerPid).length === 0 || !isAlive(killed.helper));

  /* ---------- בטיחות: מה שכבר רץ ומה שהשם שלו לא תואם לא נסגר ---------- */
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '999999.jsonl'), JSON.stringify({ a: 'start', pid: bystander.pid, image: 'chrome.exe', label: 'wrong image on purpose', owner: 999999 }) + '\n');
  t.check('a registry line whose pid now belongs to another image (pid reuse) is NOT closed', tracker.sweep(dir, 999999).length === 0 && isAlive(bystander.pid));
  t.check('the process that was already running before the experiments was never touched', isAlive(bystander.pid));

  /* ---------- חלונות שהניסוי העלה: רק חדשים ורק מהתמונות המוצהרות ---------- */
  const probeExe = path.join(TMP, 'tgprobe.exe'); // עותק קטן של ping בשם ייחודי: אפשר לעקוב אחריו לפי שם בלי להתנגש בשום דבר אחר במחשב
  fs.copyFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'PING.EXE'), probeExe);
  const probe = () => spawn(probeExe, ['-n', '60', '127.0.0.1'], { stdio: 'ignore' });
  const oldProbe = probe();
  await sleep(500);
  tracker.watchImages(['tgprobe.exe']); // baseline נלקח כאן: oldProbe כבר רץ
  const newProbe = probe();
  await sleep(500);
  const found = tracker.newOpeners().map((o) => o.pid);
  t.check('a NEW process of a declared image is found, the one that already ran is not', found.includes(newProbe.pid) && !found.includes(oldProbe.pid), JSON.stringify({ found, oldProbe: oldProbe.pid, newProbe: newProbe.pid }));
  const closed = tracker.closeAll('exit-quiet');
  t.check('closeAll closes only the new one (by exact pid)', closed.some((c) => c.pid === newProbe.pid) && !closed.some((c) => c.pid === oldProbe.pid) && !!(await poll(() => !isAlive(newProbe.pid, 'tgprobe.exe'), 5000, 100)) && isAlive(oldProbe.pid, 'tgprobe.exe'), JSON.stringify(closed));

  for (const pid of [oldProbe.pid, bystander.pid]) tracker.killTree(pid);
  try { fs.rmSync(dir, { recursive: true, force: true }); fs.unlinkSync(probeExe); } catch { /* נעול: tests/run.js מנקה */ }
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
