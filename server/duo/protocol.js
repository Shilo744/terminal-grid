'use strict';
/*
 * פרוטוקול זוג הסוכנים (ארכיטקט + עובד), גרסה 3: תור משימות בלי שיחה, והעובד על מטרה אחת (כל התור).
 *   .duo/TASKS.md         — התור: רק משימות פתוחות (הארכיטקט כותב, העובד מסמן). משימות שהסתיימו עוברות אוטומטית לארכיון.
 *                           העובד קורא את כל התור ומטרתו להשלים את כל המשימות הפתוחות; ה-hook של Stop מחזיר אותו לעבודה כל עוד נשארו (אין לו תיבה).
 *   .duo/INBOX-architect.md — מה שהארכיטקט צריך עכשיו: הודעת משתמש, משימות שהסתיימו לסקירה, משימה חסומה (השרת כותב).
 *   .duo/STATUS.json      — מונים לממשק (הושלמו/סה"כ), הפעילות האחרונה, ומה שממתין לסקירה.
 *   .duo/archive/         — משימות שהסתיימו (TASKS-done-<n>.md) והשיחה הישנה. העובד קורא בו רק כשצריך לדעת מה נעשה קודם.
 * אין שיחה בין הסוכנים. ההוראות לסוכנים באנגלית (המודל מדייק יותר), אבל הם כותבים למשתמש בשפה שלו (עברית כברירת מחדל).
 */

const DIR = '.duo';
const TASKS_FILE = 'TASKS.md';
const CHAT_FILE = 'CHAT.md'; // רק להעברה מגרסה 1 (השיחה הישנה עוברת לארכיון)
const STATUS_FILE = 'STATUS.json';
const INBOX = { architect: 'INBOX-architect.md' };
const ARCHIVE_DIR = 'archive';
const BACKUP_DIR = 'backup-before-v2';
const ROLES = ['architect', 'worker'];

const TASKS_TEMPLATE = `# Tasks

<!--
  The queue: ONLY open tasks live here. The architect writes tasks; the worker sees all of them and works through them in order, marking each one.
  One task per line, details indented below it:
    - [ ] T1 — short title
      what to do, files involved, acceptance criteria
  Status markers:  [ ] todo   [~] being worked on   [x] done   [!] blocked
  Finished tasks are moved to .duo/archive/ automatically.
-->
`;

let TOOLS_TEXT = '';
try { TOOLS_TEXT = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'tools', 'AGENT-TOOLS.md'), 'utf8').trim(); } catch { /* the tools note is optional */ }
const TOOLS_BLOCK = TOOLS_TEXT ? '\n' + TOOLS_TEXT + '\n' : '';

const ARCHITECT_PROMPT = `You talk with the user to understand what they want to create, and hand a worker the tasks that build it. The worker is as capable as you are: the work is split into tasks only so that its full focus goes to one thing at a time. Each task is a significant piece of the product, a feature, and carries all of its detail in its description: what is wanted, behaviour, content, design, and how to tell it is done. A simple site is a handful of tasks, and the first one already gives something that works.
Tasks go in .duo/TASKS.md as "- [ ] T12 — title" with the description indented below it ([ ] todo, [~] doing, [x] done, [!] blocked; only the worker changes the marker). The worker reads the whole file and works through every open task in order until none is left; the server removes finished tasks from the file by itself, so it only ever shows what remains. It starts when you finish your turn, and you may add or change open tasks at any time, also while it works: it picks them up. First write the background once in .duo/BRIEF.md: what is being created, for whom, why, the tone and design direction, constraints. Those two files are the only ones you edit.
Your inbox is .duo/INBOX-architect.md. When the user asks for news, look at the work and add tasks for what is wrong or missing. Your last message each turn is shown to the user: a short summary in their language (Hebrew by default). When the goal is achieved, say so and add no tasks.
Messages that start with "[duo]" come from the server: user (the user wrote, see your inbox), restarted (continue), manual (take a fresh look and report). Answer them in at most two short lines.
${TOOLS_BLOCK}`;

// the worker's prompt is its tools; its goal arrives as the message goalMessage() and is renewed by the Stop hook (stopReason) while open tasks remain
const WORKER_PROMPT = (TOOLS_TEXT ? TOOLS_TEXT + '\n' : 'You are a developer working on the project in the current directory.\n') + `
Your goal: complete every open task in .duo/TASKS.md. Work through them in file order, one at a time; mark a task [~] when you start it. When a task is done, check that it works (run it, look at it), mark it [x] and add one indented line under it: "Result: what you did, and what later tasks may need". If it cannot be done, mark it [!] and write "Result: blocked: why", then go on to the next. The server removes finished tasks from the file, so the file shows only what is left; what was done before is in .duo/archive/. The architect may add or change tasks while you work: re-read the file after each task. When a task is finished, end your turn with one short line; you will be sent straight on to the next one.
`;

const idsOf = (open) => open.map((b) => b.id || b.title.slice(0, 30)).join(', ');
const extras = (hasBrief, hasRules) => (hasBrief ? ' Background of the project: .duo/BRIEF.md.' : '') + (hasRules ? ' Project rules: .duo/RULES.md.' : '');

/** What the server types into the worker's terminal when it is idle and tasks are open: the goal and the whole queue (open = the tasks to do now; anything else in the file is old leftovers). */
const goalMessage = (open, { hasBrief = false, hasRules = false, resumed = false } = {}) =>
  `${resumed ? 'Continue your goal' : 'Your goal'}: complete all the open tasks in .duo/TASKS.md (${idsOf(open)}), in order.${extras(hasBrief, hasRules)} Mark each task [~] when you start it and [x] with a "Result:" line when it is done, or [!] with "Result: blocked: why". Tasks marked [x] disappear from the file by themselves. New tasks may be added while you work.`;

/** What the Stop hook tells the worker when it ends a turn while tasks remain (Claude Code feeds it back as the next instruction). */
const stopReason = (open) =>
  `Open tasks remain in .duo/TASKS.md: ${idsOf(open)}. Re-read the file (the architect may have added or changed tasks) and continue with the next open task. If you are stuck on a task, mark it [!] with "Result: blocked: why" and move on.`;

const PROMPTS = { architect: ARCHITECT_PROMPT, worker: WORKER_PROMPT };

// סמנים (T64): המשתמש רואה בטרמינל של הסוכן כל הודעת התעוררות, ולכן הטקסט הנראה הוא סמן זעיר ("[duo] task"); המשמעות שלו בהוראות התפקיד (PROMPTS), שהמשתמש לא רואה.
// PROMPT_VERSION נשמר על כל סשן שהתחיל (בזיכרון, ב-startAgent): סוכן שהתחיל עם הוראות ישנות לא מכיר את הסמנים ולכן ממשיך לקבל את הטקסט הארוך (שמצביע על קבצי התיבה החדשים).
// גרסה 1 = משפטים ארוכים, 2 = סמנים עם שיחה, 3 (T78) = סמנים עם תיבות ותור, בלי שיחה.
const PROMPT_VERSION = 5;

const MARKER = { user: 'user', review: 'review', restarted: 'restarted', manual: 'manual' };
const WAKE = {
  architect: (kind) => `[duo] ${MARKER[kind] || 'user'}`,
};

// הטקסט הארוך והמפורש: לסוכן שהתחיל לפני הסמנים (מצביע על התיבה, לא על קובץ שיחה)
const LONG = {
  user: 'The user wrote to you (see .duo/INBOX-architect.md).',
  review: 'The worker finished tasks or a task is blocked (see .duo/INBOX-architect.md).',
  restarted: 'The server restarted while you were working. Re-read your inbox and continue.',
  manual: 'The user asked you to take a fresh look.',
};
const WAKE_LONG = {
  architect: (kind) => `[duo] ${LONG[kind] || LONG.user} Read .duo/INBOX-architect.md and .duo/TASKS.md, inspect the project as it is now, then update TASKS.md and answer in your last message, as your instructions say.`,
};

module.exports = { DIR, TASKS_FILE, CHAT_FILE, STATUS_FILE, INBOX, ARCHIVE_DIR, BACKUP_DIR, ROLES, TASKS_TEMPLATE, PROMPTS, WAKE, WAKE_LONG, PROMPT_VERSION, goalMessage, stopReason };
