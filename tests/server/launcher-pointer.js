'use strict';
/*
 * המפעיל היציב (T80, scripts/launch-current.ps1) ומצביע הגרסה current.txt, בתיקיית גרסאות זמנית עם שתי גרסאות מדומות (start.ps1 שרק רושם עם מה הופעל):
 *  - המפעיל מפעיל את הגרסה שב-current.txt ומעביר הלאה תיקייה ופרמטר בשם (-Kind), ומסרב בבירור כשהגרסה חסרה;
 *  - סקריפט המעבר כותב current.txt רק אחרי הפעלה מוצלחת, אף פעם עם -NoStart, ורק כשהמפעיל קיים ליד השחרורים;
 *  - אחרי מעבר המפעיל מפעיל את הגרסה החדשה; הקיצור והרישום לא נוגעים (הסקריפטים לא מכירים אותם).
 * הכול בתיקייה זמנית, בפורט פנוי (לא 7791), בלי שרת אמיתי.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { TMP, checker } = require('../lib/harness');

const REPO = path.resolve(__dirname, '..', '..');
const dir = path.join(TMP, 'launcher-pointer-' + process.pid);
const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* נעול: נשאר ב-tests/.tmp */ } };
const ps = (file, args) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], { encoding: 'utf8', timeout: 60000, windowsHide: true });
const current = () => { try { return fs.readFileSync(path.join(dir, 'current.txt'), 'utf8').trim(); } catch { return null; } };
const started = (v) => { try { return JSON.parse(fs.readFileSync(path.join(dir, v, 'started.json'), 'utf8')); } catch { return null; } };

(async () => {
  const t = checker('stable launcher and current.txt pointer');
  rm(dir);
  for (const v of ['V1.0', 'V2.0']) {
    fs.mkdirSync(path.join(dir, v), { recursive: true });
    fs.writeFileSync(path.join(dir, v, 'start.ps1'), `param([Parameter(Position = 0)][string]$Dir, [string]$Kind = 'claude')\r\nSet-Content -LiteralPath (Join-Path $PSScriptRoot 'started.json') -Value ((@{ dir = $Dir; kind = $Kind; version = '${v}' }) | ConvertTo-Json -Compress)\r\n`);
  }
  fs.copyFileSync(path.join(REPO, 'scripts', 'switch-live-to-release.ps1'), path.join(dir, 'switch-live-to-release.ps1'));
  const sw = (rel, extra = []) => ps(path.join(dir, 'switch-live-to-release.ps1'), ['-Release', rel, '-Port', '7897', '-DevFolder', path.join(dir, 'no-dev'), ...extra]);

  /* ---------- בלי מפעיל ליד השחרורים: המעבר לא יוצר current.txt ---------- */
  let r = sw('V1.0');
  t.check('without launch-current.ps1 the switch starts the release but does not create current.txt', r.status === 0 && !!started('V1.0') && current() === null, (r.stdout + r.stderr).slice(-300));
  fs.rmSync(path.join(dir, 'V1.0', 'started.json'));

  /* ---------- המפעיל ---------- */
  fs.copyFileSync(path.join(REPO, 'scripts', 'launch-current.ps1'), path.join(dir, 'launch-current.ps1'));
  fs.writeFileSync(path.join(dir, 'current.txt'), 'V1.0\r\n');
  const launch = (...a) => ps(path.join(dir, 'launch-current.ps1'), a);
  r = launch('C:\\some folder\\project', '-Kind', 'powershell');
  const s1 = started('V1.0');
  t.check('the launcher starts the version in current.txt and passes the folder (with a space) and -Kind through', r.status === 0 && !!s1 && s1.dir === 'C:\\some folder\\project' && s1.kind === 'powershell' && !started('V2.0'), JSON.stringify(s1) + (r.stderr || '').slice(0, 200));

  /* ---------- מעבר: current.txt מתעדכן רק אחרי הפעלה ---------- */
  r = sw('V2.0', ['-NoStart']);
  t.check('-NoStart (nothing started) leaves current.txt alone', r.status === 0 && current() === 'V1.0' && !started('V2.0'), (r.stdout + r.stderr).slice(-300));
  r = sw('V3.0');
  t.check('a release that does not exist: refused, current.txt unchanged', r.status !== 0 && current() === 'V1.0', (r.stdout + r.stderr).slice(-200));
  r = sw('V2.0');
  t.check('a successful switch to V2.0 starts it and writes current.txt', r.status === 0 && !!started('V2.0') && current() === 'V2.0', (r.stdout + r.stderr).slice(-300));
  fs.rmSync(path.join(dir, 'V1.0', 'started.json'), { force: true });
  r = launch('D:\\x');
  t.check('after the switch the launcher starts V2.0 (not V1.0) with the argument', r.status === 0 && !!started('V2.0') && started('V2.0').dir === 'D:\\x' && !started('V1.0'), (r.stderr || '').slice(0, 200));

  /* ---------- rollback by hand: edit current.txt ---------- */
  fs.writeFileSync(path.join(dir, 'current.txt'), 'V1.0\n');
  fs.rmSync(path.join(dir, 'V2.0', 'started.json'), { force: true });
  r = launch();
  t.check('rolling back by editing current.txt to V1.0 works', r.status === 0 && !!started('V1.0') && !started('V2.0'));

  /* ---------- the launcher refuses clearly when the version is missing ---------- */
  fs.writeFileSync(path.join(dir, 'current.txt'), 'V9.9\n');
  r = launch();
  t.check('a missing version in current.txt: a clear error that names the path, nothing started', r.status !== 0 && /V9\.9/.test(r.stderr + r.stdout) && /current\.txt/.test(r.stderr + r.stdout), (r.stderr + r.stdout).slice(0, 300));

  /* ---------- the scripts never reach for the shortcut or the registry ---------- */
  const code = ['launch-current.ps1', 'switch-live-to-release.ps1', 'release.js'].map((f) => fs.readFileSync(path.join(REPO, 'scripts', f), 'utf8').split('\n').filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)).join('\n')).join('\n');
  t.check('the repo scripts never touch the registry or a shortcut (.lnk, HKCU, New-ItemProperty, Startup)', !/HKCU|HKLM|Registry|New-ItemProperty|Set-ItemProperty|\.lnk|WScript\.Shell|shell:startup|CurrentVersion\\Run/i.test(code));

  rm(dir);
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); rm(dir); process.exit(2); });
