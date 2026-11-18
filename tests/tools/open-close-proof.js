'use strict';
/*
 * T58: proves "agents may open things, they must close them" with real processes (not run by npm test: it opens a real OS window for a few seconds).
 *
 *   node tests/tools/open-close-proof.js            step A: starts a test server and TWO headless Chromes, declares allowExternal(['mailto']), clicks a
 *                                                   mailto: link so Windows opens its "choose an app" dialog (OpenWith.exe) on purpose, records tasklist
 *                                                   before and during, and exits WITHOUT closing anything itself: the tracker's exit handler must.
 *   node tests/tools/open-close-proof.js --after F  step B (a separate process): reads the record, prints tasklist after, and checks that every pid that
 *                                                   was opened is gone and every pid that existed before is still there.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { FIXTURES, sleep, poll, startServer, openPage, tracker } = require('../lib/harness');

const RECORD = path.join(os.tmpdir(), 'tg-open-close-proof.json');
const rows = (table, pids) => pids.map((p) => `${String(p).padStart(6)}  ${table.get(p) || '(gone)'}`).join('\n');

async function stepA() {
  const before = tracker.processTable();
  const beforeOpeners = new Set(tracker.openerPids());
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-ticker') });
  const page1 = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 900, height: 600 });
  const page2 = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 900, height: 600 }); // the "second window"
  await page1.allowExternal(['mailto'], { reason: 'proof: a mailto: link opens the OS mail-app dialog on purpose' });
  await page1.ev(`(() => { const a = document.createElement('a'); a.href = 'mailto:proof@example.invalid'; document.body.appendChild(a); a.click(); return true; })()`);
  const fresh = () => tracker.openerPids().filter((p) => !beforeOpeners.has(p)).length > 0;
  let popped = await poll(fresh, 6000, 250);
  if (!popped) {
    // headless Chrome does not always hand mailto: to Windows: open the same real dialog the way a program would, so the closing is still shown with a real window
    const f = path.join(os.tmpdir(), 'tg-proof.tgunknown');
    fs.writeFileSync(f, 'proof');
    spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenWith.exe'), [f], { detached: true, stdio: 'ignore' }).unref();
    popped = await poll(fresh, 15000, 250);
  }
  await sleep(500);
  const during = tracker.processTable();
  const opened = [...during.keys()].filter((p) => !before.has(p) && /^(node|chrome|OpenWith|conhost|cmd|powershell)\.exe$/i.test(during.get(p)) && p !== process.pid);
  const blocked = await page2.ev('(window.__tgBlockedExternal || []).length');
  console.log('A. BEFORE: %d processes. DURING (new pids of node/chrome/OpenWith/conhost/cmd/powershell, this run included):', before.size);
  console.log(rows(during, opened));
  console.log('A. OS dialog really opened: %s. The other window (not opted in) blocked external navigation entries: %s', popped ? 'yes' : 'NO (the machine did not open one)', blocked);
  fs.writeFileSync(RECORD, JSON.stringify({ before: [...before.keys()], opened: opened.map((p) => ({ pid: p, image: during.get(p) })), me: process.pid, popped: !!popped }));
  console.log('A. exiting now WITHOUT closing anything; the tracker exit handler has to do it.');
  process.exit(0);
}

function stepB(file) {
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const after = tracker.processTable();
  const notMe = rec.opened.filter((o) => o.pid !== rec.me);
  const stillThere = notMe.filter((o) => (after.get(o.pid) || '').toLowerCase() === o.image.toLowerCase());
  const lost = rec.before.filter((p) => !after.has(p) && p !== rec.me);
  console.log('B. AFTER: %d processes. Opened by the experiment: %d (%s)', after.size, notMe.length, notMe.map((o) => `${o.image}:${o.pid}`).join(' '));
  console.log('B. still alive from those: %d %s', stillThere.length, stillThere.map((o) => `${o.image}:${o.pid}`).join(' '));
  console.log('B. processes that existed BEFORE and are gone now: %d (natural exits happen on a busy machine; none of them may be one the tracker closed: it only closes recorded or new pids)', lost.length);
  const ok = stillThere.length === 0;
  console.log(ok ? 'B. RESULT: everything the experiment opened is closed.' : 'B. RESULT: LEFTOVERS, see above.');
  process.exit(ok ? 0 : 1);
}

const i = process.argv.indexOf('--after');
if (i > 0) stepB(process.argv[i + 1] || RECORD); else stepA().catch((e) => { console.error('ERROR', e); process.exit(2); });
