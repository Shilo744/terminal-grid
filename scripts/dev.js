'use strict';
// מופע פיתוח: פורט 7795, מצב נפרד בתיקיית .dev, והשרת לא נסגר כשאין חלון פתוח. לא פותח דפדפן.
// פורט 7791 שייך לאפליקציה החיה של המשתמש — לעולם לא מאזינים עליו מכאן.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.TG_DEV_PORT) || 7795;
if (PORT === 7791) { console.error('פורט 7791 שמור לאפליקציה החיה. בחרו פורט אחר.'); process.exit(2); }

const DEV = path.join(ROOT, '.dev');
fs.mkdirSync(DEV, { recursive: true });

process.chdir(ROOT);
process.env.PORT = String(PORT);
process.env.TG_STATE_FILE = path.join(DEV, 'state.json');
process.env.TG_SETTINGS_FILE = path.join(DEV, 'settings.json');
process.env.TG_KEEP_ALIVE = '1';

console.log(`Terminal Grid (dev): http://127.0.0.1:${PORT}/   מצב: ${path.relative(ROOT, DEV)}${path.sep}   עצירה: Ctrl+C או PID ${process.pid}`);
require(path.join(ROOT, 'server.js'));
