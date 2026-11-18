'use strict';
/*
 * מנהל זוגות הסוכנים: רישום, יצירה, שחזור אחרי הפעלה מחדש, טיפול בהודעות מהממשק ו-hooks מהסוכנים.
 * הוא לא מכיר את פרטי השרת: הכול דרך ה-host שמוזרק (ראו server.js), וזה מה שמאפשר לבדוק אותו בנפרד.
 *
 * host = { createSession(opts)->session, closeSession(id), writeInput(id,data), sessions:Map, broadcast(obj), announce(session),
 *          sendTo(client,obj), persist(), log(...), port, transcriptExists(claudeId) }
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Duo } = require('./duo');
const { writeAgentFiles, buildCommand } = require('./agent-files');
const { PROMPT_VERSION } = require('./protocol');
const keepawake = require('./keepawake');

const MODES = ['auto', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'manual', 'plan'];
const EMIT_DELAY_MS = 150;
const MAX_CLOSED = 30;

function createDuoManager(host) {
  const duos = new Map();
  const dirty = new Set();
  const closed = []; // זוגות שנסגרו וניתנים לשחזור (חדש ראשון, עד MAX_CLOSED): toJSON() של הזוג, זמן הסגירה והתקדמות. נשמרים ב-state.json
  let emitTimer = null;

  const anyActive = () => [...duos.values()].some((d) => d.active);
  function syncKeepAwake() {
    if (anyActive()) keepawake.start(host.log); else keepawake.stop(host.log);
  }

  // מצב אחד לסוכן בזוג (T43): המצב מה-hooks של הזוג (starting | idle | working | attention | exited) הוא גם המצב של הטרמינל שלו. הוא נשמר על הסשן ומשודר באותה הודעה 'agent' שבה
  // משתמשים טרמינלי Claude רגילים, ולכן כותרת הפאן, כרטיס הסוכן בלוח, הנקודה בלשונית והסיכום בסרגל מסכימים תמיד (לא עוד ניחוש לפי תזמון פלט בפאן)
  function syncAgentPanes(duo) {
    for (const a of Object.values(duo.agents)) {
      const s = a.sessionId && host.sessions.get(a.sessionId);
      if (!s) continue;
      const pending = duo.pendingShown(a); // רק הוראה שמוחזקת כבר כמה שניות (T65), כמו בתמונת המצב
      const changed = s.agentState !== a.state || !!s.agentPending !== pending;
      s.agentState = a.state; s.agentSince = a.since; s.agentSource = 'hooks'; s.agentPending = pending;
      if (changed || !s.agentAnnounced) { s.agentAnnounced = true; host.broadcast({ t: 'agent', id: s.id, state: a.state, since: a.since, source: 'hooks', pending }); }
    }
  }

  // עדכוני מצב לממשק מאוחדים, כדי שעשרות אירועים בשנייה לא יציפו אותו
  function emit(duo) {
    dirty.add(duo.id);
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      for (const id of dirty) { const d = duos.get(id); if (d) { host.broadcast({ t: 'duo', op: 'state', duo: d.snapshot() }); syncAgentPanes(d); } }
      dirty.clear();
    }, EMIT_DELAY_MS);
  }

  const api = {
    startAgent(duo, role, resumeClaudeId) {
      const { settingsFile, promptFile } = writeAgentFiles(duo.id, role);
      const canResume = !!resumeClaudeId && host.transcriptExists(resumeClaudeId);
      const claudeId = resumeClaudeId || crypto.randomUUID();
      const command = buildCommand({
        role, settingsFile, promptFile, permissionMode: duo.permissionMode,
        resumeId: canResume ? claudeId : null, sessionId: canResume ? null : claudeId,
      });
      const s = host.createSession({
        kind: 'claude', cwd: duo.project, name: role === 'architect' ? 'ארכיטקט' : 'עובד', command, claudeId,
        env: { TG_DUO_ID: duo.id, TG_DUO_ROLE: role, TG_PORT: String(host.port) }, tag: { duoId: duo.id, role },
      });
      s.promptVersion = PROMPT_VERSION; // T64: הסוכן הזה התחיל עם הוראות שמכירות את הסמנים (סוכן שהתחיל לפני כן ימשיך לקבל את הטקסט הארוך)
    host.announce(s); // הלקוחות הפתוחים צריכים לדעת שנוצר טרמינל חדש
      return { sessionId: s.id, claudeId };
    },
    closeSession: (id) => host.closeSession(id),
    // טיוטה של המשתמש (T62): האם יש הודעה לא שלוחה בתיבת הקלט של הסוכן, מסך התיבה, ומנעול שמחזיק את ההקשות בזמן החלפת טיוטה
    draftState: (id) => (host.draftState ? host.draftState(id) : null),
    screenState: (id) => (host.screenState ? host.screenState(id) : null),
    screenText: (id) => (host.screenText ? host.screenText(id) : ''),
    lockHuman: (id, on) => { if (host.lockHuman) host.lockHuman(id, on); },
    writeInput: (id, data) => host.writeInput(id, data),
    promptVersionOf: (id) => { const s = host.sessions.get(id); return s ? (s.promptVersion || 1) : PROMPT_VERSION; },
    lastOutputAt: (id) => { const s = host.sessions.get(id); return s ? s.lastOutAt || 0 : 0; }, // מתי הטרמינל הדפיס לאחרונה: סוכן שמדפיס עובד, גם אם ה-hook של submit לא הגיע
    claudeIdOf: (id) => { const s = host.sessions.get(id); return s ? s.claudeId : null; },
    // /clear (של המשתמש) נותן לשיחה מזהה חדש: ה-resume אחרי הפעלה מחדש חייב להשתמש בו
    setClaudeId: (id, claudeId) => { const s = host.sessions.get(id); if (s && claudeId) s.claudeId = claudeId; },
    trustAccepted: (id) => { const s = host.sessions.get(id); return !!(s && s.trustAccepted); }, // אושר אמון בתיקייה אוטומטית: לא מתריעים "עוד לא התחיל"
    emit,
    persist: () => { syncKeepAwake(); host.persist(); },
    log: host.log,
  };

  function create({ project, goal, permissionMode }) {
    const dir = path.resolve(String(project || ''));
    let ok = false;
    try { ok = fs.statSync(dir).isDirectory(); } catch { /* not found */ }
    if (!ok) throw new Error(`התיקייה לא נמצאה: ${dir}`);
    const duo = new Duo({ id: crypto.randomBytes(4).toString('hex'), project: dir, goal, permissionMode: MODES.includes(permissionMode) ? permissionMode : 'auto' }, api);
    duos.set(duo.id, duo);
    try { duo.start(false); } catch (e) { duos.delete(duo.id); duo.close(); throw e; }
    host.log('duo create', duo.id, dir);
    api.persist();
    return duo;
  }

  function remove(id) {
    const duo = duos.get(id);
    if (!duo) return;
    let entry = null;
    try { const c = duo.snapshot().tasks; entry = { ...duo.toJSON(), paused: true, closedAt: Date.now(), done: c.counts.done, total: c.total }; } catch { /* the pair is still closed without a way back */ }
    duo.close();
    duos.delete(id);
    if (entry) { closed.unshift(entry); closed.length = Math.min(closed.length, MAX_CLOSED); }
    host.log('duo remove', id);
    host.broadcast({ t: 'duo', op: 'removed', id });
    broadcastClosed();
    api.persist();
  }

  const closedView = () => closed.map((c) => ({ id: c.id, name: c.name || null, project: c.project, closedAt: c.closedAt, done: c.done || 0, total: c.total || 0 }));
  const broadcastClosed = () => host.broadcast({ t: 'duo', op: 'closed', list: closedView() });

  /** שחזור זוג שנסגר: אותו מזהה, אותן שיחות של הסוכנים (resume) והמשימות שבקבצי .duo. חוזר מושהה, כדי שלא יתחיל לעבוד מעצמו */
  function reopen(closedId) {
    const i = closed.findIndex((c) => c.id === closedId);
    if (i < 0) throw new Error('הזוג כבר לא ברשימת הנסגרים');
    const cfg = closed[i];
    if (duos.has(cfg.id)) cfg.id = crypto.randomBytes(4).toString('hex');
    const duo = new Duo({ ...cfg, paused: true }, api);
    duos.set(duo.id, duo);
    try { duo.start(true); } catch (e) { duos.delete(duo.id); duo.close(); throw e; }
    closed.splice(i, 1);
    host.log('duo reopen', duo.id, duo.project);
    broadcastClosed();
    api.persist();
    return duo;
  }

  /** שחזור אחרי הפעלה מחדש של השרת: אותם סוכנים, באותה נקודה (resume), ואותו מצב השהיה */
  function restore(list) {
    for (const cfg of Array.isArray(list) ? list : []) {
      try {
        const duo = new Duo(cfg, api);
        duos.set(duo.id, duo);
        duo.start(true);
        host.log('duo restore', duo.id, duo.project);
      } catch (e) { host.log('duo restore failed', cfg && cfg.project, e.message); }
    }
    syncKeepAwake();
  }

  // סדר הזוגות (T46): הסדר של duos הוא סדר הלשוניות, תפריט הצד והשמירה (state.json). רק מזהים קיימים; מה שלא הוזכר נשאר בסוף בסדר הקודם
  function reorder(ids) {
    if (!Array.isArray(ids)) throw new Error('סדר לא תקין');
    const wanted = [...new Set(ids.map(String))].filter((id) => duos.has(id));
    const rest = [...duos.keys()].filter((id) => !wanted.includes(id));
    const next = [...wanted, ...rest];
    if (next.every((id, i) => id === [...duos.keys()][i])) return;
    const copy = new Map(next.map((id) => [id, duos.get(id)]));
    duos.clear();
    for (const [id, d] of copy) duos.set(id, d);
    host.broadcast({ t: 'duo', op: 'order', ids: next });
    host.persist();
  }

  /** מחזיר את מה ש-hook-cli צריך לדעת (כרגע: { block } לעצירה של העובד כשנשארו משימות), או null */
  function onHook(body) {
    const duo = body && duos.get(body.duoId);
    if (!duo) return null;
    const back = duo.onHook(body.role, body.event, body);
    const a = duo.agents[body.role];
    if (a && a.sessionId && host.markStarted) host.markStarted(a.sessionId); // T41: הסוכן עלה, השכבה "מכין..." יכולה לרדת
    return back;
  }

  /** טרמינל של סוכן נסגר (התהליך יצא או שהמשתמש סגר את הלשונית) */
  function onSessionGone(sessionId) {
    for (const duo of duos.values()) {
      for (const [role, a] of Object.entries(duo.agents)) if (a.sessionId === sessionId) duo.onSessionExit(role);
    }
  }

  /** המשתמש שלח או ניקה את התיבה של סוכן (T62): הוראה ממתינה נבדקת מיד, בלי לחכות לבדיקה הבאה */
  function onUserInput(sessionId) {
    for (const duo of duos.values()) {
      for (const [role, a] of Object.entries(duo.agents)) if (a.sessionId === sessionId && a.pending) duo.checkPending(role);
    }
  }

  function handleMessage(client, m) {
    const duo = m.duoId ? duos.get(String(m.duoId)) : null;
    try {
      switch (m.op) {
        case 'create': {
          const d = create(m);
          host.sendTo(client, { t: 'duo', op: 'created', duoId: d.id, reqId: m.reqId });
          break;
        }
        case 'pause': if (duo) duo.pause(); break;
        case 'resume': if (duo) duo.resume(); break;
        case 'say': if (duo) duo.say(m.text); break;
        case 'wake': if (duo) duo.wakeNow(m.role); break;
        case 'close': remove(String(m.duoId)); break;
        case 'reopen': { const d = reopen(String(m.closedId)); host.sendTo(client, { t: 'duo', op: 'created', duoId: d.id, reqId: m.reqId }); break; }
        case 'reorder': reorder(m.ids); break;
        case 'rename': if (duo) duo.rename(m.name); break; // T56: שם הזוג (ארכיטקט/עובד קבועים)
        case 'restartAgent': {
          // סוכן שנסגר (T51): רק הוא, ורק כשהוא באמת במצב נסגר
          if (!duo) throw new Error('הזוג לא נמצא');
          if (!duo.restartAgent(String(m.role))) throw new Error('אפשר להפעיל מחדש רק סוכן שנסגר');
          host.log('duo restartAgent', duo.id, m.role);
          break;
        }
        default:
      }
    } catch (e) {
      host.sendTo(client, { t: 'error', reqId: m.reqId, message: e.message || 'שגיאה בזוג הסוכנים' });
    }
  }

  return {
    create, remove, restore, reopen, closedView, onHook, onSessionGone, onUserInput, handleMessage, anyActive,
    snapshots: () => [...duos.values()].map((d) => d.snapshot()),
    saved: () => [...duos.values()].map((d) => d.toJSON()),
    savedClosed: () => closed,
    restoreClosed(list) { closed.length = 0; for (const c of Array.isArray(list) ? list : []) if (c && c.id && c.project) closed.push(c); closed.length = Math.min(closed.length, MAX_CLOSED); },
    sessionIds: () => new Set([...duos.values()].flatMap((d) => Object.values(d.agents).map((a) => a.sessionId))),
    shutdown() { for (const d of duos.values()) { d.stopped = true; if (d.watcher) d.watcher.close(); } keepawake.stop(host.log); },
  };
}

module.exports = { createDuoManager };
