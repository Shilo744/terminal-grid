'use strict';
/*
 * Terminal Grid — שרת מקומי.
 * מחזיק טרמינלים אמיתיים (ConPTY) ברקע, כך שרענון הדף או סגירת החלון לא הורגים את הסוכנים.
 * מאזין רק ל-127.0.0.1 ובודק Host/Origin כדי שאתר אחר בדפדפן לא יוכל לדבר איתו.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const childProcess = require('child_process');
const { execFile, spawnSync } = childProcess;
// node-pty forks a small helper (conpty_console_list_agent) every time a terminal is killed. Without windowsHide, Windows (with Windows Terminal as the
// default terminal) opens a visible semi-transparent console window that has to be closed by hand. Same helper, hidden.
const realFork = childProcess.fork;
childProcess.fork = function patchedFork(modulePath, args, options) {
  if (/conpty_console_list_agent/.test(String(modulePath))) {
    const opts = Array.isArray(args) ? { ...(options || {}), windowsHide: true } : { ...(args || {}), windowsHide: true };
    return Array.isArray(args) ? realFork.call(this, modulePath, args, opts) : realFork.call(this, modulePath, opts);
  }
  return realFork.apply(this, arguments);
};
const pty = require('node-pty');
const plat = require('./server/platform'); // כל מה שתלוי במערכת ההפעלה (Windows / macOS / Linux)
const { WebSocketServer, WebSocket } = require('ws');
const { Terminal: HeadlessTerminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { createDuoManager } = require('./server/duo');
const { createSettings, publicSchema, autoCompactEnv } = require('./server/settings');
const { createHealth } = require('./server/health');
const { createAgentStatus, writeHookSettings, checkNodeOnPath } = require('./server/agent-status');
const { createAutostart } = require('./server/autostart');
const { trustChoice, selectedLabel, trustPromptShown } = require('./server/trust');
const { createDraft, screenState } = require('./server/draft');
const { writeFileAtomic } = require('./server/atomic-write');
const V = require('./server/view');

const PORT = Number(process.env.PORT) || 7791;
const HOST = '127.0.0.1';
const ROOT = __dirname;
const STATE_FILE = process.env.TG_STATE_FILE || path.join(ROOT, 'state.json');
const SETTINGS_FILE = process.env.TG_SETTINGS_FILE || path.join(ROOT, 'settings.json');
const VERSION = require('./package.json').version;
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
// קצב שליחת הפלט: טרמינל ממוקד (או שהוקלד בו משהו לאחרונה) כל 8ms, האחרים כל 40ms, ולכל היותר 256KB לטיק (כדי שרעשן לא ירעיב הקלדה)
const FLUSH_FOCUS_MS = 8;
const FLUSH_BG_MS = 40;
const TYPED_RECENT_MS = 1500;
const MAX_FLUSH_BYTES = 256 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const KEEP_ALIVE = process.env.TG_KEEP_ALIVE === '1'; // מופע פיתוח: לא נסגרים כשאין חלון פתוח

function log(...args) {
  try {
    fs.appendFileSync(path.join(ROOT, 'server.log'), `[${new Date().toISOString()}] ${args.join(' ')}\n`);
  } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('uncaughtException', e && e.stack || e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e && e.stack || e));

// הגדרות המשתמש (server/settings.js): נטענות פעם אחת, ומשודרות לכל החלונות בכל שינוי
// הפעלה אוטומטית עם Windows (קיצור בתיקיית Startup): ההגדרה system.autostart נקראת מהקובץ עצמו, לא נשמרת
const autostart = createAutostart({ root: ROOT, port: PORT, log });
const settingsStore = createSettings({ file: SETTINGS_FILE, log, virtual: { 'system.autostart': () => autostart.exists() } });
settingsStore.load();

// בריאות השרת: השהיית לולאת האירועים (אם משהו חוסם אותה, ההקלדה נתקעת) וגם אזהרה ביומן כשהיא נחסמת יותר מ-200ms
const health = createHealth({ log });

/* ---------- סוגי טרמינלים ---------- */
// "powershell" נשאר שם הסוג (הלקוח ושמירת המצב משתמשים בו), אבל הכוונה: ה-shell הרגיל של המערכת (PowerShell ב-Windows, zsh/bash ב-Mac ו-Linux)
const PRESETS = {
  claude: plat.shell('claude'),
  powershell: plat.shell(''),
};

// תהליך שמופעל מהממשק הגרפי (קיצור בשולחן העבודה, קליק ימני על תיקייה, Finder) יורש PATH ישן או מצומצם,
// בלי תיקיות שנוספו אחר כך (למשל .local/bin שבה מותקן claude). לכן טוענים את ה-PATH העדכני של המשתמש ומוסיפים אותו.
plat.refreshPath();

function findClaude() {
  if (process.env.TG_TEST_NO_CLAUDE === '1') return false; // בדיקות: מדמה מחשב בלי claude (ה-PATH מתחדש מהרישום, ולכן אי אפשר להסיר אותו משם)
  return plat.findCommand('claude');
}
let hasClaude = findClaude();
checkNodeOnPath(log); // hooks של Claude (ושל זוגות הסוכנים) מפעילים `node`: בלעדיו הם נכשלים בשקט, אז מזהירים ביומן

// אם השרת הופעל מתוך סוכן (Claude Code), הוא ירש משם משתנים שמכבים צבעים ומשנים התנהגות
// (NO_COLOR, AI_AGENT ועוד). בלי ניקוי, כל טרמינל בתוך הרשת היה רץ "בשחור-לבן" ובמצב סוכן מקונן.
const TOOLS_DIR = path.join(__dirname, 'tools'), TOOLS_BIN = path.join(TOOLS_DIR, 'bin');
if (!plat.IS_WIN) { // קבצים שהועברו מ-Windows (zip, כונן משותף) מאבדים את הרשאת ההרצה: מחזירים אותה לכלים
  try { for (const f of fs.readdirSync(TOOLS_BIN)) if (!f.endsWith('.cmd')) fs.chmodSync(path.join(TOOLS_BIN, f), 0o755); } catch { /* אין תיקייה */ }
}
const TOOLS_NOTE = path.join(TOOLS_DIR, 'AGENT-TOOLS.md'); // נוסף להוראות של כל Claude שנפתח כאן, כדי שהוא יידע שהכלים קיימים
function cleanEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  const fromAgent = !!(env.CLAUDECODE || env.AI_AGENT || env.CLAUDE_CODE_ENTRYPOINT);
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
  }
  // משתני הדיווח של Terminal Grid עצמו (שרת שהופעל מתוך טרמינל של סוכן): לא עוברים הלאה. כל טרמינל מקבל רק את שלו (extraEnv, אחרי cleanEnv)
  for (const k of ['TG_PANE_ID', 'TG_DUO_ID', 'TG_DUO_ROLE', 'TG_PORT']) delete env[k];
  // הכלים הבסיסיים של Terminal Grid (tg-shot: צילום אתר, tg-image: יצירת תמונה) זמינים כפקודות בכל טרמינל
  const pk = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  env[pk] = TOOLS_BIN + path.delimiter + (env[pk] || '');
  env.TG_TOOLS = TOOLS_DIR;
  if (fromAgent) {
    for (const k of ['NO_COLOR', 'GIT_TERMINAL_PROMPT', 'AI_AGENT', 'CLAUDE_PID', 'WT_SESSION', 'WT_PROFILE_ID']) delete env[k];
  }
  return env;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- סשנים ---------- */
const sessions = new Map();
let nextId = 1;
const clients = new Set();
let duoManager = null; // זוגות סוכנים (ארכיטקט + עובד). נוצר אחרי שכל הפונקציות למטה מוגדרות.
const agentStatus = createAgentStatus({ sessions, broadcast: (m) => broadcast(m), log: (...a) => log(...a) }); // מצב סוכן מדויק מ-hooks של Claude

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

function meta(s) {
  // agentState/agentSince/agentSource: מצב הסוכן לפי hooks (server/agent-status.js). agentSource 'heuristic' = הלקוח ממשיך עם ההיגיון הישן (תזמון פלט)
  const claude = s.kind === 'claude';
  return {
    id: s.id, kind: s.kind, name: s.name, cwd: s.cwd, cols: s.cols, rows: s.rows, exited: s.exited, exitCode: s.exitCode, title: s.title, compact: s.compact || undefined, duo: s.tag || undefined,
    agentState: s.agentState, agentSince: s.agentSince, agentSource: claude ? s.agentSource || 'heuristic' : undefined,
    startup: s.startup || undefined, // T41: עדיין בשלב ההפעלה (הלקוח מכסה את הפאן ב-"מכין את Claude…")
  };
}

function sendTo(client, obj) {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  if (!client.ready) { client.pending.push(str); return; }
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(str);
}
function broadcast(obj) {
  const str = JSON.stringify(obj);
  for (const c of clients) sendTo(c, str);
}

const flushDelay = (s) => (V.activeTab(view).focus === s.id || Date.now() - s.lastInput < TYPED_RECENT_MS ? FLUSH_FOCUS_MS : FLUSH_BG_MS);

// שולח את הפלט שהצטבר. all=true (בסיום התהליך) מרוקן הכול; אחרת עד MAX_FLUSH_BYTES, והשאר בטיק הבא, אחרי שהלולאה טיפלה בהודעות אחרות (הקלדה)
// הודעה אחת לא עוברת MAX_MESSAGE_BYTES: הלקוח ממזג את החלקים לפי הסדר לפני הכתיבה לטרמינל
function flush(s, all = false) {
  s.timer = null;
  if (!s.outBuf) return;
  let d = s.outBuf;
  if (!all && d.length > MAX_FLUSH_BYTES) {
    s.outBuf = d.slice(MAX_FLUSH_BYTES);
    d = d.slice(0, MAX_FLUSH_BYTES);
    s.timer = setTimeout(() => flush(s), 0);
  } else s.outBuf = '';
  s.term.write(d);
  for (let i = 0; i < d.length; i += MAX_MESSAGE_BYTES) broadcast({ t: 'data', id: s.id, d: d.slice(i, i + MAX_MESSAGE_BYTES) });
}

// command / claudeId / env / tag: לשימוש זוגות הסוכנים (שורת פקודה מלאה, מזהה שיחה ידוע, משתני סביבה ותג תפקיד)
function createSession({ kind, cwd, name, resume: resumeId, sessionId, command, claudeId: givenClaudeId, env: extraEnv, tag }) {
  const k = PRESETS[kind] ? kind : 'powershell';
  const preset = PRESETS[k];
  const dir = path.resolve(typeof cwd === 'string' && cwd.trim() ? cwd.trim() : os.homedir());
  let st = null;
  try { st = fs.statSync(dir); } catch { /* not found */ }
  if (!st || !st.isDirectory()) throw new Error(`התיקייה לא נמצאה: ${dir}`);

  // כל שיחת Claude מקבלת מזהה ידוע מראש (--session-id), כדי שאחרי כיבוי אפשר להמשיך בדיוק אותה שיחה (--resume).
  // המזהים מאומתים כדי שלא יוזרק דבר לשורת הפקודה.
  let claudeId = null;
  let args = preset.args;
  let hooksFile = null; // קובץ ה-hooks של הטרמינל (רק ל-Claude רגיל; בפקודה מותאמת, כמו בזוגות סוכנים, לא נוגעים)
  if (k === 'claude' && command) {
    claudeId = UUID_RE.test(String(givenClaudeId || '')) ? String(givenClaudeId).toLowerCase() : null;
    args = plat.shell(command).args;
  } else if (k === 'claude') {
    const resume = UUID_RE.test(String(resumeId || '')) ? String(resumeId).toLowerCase() : null;
    if (resume) {
      if ([...sessions.values()].some((x) => x.claudeId === resume)) throw new Error('השיחה הזאת כבר פתוחה');
      claudeId = resume;
    } else {
      claudeId = UUID_RE.test(String(sessionId || '')) ? String(sessionId).toLowerCase() : crypto.randomUUID();
    }
    // --settings מוסיף את ה-hooks בלי לגעת בהגדרות של המשתמש; אם הכתיבה נכשלה הטרמינל נפתח בלי (והלקוח ממשיך עם ההיגיון הישן)
    hooksFile = writeHookSettings(claudeId, { log });
    const withHooks = (hooksFile ? ` --settings "${hooksFile}"` : '') + (fs.existsSync(TOOLS_NOTE) ? ` --append-system-prompt-file "${TOOLS_NOTE}"` : '');
    args = plat.shell(`claude${withHooks} ${resume ? '--resume' : '--session-id'} ${claudeId}`).args;
  }

  const id = String(nextId++);
  // an agent of a pair starts at the size its pane had last time (kept in state.json): a Claude that draws its screen at 120 columns and is then resized to the pane's width while it works leaves torn, overlapping lines behind
  const ps = tag && tag.role && paneSize[tag.role];
  const cols = ps ? ps.cols : 120, rows = ps ? ps.rows : 32;
  // דחיסה אוטומטית של Claude לפי ההגדרות: אחרי cleanEnv (שמוחק כל CLAUDE_CODE_*), ולפני extraEnv
  const compact = k === 'claude' ? autoCompactEnv(settingsStore.get()) : { env: {}, sig: '' };
  const p = pty.spawn(preset.file, args, { name: 'xterm-256color', cols, rows, cwd: dir, env: { ...cleanEnv(), ...compact.env, ...(hooksFile ? { TG_PANE_ID: id, TG_PORT: String(PORT) } : {}), ...(extraEnv || {}) } });
  const term = new HeadlessTerminal({ cols, rows, scrollback: settingsStore.get().terminal.scrollback, allowProposedApi: true }); // היסטוריית הגלילה לפי ההגדרה, לטרמינלים חדשים
  const serializer = new SerializeAddon();
  term.loadAddon(serializer);

  const s = {
    id, kind: k, cwd: dir, claudeId, tag: tag || null, compact: compact.sig,
    name: (typeof name === 'string' && name.trim()) || plat.P.basename(dir) || dir,
    pty: p, term, serializer, cols, rows,
    title: '', titleTimer: null, exited: false, exitCode: null, outBuf: '', timer: null, lastInput: 0,
    draft: createDraft(), lastKeyAt: 0, lockQueue: null, // טיוטת המשתמש בתיבת הקלט (T62, server/draft.js)
  };

  // Claude Code מעדכן את הכותרת כל כמה עשרות מילישניות בזמן עבודה — מרכזים ושולחים רק את האחרונה.
  term.onTitleChange((t) => {
    s.title = t;
    if (s.titleTimer) return;
    s.titleTimer = setTimeout(() => { s.titleTimer = null; broadcast({ t: 'title', id, title: s.title }); }, 250);
  });
  p.onData((d) => {
    s.lastOutAt = Date.now();
    s.outBuf += d;
    if (!s.timer) s.timer = setTimeout(() => flush(s), flushDelay(s));
  });
  p.onExit(({ exitCode }) => {
    flush(s, true);
    s.exited = true;
    s.exitCode = exitCode;
    broadcast({ t: 'exit', id, code: exitCode });
    agentStatus.onExit(s);
    if (s.tag && duoManager && !shuttingDown) duoManager.onSessionGone(id);
  });

  if (hooksFile) agentStatus.track(s);
  sessions.set(id, s);
  watchTrust(s);
  if (k === 'claude') watchStartup(s);
  log('create', id, k, dir);
  persist();
  return s;
}

/* ---------- שאלת האמון של Claude Code ("Quick safety check: Is this a project you created or one you trust?") ----------
 * כל טרמינל Claude חדש בתיקייה חדשה נעצר בשאלה הזאת וצריך לחיצה ידנית (גם סוכני זוגות בלילה). השרת קורא את המסך הנראה של טרמינל Claude חדש ועונה "Yes, I trust this folder".
 * הדיאלוג האמיתי מסמן כברירת מחדל את "No, exit" (האפשרות הראשונה), ו-Enter לבדו היה סוגר את Claude (באג T32). לכן הכלל (server/trust.js, פונקציה טהורה שנבדקת מול הטקסט האמיתי):
 * Enter רק כשהשורה המסומנת (❯) היא Yes; כשהמסומנת היא No שולחים חץ למטה, מחכים שהמסך יתעדכן, וקוראים שוב (עד 5 צעדים); בכל מקרה אחר לא נשלח כלום.
 * רק בתוך 45 שניות מההפעלה, רק פעם אחת לטרמינל, ותמיד אחרי השהיה קצרה שבסופה קוראים את המסך שוב. תמיד פעיל: פתיחת סוכן בתיקייה היא כבר ההחלטה לסמוך עליה
 * (אין הגדרה ואין ממשק; רק משתנה הסביבה TG_AUTOTRUST=0 מכבה, לבדיקות). אף פעם לא עונים על שום דבר אחר (למשל אישור "bypass permissions"), ולא נוגעים ב-~/.claude.json.
 * הזיהוי תלוי בניסוח האנגלי של השאלה: אם Claude Code ישנה אותו, האישור האוטומטי פשוט מפסיק לעבוד והלחיצה הידנית חוזרת (בלי נזק).
 * TG_TRUST_WINDOW_MS: חלון הזמן, רק לבדיקות. */
const TRUST_WINDOW_MS = Number(process.env.TG_TRUST_WINDOW_MS) || 45 * 1000;
const TRUST_POLL_MS = Number(process.env.TG_TRUST_POLL_MS) || 100;     // בודקים את המסך כל 100ms (הדיאלוג מופיע בתוך שניות מההפעלה); המשתנה לכלי המדידה בלבד
const TRUST_SETTLE_MS = Number(process.env.TG_TRUST_SETTLE_MS) || 150;   // אחרי שהשאלה נראתה: השהיה קצרה וקריאה חוזרת, כדי לא לפעול על מסך באמצע ציור
const TRUST_REACT_MS = 1500;   // אחרי חץ: כמה מחכים שהמסך יתעדכן לפני שמוותרים (אף פעם לא חץ שני "בעיוור")
const TRUST_MAX_DOWNS = 5;

// הטקסט הנראה על המסך (בלי ANSI), שורה אחרי שורה
function screenText(s) {
  const b = s.term.buffer.active;
  const out = [];
  for (let y = b.baseY; y < b.baseY + s.rows; y++) { const l = b.getLine(y); if (l) out.push(l.translateToString(true)); }
  return out.join('\n');
}

function watchTrust(s) {
  if (s.kind !== 'claude' || process.env.TG_AUTOTRUST === '0') return;
  const t0 = Date.now();
  let downs = 0;
  const alive = () => !s.exited && sessions.has(s.id) && Date.now() - t0 <= TRUST_WINDOW_MS;
  const read = () => { try { return screenText(s); } catch { return ''; /* מסוף נסגר */ } };
  const later = (fn, ms) => { const h = setTimeout(fn, ms); if (h.unref) h.unref(); };

  const tick = () => {
    if (!alive()) return;
    if (!trustChoice(read())) return later(tick, TRUST_POLL_MS);
    later(act, TRUST_SETTLE_MS);
  };
  const act = () => {
    if (!alive()) return;
    const text = read();
    const choice = trustChoice(text); // קריאה חוזרת אחרי ההשהיה: מחליטים רק לפי מה שעל המסך עכשיו
    try {
      if (choice === 'enter') {
        s.pty.write('\r'); // השורה המסומנת היא Yes: רק כאן לוחצים Enter
        s.trustAccepted = true;
        log('auto-trust accepted', s.id, s.cwd, downs ? `(after ${downs} down)` : '');
        return;
      }
      if (choice === 'down' && downs < TRUST_MAX_DOWNS) {
        downs++;
        s.pty.write('\x1b[B');
        const t1 = Date.now();
        const before = selectedLabel(text);
        const react = () => {
          if (!alive()) return;
          if (selectedLabel(read()) !== before) return later(tick, TRUST_SETTLE_MS); // הסימון זז: קוראים שוב ומחליטים
          if (Date.now() - t1 > TRUST_REACT_MS) { s.trustStuck = true; log('auto-trust: the screen did not react to Down, giving up', s.id); return; }
          later(react, 50);
        };
        later(react, 50);
        return;
      }
      if (choice === 'down') { s.trustStuck = true; log('auto-trust: gave up after', downs, 'Down presses', s.id); return; }
    } catch { return; /* מסוף נסגר */ }
    later(tick, TRUST_POLL_MS); // השאלה נעלמה או שאי אפשר לפענח אותה בבטחה: לא נשלח כלום, וממשיכים לצפות
  };
  tick();
}

/* ---------- שלב ההפעלה של Claude (T41): "מכין את Claude…" עד שהוא באמת מוכן ----------
 * כל טרמינל Claude חדש (חדש, המשך שיחה, שחזור, הפעלה מחדש, ייבוא, שני סוכני הזוג) מסומן startup מרגע היצירה, והלקוח מכסה את הפאן בשכבה אטומה: PowerShell שמפעיל את claude,
 * שאלת האמון (T40) ולחיצות החצים וה-Enter, והפריים הראשון של Claude לא נראים. הטרמינל שמתחת ממשיך לקבל פלט, ולכן כשהשכבה עולה הוא כבר מצויר ומוכן.
 * השלב נגמר באחד מאלה, הראשון: (a) אירוע SessionStart של ה-hooks (או כל hook); (b) על המסך תיבת ההקלדה של Claude ("? for shortcuts" או שורת "│ >");
 * (c) על המסך דיאלוג שדורש אדם ושאינו שאלת האמון (התחברות, ערכת נושא, אישור bypass-permissions, "(y/n)"): השכבה עולה מיד, אף פעם לא מסתירים שאלה שצריך לענות עליה;
 * (d) התהליך יצא; (e) 12 שניות (TG_STARTUP_TIMEOUT_MS לבדיקות): השכבה עולה והלקוח מציג רמז "הטעינה לוקחת יותר מהרגיל".
 * שאלת האמון עצמה נשארת מוסתרת רק כל עוד הטיפול האוטומטי בה עובד; אם הוא כבוי (TG_AUTOTRUST=0), נתקע, או שהשאלה נשארת על המסך מעל 4 שניות, השכבה עולה והמשתמש עונה בעצמו. */
const STARTUP_MS = Number(process.env.TG_STARTUP_TIMEOUT_MS) || 12000;
const { NEEDS_HUMAN, MAIN_PROMPT } = require('./server/startup-detect'); // מתי המסך מראה תיבת הקלדה / דיאלוג (גם הפריסה האמיתית, T72)
const TRUST_VISIBLE_MS = 4000;
// רק לבדיקות: claude מדומה בלי hooks ובלי תיבת הקלדה נחשב מוכן אחרי שקט של כך וכך מילישניות (בפועל 0 = כבוי: שקט בזמן שClaude טוען איננו סימן שהוא מוכן)
const STARTUP_QUIET_MS = Number(process.env.TG_STARTUP_QUIET_MS) || 0;

function watchStartup(s) {
  s.startup = true;
  const t0 = Date.now();
  const check = () => {
    if (!s.startup) return;
    if (s.exited) return endStartup(s, 'exit');
    let text = '';
    try { text = screenText(s); } catch { /* מסוף נסגר */ }
    if (trustPromptShown(text)) {
      // מוסתרת רק כל עוד הטיפול האוטומטי עובד
      s.trustSeenAt = s.trustSeenAt || Date.now();
      if (process.env.TG_AUTOTRUST === '0' || s.trustStuck || Date.now() - s.trustSeenAt > TRUST_VISIBLE_MS) return endStartup(s, 'dialog');
    } else {
      // סוכן בזוג מקבל agentSource='hooks' כבר מהשידור הראשון של מצב הזוג (T43), לפני שהתחיל בפועל: אצלו רק hook אמיתי (hookSeen, מ-duo/manager) מסיים את השלב
      if ((!s.tag && s.agentSource === 'hooks') || s.hookSeen) return endStartup(s, 'hook');
      if (NEEDS_HUMAN.test(text)) return endStartup(s, 'dialog');
      if (MAIN_PROMPT.test(text)) return endStartup(s, 'prompt');
    }
    if (STARTUP_QUIET_MS && s.lastOutAt && Date.now() - s.lastOutAt >= STARTUP_QUIET_MS && !trustPromptShown(text)) return endStartup(s, 'quiet');
    if (Date.now() - t0 > STARTUP_MS) return endStartup(s, 'timeout');
    const h = setTimeout(check, Date.now() - t0 < 3000 ? 100 : 250);
    if (h.unref) h.unref();
  };
  s.startupAt = t0;
  check();
}

function endStartup(s, why) {
  if (!s || !s.startup) return;
  s.startup = false;
  log('startup ready', s.id, why, (Date.now() - s.startupAt) + 'ms');
  broadcast({ t: 'startup', id: s.id, phase: 'ready', why });
}

function killTree(s) {
  try { s.pty.kill(); } catch { /* already gone */ }
  if (s.pty && s.pty.pid) plat.killTree(s.pty.pid);
}

function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);
  if (s.titleTimer) clearTimeout(s.titleTimer);
  if (!s.exited) killTree(s);
  try { s.term.dispose(); } catch { /* ignore */ }
  sessions.delete(id);
  V.removeId(view, id);
  broadcast({ t: 'closed', id });
  log('close', id);
  hist.at = 0; // T55: השיחה של הטרמינל שנסגר חייבת להופיע בהיסטוריה מיד (המטמון של 3 שניות עלול להיות מלפני שנכתבה)
  if (s.tag && duoManager && !shuttingDown) duoManager.onSessionGone(id);
  if (!shuttingDown) persist(); // בכיבוי השרת לא מוחקים את המצב השמור — הוא מה שמחזיר הכול בהפעלה הבאה
}

// הפעלה מחדש של טרמינל שיצא: Claude ממשיך את אותה שיחה (resume כשיש לה קובץ שמור, אחרת אותו מזהה מחדש), PowerShell נפתח באותה תיקייה.
// הטרמינל החדש תופס את המקום של הישן בסדר (ובהגדלה/מיקוד אם היו שלו), והישן נסגר
async function restartSession(old) {
  const opts = { kind: old.kind, cwd: old.cwd, name: old.name };
  if (old.kind === 'claude' && old.claudeId) {
    if (await transcriptExistsAsync(old.claudeId)) opts.resume = old.claudeId; else opts.sessionId = old.claudeId;
  }
  const before = JSON.parse(JSON.stringify(view)); // הלשונית, המקום, ההגדלה והמיקוד של הישן עוברים לחדש
  closeSession(old.id); // קודם: אחרת resume מסרב ("השיחה כבר פתוחה")
  const fresh = createSession(opts);
  broadcast({ t: 'created', reqId: null, session: { ...meta(fresh), snapshot: '' } });
  V.replaceId(before, old.id, fresh.id);
  view = V.normalizeView(before, gridIds());
  broadcast({ t: 'view', view: viewOut() });
  persist();
  log('restart', old.id, '->', fresh.id);
}

// כתיבה לטרמינל כאילו הוקלד (משמש את זוגות הסוכנים להעיר סוכן). כתיבה שלא של אדם: לא נספרת כטיוטה ולא כהקלדה
function writeInput(id, data) {
  const s = sessions.get(String(id));
  if (s && !s.exited) s.pty.write(data);
}

/* ---------- טיוטה של המשתמש בסוכן (T62) ----------
 * הוראת wake של זוג לא נדחפת לתוך הודעה שהמשתמש כותב. draftState אומר אם יש טיוטה ואם הוא מקליד עכשיו; lockHuman מחזיק את ההקשות בזמן שהטיוטה מוחלפת
 * (Ctrl+S של Claude מזיז אותה הצידה והיא חוזרת לבד) ומשחרר אותן בסדר אחר כך. */
const TYPING_PAUSE_MS = 1500;       // הקשה בשנייה וחצי האחרונות = "מקליד עכשיו"
const ECHO_GRACE_MS = 2000;         // הקשה אחרונה לפני פחות מזה: הצל קובע (ההד של Claude עוד לא בהכרח על המסך)
function draftState(id) {
  const s = sessions.get(String(id));
  if (!s || s.exited) return null;
  const now = Date.now();
  const scr = screenState(s.term);
  let draft;
  if (s.draft.active && now - s.draft.lastAt < ECHO_GRACE_MS) draft = true;
  else if (scr.found) { draft = scr.draft; if (!draft && s.draft.active) s.draft.clear(); } // המסך גובר על הצל כשהוא קריא (Ctrl+W, עריכה באמצע וכו')
  else draft = s.draft.active;
  return { draft, typing: now - s.lastKeyAt < TYPING_PAUSE_MS, lastKeyAt: s.lastKeyAt, screen: scr };
}
function lockHuman(id, on) {
  const s = sessions.get(String(id));
  if (!s) return;
  if (on) { if (!s.lockQueue) s.lockQueue = []; return; }
  const q = s.lockQueue;
  s.lockQueue = null;
  if (q && q.length && !s.exited) {
    const data = q.join('');
    if (s.draft.feed(data)) s.lastKeyAt = Date.now();
    s.pty.write(data);
  }
}

/* ---------- שמירה ושחזור: כניסה מחדש מחזירה את אותו מצב ---------- */
// נשמר: אילו טרמינלים פתוחים (סוג, תיקייה, שם, ומזהה השיחה של Claude), הסדר, ומה מוגדל/ממוקד.
// בהפעלה הבאה כל שיחת Claude נפתחת מחדש עם --resume, ו-PowerShell נפתח באותה תיקייה.
// לשוניות הרשת (T60): { tabs: [{ id, name, order, expanded, focus }], active }; ראו server/view.js. viewOut מוסיף את order/expanded/focus של הלשונית הפעילה (לקוח ישן, בדיקות)
let view = V.normalizeView(null, []);
const gridIds = () => [...sessions.values()].filter((s) => !s.tag).map((s) => s.id);
const viewOut = () => { view = V.normalizeView(view, gridIds()); const a = V.activeTab(view); return { ...view, order: a.order, expanded: a.expanded, focus: a.focus }; };
let restoring = false;
let persistTimer = null;

/* ---------- שמות מותאמים לפרויקטים בתפריט הצד (T56): לפי נתיב התיקייה (בלי הבדל אותיות), נשמרים ב-state.json ---------- */
const projectNames = {};
const paneSize = {}; // role -> { cols, rows } of the last pane of a pair agent (architect / worker)
const projectKey = (p) => String(p || '').replace(/[\\/]+/g, '\\').replace(/\\$/, '').toLowerCase();
function setProjectName(p, name) {
  const key = projectKey(p);
  if (!key || key.length > 400) return false;
  if (typeof name !== 'string') return false;
  const n = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (n) projectNames[key] = n; else delete projectNames[key]; // ריק = חוזרים לשם התיקייה
  broadcast({ t: 'projectNames', names: projectNames });
  persist();
  return true;
}

function snapshotState() {
  const live = [...sessions.values()].filter((s) => !s.exited && !s.tag); // טרמינלים של זוגות נשמרים דרך duoManager
  // הסדר השטוח של הקובץ השמור: לשונית אחר לשונית, ובתוכה לפי הסדר שלה; הלשוניות שומרות אינדקסים לתוכו
  view = V.normalizeView(view, gridIds()); // טרמינל חדש שעוד לא הגיע ללשונית נכנס לפעילה
  const flat = view.tabs.flatMap((t) => t.order);
  const rank = (s) => { const i = flat.indexOf(s.id); return i < 0 ? 1e9 + Number(s.id) : i; };
  live.sort((a, b) => rank(a) - rank(b));
  const idx = (id) => { const i = live.findIndex((s) => s.id === id); return i < 0 ? null : i; };
  const act = V.activeTab(view);
  return {
    v: 1,
    savedAt: new Date().toISOString(),
    sessions: live.map((s) => ({ kind: s.kind, cwd: s.cwd, name: s.name, claudeId: s.claudeId || null })),
    expanded: idx(act.expanded), // הלשונית הפעילה, גם בשדות הישנים: גרסה קודמת קוראת את הקובץ ורואה רשת אחת
    focus: idx(act.focus),
    tabs: view.tabs.map((t) => ({ id: t.id, name: t.name, order: t.order.map(idx).filter((i) => i != null), expanded: idx(t.expanded), focus: idx(t.focus) })),
    active: view.active,
    duos: duoManager ? duoManager.saved() : [],
    closedDuos: duoManager ? duoManager.savedClosed() : [],
    paneSize,
    projectNames,
  };
}

function saveStateNow() {
  if (restoring) return; // באמצע שחזור הקובץ השמור הוא המקור היחיד — לא דורסים אותו בחצי מצב
  clearTimeout(persistTimer);
  persistTimer = null;
  try {
    writeFileAtomic(STATE_FILE, JSON.stringify(snapshotState()));
  } catch (e) { log('save state failed', e.message); }
}

function persist() {
  if (shuttingDown || restoring) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(saveStateNow, 400);
}

// האם יש קובץ שיחה (jsonl) למזהה הזה. מטמון: "כן" נשמר לתמיד (קובץ שיחה לא נעלם), "לא" ל-5 שניות (השיחה יכולה להיווצר עוד רגע).
// שחזור המצב בהפעלה משתמש בגרסה האסינכרונית. הגרסה הסינכרונית נשארה רק ליצירת זוג סוכנים (server/duo, פעם אחת ליצירה, לא בזמן הקלדה)
// והיא משתמשת באותו מטמון.
const transcriptSeen = new Map(); // id -> true | זמן ה"לא" האחרון
const TRANSCRIPT_NO_MS = 5000;
function transcriptCached(id) {
  const v = transcriptSeen.get(id);
  if (v === true) return true;
  return v && Date.now() - v < TRANSCRIPT_NO_MS ? false : undefined;
}
async function transcriptExistsAsync(id) {
  const c = transcriptCached(id);
  if (c !== undefined) return c;
  let found = false;
  try {
    for (const d of await fs.promises.readdir(PROJECTS_DIR)) {
      try { await fs.promises.access(path.join(PROJECTS_DIR, d, id + '.jsonl')); found = true; break; } catch { /* לא בתיקייה הזאת */ }
    }
  } catch { /* no projects dir */ }
  transcriptSeen.set(id, found || Date.now());
  return found;
}
function transcriptExists(id) {
  const c = transcriptCached(id);
  if (c !== undefined) return c;
  let found = false;
  try {
    for (const d of fs.readdirSync(PROJECTS_DIR)) if (fs.existsSync(path.join(PROJECTS_DIR, d, id + '.jsonl'))) { found = true; break; }
  } catch { /* no projects dir */ }
  transcriptSeen.set(id, found || Date.now());
  return found;
}

// זוגות סוכנים: כל מה שהם צריכים מהשרת עובר דרך האובייקט הזה (ראו server/duo/manager.js)
duoManager = createDuoManager({
  createSession, closeSession, writeInput, draftState, lockHuman, screenState: (id) => { const s = sessions.get(String(id)); return s ? screenState(s.term) : null; }, screenText: (id) => { const s = sessions.get(String(id)); try { return s && !s.exited ? screenText(s) : ''; } catch { return ''; } }, sessions, broadcast, sendTo, persist, log, port: PORT, transcriptExists,
  markStarted: (id) => { const s = sessions.get(id); if (s) { s.hookSeen = true; endStartup(s, 'hook'); } },
  announce: (s) => broadcast({ t: 'created', reqId: null, session: { ...meta(s), snapshot: '' } }),
});

async function restoreState() {
  let st;
  try { st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return; }
  if (st && st.paneSize && typeof st.paneSize === 'object') for (const r of ['architect', 'worker']) { const v = st.paneSize[r]; if (v && Number.isInteger(v.cols) && Number.isInteger(v.rows) && v.cols >= 20 && v.cols <= 500 && v.rows >= 4 && v.rows <= 300) paneSize[r] = { cols: v.cols, rows: v.rows }; }
  if (st && st.projectNames && typeof st.projectNames === 'object') for (const [k, v] of Object.entries(st.projectNames)) if (typeof v === 'string' && v.trim() && k.length <= 400) projectNames[projectKey(k)] = v.trim().slice(0, 60); // שמות הפרויקטים נטענים גם כשאין טרמינלים לשחזר
  const hasDuos = !!st && Array.isArray(st.duos) && st.duos.length > 0;
  if (st && duoManager) duoManager.restoreClosed(st.closedDuos); // זוגות שנסגרו וניתן לשחזר (גם כשאין עוד טרמינלים וזוגות)
  if (!st || !Array.isArray(st.sessions) || (!st.sessions.length && !hasDuos)) return;
  restoring = true;
  log('restoring', st.sessions.length, 'terminals', hasDuos ? `+ ${st.duos.length} duo` : '');
  const made = [];
  for (const it of st.sessions) {
    try {
      const opts = { kind: it.kind, cwd: it.cwd, name: it.name };
      if (it.kind === 'claude' && UUID_RE.test(String(it.claudeId || ''))) {
        // שיחה שעוד לא נשלחה בה אף הודעה אין לה קובץ שמור ואי אפשר לעשות לה resume — פותחים אותה חדשה עם אותו מזהה
        if (await transcriptExistsAsync(it.claudeId)) opts.resume = it.claudeId; else opts.sessionId = it.claudeId;
      }
      const s = createSession(opts);
      made.push(s);
      broadcast({ t: 'created', reqId: null, session: { ...meta(s), snapshot: '' } });
    } catch (e) {
      made.push(null);
      log('restore failed', it && it.cwd, e.message);
    }
    await sleep(250); // לא מפעילים את כל הסוכנים באותו רגע
  }
  const pick = (i) => (i != null && made[i] ? made[i].id : null);
  if (Array.isArray(st.tabs) && st.tabs.length) {
    const ids = (a) => (Array.isArray(a) ? a.map(pick).filter(Boolean) : []);
    view = V.normalizeView({ tabs: st.tabs.map((t) => (t && typeof t === 'object' ? { id: t.id, name: t.name, order: ids(t.order), expanded: pick(t.expanded), focus: pick(t.focus) } : null)), active: st.active }, gridIds());
  } else {
    view = V.normalizeView({ order: made.filter(Boolean).map((s) => s.id), expanded: pick(st.expanded), focus: pick(st.focus) }, gridIds()); // קובץ מלפני הלשוניות: הכול בלשונית אחת
  }
  if (hasDuos) duoManager.restore(st.duos); // זוגות הסוכנים חוזרים עם אותן שיחות (resume) ואותו מצב השהיה
  restoring = false;
  broadcast({ t: 'view', view: viewOut() });
  saveStateNow();
}

// תמונת מצב מדויקת של כל טרמינל (כולל היסטוריה) לחלון שמתחבר מחדש.
// מבקשים את כל התמונות באותו רגע, ומה שמגיע אחרי כן נשמר בתור ונשלח אחריהן — בלי כפילויות ובלי אובדן.
function buildList() {
  const tasks = [...sessions.values()].map((s) => new Promise((resolve) => {
    s.term.write('', () => resolve({ ...meta(s), snapshot: s.serializer.serialize() }));
  }));
  return Promise.all(tasks).then((list) => ({ t: 'list', sessions: list, view: viewOut(), settings: settingsStore.get(), duos: duoManager ? duoManager.snapshots() : [], duosClosed: duoManager ? duoManager.closedView() : [], projectNames }));
}

function onMessage(client, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== 'object') return;
  const s = m.id != null ? sessions.get(String(m.id)) : null;

  switch (m.t) {
    case 'input':
      if (s && !s.exited && typeof m.d === 'string') {
        s.lastInput = Date.now();
        if (s.lockQueue) { s.lockQueue.push(m.d); break; } // החלפת טיוטה בעיצומה (T62): ההקשות ממתינות וישוחררו בסדר
        const hadDraft = s.draft.active;
        if (s.draft.feed(m.d)) s.lastKeyAt = Date.now();
        const t0 = process.hrtime.bigint();
        s.pty.write(m.d);
        if (hadDraft && !s.draft.active && s.tag && duoManager) duoManager.onUserInput(s.id); // שלח או ניקה: הוראה ממתינה נבדקת מיד
        // הדבקה גדולה: כמה זמן pty.write החזיר (T33: 0.1-0.2ms ל-20KB, כלומר ההמתנה אינה בשרת; ביומן כדי שאפשר יהיה לוודא את זה בשימוש אמיתי)
        if (m.d.length >= 8192) log('big input', s.id, m.d.length, 'chars, pty.write returned after', (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1), 'ms');
      }
      break;
    case 'resize': {
      if (!s) break;
      const cols = clampInt(m.cols, 20, 500), rows = clampInt(m.rows, 4, 300); // never a few characters wide: an agent writes its whole answer in that width
      if (cols === s.cols && rows === s.rows && !s.resizeFailed) break;
      // a failed pty resize is remembered (resizeFailed) and retried by the next request, and logged: a silently failed resize leaves the agent drawing at the old width into a narrower screen
      if (!s.exited) { try { s.pty.resize(cols, rows); s.resizeFailed = false; } catch (e) { s.resizeFailed = true; log('pty resize failed', s.id, cols + 'x' + rows, e && e.message); } }
      if (s.tag) log('resize', s.id, s.tag.role, cols + 'x' + rows, s.resizeFailed ? 'FAILED' : 'ok');
      s.cols = cols; s.rows = rows;
      if (s.tag && s.tag.role && (!paneSize[s.tag.role] || paneSize[s.tag.role].cols !== cols || paneSize[s.tag.role].rows !== rows)) { paneSize[s.tag.role] = { cols, rows }; persist(); }
      s.term.write('', () => { try { s.term.resize(cols, rows); } catch { /* disposed */ } });
      break;
    }
    case 'create': {
      const run = () => {
        try {
          if (process.env.TG_TEST_CREATE_FAIL === '1') throw new Error('שגיאה מדומה בפתיחה (בדיקה)');
          const created = createSession(m);
          broadcast({ t: 'created', reqId: m.reqId, session: { ...meta(created), snapshot: '' } });
        } catch (e) {
          sendTo(client, { t: 'error', reqId: m.reqId, message: e.message || 'שגיאה בפתיחת טרמינל' });
        }
      };
      // בדיקות (משוב מיידי, T38): TG_TEST_CREATE_DELAY_MS מדמה פתיחה איטית, TG_TEST_CREATE_FAIL=1 פתיחה שנכשלת
      const wait = Number(process.env.TG_TEST_CREATE_DELAY_MS) || 0;
      if (wait) setTimeout(run, wait); else run();
      break;
    }
    case 'rename':
      if (s && typeof m.name === 'string' && m.name.trim()) {
        s.name = m.name.trim().slice(0, 60);
        broadcast({ t: 'renamed', id: s.id, name: s.name });
        persist();
      }
      break;
    case 'projectName': // T56: שם מותאם לפרויקט בתפריט הצד
      if (typeof m.path === 'string') setProjectName(m.path, m.name);
      break;
    case 'close':
      if (s) closeSession(s.id);
      break;
    case 'clear':
      // ניקוי המסך (והגלילה) בכל החלונות וגם בתמונת המצב של השרת. ה-PTY לא נוגע: מה שרץ בו ימשיך לצייר כרגיל
      if (s) { try { s.term.clear(); } catch { /* disposed */ } broadcast({ t: 'cleared', id: s.id }); }
      break;
    case 'restart':
      if (s && s.exited && !s.tag) setTimeout(() => restartSession(s).catch((e) => sendTo(client, { t: 'error', message: e.message || 'שגיאה בהפעלה מחדש' })), Number(process.env.TG_TEST_CREATE_DELAY_MS) || 0); // ההשהיה: בדיקות בלבד
      break;
    case 'view': {
      // סדר הטרמינלים, מה מוגדל ומה ממוקד — נשמר כדי שאחרי כניסה מחדש הכול יחזור למקום
      if (Array.isArray(m.tabs)) {
        view = V.normalizeView({ tabs: m.tabs, active: m.active }, gridIds());
      } else {
        // הודעה בצורה הישנה (order/expanded/focus): עורכת את הלשונית הפעילה בלבד
        const cur = JSON.parse(JSON.stringify(view));
        const a = V.activeTab(cur);
        a.order = Array.isArray(m.order) ? m.order.map(String) : a.order;
        a.expanded = m.expanded != null ? String(m.expanded) : null;
        a.focus = m.focus != null ? String(m.focus) : null;
        view = V.normalizeView(cur, gridIds());
      }
      persist();
      break;
    }
    case 'settings:set': {
      // patch חלקי (נבדק מול הסכמה); migrate = ההעברה החד-פעמית מ-localStorage. תמיד משדרים, כדי שהשולח יוכל לסגור את הבקשה (rid)
      const snapshot = settingsStore.patch(m.patch, { migrate: m.migrate === true });
      const echo = { t: 'settings', settings: snapshot, rid: typeof m.rid === 'string' ? m.rid.slice(0, 40) : undefined };
      const lag = Number(process.env.TG_TEST_SETTINGS_ECHO_MS) || 0; // בדיקות (T38): הד מאוחר של ערך קודם, כמו שרת עמוס
      if (lag) setTimeout(() => broadcast(echo), lag); else broadcast(echo);
      break;
    }
    case 'duo':
      duoManager.handleMessage(client, m);
      break;
    default:
  }
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  saveStateNow(); // תמונת המצב האחרונה נשמרת לפני שהטרמינלים נסגרים
  shuttingDown = true;
  if (duoManager) duoManager.shutdown();
  log('shutdown');
  broadcast({ t: 'bye' });
  for (const id of [...sessions.keys()]) closeSession(id);
  setTimeout(() => process.exit(0), 300);
}

/* ---------- בורר תיקיות (חלון רגיל של המערכת) ---------- */
const pickFolder = (start) => plat.pickFolder(start, log); // חלון בחירת התיקייה של המערכת (server/platform.js)

/* ---------- "הבא סוכן פתוח": סוכני Claude שרצים בטרמינל אחר ---------- */
// אי אפשר להעביר תהליך רץ לחלון אחר, אבל אפשר לסגור אותו ולהמשיך את אותה שיחה כאן (claude --resume).
// Claude Code רושם כל סוכן אינטראקטיבי ב-~/.claude/sessions/<pid>.json (מזהה שיחה, תיקייה, מצב).
function listExternalClaude() {
  return plat.listExternalClaude(process.pid, [...sessions.values()].map((s) => s.pty && s.pty.pid).filter(Boolean), log);
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adoptHit(hit) {
  const pid = hit.pid;
  // אותה שיחה לא יכולה לרוץ בשני מקומות: סוגרים את המקור (ואת מה שהוא הפעיל) ורק אז ממשיכים כאן
  await new Promise((resolve) => plat.killTree(pid, resolve));
  for (let i = 0; i < 25 && pidAlive(pid); i++) await sleep(200);
  if (pidAlive(pid)) throw new Error('לא הצלחתי לסגור את הסוכן המקורי');
  log('adopt', pid, hit.sessionId, hit.cwd);
  const s = createSession({ kind: 'claude', cwd: hit.cwd, resume: hit.sessionId });
  broadcast({ t: 'created', reqId: null, focus: true, session: { ...meta(s), snapshot: '' } });
  return s;
}

async function adoptClaude(pid, sessionId) {
  const hit = (await listExternalClaude()).find((x) => x.pid === pid && x.sessionId === sessionId && !x.inGrid);
  if (!hit) throw new Error('הסוכן הזה כבר לא פתוח');
  return adoptHit(hit);
}

// ייבוא כולם: רשימה אחת, ואז כל סוכן בתורו (בכשל של אחד ממשיכים לשאר)
async function adoptAllClaude() {
  const hits = (await listExternalClaude()).filter((x) => !x.inGrid);
  let done = 0, failed = 0;
  for (const hit of hits) {
    try { await adoptHit(hit); done++; } catch (e) { failed++; log('adopt failed', hit.pid, e.message); }
  }
  return { done, failed };
}

// אם המשתמש עושה /clear או /resume בתוך הטרמינל, מזהה השיחה משתנה. בודקים מדי פעם מול הרישום של Claude
// ומתקנים את המזהה השמור, כדי שהשחזור יחזיר את השיחה העדכנית ולא את זו שלפני כן.
let syncingIds = false;
async function syncClaudeIds() {
  if (syncingIds || shuttingDown || restoring) return;
  if (![...sessions.values()].some((s) => s.kind === 'claude' && !s.exited)) return;
  syncingIds = true;
  try {
    let changed = false;
    for (const h of await listExternalClaude()) {
      if (!h.panePid) continue;
      const s = [...sessions.values()].find((x) => x.pty && x.pty.pid === h.panePid && x.kind === 'claude');
      if (s && s.claudeId !== h.sessionId) {
        log('claude session changed', s.id, s.claudeId, '->', h.sessionId);
        s.claudeId = h.sessionId;
        changed = true;
      }
    }
    if (changed) persist();
  } finally { syncingIds = false; }
}
setInterval(() => { syncClaudeIds().catch(() => {}); }, Number(process.env.TG_SYNC_MS) || 30000);

/* ---------- היסטוריית שיחות (כמו ב-Claude Code): כל השיחות השמורות, לפי תיקיית הפרויקט ---------- */
// Claude שומר כל שיחה כקובץ ~/.claude/projects/<פרויקט>/<מזהה>.jsonl. מהקובץ מוציאים תיקייה, שם ותאריך;
// קוראים רק את ההתחלה והסוף שלו (הקבצים יכולים להגיע ל-60MB) והתוצאה נשמרת עד שהקובץ משתנה.
const histCache = new Map();
const HEAD_BYTES = 128 * 1024;
const TAIL_BYTES = 64 * 1024;
const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);

function msgText(o) {
  const c = o && o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) { const b = c.find((x) => x && x.type === 'text' && typeof x.text === 'string'); return b ? b.text : ''; }
  return '';
}

function parseTranscript(file, st) {
  const info = { cwd: null, first: '', custom: '', ai: '', last: '', hasUser: false };
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(Math.min(HEAD_BYTES, st.size));
    fs.readSync(fd, head, 0, head.length, 0);
    const tailLen = Math.min(TAIL_BYTES, st.size);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, st.size - tailLen);
    for (const chunk of [head, tail]) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.charCodeAt(0) !== 123) continue; // '{'
        let o;
        try { o = JSON.parse(line); } catch { continue; } // שורה חתוכה בקצה הקטע
        if (!o || typeof o.type !== 'string') continue;
        if (!info.cwd && typeof o.cwd === 'string') info.cwd = o.cwd;
        if (o.type === 'user' && !o.isMeta) {
          info.hasUser = true;
          if (!info.first) {
            const t = msgText(o).trim();
            if (t && !t.startsWith('<') && !t.startsWith('[')) info.first = tidy(t); // בלי פקודות /slash והודעות מערכת
          }
        } else if (o.type === 'custom-title' && o.customTitle) info.custom = tidy(o.customTitle);
        else if (o.type === 'ai-title' && o.aiTitle) info.ai = tidy(o.aiTitle);
        else if (o.type === 'last-prompt' && o.lastPrompt) info.last = tidy(o.lastPrompt);
      }
    }
  } finally { if (fd != null) try { fs.closeSync(fd); } catch { /* ignore */ } }
  return info;
}

// "רצה בחוץ" (שיחה שפתוחה בטרמינל אחר) נבדקת דרך PowerShell, שלוקח כשתי שניות. לכן הרשימה חוזרת מיד
// מהדיסק, והבדיקה רצה ברקע ונשמרת עד שמתיישנת. הדף שואל שוב כשהתשובה עדיין לא הגיעה (liveReady).
const liveCache = { at: 0, ids: new Set(), busy: false };
function refreshLive() {
  if (liveCache.busy) return;
  liveCache.busy = true;
  listExternalClaude()
    .then((ext) => { liveCache.ids = new Set(ext.filter((x) => !x.inGrid).map((x) => x.sessionId)); })
    .catch(() => {})
    .finally(() => { liveCache.at = Date.now(); liveCache.busy = false; });
}

// הסריקה של היסטוריית השיחות (כל קובצי ה-jsonl של Claude) לא רצה על לולאת האירועים בבת אחת: קריאת תיקיות ו-stat אסינכרוניים,
// ופענוח קבצים בפרוסות של כמה מילישניות עם הפסקה ביניהן, כך שהקלדה בטרמינלים לא נתקעת בזמן שהסרגל נפתח.
// התוצאה נשמרת 3 שניות, בקשות שמגיעות בזמן סריקה משתפות אותה, ואם הסריקה (הראשונה, עם הרבה קבצים) לא נגמרת
// בתקציב הזמן, מחזירים מה שיש עם partial:true והסריקה ממשיכה ברקע (הדף שואל שוב).
const HIST_TTL_MS = 3000;
const HIST_BUDGET_MS = 1500;
const SLICE_MS = 8;
const hist = { result: null, at: 0, inflight: null };
const yieldLoop = () => new Promise((r) => setImmediate(r));

async function scanHistory() {
  const dirOk = new Map();
  const exists = async (p) => {
    if (!dirOk.has(p)) { let ok = false; try { ok = (await fs.promises.stat(p)).isDirectory(); } catch { /* gone */ } dirOk.set(p, ok); }
    return dirOk.get(p);
  };
  let sliceStart = Date.now();
  const slice = async () => { if (Date.now() - sliceStart > SLICE_MS) { await yieldLoop(); sliceStart = Date.now(); } };

  const groups = new Map();
  let dirs = [];
  try { dirs = await fs.promises.readdir(PROJECTS_DIR); } catch { /* no history yet */ }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d);
    let names;
    try { names = await fs.promises.readdir(dir); } catch { continue; }
    const files = names.filter((f) => f.endsWith('.jsonl') && UUID_RE.test(f.slice(0, -6)));
    for (let i = 0; i < files.length; i += 32) {
      const batch = files.slice(i, i + 32);
      const stats = await Promise.all(batch.map((f) => fs.promises.stat(path.join(dir, f)).catch(() => null)));
      for (let j = 0; j < batch.length; j++) {
        const st = stats[j];
        if (!st || !st.isFile()) continue;
        await slice();
        const f = batch[j], id = f.slice(0, -6), file = path.join(dir, f);
        const key = `${st.mtimeMs}:${st.size}`;
        let hit = histCache.get(file);
        if (!hit || hit.key !== key) {
          try { hit = { key, info: parseTranscript(file, st) }; } catch { continue; }
          histCache.set(file, hit);
        }
        const info = hit.info;
        const title = info.custom || info.ai || info.first || info.last;
        if (!title) continue; // שיחה בלי אף הודעה אמיתית (רק פקודות כמו /clear) — אין מה להמשיך
        const gk = info.cwd ? info.cwd.toLowerCase() : 'dir:' + d;
        let g = groups.get(gk);
        if (!g) {
          g = {
            cwd: info.cwd, last: 0, sessions: [],
            name: info.cwd ? (plat.P.basename(info.cwd) || info.cwd) : d,
            parent: info.cwd ? plat.P.dirname(info.cwd) : '',
            exists: info.cwd ? await exists(info.cwd) : false,
          };
          groups.set(gk, g);
        }
        g.sessions.push({ id, title: title || '(ללא שם)', last: st.mtimeMs });
        if (st.mtimeMs > g.last) g.last = st.mtimeMs;
      }
    }
  }
  const projects = [...groups.values()].sort((a, b) => b.last - a.last);
  for (const g of projects) g.sessions.sort((a, b) => b.last - a.last);
  return projects;
}

// "פתוחה" ו"רצה בחוץ" משתנות מהר מהסריקה, ולכן מוסיפים אותן בכל תשובה ולא שומרים אותן במטמון
function decorate(projects, partial) {
  const liveOutside = liveCache.ids;
  const openById = new Map([...sessions.values()].filter((s) => s.claudeId).map((s) => [s.claudeId, s.id]));
  return {
    projects: projects.map((g) => ({ ...g, sessions: g.sessions.map((x) => ({ ...x, open: openById.get(x.id) || null, live: liveOutside.has(x.id) })) })),
    liveReady: liveCache.at > 0,
    ...(partial ? { partial: true } : {}),
  };
}

async function listHistory() {
  if (Date.now() - liveCache.at > 8000) refreshLive();
  if (hist.result && Date.now() - hist.at < HIST_TTL_MS) return decorate(hist.result, false);
  if (!hist.inflight) {
    hist.inflight = scanHistory()
      .then((r) => { hist.result = r; hist.at = Date.now(); return r; })
      .finally(() => { hist.inflight = null; });
  }
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(null), HIST_BUDGET_MS); });
  const done = await Promise.race([hist.inflight, late]);
  clearTimeout(timer);
  if (done) return decorate(done, false);
  return decorate(hist.result || [], true); // הסריקה ממשיכה ברקע; מחזירים את הקודמת (או ריקה) עכשיו
}

/* ---------- HTTP ---------- */
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const hostOk = (req) => ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase());
const originOk = (req) => ALLOWED_ORIGINS.has(String(req.headers.origin || '').toLowerCase());

const JS = 'text/javascript; charset=utf-8';
const CSS = 'text/css; charset=utf-8';
const nm = (...p) => path.join(ROOT, 'node_modules', ...p);
const STATIC = {
  '/': [path.join(ROOT, 'public', 'index.html'), 'text/html; charset=utf-8'],
  '/app.js': [path.join(ROOT, 'public', 'app.js'), JS],
  '/rtl.js': [path.join(ROOT, 'public', 'rtl.js'), JS],
  '/style.css': [path.join(ROOT, 'public', 'style.css'), CSS],
  '/vendor/xterm.js': [nm('@xterm', 'xterm', 'lib', 'xterm.js'), JS],
  '/vendor/xterm.css': [nm('@xterm', 'xterm', 'css', 'xterm.css'), CSS],
  '/vendor/addon-fit.js': [nm('@xterm', 'addon-fit', 'lib', 'addon-fit.js'), JS],
  '/vendor/addon-web-links.js': [nm('@xterm', 'addon-web-links', 'lib', 'addon-web-links.js'), JS],
  '/vendor/addon-unicode11.js': [nm('@xterm', 'addon-unicode11', 'lib', 'addon-unicode11.js'), JS],
  '/vendor/addon-webgl.js': [nm('@xterm', 'addon-webgl', 'lib', 'addon-webgl.js'), JS],
  '/fonts/CascadiaMono.ttf': [path.join(ROOT, 'public', 'fonts', 'CascadiaMono.ttf'), 'font/ttf'],
};

// כל שאר הקבצים של הממשק (js/*.js, css/*.css ...) מוגשים מתיקיית public, בלי אפשרות לצאת ממנה
const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = {
  '.js': JS, '.mjs': JS, '.css': CSS, '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};
function publicEntry(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^[\\/]+/, ''));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return null;
  const type = MIME[path.extname(file).toLowerCase()];
  return type && fs.existsSync(file) ? [file, type] : null;
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// קריאה מתהליך מקומי (למשל התפריט הימני ב-Explorer): אין לה Origin. דפדפן שולח Origin תמיד ב-POST,
// ואתר זר לא יכול להוסיף כותרת מותאמת בלי preflight, ולכן שני התנאים יחד חוסמים אתרים.
const localCallerOk = (req) =>
  hostOk(req) && req.headers['x-tg'] === '1' && (!req.headers.origin || originOk(req));

// תמונות מודבקות (T45): תיקייה זמנית אחת, נמחקות אחרי 24 שעות (בהפעלה ואז כל שעה, באופן אסינכרוני ובתקציב קטן)
const PASTE_IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const PASTE_IMAGE_MAX = 30 * 1024 * 1024;
const PASTE_TEXT_MAX = 20 * 1024 * 1024; // T53: טקסט ארוך שנשמר כקובץ; מעל זה הלקוח חוזר להדבקה רגילה
const PASTE_TEXT_NAME = /^text-\d{8}-\d{6}-[0-9a-f]{6}\.txt$/; // רק שמות שהשרת בנה (reveal מקבל שם בלבד, אף פעם נתיב מהלקוח)
const PASTE_KEEP_MS = 24 * 60 * 60 * 1000;
const pasteDir = () => path.join(os.tmpdir(), 'tg-paste');
async function cleanPasteDir() {
  try {
    const dir = pasteDir();
    const names = (await fs.promises.readdir(dir)).slice(0, 500);
    const now = Date.now();
    for (const n of names) {
      const f = path.join(dir, n);
      try { if (now - (await fs.promises.stat(f)).mtimeMs > PASTE_KEEP_MS) await fs.promises.unlink(f); } catch { /* נעלם או בשימוש */ }
    }
  } catch { /* אין תיקייה: אין מה לנקות */ }
}

// קורא גוף בקשה בינארי עד max בתים. { chunks, size, tooBig }: מעל המגבלה החיבור נסגר
function readUpTo(req, max) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0, tooBig = false;
    const done = () => resolve({ chunks, size, tooBig });
    req.on('data', (c) => { size += c.length; if (size > max) { tooBig = true; req.destroy(); done(); } else chunks.push(c); });
    req.on('end', done);
    req.on('error', done);
    req.on('close', done);
  });
}
const pasteStamp = () => { const d = new Date(), p2 = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`; };

function readBody(req, limit = 4096) {
  return new Promise((resolve) => {
    let b = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { b += c; if (b.length > limit) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  if (!hostOk(req)) { res.writeHead(403); return res.end('forbidden'); }
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/health') return json(res, 200, health.snapshot({ sessions: sessions.size, clients: clients.size, reset: url.searchParams.get('reset') === '1' }));
  if (url.pathname === '/api/settings') return json(res, 200, { settings: settingsStore.get(), schema: publicSchema() });
  if (url.pathname === '/api/info') {
    if (!hasClaude) hasClaude = findClaude(); // אם claude הותקן אחרי שהשרת עלה
    return json(res, 200, { home: os.homedir(), claude: hasClaude, clients: clients.size, version: VERSION, platform: plat.NAME, port: PORT, stateFile: STATE_FILE, settingsFile: SETTINGS_FILE });
  }
  // פתיחת טרמינל בתיקייה מסוימת מבחוץ (תפריט ימני, גרירה על הקיצור). חלונות פתוחים מקבלים אותו מיד.
  // דיווח מה-hooks של סוכן בזוג (פנוי / עסוק / מחכה להרשאה). רק מתהליך מקומי, כמו /api/open
  if (url.pathname === '/api/duo/event' && req.method === 'POST') {
    if (!localCallerOk(req)) return json(res, 403, { error: 'forbidden' });
    const back = duoManager.onHook(await readBody(req, 16384));
    return json(res, 200, { ok: true, ...(back || {}) }); // block: ה-hook של Stop של העובד מדפיס אותו ל-Claude, והעובד חוזר לעבודה
  }
  // דיווח מה-hooks של טרמינל Claude רגיל (עובד / מחכה להרשאה / סיים תור). כמו /api/duo/event: רק מתהליך מקומי
  if (url.pathname === '/api/agent/event' && req.method === 'POST') {
    if (!localCallerOk(req)) return json(res, 403, { error: 'forbidden' });
    return agentStatus.onEvent(await readBody(req, 16384)) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'unknown pane' });
  }
  // הדבקת תמונה (T45): הדפדפן קורא את התמונה מאירוע ההדבקה/הגרירה ושולח את הבייטים; השרת כותב קובץ זמני ועונה בנתיב, והלקוח מדביק את הנתיב לטרמינל
  // (כמו גרירת קובץ תמונה לטרמינל: Claude מצרף אותו מיד). רק לטרמינל Claude קיים, רק סוגי תמונה, מגבלת גודל, ושם הקובץ נבנה כאן (לא מהלקוח).
  if (url.pathname === '/api/paste-image' && req.method === 'POST') {
    if (!originOk(req)) return json(res, 403, { error: 'forbidden' });
    const s = sessions.get(String(url.searchParams.get('id') || ''));
    if (!s) { req.resume(); return json(res, 404, { error: 'unknown terminal' }); }
    if (s.exited) { req.resume(); return json(res, 400, { error: 'terminal exited' }); }
    const ext = PASTE_IMAGE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()];
    if (!ext) { req.resume(); return json(res, 415, { error: 'only png, jpeg, gif and webp images' }); }
    if (Number(req.headers['content-length']) > PASTE_IMAGE_MAX) { req.resume(); return json(res, 413, { error: 'image too large' }); }
    const { chunks, size, tooBig } = await readUpTo(req, PASTE_IMAGE_MAX);
    if (tooBig) { try { return json(res, 413, { error: 'image too large' }); } catch { return; } }
    if (!size) return json(res, 400, { error: 'empty body' });
    try {
      const dir = pasteDir();
      await fs.promises.mkdir(dir, { recursive: true });
      const stamp = pasteStamp();
      // שם הקובץ המקורי (אם יש) נכנס רק כמחרוזת ASCII בטוחה: Claude רואה שם מובן, ולא עובר שום נתיב מהלקוח
      const orig = String(url.searchParams.get('name') || '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
      const file = path.join(dir, `${stamp}-${crypto.randomBytes(3).toString('hex')}${orig ? '-' + orig : ''}.${ext}`);
      await fs.promises.writeFile(file, Buffer.concat(chunks), { flag: 'wx' });
      log('paste-image', s.id, size, 'bytes');
      return json(res, 200, { path: file, size });
    } catch (e) {
      log('paste-image failed', e.message);
      return json(res, 500, { error: 'could not save the image' });
    }
  }
  // הדבקת טקסט ארוך (T53): הטקסט לא עובר דרך ConPTY (15-20KB לשנייה): השרת שומר אותו כקובץ והלקוח מדביק שורת הפניה אחת. רק לטרמינל Claude קיים, טקסט בלבד
  // (UTF-8), עד 20MB (מעל זה 413 והלקוח מדביק את הטקסט עצמו), שורות מנורמלות ל-\n, בלי BOM, שם נבנה כאן, כתיבה אסינכרונית עם wx, אותה תיקייה ואותו ניקוי של 24 שעות
  // כמו תמונות. בלוג רק הגודל ושם הקובץ, אף פעם לא התוכן (יכול להיות סיסמה).
  if (url.pathname === '/api/paste-text' && req.method === 'POST') {
    if (!originOk(req)) return json(res, 403, { error: 'forbidden' });
    const s = sessions.get(String(url.searchParams.get('id') || ''));
    if (!s) { req.resume(); return json(res, 404, { error: 'unknown terminal' }); }
    if (s.kind !== 'claude' || s.exited) { req.resume(); return json(res, 400, { error: 'not a Claude terminal' }); }
    if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'text/plain') { req.resume(); return json(res, 415, { error: 'text/plain only' }); }
    if (Number(req.headers['content-length']) > PASTE_TEXT_MAX) { req.resume(); return json(res, 413, { error: 'text too large' }); }
    const { chunks, size, tooBig } = await readUpTo(req, PASTE_TEXT_MAX);
    if (tooBig) { try { return json(res, 413, { error: 'text too large' }); } catch { return; } }
    if (!size) return json(res, 400, { error: 'empty body' });
    try {
      const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
      const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
      const dir = pasteDir();
      await fs.promises.mkdir(dir, { recursive: true });
      const name = `text-${pasteStamp()}-${crypto.randomBytes(3).toString('hex')}.txt`;
      await fs.promises.writeFile(path.join(dir, name), text, { flag: 'wx' });
      log('paste-text', s.id, size, 'bytes', name);
      return json(res, 200, { path: path.join(dir, name), name, chars: [...text].length, lines });
    } catch (e) {
      log('paste-text failed', e.message);
      return json(res, 500, { error: 'could not save the text' });
    }
  }
  // "פתיחה בסייר הקבצים": רק לטרמינל קיים (לפי מזהה), ותמיד בתיקייה שלו. אף פעם לא נתיב שהגיע מהלקוח, ואין מחרוזת מעטפת
  if (url.pathname === '/api/reveal' && req.method === 'POST') {
    if (!originOk(req)) return json(res, 403, { error: 'forbidden' });
    const body = await readBody(req);
    const s = sessions.get(String(body.id));
    if (!s) return json(res, 404, { error: 'unknown terminal' });
    // T53: קובץ טקסט שנשמר מהדבקה: Explorer נפתח עם הקובץ מסומן. רק שם שהשרת בנה ורק אם הקובץ קיים בתיקיית ההדבקות, אף פעם לא נתיב מהלקוח
    let file = null;
    if (body.file != null) {
      const cand = path.join(pasteDir(), String(body.file));
      if (!PASTE_TEXT_NAME.test(String(body.file)) || !fs.existsSync(cand)) return json(res, 404, { error: 'unknown file' });
      file = cand;
    }
    if (process.env.TG_TEST_REVEAL_LOG) fs.appendFileSync(process.env.TG_TEST_REVEAL_LOG, JSON.stringify({ id: s.id, cwd: s.cwd, file }) + '\n'); // בדיקות: לא מפעילים את Explorer
    else plat.reveal(s.cwd, file);
    return json(res, 200, { ok: true });
  }
  // הפעלה אוטומטית עם Windows: GET = המצב האמיתי (קיים קיצור או לא); POST {enabled} יוצר/מוחק אותו ומשדר את ההגדרה לכל החלונות
  if (url.pathname === '/api/autostart') {
    if (!originOk(req)) return json(res, 403, { error: 'forbidden' });
    if (req.method === 'GET') return json(res, 200, { enabled: autostart.exists(), file: autostart.file() });
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled חייב להיות true או false' });
      try {
        if (body.enabled) await autostart.enable(); else autostart.disable();
      } catch (e) {
        return json(res, 500, { error: e.message || 'שגיאה בהפעלה האוטומטית', enabled: autostart.exists() });
      }
      broadcast({ t: 'settings', settings: settingsStore.get() });
      return json(res, 200, { enabled: autostart.exists(), file: autostart.file() });
    }
  }
  if (url.pathname === '/api/open' && req.method === 'POST') {
    if (!localCallerOk(req)) return json(res, 403, { error: 'forbidden' });
    const body = await readBody(req);
    try {
      const s = createSession({ kind: body.kind, cwd: body.cwd });
      broadcast({ t: 'created', reqId: null, focus: true, session: { ...meta(s), snapshot: '' } });
      return json(res, 200, { ok: true, id: s.id, clients: clients.size });
    } catch (e) {
      return json(res, 400, { error: e.message || 'failed' });
    }
  }
  if (url.pathname === '/api/claude-sessions' && req.method === 'POST') {
    if (!originOk(req)) return json(res, 403, { error: 'forbidden' });
    return json(res, 200, { sessions: (await listExternalClaude()).filter((x) => !x.inGrid) });
  }
  if (url.pathname === '/api/adopt' && req.method === 'POST') {
    if (!originOk(req)) return json(res, 403, { error: 'forbidden' });
    const body = await readBody(req);
    try {
      if (body.all) return json(res, 200, { ok: true, ...(await adoptAllClaude()) });
      const s = await adoptClaude(Number(body.pid), String(body.sessionId || ''));
      return json(res, 200, { ok: true, id: s.id });
    } catch (e) {
      return json(res, 400, { error: e.message || 'failed' });
    }
  }
  if (url.pathname === '/api/history' && req.method === 'POST') {
    if (!originOk(req)) return json(res, 403, { error: 'forbidden' });
    try { return json(res, 200, await listHistory()); } catch (e) {
      log('history error', e && e.stack || e);
      return json(res, 500, { error: 'failed' });
    }
  }
  if (url.pathname === '/api/pick-folder' && req.method === 'POST') {
    if (!originOk(req)) return json(res, 403, { error: 'forbidden' });
    const body = await readBody(req);
    return json(res, 200, { path: await pickFolder(body.start) });
  }

  const entry = STATIC[url.pathname] || publicEntry(url.pathname);
  if (!entry) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(entry[0], (err, buf) => {
    if (err) { res.writeHead(500); return res.end('read error'); }
    res.writeHead(200, {
      'content-type': entry[1],
      'cache-control': 'no-cache',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
    });
    res.end(buf);
  });
});

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info) => hostOk(info.req) && originOk(info.req),
});

// סגירת החלון = סגירת הכול. ממתינים כמה שניות כדי שרענון הדף או ניתוק רגעי לא יהרגו סוכנים,
// ואם אף חלון לא נפתח בכלל (למשל Chrome נתקע) לא משאירים שרת ותהליכים רצים ברקע.
// שינה של המחשב: החיבורים נופלים ברגע הכניסה לשינה, ובהתעוררות שעון הקיר קופץ קדימה בבת אחת.
// בלי ההגנה הזאת הבדיקה "עברו 10 שניות בלי חלון" יוצאת נכונה מיד ומוחקת את כל הטרמינלים
// לפני שהדף הספיק להתחבר מחדש. לכן קפיצת שעון מאפסת את הספירה ונותנת לדף זמן לחזור.
let everConnected = false;
let idleSince = Date.now();
let lastTick = Date.now();
let graceUntil = 0;
setInterval(() => {
  const now = Date.now();
  if (now - lastTick > 6000) {
    log('clock jump (sleep?), waiting for the window to reconnect');
    idleSince = 0;
    graceUntil = now + 120 * 1000;
    for (const c of clients) c.alive = true;
  }
  lastTick = now;
  // זוג סוכנים פעיל = עבודה לילית: לא סוגרים את השרת גם אם החלון נסגר (השהיה/מחיקה של הזוג מחזירות את הכלל הרגיל)
  if (KEEP_ALIVE || clients.size > 0 || (duoManager && duoManager.anyActive())) { idleSince = 0; return; }
  if (now < graceUntil) return;
  if (!idleSince) idleSince = now;
  const limit = everConnected ? 10 * 1000 : 60 * 1000;
  if (now - idleSince > limit) { log('no window left, closing everything'); shutdown(); }
}, 2000);

wss.on('connection', (ws) => {
  everConnected = true;
  const client = { ws, ready: false, pending: [], alive: true };
  clients.add(client);
  ws.on('pong', () => { client.alive = true; });
  ws.on('message', (raw) => onMessage(client, raw.toString()));
  ws.on('close', () => clients.delete(client));
  ws.on('error', () => clients.delete(client));

  buildList().then((list) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(list));
    client.ready = true;
    for (const str of client.pending) ws.send(str);
    client.pending = [];
  });
});

setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch { /* ignore */ }
  }
}, 30000);

server.on('error', (e) => {
  log('server error', e.message);
  if (e.code === 'EADDRINUSE') {
    console.error(`הפורט ${PORT} כבר תפוס — כנראה שהשרת כבר רץ.`);
    process.exit(0);
  }
});

cleanPasteDir();
setInterval(cleanPasteDir, 60 * 60 * 1000).unref();
server.listen(PORT, HOST, () => {
  log('listening', `${HOST}:${PORT}`);
  console.log(`Terminal Grid: http://${HOST}:${PORT}/`);
  restoreState().catch((e) => { restoring = false; log('restore error', e && e.stack || e); });
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
