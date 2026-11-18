'use strict';
/*
 * הקבצים שכל סוכן מקבל בעת ההפעלה: קובץ הגדרות עם ה-hooks (דרכם השרת יודע מתי הוא פנוי) וקובץ התפקיד.
 * נכתבים לתיקייה זמנית (לא לפרויקט) ונוצרים מחדש בכל הפעלה, כך שגם אחרי שחזור הכול קיים.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PROMPTS } = require('./protocol');

const HOOK_CLI = path.join(__dirname, 'hook-cli.js').replace(/\\/g, '/');
const root = () => path.join(os.tmpdir(), 'tg-duo');

function writeAgentFiles(duoId, role) {
  const dir = path.join(root(), duoId);
  fs.mkdirSync(dir, { recursive: true });
  const cmd = (event) => ({ hooks: [{ type: 'command', command: `node "${HOOK_CLI}" ${event}` }] });
  const settings = {
    hooks: {
      SessionStart: [cmd('start')],
      UserPromptSubmit: [cmd('submit')],
      Stop: [cmd('stop')],
      Notification: [cmd('notify')],
    },
  };
  const settingsFile = path.join(dir, `${role}.settings.json`);
  const promptFile = path.join(dir, `${role}.prompt.md`);
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  fs.writeFileSync(promptFile, PROMPTS[role]);
  return { settingsFile, promptFile };
}

/** שורת הפקודה של claude לתפקיד (נתיבים במרכאות כי PowerShell מפרש אותם). */
function buildCommand({ role, settingsFile, promptFile, permissionMode, resumeId, sessionId }) {
  const parts = ['claude', '--settings', `"${settingsFile}"`, '--append-system-prompt-file', `"${promptFile}"`,
    '--permission-mode', permissionMode || 'auto', '--name', `duo-${role}`];
  if (resumeId) parts.push('--resume', resumeId);
  else if (sessionId) parts.push('--session-id', sessionId);
  return parts.join(' ');
}

module.exports = { writeAgentFiles, buildCommand };
