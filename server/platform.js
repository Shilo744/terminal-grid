'use strict';
/*
 * שכבת תאימות בין מערכות הפעלה (Windows / macOS / Linux). כל מה שהשרת צריך מהמערכת עצמה עובר כאן,
 * כך ש-server.js לא מכיר PowerShell, taskkill, where או explorer. ב-Windows ההתנהגות זהה בדיוק לגרסאות הקודמות.
 *
 *   shellArgs(command)   הפקודה להרצה בתוך טרמינל (ו-shell אינטראקטיבי נשאר פתוח אחריה)
 *   refreshPath()        PATH עדכני (Windows: מהרישום; macOS/Linux: מה-shell של המשתמש)
 *   findCommand(name)    האם פקודה קיימת ב-PATH
 *   killTree(pid)        סוגר תהליך ואת כל מה שהפעיל
 *   pickFolder(start)    חלון בחירת תיקייה של המערכת
 *   listExternalClaude   סוכני Claude שרצים מחוץ ל-Terminal Grid
 *   reveal(dir, file)    פתיחה במנהל הקבצים
 *   keepAwake            מניעת שינה בזמן עבודה לילית
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const NAME = IS_WIN ? 'windows' : IS_MAC ? 'mac' : 'linux';
const P = IS_WIN ? path.win32 : path.posix; // לנתיבי תיקיות שמגיעים מקבצי Claude: בדיוק הסגנון של המערכת הזאת
const PATH_SEP = IS_WIN ? ';' : ':';

/* ---------- shell ---------- */
function posixShell() {
  const s = process.env.SHELL;
  if (s && fs.existsSync(s)) return s;
  return IS_MAC ? '/bin/zsh' : (fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');
}

/** { file, args } לטרמינל. command ריק = shell רגיל. אחרת מריצים את הפקודה והטרמינל נשאר פתוח אחריה (כמו -NoExit ב-PowerShell) */
function shell(command) {
  if (IS_WIN) return { file: 'powershell.exe', args: command ? ['-NoLogo', '-NoExit', '-Command', String(command)] : ['-NoLogo'] };
  const sh = posixShell();
  if (!command) return { file: sh, args: ['-l'] };
  // -l: טוען את הפרופיל של המשתמש (ה-PATH שלו, למשל ~/.local/bin שבה claude). exec: אחרי שהפקודה נגמרה נשאר shell פתוח
  return { file: sh, args: ['-l', '-i', '-c', `${command}\nexec "${sh}" -l`] };
}

/* ---------- PATH ---------- */
function refreshPath() {
  try {
    let extra = '';
    if (IS_WIN) {
      // תהליך שמופעל מ-Explorer יורש PATH ישן: טוענים את העדכני מהרג'יסטרי
      const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
        "[Console]::Out.Write([Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')))";
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 8000 });
      if (r.status !== 0 || !r.stdout) return;
      extra = r.stdout;
    } else {
      // אפליקציה שנפתחה מהממשק הגרפי (ב-macOS) מקבלת PATH מצומצם: שואלים את ה-shell של המשתמש מה ה-PATH שלו
      // סימנים סביב הערך: קובצי ההפעלה של המשתמש (.zshrc) עלולים להדפיס דברים משלהם
      const r = spawnSync(posixShell(), ['-l', '-i', '-c', 'printf "__TGPATH__%s__TGPATH__" "$PATH"'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = r.status === 0 && /__TGPATH__(.*?)__TGPATH__/s.exec(r.stdout || '');
      extra = m ? m[1] : '';
      const home = os.homedir();
      const common = [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
      extra += PATH_SEP + common.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } }).join(PATH_SEP);
    }
    const norm = (p) => (IS_WIN ? p.trim().replace(/[\\/]+$/, '').toLowerCase() : p.trim().replace(/\/+$/, ''));
    const parts = (process.env.PATH || '').split(PATH_SEP).filter(Boolean);
    const seen = new Set(parts.map(norm));
    for (const p of extra.split(PATH_SEP)) {
      if (p.trim() && !seen.has(norm(p))) { seen.add(norm(p)); parts.push(p.trim()); }
    }
    process.env.PATH = parts.join(PATH_SEP);
  } catch { /* נשארים עם ה-PATH שיש */ }
}

function findCommand(name, env = process.env) {
  try { return spawnSync(IS_WIN ? 'where' : 'which', [name], { env, windowsHide: true, timeout: 5000 }).status === 0; } catch { return false; }
}

/* ---------- תהליכים ---------- */
function killTree(pid, cb = () => {}) {
  if (!pid) return cb();
  if (IS_WIN) return execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => cb());
  // ב-PTY התהליך הוא מנהיג קבוצה (setsid): שולחים לכל הקבוצה, ואם אין קבוצה, לתהליך עצמו
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* כבר נסגר */ } }
  cb();
}

/* ---------- בחירת תיקייה ---------- */
function pickFolder(start, log = () => {}) {
  return new Promise((resolve) => {
    const done = (err, stdout) => {
      if (err) { log('pickFolder error', err.message); return resolve(''); }
      resolve(String(stdout).replace(/^﻿/, '').trim());
    };
    if (IS_WIN) {
      const script = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'CenterScreen'
$owner.Opacity = 0
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'בחרו תיקיית עבודה לטרמינל החדש'
$dlg.ShowNewFolderButton = $true
if ($env:TG_PICK_START -and (Test-Path -LiteralPath $env:TG_PICK_START)) { $dlg.SelectedPath = $env:TG_PICK_START }
$owner.Show()
$owner.Activate()
if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.SelectedPath) }
$owner.Dispose()`;
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      return execFile('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], {
        windowsHide: true, encoding: 'buffer', timeout: 5 * 60 * 1000,
        env: { ...process.env, TG_PICK_START: typeof start === 'string' ? start : '' },
      }, (err, stdout) => done(err, err ? '' : stdout.toString('utf8')));
    }
    const startDir = typeof start === 'string' && start && fs.existsSync(start) ? start : os.homedir();
    if (IS_MAC) {
      // osascript: חלון בחירת התיקייה הרגיל של macOS. ביטול = שגיאה (קוד 1): מחזירים מחרוזת ריקה כמו ב-Windows
      const script = 'on run argv\nPOSIX path of (choose folder with prompt "בחרו תיקיית עבודה לטרמינל החדש" default location (POSIX file (item 1 of argv)))\nend run';
      return execFile('osascript', ['-e', script, startDir], { timeout: 5 * 60 * 1000 }, (err, stdout) => done(null, err ? '' : String(stdout).replace(/\/+$/, '') || '/'));
    }
    // Linux: zenity או kdialog, מה שיש
    execFile('zenity', ['--file-selection', '--directory', '--filename=' + startDir + '/'], { timeout: 5 * 60 * 1000 }, (err, stdout) => {
      if (err && err.code === 'ENOENT') return execFile('kdialog', ['--getexistingdirectory', startDir], { timeout: 5 * 60 * 1000 }, (e2, o2) => done(null, e2 ? '' : o2));
      done(null, err ? '' : stdout);
    });
  });
}

/* ---------- סוכני Claude שרצים מחוץ לרשת ---------- */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function listExternalClaudeWin(rootPid, panePids, log) {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = [int]$env:TG_ROOT_PID
$procs = @{}
Get-CimInstance Win32_Process | ForEach-Object { $procs[[int]$_.ProcessId] = $_ }
function InTree([int]$p) {
  for ($i = 0; $i -lt 30 -and $p -gt 0; $i++) {
    if ($p -eq $root) { return $true }
    $n = $procs[$p]; if (-not $n) { return $false }
    $p = [int]$n.ParentProcessId
  }
  return $false
}
$panes = @{}
if ($env:TG_PANE_PIDS) { $env:TG_PANE_PIDS.Split(',') | ForEach-Object { if ($_ -match '^\\d+$') { $panes[[int]$_] = $true } } }
function PaneOf([int]$p) {
  for ($i = 0; $i -lt 30 -and $p -gt 0; $i++) {
    if ($panes.ContainsKey($p)) { return $p }
    $n = $procs[$p]; if (-not $n) { return 0 }
    $p = [int]$n.ParentProcessId
  }
  return 0
}
$out = @()
Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.claude\\sessions') -Filter '*.json' | ForEach-Object {
  $j = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $j -or $j.kind -ne 'interactive' -or $j.entrypoint -ne 'cli') { return }
  $p = $procs[[int]$j.pid]
  if (-not $p -or $p.Name -notmatch '^(claude|node)\\.exe$') { return }
  # אותו מספר תהליך יכול להיות מושאל לתוכנית אחרת אחרי שהסוכן נסגר: בודקים שזמן ההפעלה תואם
  if ($j.procStart) {
    $ft = $p.CreationDate.ToFileTimeUtc()
    if ([math]::Abs($ft - [int64]$j.procStart) -gt 100000000) { return }
  }
  $out += [pscustomobject]@{ pid = [int]$j.pid; sessionId = [string]$j.sessionId; cwd = [string]$j.cwd; name = [string]$j.name; status = [string]$j.status; inGrid = [bool](InTree ([int]$j.pid)); panePid = [int](PaneOf ([int]$j.pid)) }
}
ConvertTo-Json -InputObject @($out) -Compress`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, encoding: 'buffer', timeout: 20000,
      env: { ...process.env, TG_ROOT_PID: String(rootPid), TG_PANE_PIDS: panePids.join(',') },
    }, (err, stdout) => {
      if (err) { log('listExternalClaude error', err.message); return resolve([]); }
      try {
        const arr = JSON.parse(stdout.toString('utf8').replace(/^﻿/, '').trim() || '[]');
        resolve((Array.isArray(arr) ? arr : [arr]).filter((x) => x && UUID_RE.test(x.sessionId)));
      } catch (e) { log('listExternalClaude parse', e.message); resolve([]); }
    });
  });
}

function listExternalClaudePosix(rootPid, panePids, log) {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,ppid=,comm='], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) { log('listExternalClaude error', err.message); return resolve([]); }
      const procs = new Map();
      for (const line of String(stdout).split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
        if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), name: path.basename(m[3]) });
      }
      const panes = new Set(panePids.map(Number));
      const climb = (pid, test) => { for (let i = 0, p = pid; i < 30 && p > 0; i++) { const r = test(p); if (r) return r; const n = procs.get(p); if (!n) return 0; p = n.ppid; } return 0; };
      const dir = path.join(os.homedir(), '.claude', 'sessions');
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return resolve([]); }
      const out = [];
      for (const f of files) {
        let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
        if (!j || j.kind !== 'interactive' || j.entrypoint !== 'cli') continue;
        const p = procs.get(Number(j.pid));
        if (!p || !/^(claude|node)$/.test(p.name)) continue;
        out.push({
          pid: Number(j.pid), sessionId: String(j.sessionId), cwd: String(j.cwd || ''), name: String(j.name || ''), status: String(j.status || ''),
          inGrid: !!climb(Number(j.pid), (x) => (x === rootPid ? 1 : 0)), panePid: climb(Number(j.pid), (x) => (panes.has(x) ? x : 0)) || 0,
        });
      }
      resolve(out.filter((x) => UUID_RE.test(x.sessionId)));
    });
  });
}

function listExternalClaude(rootPid, panePids, log = () => {}) {
  return IS_WIN ? listExternalClaudeWin(rootPid, panePids, log) : listExternalClaudePosix(rootPid, panePids, log);
}

/* ---------- מנהל הקבצים ---------- */
function reveal(dir, file) {
  if (IS_WIN) return execFile('explorer.exe', file ? ['/select,' + file] : [dir], () => { /* explorer מחזיר 1 גם בהצלחה */ });
  if (IS_MAC) return execFile('open', file ? ['-R', file] : [dir], () => {});
  execFile('xdg-open', [file ? path.dirname(file) : dir], () => {});
}

/* ---------- מניעת שינה ---------- */
let awake = null;
const awakeApi = {
  start(log = () => {}) {
    if (awake) return;
    if (IS_WIN) {
      const SCRIPT = `
Add-Type -Namespace TG -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
$parent = [int]$env:TG_PARENT_PID
while ($true) {
  [TG.Power]::SetThreadExecutionState(0x80000001) | Out-Null   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
  Start-Sleep -Seconds 20
  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { break }
}`;
      const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
      awake = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
        windowsHide: true, stdio: 'ignore', env: { ...process.env, TG_PARENT_PID: String(process.pid) },
      });
    } else if (IS_MAC) {
      awake = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }); // יוצא לבד כשהשרת נסגר
    } else {
      awake = spawn('systemd-inhibit', ['--what=sleep', '--who=Terminal Grid', '--why=agent pair running', 'tail', '--pid=' + process.pid, '-f', '/dev/null'], { stdio: 'ignore' });
    }
    awake.on('exit', () => { awake = null; });
    awake.on('error', (e) => { log('keepawake failed', e.message); awake = null; });
    log('keepawake on');
  },
  stop(log = () => {}) {
    if (!awake) return;
    try { awake.kill(); } catch { /* כבר נסגר */ }
    awake = null;
    log('keepawake off');
  },
  isOn: () => !!awake,
};

module.exports = { IS_WIN, IS_MAC, NAME, P, PATH_SEP, posixShell, shell, refreshPath, findCommand, killTree, pickFolder, listExternalClaude, reveal, awake: awakeApi };
