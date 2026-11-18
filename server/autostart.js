'use strict';
/*
 * הפעלה אוטומטית עם Windows: קיצור דרך בתיקיית ההפעלה של המשתמש (Startup) שמריץ את start.ps1 ברקע (בלי חלון ובלי דפדפן).
 * השרת יודע לשחזר לבד את הטרמינלים, השיחות של Claude ואת זוגות הסוכנים מ-state.json, אבל מישהו צריך להפעיל אותו אחרי שהמחשב עלה.
 * "פעיל" = הקובץ קיים בתיקייה (זה האמת: אין מצב נפרד ששומרים בהגדרות).
 *
 *   שם:       Terminal Grid.lnk (בפורט אחר: Terminal Grid (<פורט>).lnk, כדי שמופע נוסף לא ידרוס את הראשי)
 *   יעד:      conhost.exe --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<root>\start.ps1" -NoBrowser [-Port <פורט>]
 *   בדיקות:   TG_TEST_STARTUP_DIR=<תיקייה זמנית> במקום תיקיית ההפעלה האמיתית; TG_TEST_AUTOSTART_STUB=1 כותב JSON שמתאר את הקיצור
 *             (באותו שם קובץ) במקום להפעיל PowerShell; TG_TEST_AUTOSTART_DELAY_MS=<מ"ש> מאט את היצירה (בדיקת משוב מיידי). אף בדיקה לא נוגעת בתיקיית ההפעלה האמיתית.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_PORT = 7791;

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function startupDir(env = process.env) {
  if (env.TG_TEST_STARTUP_DIR) return env.TG_TEST_STARTUP_DIR;
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'LaunchAgents');
  if (!IS_WIN) return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart');
  const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

// Windows: קיצור בתיקיית Startup. macOS: LaunchAgent (plist) שנטען בכניסה למערכת. Linux: קובץ .desktop בתיקיית autostart.
const shortcutName = (port) => {
  if (IS_MAC) return port === DEFAULT_PORT ? 'com.terminalgrid.plist' : `com.terminalgrid.${port}.plist`;
  if (!IS_WIN) return port === DEFAULT_PORT ? 'terminal-grid.desktop' : `terminal-grid-${port}.desktop`;
  return port === DEFAULT_PORT ? 'Terminal Grid.lnk' : `Terminal Grid (${port}).lnk`;
};

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** macOS / Linux: תוכן הקובץ שמפעיל את השרת בכניסה (בלי דפדפן): node server.js בתיקיית הגרסה */
function posixFileContent({ root, port, env = process.env }) {
  const node = process.execPath, server = path.join(root, 'server.js');
  const portEnv = port !== DEFAULT_PORT ? { PORT: String(port), TG_STATE_FILE: path.join(root, '.state-' + port, 'state.json'), TG_SETTINGS_FILE: path.join(root, '.state-' + port, 'settings.json') } : {};
  if (IS_MAC) {
    const envXml = Object.keys(portEnv).length
      ? '  <key>EnvironmentVariables</key>\n  <dict>\n' + Object.entries(portEnv).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>\n`).join('') + '  </dict>\n' : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(path.basename(shortcutName(port), '.plist'))}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(server)}</string></array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
${envXml}  <key>RunAtLoad</key><true/>
</dict>
</plist>
`;
  }
  const envPrefix = Object.entries(portEnv).map(([k, v]) => `${k}="${v}" `).join('');
  return `[Desktop Entry]
Type=Application
Name=Terminal Grid
Exec=env ${envPrefix}"${node}" "${server}"
Path=${root}
Terminal=false
`;
}

/** מה הקיצור צריך להכיל (טהור; נבדק ישירות) */
function describe({ root, port, env = process.env }) {
  if (!IS_WIN) return { target: process.execPath, arguments: '"' + path.join(root, 'server.js') + '"', workingDirectory: root, icon: '' };
  const sys = env.SystemRoot || env.windir || 'C:' + String.fromCharCode(92) + 'Windows';
  const script = path.join(root, 'start.ps1');
  const args = ['--headless', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `"${script}"`, '-NoBrowser'];
  if (port !== DEFAULT_PORT) args.push('-Port', String(port));
  return { target: path.join(sys, 'System32', 'conhost.exe'), arguments: args.join(' '), workingDirectory: root, icon: path.join(root, 'terminal-grid.ico') };
}

// מחרוזת בגרשיים בודדים של PowerShell (גרש בתוכה מוכפל)
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function createAutostart({ root, port, env = process.env, log = () => {} }) {
  const dir = () => startupDir(env);
  const file = () => path.join(dir(), shortcutName(port));
  const exists = () => { try { return fs.existsSync(file()); } catch { return false; } };

  /** יוצר את הקיצור. מחזיר Promise שנדחה בהודעה ברורה (בעברית) כשנכשל. */
  function enable() {
    const wait = Number(env.TG_TEST_AUTOSTART_DELAY_MS) || 0; // בדיקות: מדמה את 1-3 שניות של PowerShell
    return new Promise((r) => setTimeout(r, wait)).then(() => new Promise((resolve, reject) => {
      const d = describe({ root, port, env });
      try { fs.mkdirSync(dir(), { recursive: true }); } catch (e) { return reject(new Error(`אי אפשר ליצור את תיקיית ההפעלה: ${e.message}`)); }
      if (env.TG_TEST_AUTOSTART_STUB === '1') {
        try { fs.writeFileSync(file(), JSON.stringify(d, null, 2)); resolve(); } catch (e) { reject(new Error(`אי אפשר ליצור את הקיצור: ${e.message}`)); }
        return;
      }
      if (!IS_WIN) {
        try { fs.writeFileSync(file(), posixFileContent({ root, port, env })); resolve(); } catch (e) { reject(new Error(`אי אפשר ליצור את קובץ ההפעלה: ${e.message}`)); }
        return;
      }
      const ps = [
        '$ErrorActionPreference = "Stop"',
        '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + q(file()) + ')',
        '$s.TargetPath = ' + q(d.target),
        '$s.Arguments = ' + q(d.arguments),
        '$s.WorkingDirectory = ' + q(d.workingDirectory),
        '$s.IconLocation = ' + q(d.icon),
        '$s.WindowStyle = 7',
        '$s.Description = "Terminal Grid"',
        '$s.Save()',
      ].join('; ');
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 20000 }, (err, _out, stderr) => {
        if (err || !exists()) {
          const why = String(stderr || (err && err.message) || 'unknown').split(/\r?\n/).find((l) => l.trim()) || 'unknown';
          log('autostart enable failed', why);
          return reject(new Error(`יצירת הקיצור נכשלה: ${why.slice(0, 160)}`));
        }
        resolve();
      });
    }));
  }

  /** מוחק את הקיצור (אם אין, לא קורה כלום) */
  function disable() {
    try { fs.unlinkSync(file()); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`אי אפשר למחוק את הקיצור: ${e.message}`); }
  }

  return { exists, enable, disable, file, dir, describe: () => describe({ root, port, env }) };
}

module.exports = { createAutostart, describe, posixFileContent, startupDir, shortcutName, DEFAULT_PORT };
