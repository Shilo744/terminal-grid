'use strict';
/*
 * מופעל על ידי ה-hooks של Claude Code (SessionStart / UserPromptSubmit / Stop / Notification) בתוך טרמינל של סוכן.
 * מדווח לשרת המקומי מה קרה, כדי שהשרת ידע אם הסוכן פנוי או עסוק. כל כשל נבלע ויוצאים עם 0 (אף פעם לא מכשיל את Claude).
 * יוצא דופן אחד: ב-Stop של העובד בזוג השרת עונה { block: <סיבה> } כשנשארו משימות פתוחות, ואז מודפס {"decision":"block","reason":...}
 * ו-Claude Code ממשיך לעבוד עם הסיבה כהוראה הבאה, במקום לעצור. בלי תשובה (שרת לא זמין, פסק זמן) לא מודפס כלום והעובד נעצר.
 *   שימוש: node hook-cli.js <start|submit|stop|notify>
 *   משתני סביבה: TG_PORT, ואחד משניים: TG_DUO_ID + TG_DUO_ROLE (סוכן בזוג: POST ל-/api/duo/event) או TG_PANE_ID (טרמינל Claude רגיל: POST ל-/api/agent/event).
 *   בלי אף אחד מהם (Claude שהופעל מחוץ ל-Terminal Grid עם אותו קובץ הגדרות) לא שולחים כלום.
 */
const http = require('http');

let raw = '';
let sent = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', send);
setTimeout(send, 2500); // אם Claude לא סוגר את הקלט

function send() {
  if (sent) return;
  sent = true;
  let j = {};
  // BOM בתחילת הקלט (PowerShell מוסיף אחד כשמעבירים לו טקסט בצינור) שובר את JSON.parse: מורידים אותו
  try { j = JSON.parse(raw.replace(/^\uFEFF/, '') || '{}'); } catch { /* לא JSON */ }
  const duoId = process.env.TG_DUO_ID, paneId = process.env.TG_PANE_ID;
  if (!duoId && !paneId) process.exit(0);
  // הכול שמשימות עתידיות עשויות להזדקק לו (transcript_path, ו-source של SessionStart) עובר בשני המסלולים; השרת מתעלם ממה שאינו משתמש בו
  const body = JSON.stringify({
    duoId, role: process.env.TG_DUO_ROLE, paneId,
    event: process.argv[2],
    sessionId: j.session_id,
    transcriptPath: typeof j.transcript_path === 'string' ? j.transcript_path.slice(0, 500) : undefined,
    source: typeof j.source === 'string' ? j.source.slice(0, 40) : undefined,
    notificationType: j.notification_type,
    message: typeof j.message === 'string' ? j.message.slice(0, 300) : undefined,
    last: typeof j.last_assistant_message === 'string' ? j.last_assistant_message.slice(0, 600) : undefined,
  });
  const rq = http.request({
    host: '127.0.0.1', port: Number(process.env.TG_PORT), path: duoId ? '/api/duo/event' : '/api/agent/event', method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-tg': '1' },
  }, (r) => {
    let out = '';
    r.setEncoding('utf8');
    r.on('data', (d) => { if (out.length < 8192) out += d; });
    r.on('end', () => {
      let j = {};
      try { j = JSON.parse(out || '{}'); } catch { /* לא JSON */ }
      if (duoId && process.argv[2] === 'stop' && j && typeof j.block === 'string' && j.block) process.stdout.write(JSON.stringify({ decision: 'block', reason: j.block }));
      process.exit(0);
    });
  });
  rq.on('error', () => process.exit(0));
  rq.setTimeout(4000, () => { rq.destroy(); process.exit(0); });
  rq.end(body);
}
