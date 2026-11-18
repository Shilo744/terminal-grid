'use strict';
// שומר הטיוטה של הזוג (T62), Duo אמיתי עם api מדומה: מתי מחכים, מתי מחליפים טיוטה, מתי כופים, בדיקה חוזרת ברגע האחרון, איחוד הוראות, וכשל בהחלפה.
process.env.TG_TEST_BOOT_SETTLE_MS = '1'; process.env.TG_TEST_PENDING_SHOW_MS = '-1'; // T65: בלי המתנת ההפעלה, וההמתנה מוצגת מיד (לפני טעינת duo.js)
const path = require('path');
const fs = require('fs');
const { TMP, checker } = require('../lib/harness');
const { Duo } = require('../../server/duo/duo');

const t = checker('duo draft guard (unit)');
const project = path.join(TMP, 'duo-guard-' + process.pid);
fs.rmSync(project, { recursive: true, force: true });
fs.mkdirSync(path.join(project, '.duo'), { recursive: true });

let n = 0;
const writes = [];
const locks = [];
let draftState = null;
let screen = null;
const api = {
  startAgent: () => ({ sessionId: 's' + ++n, claudeId: null }), closeSession() {}, writeInput: (id, d) => writes.push(d), claudeIdOf: () => null, emit() {}, persist() {}, log() {}, trustAccepted: () => false,
  draftState: () => draftState, screenState: () => screen, lockHuman: (id, on) => locks.push(on),
};
const d = new Duo({ id: 'g1', project, goal: '', permissionMode: 'auto', paused: false }, api);
d.start(false);
d.onHook('architect', 'start'); d.onHook('worker', 'start');
const arch = d.agents.architect;
const now = Date.now();

/* ---------- guard ---------- */
draftState = null;
t.check('no draft tracking at all (unit tests, plain terminals): go', d.guard('architect') === 'go');
draftState = { draft: false, typing: false, lastKeyAt: now };
t.check('no draft and not typing: go', d.guard('architect') === 'go');
draftState = { draft: false, typing: true, lastKeyAt: now };
t.check('typing (even without a draft yet): wait for the pause', d.guard('architect') === 'wait');
draftState = { draft: true, typing: true, lastKeyAt: now };
t.check('typing with a draft: wait', d.guard('architect') === 'wait');
t.check('typing for more than 30 seconds in a row: stop waiting and go by the draft (swap)', d.guard('architect', now - 31000) === 'swap');
draftState = { draft: true, typing: false, lastKeyAt: now - 5000 };
t.check('a draft and a pause: swap the draft out', d.guard('architect') === 'swap');
arch.swapFails = 2;
t.check('after two failed swaps on this agent: only wait', d.guard('architect') === 'wait');
arch.swapFails = 0;
draftState = { draft: true, typing: false, lastKeyAt: now - 11 * 60 * 1000 };
t.check('a draft untouched for 10 minutes is abandoned: force', d.guard('architect') === 'force');
const savedLock = api.lockHuman; delete api.lockHuman;
draftState = { draft: true, typing: false, lastKeyAt: now - 5000 };
t.check('without a human lock in the host the swap is never used: wait', d.guard('architect') === 'wait');
api.lockHuman = savedLock;

/* ---------- wake: המתנה, איחוד, בדיקה חוזרת ---------- */
draftState = { draft: true, typing: true, lastKeyAt: now };
writes.length = 0;
d.wake('architect', 'first text', { needed: () => true });
d.wake('architect', 'second text', { needed: () => true });
t.check('typing: the wake waits (nothing written, the agent stays idle, one pending wake with the NEWEST text)', writes.length === 0 && arch.state === 'idle' && arch.pending && arch.pending.text === 'second text' && d.snapshot().agents.architect.pending === true, JSON.stringify(arch.pending && arch.pending.text));
let needed = false;
arch.pending.needed = () => needed;
draftState = { draft: false, typing: false, lastKeyAt: now - 9000 };
d.checkPending();
t.check('(0) a wake that is no longer needed is dropped silently at the last moment', arch.pending === null && writes.length === 0 && d.snapshot().tech.some((e) => /כבר לא נחוצה/.test(e.text)));
draftState = { draft: true, typing: true, lastKeyAt: now };
d.wake('architect', 'third text', { needed: () => true });
draftState = { draft: false, typing: false, lastKeyAt: now - 9000 };
let committed = 0;
arch.pending.commit = () => { committed++; };
d.checkPending();
t.check('the pause comes: the pending wake is delivered once, its commit runs only now, and the agent becomes working', arch.pending === null && committed === 1 && arch.state === 'working' && writes[0] === '\x1b[200~third text\x1b[201~', JSON.stringify(writes));
arch.state = 'idle'; clearTimeout(arch.submitTimer);

// הזוג מושהה / הסוכן באמצע תור
draftState = { draft: true, typing: true, lastKeyAt: now };
d.wake('architect', 'text for a paused pair', {});
d.paused = true;
d.checkPending();
t.check('a paused pair drops the pending wake (evaluate decides again after resume)', arch.pending === null);
d.paused = false;
d.wake('architect', 'text while busy', {});
arch.state = 'working';
draftState = { draft: false, typing: false, lastKeyAt: 0 };
d.checkPending();
t.check('an agent in the middle of a turn keeps the wake pending until it is idle', arch.pending !== null && arch.pending.text === 'text while busy');
arch.state = 'idle';
d.checkPending();
t.check('...and delivers it when it is idle', arch.pending === null && arch.state === 'working');
arch.state = 'idle'; clearTimeout(arch.submitTimer);

/* ---------- החלפה שנכשלה ---------- */
(async () => {
  await new Promise((r) => setTimeout(r, 600)); // ה-Enter המושהה (400ms) של ההזרקות הקודמות נכתב לפני שמתחילים לספור
  writes.length = 0; locks.length = 0;
  screen = { found: true, draft: true, stashed: false }; // המסך לא מאשר stash
  draftState = { draft: true, typing: false, lastKeyAt: now - 5000 };
  d.wake('architect', 'swap text', {});
  await new Promise((r) => setTimeout(r, 1200));
  t.check('a swap the screen does not confirm writes ONLY the stash key (never the wake) and releases the lock', JSON.stringify(writes) === JSON.stringify(['\x13']) && JSON.stringify(locks) === JSON.stringify([true, false]), JSON.stringify({ writes, locks }));
  t.check('...and the wake goes back to waiting, the agent back to idle, the failure counted', arch.state === 'idle' && arch.pending && arch.pending.text === 'swap text' && arch.swapFails === 1, JSON.stringify({ s: arch.state, p: !!arch.pending, f: arch.swapFails }));
  d.close();
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  process.exit(t.finish() ? 0 : 1);
})();
