// A fake interactive Claude for the duo tests (protocol v3). It reports hooks exactly like the real one (through server/duo/hook-cli.js)
// and "works" by editing the .duo files when a pasted message arrives.
//   worker:    gets the goal ("Your goal: complete all the open tasks ..."), then does ONE task per turn (the first open one in .duo/TASKS.md: [~] then [x] + Result),
//              logs "GOAL <ids in the message>" and "TASK <id> ctx=<n>" (n = tasks since the last /clear) to .duo/worker.log, and ends the turn with the Stop hook.
//              Like the real Claude Code it carries on when the Stop hook answers {"decision":"block","reason":...} (logs "BLOCKED <reason>") and stops otherwise.
//              "/clear" resets ctx and reports SessionStart(source=clear) with a new session id (FAKE_NO_CLEAR=1: ignores /clear, no hook).
//              FAKE_STUCK=1: marks the task [~] only (never finishes). FAKE_BLOCK=T2: marks that task [!] with "Result: blocked: ...".
//              FAKE_SLOW_RESULT=1: marks [x] first and writes the Result line 1.2 s later (the server must not archive in between).
//              FAKE_NO_BLOCK=1: ignores the Stop hook's answer (stops anyway), like a hook that did not reach Claude.
//   architect: reads .duo/INBOX-architect.md, logs "ARCH <marker> users=<n> finished=<n> blocked=<n>" to .duo/arch.log. A user message plans two new tasks
//              (numbers after the highest used, archived ones included); a review plans nothing and says "goal achieved" when nothing is open.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const role = process.env.TG_DUO_ROLE || 'worker';
const duoDir = path.join(process.cwd(), '.duo');
const HOOK = path.resolve(__dirname, '..', '..', 'server', 'duo', 'hook-cli.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = (n) => path.join(duoDir, n);
const read = (n) => (fs.existsSync(file(n)) ? fs.readFileSync(file(n), 'utf8') : '');
const log = (name, line) => { try { fs.appendFileSync(file(name), line + '\n'); } catch { /* */ } };

function hook(event, extra = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK, event], { env: process.env, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', () => resolve(out));
    p.stdin.end(JSON.stringify({ session_id: 'fake-' + role, ...extra }));
  });
}

let busy = false;
let ctx = 0, clears = 0;
// בדיקות (T65): כשיש קובץ .duo/DEAF הסוכן המדומה מתעלם מהוראות (לא שולח hook של submit), כמו סוכן שההוראה אליו אבדה
const deaf = () => fs.existsSync(path.join(duoDir, 'DEAF'));

async function doClear() {
  log('clear.log', role + ' CLEAR');
  if (process.env.FAKE_NO_CLEAR) return;
  ctx = 0; clears++;
  await sleep(300);
  await hook('start', { source: 'clear', session_id: `fake-${role}-clear${clears}` });
}

// the conversation size the server reads (TG_TEST_CTX_FILE=ctx-fake.txt): 40K base + FAKE_CTX_PER_TASK for every task since the last /clear or /compact
const writeCtx = () => { try { fs.writeFileSync(path.join(duoDir, 'ctx-fake.txt'), String(40000 + ctx * (Number(process.env.FAKE_CTX_PER_TASK) || 0))); } catch { /* none */ } };
async function doCompact() {
  log('compact.log', role + ' COMPACT ctx=' + ctx);
  if (process.env.FAKE_NO_COMPACT) return;
  ctx = 0; writeCtx();
  await sleep(300);
  await hook('start', { source: 'compact' });
}

const nums = () => {
  const all = (read('TASKS.md').replace(/<!--[\s\S]*?-->/g, '').match(/^\s*- \[.\] T\d+/gm) || []).concat((() => { try { return JSON.parse(read('STATUS.json')).doneIds || []; } catch { return []; } })());
  return all.map((x) => Number(String(x).replace(/\D/g, ''))).filter(Number.isFinite);
};

async function work(prompt) {
  busy = true;
  await hook('submit', { prompt });
  await sleep(700);
  if (role === 'architect') {
    const inbox = read('INBOX-architect.md');
    const count = (re) => (inbox.match(re) || []).length;
    const marker = (/\[duo\] (\w+)/.exec(prompt) || [])[1] || '?';
    log('arch.log', `ARCH ${marker} users=${/## Message from the user/.test(inbox) ? 1 : 0} finished=${count(/^- T\d+ — .*\n  Result:/gm)} blocked=${count(/^- T\d+ — .*\n  Reason:/gm)}`);
    const open = /^- \[[ ~]\]/m.test(read('TASKS.md'));
    let last;
    if (/## Message from the user/.test(inbox) && !/NOTASKS/.test(inbox)) {
      const n = Math.max(0, ...nums()) + 1;
      fs.appendFileSync(file('TASKS.md'), `\n- [ ] T${n} — first thing\n  do it\n- [ ] T${n + 1} — second thing\n  do it too\n`);
      last = `Plan written: T${n}, T${n + 1}.`;
    } else last = open ? 'Looked again, tasks are still open.' : 'Reviewed the results: goal achieved.';
    await sleep(300);
    await hook('stop', { last_assistant_message: last });
    busy = false;
    return;
  }
  // like the real worker: it works only on the tasks the goal message lists (the file may hold old leftovers), and the Stop hook's reason renews the list
  let listed = (/\(([^)]*)\)/.exec(prompt) || [])[1] || '';
  log('worker.log', 'GOAL ' + listed);
  for (let turn = 0; turn < 100; turn++) {
    const tasks = read('TASKS.md').replace(/<!--[\s\S]*?-->/g, '');
    const ids = listed.split(/[ ,]+/).filter(Boolean);
    const re = /^- \[( |~)\] (T\d+)\b[^\n]*\n(?:[ \t]+[^\n]*\n)*/gm; // an open task line and its indented details
    let m = null, mm;
    while ((mm = re.exec(tasks))) if (ids.includes(mm[2])) { m = mm; break; }
    if (m) {
      const id = m[2];
      ctx++; writeCtx();
      log('worker.log', `TASK ${id} ctx=${ctx}`);
      const mark = process.env.FAKE_STUCK ? '~' : process.env.FAKE_BLOCK === id ? '!' : 'x';
      const line = m[0].replace(/\[( |~)\]/, '[' + mark + ']');
      const result = mark === 'x' ? `  Result: done by the fake worker (learned: ctx=${ctx})\n` : mark === '!' ? '  Result: blocked: the fake worker cannot do this\n' : '';
      const now = read('TASKS.md');
      if (process.env.FAKE_SLOW_RESULT && mark === 'x') {
        fs.writeFileSync(file('TASKS.md'), now.replace(m[0], line));
        await sleep(1200);
        fs.writeFileSync(file('TASKS.md'), read('TASKS.md').replace(line, line + result));
      } else fs.writeFileSync(file('TASKS.md'), now.replace(m[0], line + result));
    }
    await sleep(300);
    const answer = await hook('stop', { last_assistant_message: 'ok' });
    let block = null;
    try { block = JSON.parse(answer || '{}'); } catch { /* none */ }
    if (process.env.FAKE_NO_BLOCK || !block || block.decision !== 'block') break;
    log('worker.log', 'BLOCKED ' + String(block.reason).slice(0, 60));
    listed = (/TASKS\.md: ([^.]*)\./.exec(String(block.reason)) || [])[1] || listed;
  }
  busy = false;
}


/* ---------- מצב FAKE_UI=1: מצייר תיבת קלט כמו Claude Code (T62) ----------
 * שני קווי ─, שורה ראשונה ❯ עם הטיוטה (או הצעה דהויה), שורת תחתית. Ctrl+S מזיז את הטיוטה הצידה ("› stashed"), ובשליחה הבאה היא חוזרת (כמו Claude v2.1.301).
 * FAKE_NO_STASH=1: Ctrl+S לא עושה כלום (בדיקת "החלפת טיוטה לא אושרה"). FAKE_LOG=<קובץ>: כל שליחה ושינוי טיוטה נרשמים (SUBMIT/DRAFT/STASH/PASTE) לבדיקות. */
const UI = !!process.env.FAKE_UI;
let draft = '', stash = null;
const msgs = [];          // user messages of this conversation (what /rewind lists)
let menu = null;          // { stage: 'pick'|'confirm', idx, opt }  FAKE_NO_REWIND=1: /rewind is not understood (the server must fall back to /clear)
const logf = (line) => { if (process.env.FAKE_LOG) try { fs.appendFileSync(process.env.FAKE_LOG + '.' + role, line.replace(/\n/g, '\\n') + '\n'); } catch { /* */ } };
function drawMenu() {
  const lines = [' Rewind', '', ' Restore the code and/or conversation to the point before…', ''];
  if (menu.stage === 'pick') {
    msgs.forEach((m, i) => { lines.push((menu.idx === i ? '❯ ' : '  ') + m.split('\n')[0].slice(0, 90)); lines.push('    No code changes'); });
    lines.push((menu.idx === msgs.length ? '❯ ' : '  ') + '(current)');
    lines.push('', ' Enter to continue · Esc to cancel');
  } else {
    lines.length = 0;
    lines.push(' Rewind', '', ' Confirm you want to restore to the point before you sent this message:', '  │ ' + msgs[menu.idx].split('\n')[0].slice(0, 90), '  │ (5s ago)', '', ' The conversation will be forked.', ' The code will be unchanged.', '');
    ['Restore code and conversation', 'Restore conversation', 'Restore code', 'Summarize from here'].forEach((o, i) => lines.push((menu.opt === i ? '  ❯ ' : '    ') + (i + 1) + '. ' + o));
  }
  process.stdout.write('\x1b[2J\x1b[H' + lines.join('\r\n') + '\r\n');
}
function draw() {
  if (menu) { drawMenu(); return; }
  const RULE = '\u2500'.repeat(100);
  const input = draft ? draft.split('\n').join('\r\n  ') : '\x1b[2mTry "something"\x1b[22m';
  process.stdout.write('\x1b[2J\x1b[H' + [' FAKE-DUO-AGENT ' + role, ' C:\\project', RULE, '\u276f ' + input, RULE, '  \u23f5\u23f5 auto mode on (shift+tab to cycle)' + (stash !== null ? ' \u00b7 \u203a stashed' : '')].join('\r\n'));
}
let inPaste = false;
function menuKey(s, i) {
  // returns the number of characters used by the key
  if (s.startsWith('\x1b[A', i)) { if (menu.stage === 'pick') menu.idx = Math.max(0, menu.idx - 1); else menu.opt = Math.max(0, menu.opt - 1); return 3; }
  if (s.startsWith('\x1b[B', i)) { if (menu.stage === 'pick') menu.idx = Math.min(msgs.length, menu.idx + 1); else menu.opt = Math.min(3, menu.opt + 1); return 3; }
  if (s[i] === '\r') {
    if (menu.stage === 'pick') { if (menu.idx < msgs.length) { menu.stage = 'confirm'; menu.opt = 0; } else menu = null; return 1; }
    if (menu.opt === 1) { const removed = msgs.splice(menu.idx); draft = removed[0] || ''; ctx = 0; log('rewind.log', `REWIND removed=${removed.length} kept=${msgs.length}`); }
    menu = null; return 1;
  }
  if (s[i] === '\x1b') { menu = null; return 1; }
  return 1;
}
function ui(s) {
  let i = 0;
  while (i < s.length) {
    if (menu) { i += menuKey(s, i); continue; }
    if (s.startsWith('\x1b[200~', i)) { inPaste = true; i += 6; continue; }
    if (s.startsWith('\x1b[201~', i)) { inPaste = false; logf('PASTE-END ' + draft); i += 6; continue; }
    const ch = s[i];
    if (inPaste) { draft += ch; i++; continue; }
    if (ch === '\x1b') {
      if (s[i + 1] === '\r') { draft += '\n'; i += 2; continue; }
      if (s[i + 1] === '[') { let j = i + 2; while (j < s.length && !(s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e)) j++; i = j + 1; continue; }
      i += 2; continue;
    }
    if (ch === '\x13') {
      if (!process.env.FAKE_NO_STASH && draft) { stash = draft; draft = ''; logf('STASH ' + stash); }
      i++; continue;
    }
    if (ch === '\r') {
      const text = draft;
      draft = '';
      if (stash !== null) { draft = stash; stash = null; }
      logf('SUBMIT ' + text);
      if (text.includes('TG-FAKE-EXIT')) process.exit(3);
      if (text.trim() === '/clear') { msgs.length = 0; doClear(); i++; continue; }
      if (text.trim() === '/compact') { doCompact(); i++; continue; }
      if (text.trim() === '/rewind') { if (process.env.FAKE_NO_REWIND) log('rewind.log', 'UNKNOWN-COMMAND'); else { log('rewind.log', 'OPEN msgs=' + msgs.length); menu = { stage: 'pick', idx: msgs.length, opt: 0 }; } i++; continue; }
      if (text && !text.startsWith('/')) msgs.push(text);
      if (text && !busy && !deaf()) work(text);
      i++; continue;
    }
    if (ch === '\x7f' || ch === '\b') { draft = draft.slice(0, -1); i++; continue; }
    if (ch === '\x03' || ch === '\x15') { draft = ''; i++; continue; }
    if (ch >= ' ') draft += ch;
    i++;
  }
  logf('DRAFT ' + draft);
  draw();
}

process.stdin.setEncoding('utf8');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let buf = '';
process.stdin.on('data', (d) => {
  if (UI) { ui(String(d)); return; }
  buf += d;
  let m;
  while ((m = /\x1b\[200~([\s\S]*?)\x1b\[201~\r/.exec(buf))) {
    buf = buf.slice(m.index + m[0].length);
    if (m[1].includes('TG-FAKE-EXIT')) process.exit(3); // בדיקות: מדמה סוכן שנפל (התהליך יוצא והטרמינל נשאר ברשימה)
    if (m[1].trim() === '/clear') { doClear(); continue; }
    if (m[1].trim() === '/compact') { doCompact(); continue; }
    if (!busy && !deaf()) work(m[1]);
  }
});
console.log(`FAKE-DUO-AGENT ${role} ready`);
const convo = /--(resume|session-id) (\S+)/.exec(process.argv.slice(2).join(' ')); // בדיקות: איזו שיחה הסוכן קיבל בשורת הפקודה
console.log('FAKE-ARGS ' + (convo ? convo[1] + '=' + convo[2] : 'none'));
if (UI) draw();
hook('start');
