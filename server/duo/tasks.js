'use strict';
/*
 * קריאה של קובץ המשימות והשיחה (טהור: מקבל טקסט, מחזיר נתונים). שום קריאת קבצים כאן.
 */
const crypto = require('crypto');

const STATUS = { ' ': 'todo', '~': 'doing', x: 'done', X: 'done', '!': 'blocked' };
const TASK_LINE = /^\s*[-*]\s*\[( |~|x|X|!)\]\s*(.*)$/;

const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

// הערות HTML (בתבנית יש בהן דוגמאות של משימה והודעה) לא נספרות
const stripComments = (md) => String(md || '').replace(/<!--[\s\S]*?-->/g, '');

/** TASKS.md -> { items:[{id,status,title,text}], counts, open, statusSig, taskSig } */
function parseTasks(md) {
  const items = [];
  for (const line of stripComments(md).split(/\r?\n/)) {
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    const text = m[2].trim();
    const idm = /^(T\d+)\b/i.exec(text);
    items.push({ id: idm ? idm[1].toUpperCase() : `#${items.length + 1}`, status: STATUS[m[1]], title: text.replace(/^(T\d+)\s*[—–:.-]?\s*/i, ''), text });
  }
  const counts = { todo: 0, doing: 0, done: 0, blocked: 0 };
  for (const it of items) counts[it.status]++;
  return {
    items,
    counts,
    open: counts.todo + counts.doing,
    // בלי סימון המצב: משתנה רק כשהארכיטקט מוסיף/משנה משימות (לא כשהעובד מסמן התקדמות)
    taskSig: sha(items.map((i) => i.text).join('\n')),
    // רק המצבים: משתנה כשיש התקדמות
    statusSig: sha(items.map((i) => `${i.id}:${i.status}`).join('|')),
  };
}

/**
 * TASKS.md -> גושי משימות עם המיקום המדויק בקובץ (T78): { key, id, status, title, start, end, raw, result }.
 * הגוש הוא שורת המשימה והשורות המוזחות שאחריה (פרטים, Result:, Review:) עד המשימה הבאה או שורה שאינה מוזחת (כותרת). שורות בתוך הערות HTML לא נספרות.
 * key: ה-T-id (T12), ולמשימה בלי מספר "#" וחתימה קצרה של הטקסט (יציב גם אחרי שמשימות אחרות עוברות לארכיון).
 */
function taskBlocks(md) {
  const lines = String(md || '').split(/\r?\n/);
  const inComment = [];
  let open = false;
  for (const line of lines) {
    let startsIn = open, rest = line;
    for (;;) {
      if (open) { const e = rest.indexOf('-->'); if (e < 0) break; open = false; rest = rest.slice(e + 3); } else { const b = rest.indexOf('<!--'); if (b < 0) break; open = true; rest = rest.slice(b + 4); }
    }
    inComment.push(startsIn || open || /<!--/.test(line));
  }
  const heads = [];
  for (let i = 0; i < lines.length; i++) if (!inComment[i] && TASK_LINE.test(lines[i])) heads.push(i);
  const blocks = [];
  for (let h = 0; h < heads.length; h++) {
    const start = heads[h];
    let end = start;
    for (let j = start + 1; j < lines.length; j++) {
      if (h + 1 < heads.length && j === heads[h + 1]) break;
      if (inComment[j]) break;
      if (lines[j].trim() === '') { end = end; continue; }
      if (!/^\s/.test(lines[j])) break; // כותרת או טקסט חופשי: סוף הגוש
      end = j;
    }
    const m = TASK_LINE.exec(lines[start]);
    const text = m[2].trim();
    const idm = /^(T\d+)\b/i.exec(text);
    const id = idm ? idm[1].toUpperCase() : null;
    const raw = lines.slice(start, end + 1).join('\n');
    const rm = /^\s+Result:\s*(.*)$/m.exec(raw);
    blocks.push({ key: id || '#' + sha(text).slice(0, 6), id, status: STATUS[m[1]], title: text.replace(/^(T\d+)\s*[—–:.-]?\s*/i, ''), start, end, raw, result: rm ? rm[1].trim() : '' });
  }
  return blocks;
}

const CHAT_HEAD = /^###\s*(architect|worker|user|system)\b/i;

/** CHAT.md -> רשימת כותבים לפי הסדר. כותב לא מוכר נספר כ"אחר" (שמרני: מעיר את הארכיטקט). */
function parseChat(md) {
  const authors = [];
  for (const line of stripComments(md).split(/\r?\n/)) {
    const m = CHAT_HEAD.exec(line);
    if (m) authors.push(m[1].toLowerCase());
    else if (/^###\s+\S/.test(line)) authors.push('other');
  }
  return authors;
}

/** כמה הודעות כתבו מישהו שאינו התפקיד הזה (הודעות של עצמו לא מעירות אותו) */
const othersCount = (md, role) => parseChat(md).filter((a) => a !== role).length;

const CHAT_HEAD_FULL = /^###\s*(architect|worker|user|system)\b[^\S\r\n]*(?:[·•-][^\S\r\n]*(\d{1,2}:\d{2}))?/i;

/** CHAT.md -> הודעות להצגה: [{author, time, body}] (הגוף נחתך כדי שהממשק לא יכבד) */
function parseChatEntries(md, { maxBody = 1200 } = {}) {
  const entries = [];
  let cur = null;
  for (const line of stripComments(md).split(/\r?\n/)) {
    const m = CHAT_HEAD_FULL.exec(line);
    if (m) { cur = { author: m[1].toLowerCase(), time: m[2] || '', body: [] }; entries.push(cur); continue; }
    if (/^###\s+\S/.test(line)) { cur = { author: 'other', time: '', body: [line.replace(/^###\s+/, '')] }; entries.push(cur); continue; }
    if (cur) cur.body.push(line);
  }
  return entries.map((e) => {
    const body = e.body.join('\n').trim();
    return { author: e.author, time: e.time, body: body.length > maxBody ? body.slice(0, maxBody) + '…' : body };
  });
}

module.exports = { parseTasks, taskBlocks, parseChat, parseChatEntries, othersCount, sha };
