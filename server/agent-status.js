'use strict';
/*
 * סטטוס סוכן מדויק מה-hooks של Claude Code, לכל טרמינל Claude רגיל (לא של זוג סוכנים: אלה עוברים דרך server/duo).
 * במקום לנחש "עובד / מחכה" לפי תזמון הפלט והפעמון, Claude Code עצמו מדווח: כל טרמינל מקבל קובץ הגדרות נוסף (--settings, לא נוגע
 * בהגדרות של המשתמש) עם ארבעה hooks שמפעילים את server/duo/hook-cli.js, והוא שולח POST ל-/api/agent/event.
 *
 * ה-hooks שמטופלים (שמות האירועים של Claude Code, ובסוגריים מה ש-hook-cli שולח):
 *   SessionStart (start)       השיחה התחילה, נמשכה (resume), נוקתה (clear) או נדחסה (compact)
 *   UserPromptSubmit (submit)  המשתמש שלח הודעה: הסוכן עובד
 *   Stop (stop)                הסוכן סיים תור ומחכה להודעה הבאה
 *   Notification (notify)      התראה; רק permission_prompt ו-elicitation_dialog (או הודעה שמזכירה permission) הופכות ל"דורש תשומת לב"
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK_CLI = path.join(__dirname, 'duo', 'hook-cli.js').replace(/\\/g, '/');
const root = () => path.join(os.tmpdir(), 'tg-agents');

const STATES = ['starting', 'idle', 'working', 'done', 'attention', 'exited'];
const ATTENTION_TYPES = new Set(['permission_prompt', 'elicitation_dialog']);

const isAttention = (ev) => ATTENTION_TYPES.has(ev.notificationType) || (typeof ev.message === 'string' && /permission/i.test(ev.message));

/**
 * מכונת המצבים (פונקציה טהורה): מצב נוכחי + אירוע -> המצב הבא.
 *   starting -> idle (SessionStart) -> working (UserPromptSubmit) -> done (Stop) -> working ...
 *   attention: Notification של בקשת הרשאה; מתנקה בהודעה הבאה (working) או בסיום התור (done)
 *   exited: סופי (התהליך יצא)
 * @param {string} cur  אחד מ-STATES
 * @param {{event: string, notificationType?: string, message?: string, source?: string}} ev  event הוא start | submit | stop | notify | exit
 */
function nextState(cur, ev) {
  if (cur === 'exited') return 'exited';
  switch (ev && ev.event) {
    case 'exit': return 'exited';
    case 'start':
      // דחיסה באמצע תור (compact) לא מפסיקה את העבודה
      return cur === 'working' && ev.source === 'compact' ? 'working' : 'idle';
    case 'submit': return 'working';
    case 'stop': return 'done';
    case 'notify': return isAttention(ev) ? 'attention' : cur;
    default: return cur;
  }
}

/** קובץ ההגדרות עם ארבעת ה-hooks לשיחה אחת. מחזיר את הנתיב, או null כשהכתיבה נכשלה (אז הטרמינל נפתח בלי hooks). */
function writeHookSettings(claudeId, { log } = {}) {
  try {
    const dir = root();
    fs.mkdirSync(dir, { recursive: true });
    // הצורה `node "<נתיב>" <אירוע>` היא היחידה שמתפרשת נכון בכל הקליפות (bash, cmd ו-PowerShell: פקודה שמתחילה במחרוזת במרכאות היא שגיאת תחביר
    // ב-PowerShell), והיא אותה צורה שמשמשת את זוגות הסוכנים. אין דרך להקיף נתיב של תוכנית במרכאות שעובדת בכולן, לכן node חשוף ותלוי ב-PATH (נבדק בהפעלה)
    const cmd = (event) => ({ hooks: [{ type: 'command', command: `node "${HOOK_CLI}" ${event}` }] });
    const settings = { hooks: { SessionStart: [cmd('start')], UserPromptSubmit: [cmd('submit')], Stop: [cmd('stop')], Notification: [cmd('notify')] } };
    const file = path.join(dir, `${claudeId}.settings.json`);
    // הנתיב נכנס לשורת פקודה של PowerShell בתוך מרכאות כפולות: תווים ש-PowerShell מפרש שם (דולר, גרש הפוך, מרכאות) פירושם טרמינל בלי hooks, לא שורה שבורה
    if (/["$`]/.test(file)) throw new Error('unsafe characters in the temp path: ' + file);
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    return file;
  } catch (e) {
    if (log) log('agent hooks settings failed', e.message);
    return null;
  }
}

/**
 * בהפעלת השרת: האם `node` נמצא ב-PATH שהטרמינלים יורשים. בלי זה כל hook נכשל בשקט (והסטטוס חוזר להיגיון הישן), ולכן כותבים אזהרה ברורה ליומן.
 * @returns {boolean}
 */
function checkNodeOnPath(log, env = process.env) {
  let ok = false;
  ok = require('./platform').findCommand('node', env);
  if (!ok && log) log('WARNING: node is not on the PATH of the terminals; Claude hooks (agent status) and agent pairs cannot run hook-cli.js');
  return ok;
}

/** ה-hooks שנכתבו לטרמינל Claude שנפתח, אפשר לבדוק אותם מהבדיקות */
const hookSettingsPath = (claudeId) => path.join(root(), `${claudeId}.settings.json`);

/**
 * מצב הסוכן של כל הטרמינלים. host = { sessions: Map, broadcast(obj), log(...) }.
 * שדות על ה-session: agentState, agentSince, agentSource ('hooks' אחרי האירוע הראשון, אחרת 'heuristic': הלקוח ממשיך עם ההיגיון הישן),
 * agentLast ({transcriptPath, source}: למשימות עתידיות).
 */
function createAgentStatus(host) {
  /** טרמינל Claude שנפתח עם hooks: מתחיל ב-starting (עדיין heuristic עד שמגיע אירוע) */
  function track(s) {
    s.agentState = 'starting';
    s.agentSince = Date.now();
    s.agentSource = 'heuristic';
  }

  /** @returns {boolean} האם הטרמינל מוכר (אחרת ה-endpoint מחזיר שגיאה) */
  function onEvent(body) {
    const s = body && host.sessions.get(String(body.paneId || ''));
    if (!s || s.kind !== 'claude' || s.tag || s.agentSource == null) return false;
    const event = String(body.event || '');
    if (!['start', 'submit', 'stop', 'notify'].includes(event)) return false;
    s.agentSource = 'hooks';
    s.agentLast = { transcriptPath: typeof body.transcriptPath === 'string' ? body.transcriptPath.slice(0, 500) : undefined, source: body.source };
    const state = nextState(s.agentState, { event, notificationType: body.notificationType, message: body.message, source: body.source });
    set(s, state, true);
    return true;
  }

  // publish: גם כשהמצב לא השתנה מודיעים כשהמקור הפך ל-hooks בפעם הראשונה (הלקוח עובר מההיגיון הישן אל hooks)
  function set(s, state, publish) {
    const changed = state !== s.agentState;
    if (changed) { s.agentState = state; s.agentSince = Date.now(); }
    if (changed || (publish && !s.agentAnnounced)) {
      s.agentAnnounced = true;
      host.broadcast({ t: 'agent', id: s.id, state: s.agentState, since: s.agentSince, source: s.agentSource });
    }
  }

  /** התהליך יצא */
  function onExit(s) {
    if (s.agentSource == null) return;
    set(s, nextState(s.agentState, { event: 'exit' }), true);
  }

  return { track, onEvent, onExit };
}

module.exports = { STATES, nextState, writeHookSettings, hookSettingsPath, checkNodeOnPath, createAgentStatus };
