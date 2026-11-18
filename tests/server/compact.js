'use strict';
// Auto-compact settings (T21): schema normalisation, and the environment a NEW Claude terminal gets in each mode.
// Real Claude behaviour of these variables is not tested here (fake claude that prints its environment).
const path = require('path');
const { FIXTURES, sleep, poll, checker, startServer, connect } = require('../lib/harness');
const S = require('../../server/settings');

(async () => {
  const t = checker('auto-compact settings + environment');

  /* ---------- schema ---------- */
  const d = S.defaults();
  t.check('defaults: mode "default", window 400000', d.claude.autoCompact.mode === 'default' && d.claude.autoCompact.window === 400000);
  const n = S.normalize({ claude: { autoCompact: { mode: 'late', window: 123 } } });
  t.check('an unknown mode or window falls back to the defaults', n.claude.autoCompact.mode === 'default' && n.claude.autoCompact.window === 400000);
  t.check('valid values are kept', S.normalize({ claude: { autoCompact: { mode: 'early', window: 250000 } } }).claude.autoCompact.window === 250000 && S.normalize({ claude: { autoCompact: { mode: 'off' } } }).claude.autoCompact.mode === 'off');
  t.check('the window must be one of the four presets', S.normalize({ claude: { autoCompact: { window: 100000 } } }).claude.autoCompact.window === 400000 && S.normalize({ claude: { autoCompact: { window: '250000' } } }).claude.autoCompact.window === 400000);
  const env = (mode, window) => S.autoCompactEnv({ claude: { autoCompact: { mode, window } } });
  t.check('autoCompactEnv: default sets nothing, early sets the window, off sets DISABLE_AUTO_COMPACT', JSON.stringify(env('default', 150000).env) === '{}' && env('early', 150000).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '150000' && env('off', 150000).env.DISABLE_AUTO_COMPACT === '1');
  t.check('the signature tells modes (and windows) apart', env('early', 150000).sig === 'early:150000' && env('early', 600000).sig === 'early:600000' && env('off', 1).sig === 'off' && env('default', 1).sig === 'default');

  /* ---------- real terminals ---------- */
  // the user's own environment: a CLAUDE_CODE_* variable must still be stripped (cleanEnv), another variable must survive, and a pre-set DISABLE_AUTO_COMPACT must not be overridden in default mode
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-env'), env: { CLAUDE_CODE_OTHER: 'leak', TG_TEST_KEEP: 'kept', DISABLE_AUTO_COMPACT: '' } });
  const c = await connect(srv.port);
  await poll(() => c.settings, 8000);
  const run = async (patch, label) => {
    c.send({ t: 'settings:set', patch: { claude: { autoCompact: patch } }, rid: 'p' + label });
    await poll(() => c.messages.some((m) => m.t === 'settings' && m.rid === 'p' + label), 8000);
    const before = c.sessions.size;
    c.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: label, reqId: label });
    await poll(() => c.sessions.size === before + 1, 15000);
    const id = [...c.sessions.values()].find((s) => s.name === label).id;
    await poll(() => /ENVCHK .* END/.test(c.out.get(id) || ''), 20000);
    const line = /ENVCHK AUTO=(\S*) DISABLE=(\S*) OTHER=(\S*) KEEP=(\S*) END/.exec(c.out.get(id) || '');
    return line ? { auto: line[1], disable: line[2], other: line[3], keep: line[4], meta: c.sessions.get(id) } : null;
  };

  let r = await run({ mode: 'default' }, 'default');
  t.check('default mode: neither variable is set', !!r && r.auto === '' && r.disable === '', JSON.stringify(r && { a: r.auto, d: r.disable }));
  t.check('cleanEnv still strips other CLAUDE_CODE_* variables, other variables survive', !!r && r.other === '' && r.keep === 'kept', JSON.stringify(r && { o: r.other, k: r.keep }));
  t.check('the terminal meta carries the setting it started with', !!r && r.meta.compact === 'default');

  r = await run({ mode: 'early', window: 250000 }, 'early');
  t.check('early mode: CLAUDE_CODE_AUTO_COMPACT_WINDOW is passed (and survives cleanEnv)', !!r && r.auto === '250000' && r.disable === '', JSON.stringify(r && { a: r.auto, d: r.disable }));
  t.check('its meta says early:250000', !!r && r.meta.compact === 'early:250000');
  r = await run({ mode: 'early', window: 600000 }, 'early2');
  t.check('another window value is used for the next terminal', !!r && r.auto === '600000');

  r = await run({ mode: 'off' }, 'off');
  t.check('off mode: DISABLE_AUTO_COMPACT=1 and no window', !!r && r.disable === '1' && r.auto === '', JSON.stringify(r && { a: r.auto, d: r.disable }));
  t.check('a terminal that was already running keeps its old signature', c.sessions.get([...c.sessions.values()].find((s) => s.name === 'default').id).compact === 'default');

  // PowerShell terminals never get the variables
  const before = c.sessions.size;
  c.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps', reqId: 'ps' });
  await poll(() => c.sessions.size === before + 1, 15000);
  await sleep(300);
  t.check('a PowerShell terminal has no compact signature', ![...c.sessions.values()].find((s) => s.name === 'ps').compact);

  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
