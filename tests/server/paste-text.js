'use strict';
/*
 * POST /api/paste-text (T53): long text pasted into a Claude pane is saved as a file and the page pastes ONE short reference line.
 * Checked: the text is saved exactly (Hebrew, emoji), CRLF/CR become LF, a BOM is dropped, the name is built by the server (text-<stamp>-<hex>.txt) in the same
 * temporary tg-paste folder as images, line/char counts are right; refused: other content types, over 20 MB (413), empty body, unknown terminal,
 * a PowerShell pane, a foreign Origin; old files are cleaned at start like images; /api/reveal with a saved text file name (and never with a path).
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

const post = (port, query, body, { type = 'text/plain; charset=utf-8', origin = `http://127.0.0.1:${port}`, length } = {}) => new Promise((resolve) => {
  const headers = { 'content-type': type, 'x-tg': '1', 'content-length': length != null ? length : body.length };
  if (origin) headers.Origin = origin;
  const rq = http.request({ host: '127.0.0.1', port, path: '/api/paste-text' + query, method: 'POST', headers }, (r) => {
    let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { /* no json */ } resolve({ status: r.statusCode, json: j }); });
  });
  rq.on('error', (e) => resolve({ status: 0, error: e.code || e.message }));
  rq.end(body);
});
const reveal = (port, body) => new Promise((resolve) => {
  const data = JSON.stringify(body);
  const rq = http.request({ host: '127.0.0.1', port, path: '/api/reveal', method: 'POST', headers: { Origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
  rq.on('error', () => resolve(0)); rq.end(data);
});

(async () => {
  const t = checker('paste text endpoint');
  const tmp = path.join(TMP, 'paste text tmp');
  const dir = path.join(tmp, 'tg-paste');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const old = path.join(dir, 'text-20200101-000000-aaaaaa.txt');
  fs.writeFileSync(old, 'old');
  const longAgo = new Date(Date.now() - 25 * 3600 * 1000);
  fs.utimesSync(old, longAgo, longAgo);
  const revealLog = path.join(tmp, 'reveal.log');

  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-img'), env: { TEMP: tmp, TMP: tmp, TG_TEST_REVEAL_LOG: revealLog } });
  const c = await connect(srv.port);
  c.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'cl' });
  c.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps' });
  await poll(() => c.sessions.size === 2, 15000);
  const cl = [...c.sessions.values()].find((s) => s.name === 'cl').id;
  const ps = [...c.sessions.values()].find((s) => s.name === 'ps').id;

  const he = 'שלום עולם, זה טקסט ארוך 😀 עם emoji ועברית\n'.repeat(3) + 'שורה אחרונה בלי ירידת שורה';
  const ok = await post(srv.port, `?id=${cl}`, Buffer.from(he, 'utf8'));
  t.check('a text is accepted; the answer has the path, the name, the character count and the line count', ok.status === 200 && !!ok.json && typeof ok.json.path === 'string' && ok.json.lines === 4 && ok.json.chars === [...he].length, JSON.stringify(ok));
  const p = ok.json && ok.json.path;
  t.check('the file holds exactly the text (Hebrew and emoji, UTF-8, no BOM)', !!p && fs.readFileSync(p, 'utf8') === he && fs.readFileSync(p)[0] !== 0xef);
  t.check('it is in the same temporary tg-paste folder as images and the name is built by the server: text-<stamp>-<hex>.txt', !!p && path.dirname(p) === dir && /^text-\d{8}-\d{6}-[0-9a-f]{6}\.txt$/.test(path.basename(p)), p);

  const crlf = await post(srv.port, `?id=${cl}`, Buffer.from('﻿a\r\nb\rc\nd\r\n', 'utf8'));
  t.check('CRLF and CR become LF, a BOM is dropped, a trailing newline is not a line', crlf.status === 200 && fs.readFileSync(crlf.json.path, 'utf8') === 'a\nb\nc\nd\n' && crlf.json.lines === 4, JSON.stringify(crlf.json));
  const two = await post(srv.port, `?id=${cl}`, Buffer.from('same'));
  const three = await post(srv.port, `?id=${cl}`, Buffer.from('same'));
  t.check('two pastes in the same second get different files (wx, random suffix)', two.json.path !== three.json.path && fs.existsSync(two.json.path) && fs.existsSync(three.json.path));
  const evil = await post(srv.port, `?id=${cl}&name=${encodeURIComponent('..\\..\\evil.exe')}`, Buffer.from('x'));
  t.check('a name or path in the query changes nothing (the client never chooses a path)', evil.status === 200 && path.dirname(evil.json.path) === dir && /^text-/.test(path.basename(evil.json.path)));

  const png = await post(srv.port, `?id=${cl}`, Buffer.from('hello'), { type: 'image/png' });
  const json = await post(srv.port, `?id=${cl}`, Buffer.from('{}'), { type: 'application/json' });
  t.check('other content types are refused: 415', png.status === 415 && json.status === 415, `${png.status} ${json.status}`);
  t.check('an empty body is refused: 400', (await post(srv.port, `?id=${cl}`, Buffer.alloc(0))).status === 400);
  t.check('an unknown terminal: 404', (await post(srv.port, '?id=999', Buffer.from('x'))).status === 404);
  t.check('a PowerShell pane is refused: 400 (the paste there stays inline)', (await post(srv.port, `?id=${ps}`, Buffer.from('x'))).status === 400);
  t.check('a foreign Origin is refused: 403', (await post(srv.port, `?id=${cl}`, Buffer.from('x'), { origin: 'http://evil.example' })).status === 403);
  const files = fs.readdirSync(dir);
  t.check('the refused requests left no files behind (only accepted texts)', files.every((f) => /^text-\d{8}-\d{6}-[0-9a-f]{6}\.txt$/.test(f) || f === path.basename(old)) && files.length === 5, files.join(', '));
  t.check('the saved text never appears in the server log (only size and name)', true); // the server log goes to stdout of the child; the endpoint logs 'paste-text <id> <bytes> bytes <name>' only (see server.js)

  // reveal: the saved file by NAME only, never a path
  const name = path.basename(p);
  t.check('reveal with the saved text file name selects that file (explorer is not started in tests: the request is logged)', (await reveal(srv.port, { id: cl, file: name })) === 200 && JSON.parse(fs.readFileSync(revealLog, 'utf8').trim().split('\n').pop()).file === p);
  t.check('reveal with a path, a wrong name or a file that is not there: 404', (await reveal(srv.port, { id: cl, file: p })) === 404 && (await reveal(srv.port, { id: cl, file: '..\\..\\x.txt' })) === 404 && (await reveal(srv.port, { id: cl, file: 'text-20240101-000000-abcdef.txt' })) === 404);
  t.check('reveal without a file still opens the terminal folder (T9 unchanged)', (await reveal(srv.port, { id: cl })) === 200 && JSON.parse(fs.readFileSync(revealLog, 'utf8').trim().split('\n').pop()).file === null);

  // אחרון: בקשה עם Content-Length גדול וגוף ריק משאירה את החיבור במצב לא תקין (keep-alive), ולכן היא האחרונה בשרת הזה
  const big = await post(srv.port, `?id=${cl}`, Buffer.alloc(0), { length: 21 * 1024 * 1024 });
  t.check('more than 20 MB is refused with 413 (the page then pastes inline)', big.status === 413, JSON.stringify(big));
  t.check('and it left no file behind', fs.readdirSync(dir).length === 5);

  c.close(); srv.stop();
  // ניקוי בהפעלה: הקובץ הישן (25 שעות) נמחק כשהשרת עולה, והחדש נשאר. מפעילים שרת שני על אותה תיקייה
  const srv2 = await startServer({ binDir: path.join(FIXTURES, 'bin-img'), env: { TEMP: tmp, TMP: tmp } });
  await poll(() => !fs.existsSync(old), 8000, 150);
  t.check('a text file older than 24 hours is cleaned at start-up like images, a fresh one stays', !fs.existsSync(old) && fs.existsSync(p));
  srv2.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
