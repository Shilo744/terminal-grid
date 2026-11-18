'use strict';
/*
 * זוג סוכנים אחד: ארכיטקט + עובד על פרויקט אחד, בפרוטוקול 2 (T78): תור משימות בלי שיחה בין הסוכנים (הפרטים ב-protocol.js וב-queue.js).
 *
 * מתי מעירים מי (כל ההחלטות לפי תוכן הקבצים, אף פעם לא לפי שעון או ניחוש מהמסך):
 *   עובד:    המטרה שלו אחת: להשלים את כל המשימות הפתוחות ב-TASKS.md. כשהוא פנוי ויש משימות פתוחות (והארכיטקט סיים לכתוב) השרת מזריק לו את המטרה פעם אחת;
 *            מאז ה-hook של Stop מחזיר אותו לעבודה כל עוד נשארו משימות (גם כאלה שהארכיטקט הוסיף תוך כדי), ורק כשהתור ריק מותר לו לעצור.
 *            כשהוא מסמן [x] עם Result (או [!] עם סיבה), המשימה עוברת לארכיון והקובץ מכיל רק מה שנשאר. הוא רואה את כל התור ולכן יודע מה צפוי; ההקשר שלו לא מנוקה בין משימות.
 *            אם נעצר בלי להתקדם: מתריעים ומעירים אותו שוב עם המתנה הולכת וגדלה.
 *   ארכיטקט: מתעורר רק על הודעת משתמש או הפעלה מחדש של השרת. הכול דרך INBOX-architect.md.
 *   "פנוי / עסוק" נקבע מ-hooks של Claude (SessionStart / UserPromptSubmit / Stop), לא מהמסך.
 *
 * שום דבר לא נעצר מעצמו: רק המשתמש משהה/עוצר. מצבים חריגים (הסוכן לא מתקדם, הרשאה ממתינה, הסוכן נסגר) מופיעים כהתראות.
 */
const fs = require('fs');
const path = require('path');
const files = require('./files');
const queue = require('./queue');
const { parseTasks, taskBlocks, sha } = require('./tasks');
const usageOf = require('./usage');
const { WAKE, WAKE_LONG, PROMPT_VERSION, goalMessage, stopReason } = require('./protocol');

const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;
const SUBMIT_TIMEOUT_MS = Number(process.env.TG_TEST_SUBMIT_TIMEOUT_MS) || 20 * 1000; // (TG_TEST_*: רק לבדיקות, כדי לא לחכות דקות)
const MAX_ALERTS = 20;
const MAX_EVENTS = 60;
const MAX_TECH = 40;

// התראות רק כשיש למשתמש מה לעשות (T65; הטבלה המלאה ב-docs/duo-alerts.md). תקלות פנימיות שמתאוששות לבד נרשמות ביומן השרת וב"פרטים טכניים", ומקודמות להתראה רק על התמדה:
const NOTRECEIVED_PROMOTE_COUNT = 3;                  // "ההוראה לא התקבלה" שלוש פעמים ברצף לאותו סוכן...
const NOTRECEIVED_PROMOTE_MS = 5 * 60 * 1000;         // ...או חמש דקות בלי תשובה אחת
const STOP_BLOCKS_NO_PROGRESS = Number(process.env.TG_TEST_STOP_BLOCKS) || 3;   // כמה פעמים ברצף ה-hook של Stop מחזיר את העובד לעבודה בלי שהתור השתנה בכלל, לפני שנותנים לו לעצור
const ARCH_WRITING_MAX_MS = Number(process.env.TG_TEST_ARCH_WRITING_MS) || 15 * 60 * 1000; // הארכיטקט באמצע תור: העובד מחכה שיסיים לכתוב משימות, ולכל היותר כל כך הרבה זמן
const OUTPUT_BUSY_MS = 4000;                          // טרמינל שהדפיס משהו בארבע השניות האחרונות עובד (גם אם ה-hook של submit לא הגיע)... אבל רק פלט שהגיע זמן מה אחרי ההזרקה (ההד של ההדבקה עצמה לא נחשב)
const FIRST_RETRY_MS = Number(process.env.TG_TEST_RETRY_MS) || 8 * 1000;                      // כישלון ראשון הוא כמעט תמיד תקלת הפעלה: ניסיון חוזר מהיר; אחר כך דקה
const BOOT_SETTLE_MS = Number(process.env.TG_TEST_BOOT_SETTLE_MS) || 2500; // אחרי SessionStart ההוראה הראשונה מחכה רגע: תיבת הקלט של Claude עוד לא בהכרח מקבלת (T65)
const PENDING_SHOW_MS = Number(process.env.TG_TEST_PENDING_SHOW_MS) || 10 * 1000; // "הודעה ממתינה" (T62) מוצגת רק אחרי שהוראה מחכה כבר כמה שניות

// טיוטה של המשתמש בתיבת הקלט של הסוכן (T62): server/draft.js יודע אם יש אחת
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const STASH_KEY = '\x13';                       // Ctrl+S ב-Claude Code: מזיז את הטיוטה הצידה; היא חוזרת לבד בשליחה הבאה (נבדק ידנית, v2.1.301)
const SWAP_DRAFTS = true;                        // מתג אחד: false = בכל טיוטה רק ממתינים (בלי Ctrl+S)
const DRAFT_CHECK_MS = Number(process.env.TG_TEST_DRAFT_CHECK_MS) || 2000;                     // כל כמה זמן בודקים הוראה ממתינה (וגם מיד כשהמשתמש שלח או ניקה)
const TYPING_MAX_MS = 30 * 1000;                 // ממתינים להפסקה בהקלדה עד 30 שניות רצופות; אחרי זה פועלים לפי הטיוטה
const DRAFT_ABANDONED_MS = Number(process.env.TG_TEST_DRAFT_ABANDONED_MS) || 10 * 60 * 1000; // טיוטה שלא נגעו בה 10 דקות היא נטושה (TG_TEST_DRAFT_ABANDONED_MS: בדיקות בלבד): זוג שרץ בלילה לא נתקע בגלל חצי משפט שנשכח
const MAX_USER_QUEUE = 20;
const STASH_CONFIRM_MS = 700;                   // כמה מחכים שהמסך יאשר "stashed" לפני שמוותרים (בלי אישור לא שולחים כלום)
const RESTORE_WAIT_MS = 1500;                    // כמה מחכים ש-Claude יחזיר את הטיוטה אחרי השליחה

const newAgent = (role) => ({
  role, sessionId: null, claudeId: null, state: 'starting', since: Date.now(), wakes: 0, lastWakeAt: 0, lastStopAt: 0,
  pendingUsers: [],     // ארכיטקט: הודעות משתמש שעוד לא נמסרו לו ({ t, text }); נשמרות בהפעלה מחדש
  feedSig: '',          // עובד: חתימת התור בהזרקה האחרונה ובעצירה האחרונה (כדי לזהות התקדמות)
  baseline: {},         // עובד: משימות פתוחות שהיו בתיקייה כשהזוג נוצר (היסטוריה: לא מוזנות כל עוד לא השתנו; T72)
  noProgress: 0, nextEligibleAt: 0, submitTimer: null, submitSeen: false,
  wasWorking: false,    // נשמר: האם היה באמצע תור בשמירה האחרונה (אחרי הפעלה מחדש של השרת מעירים אותו שוב)
  pending: null,        // הוראה שממתינה כי המשתמש כותב לסוכן (T62): { since, text, manual, commit, needed }
  heldSince: 0,         // מאז מתי ההוראה הנוכחית מוחזקת (T65: "הודעה ממתינה" מוצגת רק אחרי כמה שניות, גם דרך ניסיונות החלפה שנכשלו)
  swapping: false,      // החלפת טיוטה רצה עכשיו (T62)
  startedAt: 0,         // מתי הגיע ה-SessionStart האחרון (T65)
  missed: 0, missedSince: 0, // "ההוראה לא התקבלה" ברצף ומאז מתי (T65)
  stuckSince: 0,        // מאז מתי העובד נעצר בלי התקדמות (T65)
  swapFails: 0,         // כמה פעמים ברצף החלפת טיוטה לא אושרה (אחרי 2: רק ממתינים)
  restartWake: false,   // ארכיטקט: מעירים אותו פעם אחת עם הסיבה "השרת הופעל מחדש" כשה-SessionStart שלו מגיע
  diedWorking: false,   // נסגר באמצע תור (T51): אחרי הפעלה מחדש ידנית של הארכיטקט הוא מתעורר פעם אחת, כמו אחרי הפעלה מחדש של השרת
  startTimer: null,     // בדיקת "עוד לא התחיל" של הפעלה מחדש (T51)
});

class Duo {
  /**
   * @param {object} cfg { id, project, goal, permissionMode, paused, createdAt, agents:{role:{claudeId,seenOthers,...}} }
   * @param {object} api  { startAgent(duo, role, resume) -> {sessionId, claudeId}, closeSession(id), writeInput(id,data),
   *                        claudeIdOf(sessionId), emit(duo), persist(), log(...), now() }
   */
  constructor(cfg, api) {
    this.api = api;
    this.id = cfg.id;
    this.project = cfg.project;
    this.goal = cfg.goal || '';
    this.permissionMode = cfg.permissionMode || 'auto';
    this.paused = !!cfg.paused;
    this.stopped = false;
    this.createdAt = cfg.createdAt || Date.now();
    this.usage = null; this.usageAt = 0; this.usageBusy = false; // tokens and estimated cost from the Claude logs of the project (usage.js)
    this.name = typeof cfg.name === 'string' ? cfg.name : ''; // שם מותאם לזוג (T56); ריק = שם תיקיית הפרויקט
    this.agents = { architect: newAgent('architect'), worker: newAgent('worker') };
    for (const role of Object.keys(this.agents)) Object.assign(this.agents[role], pickSaved(cfg.agents && cfg.agents[role]));
    this.alerts = [];
    this.events = [];
    this.techEvents = [];
    this.paths = null;
    this.watcher = null;
    this.evalTimer = null;
    this.evaluating = false;
    this.draftTimer = null;
  }

  /* ---------- חיים ---------- */

  /** @param {boolean} restoring true כשמשחזרים אחרי הפעלה מחדש של השרת (לא כותבים שוב את המטרה לשיחה) */
  start(restoring = false) {
    this.paths = queue.ensure(this.project); // זוג מגרסה 1 עובר כאן את המעבר החד-פעמי (ארכיון + גיבוי)
    this.st = queue.readStatus(this.project);
    if (restoring) {
      // אחרי הפעלה מחדש (או כיבוי של המחשב) מי שהיה באמצע עבודה ממשיך, גם אם הקבצים לא השתנו: אחרת הזוג היה יושב ובטל עד שמישהו עורך קובץ.
      // העובד: כשה-SessionStart שלו מגיע ויש משימות פתוחות הוא מקבל שוב את המטרה ("Continue your goal"). הארכיטקט: אם היה באמצע תור. זוג מושהה נשאר מושהה (evaluate לא רץ).
      if (this.agents.architect.wasWorking) this.agents.architect.restartWake = true;
    }
    for (const role of Object.keys(this.agents)) {
      const a = this.agents[role];
      const r = this.api.startAgent(this, role, restoring ? a.claudeId : null);
      a.sessionId = r.sessionId;
      a.claudeId = r.claudeId;
      a.state = 'starting';
      a.since = Date.now();
    }
    if (!restoring) {
      // זוג חדש (T72): משימות פתוחות שכבר כתובות בתיקייה (למשל .duo שנשאר מזוג קודם) הן היסטוריה ולא "חדש": בלעדיהן העובד
      // היה מתחיל בעצמו על משימות ישנות, בלי שהמשתמש עשה משהו. הן נרשמות כבסיס ולא מוזנות כל עוד לא השתנו; רק מה שיגיע אחרי היצירה (המטרה, הודעה, משימה חדשה או ששונתה) מעיר.
      for (const b of taskBlocks(files.read(this.paths.tasks))) if (b.status === 'todo' || b.status === 'doing') this.agents.worker.baseline[b.key] = sha(b.raw);
      if (this.goal) this.userSays(this.goal);
    }
    this.watcher = files.watch(this.project, () => this.evaluate());
    // תיקייה שעוד לא אושרה ל-Claude עוצרת בשאלת אמון בטרמינל, וההוראות לא יכולות להיכנס לפני שעונים עליה
    this.startTimer = this.checkStarted(Object.keys(this.agents));
    this.event(null, restoring ? 'הזוג שוחזר' : 'הזוג התחיל');
    this.emit();
  }

  /** אחרי 25 שניות, סוכן שעוד "מתחיל" כנראה תקוע (בדרך כלל על שאלת אמון שלא אושרה): התראה. מחזיר את הטיימר */
  checkStarted(roles) {
    const h = setTimeout(() => {
      if (this.stopped) return;
      for (const role of roles) {
        const a = this.agents[role];
        if (a.state === 'starting' && !(this.api.trustAccepted && this.api.trustAccepted(a.sessionId))) this.alert('warn', `${label(role)} עוד לא התחיל. ייתכן שצריך לאשר "לסמוך על התיקייה" בטרמינל שלו`, 'nostart:' + role, [{ type: 'open', role }]);
      }
      this.emit();
    }, 25000);
    if (h.unref) h.unref();
    return h;
  }

  /**
   * הפעלה מחדש של סוכן שנסגר (T51): אותו תפקיד ואותה שיחה (claudeId: --resume כשיש שיחה שמורה, אחרת --session-id), באותו מקום בזוג, עם אותם hooks והגדרות.
   * מחזיר false כשאין מה להפעיל (תפקיד לא מוכר, הסוכן לא נסגר, או שהזוג נסגר): אף פעם לא נוגעים בסוכן חי.
   */
  restartAgent(role) {
    const a = this.agents[role];
    if (!a || this.stopped || a.state !== 'exited') return false;
    const old = a.sessionId;
    a.sessionId = null; // לפני הסגירה: אחרת סגירת הסשן הישן מדווחת על הסוכן שוב כ"נסגר"
    if (old) this.api.closeSession(old); // הישן קודם: אחרת resume מסרב ("השיחה כבר פתוחה"); אם כבר נסגר, אין מה לעשות
    clearTimeout(a.submitTimer); clearTimeout(a.startTimer);
    const r = this.api.startAgent(this, role, a.claudeId);
    a.sessionId = r.sessionId; a.claudeId = r.claudeId;
    a.state = 'starting'; a.since = Date.now(); a.submitSeen = false; a.nextEligibleAt = 0;
    if (role === 'worker') {
      a.noProgress = 0; // יש משימות פתוחות: המטרה מוזנת שוב כשה-SessionStart מגיע
    } else if (a.diedWorking) a.restartWake = true;
    a.diedWorking = false;
    this.resolve('closed:' + role); // הבעיה נגמרה; אם הסוכן לא יעלה, תעלה התראה "לא התחיל" משלה
    this.event(role, 'הופעל מחדש');
    a.startTimer = this.checkStarted([role]);
    this.api.persist();
    this.emit();
    return true;
  }

  close() {
    this.stopped = true;
    clearTimeout(this.evalTimer);
    clearTimeout(this.startTimer);
    if (this.draftTimer) { clearInterval(this.draftTimer); this.draftTimer = null; }
    if (this.watcher) this.watcher.close();
    for (const a of Object.values(this.agents)) {
      clearTimeout(a.submitTimer); clearTimeout(a.startTimer); clearTimeout(a.blockTimer); a.pending = null;
      if (a.sessionId) this.api.closeSession(a.sessionId);
    }
  }

  /** שינוי שם של הזוג (T56): מנוקה מתווי בקרה, עד 60 תווים; ריק = בלי שינוי. תפקידי הסוכנים (ארכיטקט / עובד) קבועים */
  rename(name) {
    if (typeof name !== 'string') return false;
    const n = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!n || n === this.name) return false;
    this.name = n;
    this.api.persist();
    this.emit();
    return true;
  }

  pause() { if (this.paused) return; this.paused = true; this.event(null, 'הושהה'); this.api.persist(); this.emit(); }
  resume() { if (!this.paused) return; this.paused = false; this.event(null, 'חזר לעבוד'); this.api.persist(); this.emit(); this.evaluate(); }

  /** הודעה מהמשתמש לארכיטקט (מעירה אותו דרך התיבה שלו; אין שיחה משותפת) */
  say(text) {
    if (!String(text || '').trim()) return;
    this.userSays(text);
    this.event('user', 'כתב לארכיטקט');
    this.api.persist();
    this.emit();
    this.evaluate();
  }

  /** מוסיף הודעת משתמש לתור של הארכיטקט ולפעילות בלוח */
  userSays(text) {
    const arch = this.agents.architect;
    arch.pendingUsers.push({ t: Date.now(), text: String(text).trim().slice(0, 4000) });
    if (arch.pendingUsers.length > MAX_USER_QUEUE) arch.pendingUsers.shift();
    queue.pushFeed(this.st, 'user', String(text).trim());
    queue.writeStatus(this.project, this.st);
  }

  /** התעוררות ידנית (כפתור): ארכיטקט פנוי מקבל "[duo] manual"; העובד מקבל מיד את המטרה (אם יש משימות פתוחות), גם אם הזוג מושהה */
  wakeNow(role) {
    const a = this.agents[role];
    if (!a || a.state === 'working' || a.state === 'starting' || this.stopped) return false;
    if (role === 'architect') { this.wake('architect', this.wakeText('architect', 'manual'), { manual: true, commit: () => this.writeArchitectInbox() }); return true; }
    this.sweep(true);
    if (!this.openQueue(taskBlocks(files.read(this.paths.tasks))).length) return false;
    a.nextEligibleAt = 0;
    this.feedGoal(true);
    return true;
  }

  /* ---------- אירועים ---------- */

  /** מחזיר { block } רק ל-Stop של העובד כשצריך להחזיר אותו לעבודה (hook-cli מדפיס אותו ל-Claude), אחרת null */
  onHook(role, event, p = {}) {
    const a = this.agents[role];
    if (!a || this.stopped) return null;
    // התראות שמתנקות לבד (T46): כל אירוע מהסוכן אומר שהוא חי ומקבל הוראות (לא התחיל / לא קיבל הוראה / נסגר נפתרו); ובקשת הרשאה נפתרת כשהוא ממשיך לעבוד או מסיים תור
    this.resolve('nostart:' + role); this.resolve('unresponsive:' + role); this.resolve('closed:' + role);
    if (event === 'start' || event === 'submit' || event === 'stop') this.resolve('permission:' + role);
    switch (event) {
      case 'start':
        // דחיסה אוטומטית של Claude באמצע תור (הוא מתקדם כמו קודם, וה-Stop עוד יגיע): לא הופך ל"פנוי"
        if (!(p.source === 'compact' && a.state === 'working')) { a.state = 'idle'; a.since = Date.now(); a.startedAt = Date.now(); }
        if (p.source === 'clear') this.onSessionChanged(role, p.sessionId, 'ההקשר נוקה');
        else if (p.source === 'compact') this.onSessionChanged(role, p.sessionId, 'ההקשר כווץ');
        break;
      case 'submit':
        clearTimeout(a.submitTimer); clearTimeout(a.blockTimer); a.submitSeen = true; a.missed = 0; a.missedSince = 0; // ההוראה התקבלה
        a.state = 'working'; a.since = Date.now();
        this.event(role, 'התחיל לעבוד');
        this.api.persist(); // wasWorking נשמר מיד, כדי שכיבוי פתאומי יידע שהיה באמצע תור
        break;
      case 'stop': {
        clearTimeout(a.submitTimer); clearTimeout(a.blockTimer); a.submitSeen = true; a.missed = 0; a.missedSince = 0;
        a.lastStopAt = Date.now();
        this.event(role, 'סיים תור', p.last);
        const back = role === 'worker' ? this.stopDecision() : null;
        if (back) { // נשארו משימות: ה-hook מחזיר את העובד לעבודה, והוא נשאר "עובד"
          a.state = 'working'; a.since = Date.now();
          this.tech('worker', 'נשארו משימות פתוחות: ה-hook של Stop מחזיר את העובד לעבודה');
          this.watchBlocked(a, a.lastStopAt);
          this.emit();
          this.api.persist();
          return back;
        }
        a.state = 'idle'; a.since = Date.now();
        if (role === 'architect' && p.last && String(p.last).trim()) { queue.pushFeed(this.st, 'architect', String(p.last).trim()); queue.writeStatus(this.project, this.st); }
        this.afterStop(role);
        this.api.persist();
        break;
      }
      case 'notify':
        // מעניין רק כשהסוכן תקוע על בקשת הרשאה: אז לא מזריקים לו כלום, ומתריעים
        if (/permission/i.test(String(p.notificationType || '')) || /permission/i.test(String(p.message || ''))) {
          a.state = 'attention'; a.since = Date.now();
          this.alert('warn', `${label(role)} ממתין לאישור הרשאה בטרמינל`, 'permission:' + role, [{ type: 'open', role }]);
        }
        break;
      default:
    }
    this.emit();
    this.evaluate();
    return null;
  }

  onSessionExit(role) {
    const a = this.agents[role];
    if (!a || this.stopped || a.state === 'exited') return; // כבר מסומן (למשל התהליך יצא ואחר כך סגרו את הטרמינל)
    clearTimeout(a.submitTimer);
    a.diedWorking = a.state === 'working' || a.state === 'attention';
    a.state = 'exited';
    this.alert('error', `${label(role)} נסגר`, 'closed:' + role, [{ type: 'restart', role }]);
    this.event(role, 'נסגר');
    this.emit();
  }

  /** תור הביצוע: משימות פתוחות ([ ] או [~]) לפי סדר הקובץ, בלי היסטוריה מלפני יצירת הזוג שלא השתנתה (T72) */
  openQueue(blocks) {
    const base = this.agents.worker.baseline;
    return blocks.filter((b) => (b.status === 'todo' || b.status === 'doing') && base[b.key] !== sha(b.raw));
  }

  /** חתימת התור: משתנה כשהעובד מתקדם (סימון, Result) או כשמשימה עברה לארכיון, ולא משתנה כשהוא רק מדבר */
  queueSig() {
    return sha(this.st.done + '|' + taskBlocks(files.read(this.paths.tasks)).map((b) => b.status + '|' + b.raw).join('\n'));
  }

  /**
   * ה-hook של Stop מהעובד: כל עוד נשארו משימות פתוחות הוא לא נעצר אלא חוזר לעבודה (Claude Code מקבל את ה-reason כהוראה הבאה, בלי הודעה חדשה בטרמינל).
   * מחזיר { block: reason } או null (מותר לו לעצור). לא חוסמים כשהזוג מושהה או נסגר, ולא כשהעובד לא מתקדם: אחרי STOP_BLOCKS_NO_PROGRESS
   * חזרות בלי שום שינוי בתור הוא נעצר, ו-afterStop מתריע ומעיר אותו שוב בהמתנה הולכת וגדלה.
   */
  stopDecision() {
    const w = this.agents.worker;
    if (this.paused || this.stopped || !this.paths) return null;
    this.sweep(true);
    const open = this.openQueue(taskBlocks(files.read(this.paths.tasks)));
    if (!open.length) return null;
    const sig = this.queueSig();
    if (sig !== w.feedSig) { w.noProgress = 0; w.stuckSince = 0; this.resolve('stuck'); } else w.noProgress++;
    w.feedSig = sig;
    if (w.noProgress >= STOP_BLOCKS_NO_PROGRESS) return null;
    return { block: stopReason(open) };
  }

  /**
   * ה-hook החזיר את העובד לעבודה. אם אחרי זמן מה אין שום סימן שהוא ממשיך (לא Stop חדש ולא פלט בטרמינל), התשובה כנראה לא הגיעה ל-Claude:
   * הוא נחשב פנוי, ו-evaluate נותן לו את המטרה שוב (אחרת הזוג היה תקוע בשקט עם עובד ש"עובד" לנצח).
   */
  watchBlocked(a, stopAt) {
    clearTimeout(a.blockTimer);
    a.blockTimer = setTimeout(() => {
      if (this.stopped || a.state !== 'working' || a.lastStopAt !== stopAt) return;
      const out = this.api.lastOutputAt ? this.api.lastOutputAt(a.sessionId) : 0;
      if (Date.now() - out < OUTPUT_BUSY_MS) { this.watchBlocked(a, stopAt); return; }
      a.state = 'idle'; a.since = Date.now();
      this.tech('worker', 'אחרי ההחזרה לעבודה אין סימן חיים: נחשב פנוי');
      this.emit();
      this.evaluate();
    }, SUBMIT_TIMEOUT_MS);
    if (a.blockTimer.unref) a.blockTimer.unref();
  }

  /** העובד נעצר ולא הוחזר לעבודה: או שהתור נגמר (תקין), או שהוא לא מתקדם (התראה, והשכמה חוזרת בהמתנה הולכת וגדלה), או שהזוג מושהה */
  afterStop(role) {
    if (role !== 'worker') return;
    const w = this.agents.worker;
    this.sweep(true);
    const open = this.openQueue(taskBlocks(files.read(this.paths.tasks)));
    if (!open.length) { w.noProgress = 0; w.stuckSince = 0; w.nextEligibleAt = 0; this.resolve('stuck'); return; }
    if (this.paused) return;
    if (!w.stuckSince) w.stuckSince = Date.now();
    w.nextEligibleAt = Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, w.noProgress - STOP_BLOCKS_NO_PROGRESS));
    this.tech('worker', `העובד נעצר בלי להתקדם (${w.noProgress}); ממשיכים לנסות עם המתנה הולכת וגדלה`);
    this.alert('warn', 'העובד לא מתקדם במשימות. אפשר לפתוח את הטרמינל שלו או לכתוב לארכיטקט', 'stuck', [{ type: 'open', role: 'worker' }, { type: 'note' }]);
    this.scheduleEvaluate(w.nextEligibleAt - Date.now() + 50);
  }

  /* ---------- החלטות ---------- */

  scheduleEvaluate(ms) {
    clearTimeout(this.evalTimer);
    this.evalTimer = setTimeout(() => this.evaluate(), Math.max(50, ms));
    if (this.evalTimer.unref) this.evalTimer.unref();
  }

  evaluate() {
    if (this.paused || this.stopped || this.evaluating || !this.paths) return;
    this.evaluating = true;
    try {
      this.evalWorker();
      this.evalArchitect();
    } finally { this.evaluating = false; }
  }

  /**
   * מעביר לארכיון משימות שהעובד סיים ורושם חסומות (פעם אחת). כשהעובד באמצע תור, משימה עם [x] עוברת רק אחרי שנכתבה לה שורת Result
   * (אחרת היא הייתה נארזת בלעדיה); כשהוא נעצר (force) עוברות כולן. מחזיר { moved, blocked } (החדשות)
   */
  sweep(force = false) {
    const busy = !force && this.agents.worker.state === 'working';
    const moved = queue.archiveDone(this.project, this.st, { ready: (b) => !busy || !!b.result });
    const blocked = queue.noteBlocked(this.project, this.st);
    this.st.pendingReview = []; // nothing waits for an architect review any more
    if (moved.length || blocked.length) {
      queue.writeStatus(this.project, this.st);
      for (const m of moved) this.event('worker', `${m.id} הושלמה`, m.result);
      for (const x of blocked) this.event('worker', `${x.id} חסומה`, x.result);
      this.emit();
    }
    return { moved, blocked };
  }

  evalWorker() {
    const w = this.agents.worker;
    this.sweep();
    if (w.state !== 'idle') return;
    if (!this.openQueue(taskBlocks(files.read(this.paths.tasks))).length) return; // התור ריק
    if (Date.now() < w.nextEligibleAt) { this.scheduleEvaluate(w.nextEligibleAt - Date.now() + 50); return; }
    // הארכיטקט עוד כותב משימות: העובד מתחיל כשהוא מסיים את התור שלו (ה-hook של Stop שלו מפעיל evaluate), ולכל היותר אחרי ARCH_WRITING_MAX_MS
    const arch = this.agents.architect;
    if (arch.state === 'working' && Date.now() - arch.since < ARCH_WRITING_MAX_MS) { this.scheduleEvaluate(ARCH_WRITING_MAX_MS - (Date.now() - arch.since) + 50); return; }
    this.feedGoal(false);
  }

  /** מזריק לעובד את המטרה: להשלים את כל המשימות הפתוחות (הרשימה נבנית ברגע ההזרקה). משם ה-hook של Stop מחזיר אותו לעבודה כל עוד נשארו משימות */
  feedGoal(manual) {
    const w = this.agents.worker;
    const dir = path.join(this.project, '.duo');
    const open = () => this.openQueue(taskBlocks(files.read(this.paths.tasks)));
    this.wake('worker', () => goalMessage(open(), { hasBrief: fs.existsSync(path.join(dir, 'BRIEF.md')), hasRules: fs.existsSync(path.join(dir, 'RULES.md')), resumed: w.wakes > 0 }), {
      manual,
      commit: () => { w.feedSig = this.queueSig(); },
      needed: () => open().length > 0,
    });
  }

  /** SessionStart(source=clear|compact): ל-Claude יש מזהה שיחה חדש. מעדכנים אותו (resume אחרי הפעלה מחדש חייב את החדש) */
  onSessionChanged(role, claudeSessionId, what) {
    const a = this.agents[role];
    if (claudeSessionId && claudeSessionId !== a.claudeId) {
      a.claudeId = claudeSessionId;
      if (this.api.setClaudeId) this.api.setClaudeId(a.sessionId, claudeSessionId);
    }
    this.event(role, what);
    this.api.persist();
  }

  /** הטקסט שהארכיטקט מקבל על כל מה שממתין לו (גם כשההתעוררות היא "restarted"/"manual"): כותב את התיבה, ומרוקן את מה שנמסר */
  writeArchitectInbox() {
    const arch = this.agents.architect;
    const remaining = this.openQueue(taskBlocks(files.read(this.paths.tasks))).length;
    queue.writeArchitectInbox(this.project, { users: arch.pendingUsers, review: this.st.pendingReview, remaining });
    arch.pendingUsers = [];
    this.st.pendingReview = [];
    queue.writeStatus(this.project, this.st);
  }

  evalArchitect() {
    const arch = this.agents.architect;
    const w = this.agents.worker;
    if (arch.state !== 'idle' || Date.now() < arch.nextEligibleAt) return;
    // the architect is never woken for finished or blocked tasks (user decision): it gives tasks and stops; the user asks it for news when wanted
    let kind = null;
    if (arch.restartWake) kind = 'restarted';
    else if (arch.pendingUsers.length) kind = 'user';
    if (!kind) return;
    this.wake('architect', this.wakeText('architect', kind), {
      commit: () => { this.writeArchitectInbox(); if (kind === 'restarted') arch.restartWake = false; },
      needed: () => (kind === 'restarted' ? arch.restartWake : kind === 'user' ? arch.pendingUsers.length > 0 : this.st.pendingReview.length > 0),
    });
  }

  /** הטקסט שנראה בטרמינל של הסוכן (T64): סמן קצר, או הטקסט הארוך הישן לסוכן שהתחיל עם הוראות בלי סמנים */
  wakeText(role, kind) {
    const a = this.agents[role];
    const v = this.api.promptVersionOf ? this.api.promptVersionOf(a.sessionId) : PROMPT_VERSION;
    return (v >= PROMPT_VERSION ? WAKE : WAKE_LONG)[role](kind);
  }

  /**
   * מעיר סוכן: מזריק הוראה לטרמינל שלו כמו הדבקה + Enter. המצב הופך ל"עסוק" מיד ומאושר ב-hook של UserPromptSubmit.
   * אבל קודם (T62): אם המשתמש כותב עכשיו הודעה לאותו סוכן, ההוראה לא נדחפת לתוך הטיוטה ולא שולחת אותה. opts: { manual, commit, needed }
   *   commit: מה לעדכן בדיוק ברגע ההזרקה (מוני "ראה", חתימות משימות), ולא בשעת ההחלטה: כך wake שנדחה נבדק מחדש מהמצב האמיתי ברגע האחרון
   *   needed: האם ההוראה עדיין נחוצה (נקרא ברגע האחרון; false = נזרקת בשקט, והחלטה חדשה תתקבל אם ישתנה משהו)
   */
  wake(role, text, opts = {}) {
    const a = this.agents[role];
    const g = a.swapping ? 'wait' : this.guard(role, a.pending ? a.pending.since : 0); // באמצע החלפת טיוטה: לא מתחילים אחרת במקביל, רק מעדכנים את ההוראה הממתינה
    if (g === 'go' || g === 'force' || g === 'swap') {
      if (a.pending) { a.pending = null; this.emit(); }
      return this.inject(role, text, opts, g);
    }
    // המשתמש מקליד או שיש טיוטה: מחכים. הוראה אחת ממתינה לכל סוכן (חדשה מחליפה ישנה), והסוכן נשאר "פנוי"
    if (!a.pending) { a.pending = { since: a.heldSince || Date.now() }; a.heldSince = a.pending.since; this.tech(role, 'ההוראה ממתינה: המשתמש כותב לסוכן'); }
    Object.assign(a.pending, { text, manual: !!opts.manual, commit: opts.commit, needed: opts.needed });
    this.emit();
    this.ensureDraftTimer();
    return undefined;
  }

  /**
   * מה לעשות עכשיו בנוגע לטיוטה של המשתמש בסוכן הזה (T62):
   *   go    אין טיוטה ואין הקלדה: מזריקים כרגיל
   *   swap  יש טיוטה והמשתמש עצר: מזיזים אותה הצידה (Ctrl+S של Claude), שולחים, ו-Claude מחזיר אותה לבד
   *   wait  מקליד עכשיו (עד 30 שניות רצופות), או שיש טיוטה ואי אפשר להחליף: מחכים
   *   force טיוטה נטושה (10 דקות בלי הקשה): מזריקים כמו פעם, וזה נרשם בפעילות
   * בלי api.draftState (בדיקות יחידה, או טרמינל בלי מעקב) הכול "go".
   */
  guard(role, pendingSince = 0) {
    const a = this.agents[role];
    // רגע אחרי SessionStart תיבת הקלט של Claude עוד לא בהכרח מקבלת טקסט (T65): ההוראה הראשונה מחכה כמה שניות, כדי שלא תאבד והמשתמש לא יראה תקלה
    if (a.startedAt && Date.now() - a.startedAt < BOOT_SETTLE_MS) return 'wait';
    const st = this.api.draftState ? this.api.draftState(a.sessionId) : null;
    if (!st || (!st.draft && !st.typing)) return 'go';
    const now = Date.now();
    if (st.draft && st.lastKeyAt && now - st.lastKeyAt > DRAFT_ABANDONED_MS) return 'force';
    if (st.typing && !(pendingSince && now - pendingSince > TYPING_MAX_MS)) return 'wait';
    if (st.draft && SWAP_DRAFTS && this.api.screenState && this.api.lockHuman && a.swapFails < 2) return 'swap';
    return st.draft ? 'wait' : 'go';
  }

  /** הוראה מוחזקת שכבר ראוי להראות (T65): לא ניסיון חוזר, ומוחזקת כמה שניות */
  pendingShown(a) { return !!(a.pending && !a.pending.retry && Date.now() - (a.heldSince || a.pending.since) >= PENDING_SHOW_MS); }

  ensureDraftTimer() {
    if (this.draftTimer) return;
    this.draftTimer = setInterval(() => this.checkPending(), DRAFT_CHECK_MS);
    if (this.draftTimer.unref) this.draftTimer.unref();
  }

  /** בודק הוראות ממתינות (כל 2 שניות, ומיד כשהמשתמש שלח או ניקה את התיבה). role: רק לסוכן הזה */
  checkPending(only) {
    for (const [role, a] of Object.entries(this.agents)) {
      if (only && role !== only) continue;
      const p = a.pending;
      if (!p) continue;
      // זוג מושהה / נסגר / הסוכן נסגר: אין למי להעיר. נזרקת; evaluate אחרי המשך תחליט מחדש (המונים לא עודכנו)
      if (this.paused || this.stopped || a.state === 'exited') { a.pending = null; this.emit(); continue; }
      if (!p.shown && !p.retry && Date.now() - p.since >= PENDING_SHOW_MS) { p.shown = true; this.emit(); } // רק הוראה שמחכה כבר כמה שניות מוצגת (T65)
      if (p.retryAt && Date.now() < p.retryAt) continue; // ניסיון חוזר אחרי כישלון: לא לפני הזמן
      if (a.state !== 'idle') continue; // באמצע תור (גם של המשתמש עצמו): מחכים לסוף
      if (p.needed && !p.needed()) { a.pending = null; this.tech(role, 'ההוראה כבר לא נחוצה'); this.emit(); continue; }
      const g = this.guard(role, p.since);
      if (g === 'wait') continue;
      a.pending = null;
      this.emit();
      this.inject(role, p.text, { manual: p.manual, commit: p.commit, needed: p.needed, retry: p.retry }, g);
    }
    if (!Object.values(this.agents).some((x) => x.pending) && this.draftTimer) { clearInterval(this.draftTimer); this.draftTimer = null; }
  }

  inject(role, text, { manual = false, commit, needed, retry = false } = {}, mode = 'go') {
    const a = this.agents[role];
    const textFn = typeof text === 'function' ? text : null;
    if (textFn) text = textFn(); // the text can be built at the moment of injection (the worker's goal lists the open tasks of that moment)
    if (commit && mode !== 'swap') commit(); // בהחלפת טיוטה ה-commit רץ רק אחרי שה-stash אושר (T78): כישלון משאיר את ההוראה ממתינה עם ה-commit שלה, והתיבה לא נצרכת לחינם
    a.state = 'working'; a.since = Date.now(); a.lastWakeAt = Date.now(); a.submitSeen = false;
    if (retry) this.tech(role, 'ניסיון חוזר להעיר'); // ניסיון חוזר אחרי הוראה שלא התקבלה: לא שורה חדשה בפעילות ולא עוד "הופעל" במונה
    else { a.wakes++; this.event(role, manual ? 'הופעל ידנית' : 'הופעל', mode === 'force' ? 'נשלחה יחד עם טיוטה ישנה' : null); }
    clearTimeout(a.submitTimer);
    if (mode === 'swap') { if (!a.heldSince) a.heldSince = Date.now(); a.swapping = true; this.swapSubmit(role, text, commit, needed); }
    else { a.heldSince = 0; this.writeWake(a, text); }
    a.submitTimer = setTimeout(() => {
      if (!a.submitSeen && a.state === 'working') {
        // ה-hook של submit לא הגיע, אבל הטרמינל פעיל ברגע זה: הסוכן עובד (מסמנים שהתקבל; אחרת היינו מדביקים עוד הוראה לסוכן שבאמצע עבודה)
        const out = this.api.lastOutputAt ? this.api.lastOutputAt(a.sessionId) : 0;
        if (out > a.lastWakeAt + SUBMIT_TIMEOUT_MS * 0.6 && Date.now() - out < OUTPUT_BUSY_MS) { a.submitSeen = true; a.missed = 0; a.missedSince = 0; this.tech(role, 'ההוראה התקבלה (לפי פעילות הטרמינל; ה-hook של submit לא הגיע)'); return; }
        // תקלה פנימית שמתאוששת לבד (בדרך כלל רגע ההפעלה): לא מוצגת. ניסיון חוזר אמיתי (קודם לא היה אחד: המוני "ראה" כבר עודכנו), והתראה אחת רק על התמדה
        const now = Date.now();
        a.state = 'idle';
        a.missed++;
        if (!a.missedSince) a.missedSince = now;
        a.nextEligibleAt = now + (a.missed <= 1 ? FIRST_RETRY_MS : (Number(process.env.TG_TEST_RETRY_MS) || 60 * 1000));
        this.tech(role, `ההוראה לא התקבלה (ניסיון ${a.missed}); ינסו שוב`);
        if (a.missed >= NOTRECEIVED_PROMOTE_COUNT || now - a.missedSince >= NOTRECEIVED_PROMOTE_MS) {
          const mins = Math.max(1, Math.round((now - a.missedSince) / 60000));
          this.alert('warn', `${label(role)} לא מגיב להוראות כבר ${mins} ${mins === 1 ? 'דקה' : 'דקות'}`, 'unresponsive:' + role, [{ type: 'open', role }]);
        }
        a.pending = { since: now, text: textFn || text, manual, retry: true, retryAt: a.nextEligibleAt, needed: () => (role === 'worker' ? this.openQueue(taskBlocks(files.read(this.paths.tasks))).length > 0 : true) };
        this.emit();
        this.ensureDraftTimer();
      }
    }, SUBMIT_TIMEOUT_MS + (mode === 'swap' ? 1500 : 0));
    if (a.submitTimer.unref) a.submitTimer.unref();
    this.emit();
    this.api.persist();
  }

  writeWake(a, text) {
    this.api.writeInput(a.sessionId, PASTE_START + text + PASTE_END);
    setTimeout(() => this.api.writeInput(a.sessionId, '\r'), 400);
  }

  /**
   * החלפת טיוטה (T62; נבדק מול Claude Code v2.1.301): Ctrl+S מזיז את הטיוטה הצידה ("› stashed" בשורה התחתונה, כולל [Pasted text #N]); ההוראה נשלחת כרגיל;
   * ו-Claude עצמו מחזיר את הטיוטה כשההודעה נשלחת (כ-0.2 שנייה אחרי Enter, "Draft restored"). בזמן הזה "מנעול אדם": ההקשות של המשתמש ממתינות ומשוחזרות
   * בסדר אחרי ההחלפה, כך שדבר מהן לא הולך לאיבוד ולא נכנס לתוך ההוראה. אם המסך לא מאשר stash תוך 0.7 שנייה, לא נשלח כלום (לא מערבבים אף פעם):
   * ההוראה חוזרת להמתנה, ואחרי שני כשלונות הסוכן הזה עובר להמתנה בלבד.
   */
  async swapSubmit(role, text, commit, needed) {
    const a = this.agents[role];
    const id = a.sessionId;
    const api = this.api;
    const wait = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (pred(api.screenState(id))) return true; } catch { /* מסך לא קריא */ } await new Promise((r) => setTimeout(r, 40)); } return false; };
    api.lockHuman(id, true);
    let outcome = 'failed';
    try {
      api.writeInput(id, STASH_KEY);
      if (await wait((s) => s && s.found && s.stashed && !s.draft, STASH_CONFIRM_MS)) {
        if (commit) commit();
        this.writeWake(a, text);
        // Claude מחזיר את הטיוטה מיד אחרי ה-Enter; מחכים לזה (מוגבל) לפני ששוחררים את ההקשות
        await new Promise((r) => setTimeout(r, 450));
        await wait((s) => s && s.found && s.draft, RESTORE_WAIT_MS);
        outcome = 'swapped';
        a.swapFails = 0;
        a.heldSince = 0;
      }
    } catch (e) { this.api.log('swap failed', e.message); } finally { api.lockHuman(id, false); a.swapping = false; }
    if (outcome === 'failed') {
      // לא נשלח כלום: בחזרה להמתנה (הסוכן לא התחיל לעבוד)
      a.swapFails++;
      clearTimeout(a.submitTimer);
      a.state = 'idle'; a.wakes = Math.max(0, a.wakes - 1);
      a.pending = { since: a.heldSince || Date.now(), text, manual: false, commit, needed }; // מאז שההוראה הוחזקה לראשונה, לא מאז הניסיון שנכשל
      this.tech(role, 'החלפת הטיוטה לא אושרה: ההוראה ממתינה');
      this.emit();
      this.ensureDraftTimer();
    } else {
      this.tech(role, 'הטיוטה של המשתמש נשמרה והוחזרה');
    }
  }

  /* ---------- תצוגה ושמירה ---------- */

// התראה = בעיה שעדיין נכונה. לכל התראה מפתח, והיא נשארת פעילה עד ש-resolve(key) נקרא כשהבעיה נפתרה (T46): רק התראות פעילות צובעות את הנקודה ומופיעות בבאנר.
  // ההיסטוריה נשארת ב"פעילות אחרונה" (events).
  alert(level, text, key, actions) {
    key = key || text;
    const open = this.alerts.find((x) => x.key === key && !x.resolved);
    if (open) { open.text = text; return; } // אותה בעיה כבר פעילה: בלי כפילות
    this.alerts.push({ t: Date.now(), level, text, key, actions: actions || [], resolved: false });
    if (this.alerts.length > MAX_ALERTS) this.alerts.shift();
    this.event(null, 'התראה: ' + text);
  }

  resolve(key) {
    let any = false;
    for (const x of this.alerts) if (x.key === key && !x.resolved) { x.resolved = true; x.resolvedAt = Date.now(); any = true; this.event(null, 'נפתר: ' + x.text); }
    return any;
  }

  /** אירוע טכני (T65): נרשם ביומן השרת ובקטע המקופל "פרטים טכניים"; לעולם לא כותרת, התראה או שורה בפעילות האחרונה */
  tech(role, text) {
    this.techEvents.push({ t: Date.now(), role, text });
    if (this.techEvents.length > MAX_TECH) this.techEvents.shift();
    this.api.log('duo', this.id, role || '-', text);
  }

  event(role, text, detail) {
    this.events.push({ t: Date.now(), role, text, detail: detail ? String(detail).slice(0, 240) : undefined });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  emit() { this.api.emit(this); }

  /** sums the tokens of every Claude conversation of the project since the pair was created (a /clear starts a new one); at most every 20 s, never blocks */
  refreshUsage() {
    if (this.usageBusy || Date.now() - this.usageAt < 20000 || !this.project) return;
    this.usageBusy = true;
    usageOf.projectUsage(this.project, this.createdAt - 60000).then((u) => {
      this.usageAt = Date.now();
      if (!u) return;
      const changed = !this.usage || Math.abs(u.cost - this.usage.cost) > 0.005;
      this.usage = u;
      if (changed) this.emit();
    }).catch(() => { this.usageAt = Date.now(); }).finally(() => { this.usageBusy = false; });
  }

  /** לשידור לממשק (כולל התוכן הנוכחי של הקבצים) */
  snapshot() {
    this.refreshUsage();
    const md = this.paths ? files.read(this.paths.tasks) : '';
    const parsed = this.paths ? parseTasks(md) : { items: [], counts: { todo: 0, doing: 0, done: 0, blocked: 0 }, open: 0 };
    // the full text of every task (the lines under its title: details, Result, Review) for the board, clipped so the snapshot stays small
    const blocks = this.paths ? taskBlocks(md) : [];
    const detailOf = (i, idx) => {
      const b = blocks.find((x) => x.id && x.id === i.id) || blocks[idx];
      if (!b) return '';
      const s = b.raw.split('\n').slice(1).map((l) => l.replace(/^ {1,4}/, '')).join('\n').trim();
      return s.length > 1200 ? s.slice(0, 1199) + '…' : s;
    };
    parsed.items = parsed.items.map((i, idx) => ({ ...i, detail: detailOf(i, idx) }));
    const st = this.st || queue.defaults();
    // משימות שהסתיימו כבר בארכיון: הן נספרות במונה (הושלמו / סה"כ לא משתנים) ורק האחרונות מופיעות ברשימה
    const counts = { ...parsed.counts, done: parsed.counts.done + st.done };
    const inFile = new Set(parsed.items.map((i) => i.id));
    const archived = this.paths ? queue.readArchiveItems(this.project) : [];
    const items = [...(archived.length ? archived : st.recent.map((r) => ({ id: r.id, status: 'done', title: r.title, text: r.title, detail: r.result ? 'Result: ' + r.result : '' }))).filter((r) => !inFile.has(r.id)), ...parsed.items];
    const tasks = { items, counts, open: parsed.open, total: counts.todo + counts.doing + counts.done + counts.blocked };
    const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const feed = st.feed.slice(-40).map((e) => ({ author: e.author, time: hhmm(e.t), body: e.text, kind: e.kind }));
    const agent = (a) => ({ sessionId: a.sessionId, state: a.state, since: a.since, wakes: a.wakes, lastStopAt: a.lastStopAt, noProgress: a.noProgress, pending: this.pendingShown(a) });
    return {
      id: this.id, project: this.project, name: this.name || path.basename(this.project) || this.project, goal: this.goal, paused: this.paused, permissionMode: this.permissionMode, createdAt: this.createdAt,
      agents: { architect: agent(this.agents.architect), worker: agent(this.agents.worker) },
      tasks,
      usage: this.usage ? { input: this.usage.input, output: this.usage.output, cacheRead: this.usage.cacheRead, cacheWrite5m: this.usage.cacheWrite5m, cacheWrite1h: this.usage.cacheWrite1h, cost: this.usage.cost, models: this.usage.models, unknownModels: this.usage.unknownModels } : null,
      feed, alerts: this.alerts.filter((x) => !x.resolved).slice(-8), events: this.events.slice(-30), tech: this.techEvents.slice(-20), // רק התראות פעילות; הנפתרות נשארות ב-events
      files: this.paths ? { dir: this.paths.dir, tasks: this.paths.tasks, status: this.paths.status } : null,
    };
  }

  /** לשמירה בדיסק (state.json): מספיק כדי להמשיך בדיוק מאותה נקודה אחרי הפעלה מחדש */
  toJSON() {
    const saved = (a) => ({ claudeId: this.api.claudeIdOf(a.sessionId) || a.claudeId, wakes: a.wakes, wasWorking: a.state === 'working',
      baseline: Object.keys(a.baseline).length ? a.baseline : undefined, pendingUsers: a.pendingUsers.length ? a.pendingUsers : undefined });
    return { id: this.id, project: this.project, name: this.name || undefined, goal: this.goal, permissionMode: this.permissionMode, paused: this.paused, createdAt: this.createdAt,
      agents: { architect: saved(this.agents.architect), worker: saved(this.agents.worker) } };
  }

  /** האם הזוג דורש שהשרת ימשיך לרוץ ושהמחשב לא יירדם */
  get active() { return !this.paused && !this.stopped; }
}

const label = (role) => (role === 'architect' ? 'הארכיטקט' : 'העובד');
const pickSaved = (s) => (s ? { claudeId: s.claudeId || null, wakes: s.wakes || 0, wasWorking: !!s.wasWorking,
  baseline: s.baseline && typeof s.baseline === 'object' ? s.baseline : {}, pendingUsers: Array.isArray(s.pendingUsers) ? s.pendingUsers.slice(-MAX_USER_QUEUE) : [] } : {});

module.exports = { Duo };
