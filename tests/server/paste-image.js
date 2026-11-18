'use strict';
/*
 * POST /api/paste-image (T45): התמונה מגיעה מאירוע ההדבקה בדפדפן, השרת כותב קובץ זמני ועונה בנתיב.
 * נבדק: הבייטים נשמרים בדיוק, השם נבנה בשרת (שם הלקוח רק כמחרוזת ASCII בטוחה, בלי נתיבים), הסיומת לפי סוג התוכן, התיקייה זמנית (TEMP עם רווח בנתיב);
 * נדחים: סוג אחר (טקסט, svg), גודל מעל 30MB, גוף ריק, טרמינל לא קיים, טרמינל PowerShell, Origin זר; ניקוי קבצים בני יותר מ-24 שעות בהפעלה.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const post = (port, query, body, { type = 'image/png', origin = `http://127.0.0.1:${port}`, length } = {}) => new Promise((resolve) => {
  const headers = { 'content-type': type, 'x-tg': '1', 'content-length': length != null ? length : body.length };
  if (origin) headers.Origin = origin;
  const rq = http.request({ host: '127.0.0.1', port, path: '/api/paste-image' + query, method: 'POST', headers }, (r) => {
    let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { /* no json */ } resolve({ status: r.statusCode, json: j }); });
  });
  rq.on('error', (e) => resolve({ status: 0, error: e.code || e.message }));
  rq.end(body);
});

(async () => {
  const t = checker('paste image endpoint');
  const tmp = path.join(TMP, 'paste tmp'); // רווח בנתיב: Claude צריך נתיב בגרשיים
  const dir = path.join(tmp, 'tg-paste');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // קבצים ישנים וחדשים שכבר בתיקייה: הישן נמחק בהפעלה, החדש נשאר
  const old = path.join(dir, 'old-image.png'), fresh = path.join(dir, 'fresh-image.png');
  fs.writeFileSync(old, PNG); fs.writeFileSync(fresh, PNG);
  const longAgo = new Date(Date.now() - 25 * 3600 * 1000);
  fs.utimesSync(old, longAgo, longAgo);

  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-img'), env: { TEMP: tmp, TMP: tmp } });
  const c = await connect(srv.port);
  c.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'cl' });
  c.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps' });
  await poll(() => c.sessions.size === 2, 15000);
  const cl = [...c.sessions.values()].find((s) => s.name === 'cl').id;
  const ps = [...c.sessions.values()].find((s) => s.name === 'ps').id;

  const ok = await post(srv.port, `?id=${cl}&name=${encodeURIComponent('my shot.png')}`, PNG);
  t.check('a PNG is accepted and the answer has a path', ok.status === 200 && !!ok.json && typeof ok.json.path === 'string', JSON.stringify(ok));
  const p = ok.json && ok.json.path;
  t.check('the file exists with exactly the same bytes', !!p && fs.existsSync(p) && Buffer.compare(fs.readFileSync(p), PNG) === 0);
  t.check('it is inside the temporary folder (a path with a space), under tg-paste', !!p && path.dirname(p) === dir && p.includes(' '), p);
  t.check('the name is built by the server: timestamp-random-safename.png', !!p && /^\d{8}-\d{6}-[0-9a-f]{6}-my-shot\.png$/.test(path.basename(p)), p && path.basename(p));
  const evil = await post(srv.port, `?id=${cl}&name=${encodeURIComponent('..\\..\\evil name.exe')}`, PNG);
  t.check('a client name with path separators and a different extension cannot escape the folder or change the type', evil.status === 200 && path.dirname(evil.json.path) === dir && /\.png$/.test(evil.json.path) && !/evil name/.test(evil.json.path), JSON.stringify(evil));
  const jpg = await post(srv.port, `?id=${cl}`, PNG, { type: 'image/jpeg' });
  const webp = await post(srv.port, `?id=${cl}`, PNG, { type: 'image/webp; charset=x' });
  const gif = await post(srv.port, `?id=${cl}`, PNG, { type: 'image/gif' });
  t.check('the extension follows the content type (jpeg -> .jpg, webp, gif)', /\.jpg$/.test(jpg.json && jpg.json.path) && /\.webp$/.test(webp.json && webp.json.path) && /\.gif$/.test(gif.json && gif.json.path));

  const txt = await post(srv.port, `?id=${cl}`, Buffer.from('hello'), { type: 'text/plain' });
  const svg = await post(srv.port, `?id=${cl}`, Buffer.from('<svg/>'), { type: 'image/svg+xml' });
  t.check('other content types are refused (text, svg): 415', txt.status === 415 && svg.status === 415, `${txt.status} ${svg.status}`);
  const empty = await post(srv.port, `?id=${cl}`, Buffer.alloc(0));
  t.check('an empty body is refused: 400', empty.status === 400, String(empty.status));
  const big = await post(srv.port, `?id=${cl}`, Buffer.alloc(31 * 1024 * 1024, 1));
  t.check('over 30 MB is refused: 413 (nothing saved)', big.status === 413 || big.status === 0, JSON.stringify(big));
  const unknown = await post(srv.port, '?id=999', PNG);
  const none = await post(srv.port, '', PNG);
  t.check('an unknown terminal and a missing id: 404', unknown.status === 404 && none.status === 404, `${unknown.status} ${none.status}`);
  const shell = await post(srv.port, `?id=${ps}`, PNG);
  t.check('a PowerShell terminal accepts the image too: 200 (the path is pasted into the command line)', shell.status === 200, String(shell.status));
  const foreign = await post(srv.port, `?id=${cl}`, PNG, { origin: 'http://evil.example' });
  const noOrigin = await post(srv.port, `?id=${cl}`, PNG, { origin: null });
  t.check('a foreign Origin and a request without an Origin are refused: 403', foreign.status === 403 && noOrigin.status === 403, `${foreign.status} ${noOrigin.status}`);

  const saved = fs.readdirSync(dir);
  t.check('only the accepted images were saved (no leftovers from the refused ones)', saved.filter((n) => !['old-image.png', 'fresh-image.png'].includes(n)).length === 6, saved.join(', '));
  await sleep(500);
  t.check('on start the files older than 24 hours were deleted and the fresh one kept', !fs.existsSync(old) && fs.existsSync(fresh));
  const log = fs.readFileSync(path.join(__dirname, '..', '..', 'server.log'), 'utf8');
  t.check('server.log notes the saved images (terminal id and size, never the content)', new RegExp('paste-image ' + cl + ' ' + PNG.length + ' bytes').test(log));

  c.close(); srv.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
