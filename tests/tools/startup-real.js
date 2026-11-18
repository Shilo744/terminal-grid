'use strict';
/*
 * T72: how long does the "מכין את Claude…" cover stay up with a REAL Claude Code? (manual tool, not part of npm test)
 *   node tests/tools/startup-real.js [runs=3]
 * Starts the app server on port 7795 (fresh state file, real home and claude), opens one headless Chrome (so the page exists like for a user) and creates `runs` Claude
 * terminals one after the other in this folder. Per terminal it prints: ms from the create message to the server's "startup ready" (and WHY it ended),
 * and ms until the input box (rule line + marker row) is really on the screen. Nothing is submitted. Closed by exact pid at the end.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { REAL_HOME, sleep, poll, connect, openPage, tracker, getJson } = require('../lib/harness');

const RUNS = Number(process.argv[2]) || 3;
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 7795;
const OUT = path.join(__dirname, '..', '.tmp', 'startup-real');
fs.mkdirSync(OUT, { recursive: true });
const drive = path.parse(REAL_HOME).root.replace(/[\\/]+$/, '');
const realEnv = { ...process.env, USERPROFILE: REAL_HOME, HOME: REAL_HOME, HOMEDRIVE: drive, HOMEPATH: REAL_HOME.slice(drive.length), LOCALAPPDATA: process.env.TG_REAL_LOCALAPPDATA, APPDATA: process.env.TG_REAL_APPDATA };
delete realEnv.CLAUDE_CODE_CHILD_SESSION;

(async () => {
  for (const f of ['state.json', 'settings.json']) { try { fs.unlinkSync(path.join(OUT, f)); } catch { /* none */ } }
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...realEnv, PORT: String(PORT), TG_STATE_FILE: path.join(OUT, 'state.json'), TG_SETTINGS_FILE: path.join(OUT, 'settings.json'), TG_KEEP_ALIVE: '1' }, stdio: 'ignore' });
  tracker.record(server.pid, 'node.exe', 'startup-real server');
  for (let i = 0; i < 40; i++) { try { await getJson(`http://127.0.0.1:${PORT}/api/info`); break; } catch { await sleep(300); } }
  const keeper = await connect(PORT);
  const page = await openPage(`http://127.0.0.1:${PORT}/`, { width: 1300, height: 800 });
  await page.appReady(0);
  const rows = [];
  for (let n = 1; n <= RUNS; n++) {
    const t0 = Date.now();
    const mark = keeper.messages.length;
    keeper.send({ t: 'create', kind: 'claude', cwd: ROOT, name: 'real' + n });
    const created = await poll(() => keeper.messages.slice(mark).find((m) => m.t === 'created'), 20000, 20);
    const id = created.session.id;
    const ready = await poll(() => keeper.messages.slice(mark).find((m) => m.t === 'startup' && m.id === id && m.phase === 'ready'), 60000, 20);
    const readyMs = Date.now() - t0;
    await page.waitFor(`!!document.querySelector('.pane[data-id="${id}"]')`, 20000);
    const boxMs = await (async () => {
      const ok = await poll(async () => page.ev(`import('/js/state.js').then(async ({ state }) => { const m = await import('/js/input-select.js'); const p = state.panes.get('${id}'); return !!(p && m.findInput(p.term)); })`), 60000, 50);
      return ok ? Date.now() - t0 : -1;
    })();
    rows.push({ run: n, readyMs, why: ready && ready.why, boxMs });
    console.log(JSON.stringify(rows[rows.length - 1]));
    keeper.send({ t: 'close', id });
    await sleep(1500);
  }
  const avg = (k) => Math.round(rows.reduce((a, r) => a + r[k], 0) / rows.length);
  console.log(`AVERAGE cover-ready ${avg('readyMs')} ms, input box visible ${avg('boxMs')} ms (${RUNS} runs)`);
  page.close(); keeper.close();
  tracker.killTree(server.pid); tracker.forget(server.pid);
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
