'use strict';
// הודעות ההתעוררות הן סמנים זעירים, והמשמעות בהוראות התפקיד (T64, פרוטוקול 2 של T78): הטקסט הנראה, ההוראות, והתאימות לסוכן שהתחיל עם הוראות ישנות.
process.env.TG_TEST_BOOT_SETTLE_MS = '1'; process.env.TG_TEST_PENDING_SHOW_MS = '-1'; // T65: בלי המתנת ההפעלה, וההמתנה מוצגת מיד (לפני טעינת duo.js)
const path = require('path');
const fs = require('fs');
const { TMP, checker } = require('../lib/harness');
const { Duo } = require('../../server/duo/duo');
const { WAKE, WAKE_LONG, PROMPTS, PROMPT_VERSION, goalMessage, stopReason } = require('../../server/duo/protocol');

const t = checker('invisible wake-ups: short markers (unit)');

/* ---------- הסמנים ---------- */
const markers = [WAKE.architect('user'), WAKE.architect('review'), WAKE.architect('restarted'), WAKE.architect('manual')];
t.check('the four visible architect texts are exactly the short markers (the worker gets its goal as a sentence, not a marker)', JSON.stringify(markers) === JSON.stringify(['[duo] user', '[duo] review', '[duo] restarted', '[duo] manual']) && !WAKE.worker, JSON.stringify(markers));
t.check('each marker is tiny (at most 16 characters) and starts with [duo]', markers.every((m) => m.length <= 16 && m.startsWith('[duo] ')));
t.check('an unknown kind falls back to the common marker of its role', WAKE.architect('???') === '[duo] user');
t.check('PROMPT_VERSION is 5 (the worker works from the whole queue); 4 had the one-task inbox and the warm-up marker, 3 the inbox protocol, 2 the markers with a chat, 1 the long sentences', PROMPT_VERSION === 5);

/* ---------- ההוראות נושאות את המשמעות ---------- */
t.check('the architect prompt explains user, restarted and manual, the inbox, and the two-short-lines rule', ['"[duo]"', 'restarted', 'manual', 'at most two short lines', 'INBOX-architect.md', 'TASKS.md'].every((s) => PROMPTS.architect.includes(s)));
t.check('the worker prompt is its tools plus its goal: complete every open task in TASKS.md, mark each one with a Result line, re-read the file for new tasks', PROMPTS.worker.includes('tg-shot') && PROMPTS.worker.includes('tg-image') && !PROMPTS.worker.includes('[duo]') && /Your goal: complete every open task in \.duo\/TASKS\.md/.test(PROMPTS.worker) && /Result:/.test(PROMPTS.worker) && /re-read the file/.test(PROMPTS.worker), String(PROMPTS.worker.length));
const open = [{ id: 'T1', title: 'x' }, { id: 'T2', title: 'y' }];
t.check('the goal message lists the open tasks, says how to report, and mentions the brief and the rules only when they exist', goalMessage(open).startsWith('Your goal: complete all the open tasks in .duo/TASKS.md (T1, T2)') && /Result: blocked: why/.test(goalMessage(open)) && !/BRIEF|RULES/.test(goalMessage(open)) && /\.duo\/BRIEF\.md/.test(goalMessage(open, { hasBrief: true })) && /\.duo\/RULES\.md/.test(goalMessage(open, { hasRules: true })));
t.check('after the first time it says "Continue your goal"', goalMessage(open, { resumed: true }).startsWith('Continue your goal: complete all the open tasks'));
t.check('the Stop hook reason lists the tasks that remain, tells the worker to re-read the file, and how to get unstuck', /remain[^\n]*T2/.test(stopReason([{ id: 'T2' }])) && /Re-read the file/.test(stopReason([{ id: 'T2' }])) && /blocked: why/.test(stopReason([{ id: 'T2' }])) && stopReason([{ id: '', title: 'no number here' }]).includes('no number here'));
t.check('there is no chat anywhere in the agent prompts (CHAT.md is not mentioned as something to use)', !/CHAT\.md/.test(PROMPTS.architect) && !/CHAT\.md/.test(PROMPTS.worker) && /BRIEF\.md/.test(PROMPTS.architect) && /TASKS\.md/.test(PROMPTS.architect));
t.check('each role prompt mentions only its own markers (no worker marker in the architect prompt)', !PROMPTS.architect.includes('[duo] task') && !PROMPTS.worker.includes('[duo] user') && !PROMPTS.worker.includes('[duo] review'));
t.check('the old long wording is kept for old sessions, points at the inbox (not at a chat) and says what to do', /Read \.duo\/INBOX-architect\.md and \.duo\/TASKS\.md/.test(WAKE_LONG.architect('user')) && /wrote to you/.test(WAKE_LONG.architect('user')) && /server restarted/.test(WAKE_LONG.architect('restarted')) && !WAKE_LONG.worker && !/CHAT/.test(WAKE_LONG.architect('user')));

/* ---------- Duo.wakeText: לפי גרסת ההוראות של הסשן ---------- */
const project = path.join(TMP, 'duo-markers-' + process.pid);
fs.rmSync(project, { recursive: true, force: true });
fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
let n = 0;
const versions = {};
const api = { startAgent: () => { const id = 's' + ++n; return { sessionId: id, claudeId: null }; }, closeSession() {}, writeInput() {}, claudeIdOf: () => null, emit() {}, persist() {}, log() {}, trustAccepted: () => false, promptVersionOf: (id) => versions[id] || 1 };
const d = new Duo({ id: 'm1', project, goal: '', permissionMode: 'auto', paused: true }, api);
d.start(false);
const archId = d.agents.architect.sessionId, workId = d.agents.worker.sessionId;
versions[archId] = PROMPT_VERSION; versions[workId] = 1;
t.check('a session started with the new prompt gets the markers', d.wakeText('architect', 'user') === '[duo] user' && d.wakeText('architect', 'manual') === '[duo] manual' && d.wakeText('architect', 'review') === '[duo] review');
versions[archId] = 2;
t.check('a version 2 session (markers, but with a chat) is also treated as old: the long text that points at the inbox', d.wakeText('architect', 'user').length > 60);
delete api.promptVersionOf;
t.check('a host without version tracking (plain unit setups) uses the current markers', d.wakeText('architect', 'restarted') === '[duo] restarted');

/* ---------- ההזרקה בפועל ---------- */
const writes = [];
api.writeInput = (id, data) => writes.push(data);
d.paused = false;
d.agents.architect.state = 'idle';
d.wake('architect', d.wakeText('architect', 'user'), {});
t.check('what is typed into the agent terminal is the paste of the marker, nothing longer', writes[0] === '\x1b[200~[duo] user\x1b[201~', JSON.stringify(writes));
d.close();
try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
process.exit(t.finish() ? 0 : 1);
