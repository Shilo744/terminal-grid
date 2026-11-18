'use strict';
// server/agent-status.js: מכונת המצבים של סוכן Claude לפי אירועי ה-hooks, וקובץ ההגדרות עם ה-hooks (בלי Claude אמיתי).
const fs = require('fs');
const crypto = require('crypto');
const { checker } = require('../lib/harness');
const { nextState, writeHookSettings, hookSettingsPath, checkNodeOnPath, createAgentStatus } = require('../../server/agent-status');

const t = checker('agent status state machine (unit)');
const ev = (event, extra = {}) => ({ event, ...extra });

// ---------- המעברים ----------
t.check('SessionStart: starting -> idle', nextState('starting', ev('start')) === 'idle');
t.check('UserPromptSubmit: idle -> working', nextState('idle', ev('submit')) === 'working');
t.check('Stop: working -> done', nextState('working', ev('stop')) === 'done');
t.check('a new prompt after done: done -> working', nextState('done', ev('submit')) === 'working');
t.check('Notification permission_prompt: working -> attention', nextState('working', ev('notify', { notificationType: 'permission_prompt' })) === 'attention');
t.check('Notification elicitation_dialog: working -> attention', nextState('working', ev('notify', { notificationType: 'elicitation_dialog' })) === 'attention');
t.check('a message that mentions permission counts, whatever the type', nextState('working', ev('notify', { notificationType: 'other', message: 'Claude needs your permission to use Bash' })) === 'attention');
t.check('attention is cleared by the next UserPromptSubmit', nextState('attention', ev('submit')) === 'working');
t.check('attention is cleared by Stop', nextState('attention', ev('stop')) === 'done');
t.check('an idle_prompt notification does not change the state', nextState('done', ev('notify', { notificationType: 'idle_prompt', message: 'Claude is waiting for your input' })) === 'done');
t.check('an auth_success notification does not change the state', nextState('working', ev('notify', { notificationType: 'auth_success' })) === 'working');
t.check('a notification with no fields does not change the state', nextState('idle', ev('notify')) === 'idle');
t.check('SessionStart after /clear or /resume returns to idle', nextState('done', ev('start', { source: 'clear' })) === 'idle' && nextState('done', ev('start', { source: 'resume' })) === 'idle');
t.check('SessionStart from a mid-turn compaction keeps working', nextState('working', ev('start', { source: 'compact' })) === 'working');
t.check('exit from any state', ['starting', 'idle', 'working', 'done', 'attention'].every((s) => nextState(s, ev('exit')) === 'exited'));
t.check('exited is final', ['start', 'submit', 'stop', 'notify'].every((e) => nextState('exited', ev(e, { notificationType: 'permission_prompt' })) === 'exited'));
t.check('an unknown event changes nothing', nextState('working', ev('bogus')) === 'working' && nextState('working', null) === 'working');

// ---------- קובץ ההגדרות ----------
const id = crypto.randomUUID();
const file = writeHookSettings(id);
t.check('writeHookSettings returns the file path under tg-agents', file === hookSettingsPath(id) && /tg-agents/.test(file) && fs.existsSync(file));
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
const names = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification'];
t.check('the four hooks are defined', JSON.stringify(Object.keys(cfg.hooks)) === JSON.stringify(names));
const cmds = names.map((n) => cfg.hooks[n][0].hooks[0].command);
t.check('every hook is the shell-proof form: bare node, then the quoted hook-cli path with forward slashes, then the event', cmds.every((c) => /^node "[^"\\]+\/server\/duo\/hook-cli\.js" (start|submit|stop|notify)$/.test(c)), cmds[0]);
t.check('no hook starts with a quoted program path (a parse error in PowerShell)', cmds.every((c) => !c.startsWith('"')));
t.check('events: start, submit, stop, notify', cmds.map((c) => c.split(' ').pop()).join() === 'start,submit,stop,notify');
fs.unlinkSync(file);

// node ב-PATH: מצא (כאן הבדיקה רצה עם node) / לא מצא -> אזהרה ביומן
const logged = [];
t.check('checkNodeOnPath finds node on the current PATH and logs nothing', checkNodeOnPath((m) => logged.push(m)) === true && logged.length === 0);
t.check('with an empty PATH it reports false and logs a clear warning', checkNodeOnPath((m) => logged.push(m), { ...process.env, PATH: '', Path: '' }) === false && logged.length === 1 && /node is not on the PATH/.test(logged[0]));

// ---------- הניהול על ה-sessions ----------
const sent = [];
const sessions = new Map();
const mk = (id2, extra = {}) => { const s = { id: id2, kind: 'claude', ...extra }; sessions.set(id2, s); return s; };
const agent = createAgentStatus({ sessions, broadcast: (m) => sent.push(m), log() {} });
const a = mk('1'); agent.track(a);
t.check('track: starts as starting, source heuristic (no event yet)', a.agentState === 'starting' && a.agentSource === 'heuristic');
t.check('an event for an unknown pane is rejected', agent.onEvent({ paneId: '99', event: 'start' }) === false);
t.check('an event for a duo-tagged or untracked terminal is rejected', agent.onEvent({ paneId: mk('2', { tag: { duoId: 'x' } }).id, event: 'start' }) === false && agent.onEvent({ paneId: mk('3').id, event: 'start' }) === false);
t.check('an unknown event name is rejected', agent.onEvent({ paneId: '1', event: 'explode' }) === false);
t.check('first event: source becomes hooks and the change is broadcast', agent.onEvent({ paneId: '1', event: 'start', source: 'startup', transcriptPath: 'C:/x/y.jsonl' }) && a.agentSource === 'hooks' && a.agentState === 'idle' && sent.length === 1 && sent[0].t === 'agent' && sent[0].state === 'idle' && sent[0].id === '1' && typeof sent[0].since === 'number');
t.check('transcript path and source are kept for later features', a.agentLast.transcriptPath === 'C:/x/y.jsonl' && a.agentLast.source === 'startup');
agent.onEvent({ paneId: '1', event: 'submit' });
agent.onEvent({ paneId: '1', event: 'submit' });
t.check('only real changes are broadcast (a repeated submit is not)', sent.length === 2 && sent[1].state === 'working');
agent.onEvent({ paneId: '1', event: 'notify', notificationType: 'permission_prompt' });
agent.onEvent({ paneId: '1', event: 'stop' });
t.check('attention then stop: broadcasts attention, then done', sent.map((m) => m.state).join() === 'idle,working,attention,done');
agent.onExit(a);
t.check('process exit: exited is broadcast and final', a.agentState === 'exited' && sent[sent.length - 1].state === 'exited');
agent.onEvent({ paneId: '1', event: 'submit' });
t.check('events after exit change nothing', a.agentState === 'exited');
const before = sent.length;
const plain = mk('4'); // טרמינל בלי hooks (פקודה מותאמת / כתיבה שנכשלה)
agent.onExit(plain);
t.check('a terminal without hooks never produces agent messages', sent.length === before && plain.agentState === undefined);

process.exit(t.finish() ? 0 : 1);
