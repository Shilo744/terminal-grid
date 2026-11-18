'use strict';
// @slow
// T72: a start-up that really is slow (no hook, no input box) shows a plain "Claude מתחיל… N שניות" after 5 seconds so the user can see it is alive, and the label is gone when it ends.
const path = require('path');
const { FIXTURES, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('slow start-up label');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-ticker'), env: { TG_STARTUP_TIMEOUT_MS: '11000', TG_STARTUP_QUIET_MS: '0' } });
  const keeper = await connect(srv.port);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1300, height: 800 });
  await page.appReady(0);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'slow' });
  await page.appReady(1);
  const title = () => page.ev(`(() => { const e = document.querySelector('.pane-startup'); return e && !e.hidden ? e.querySelector('.ps-title').textContent : null; })()`);
  t.check('during the first seconds the cover says "מכין את Claude…"', (await title()) === 'מכין את Claude…', String(await title()));
  const slow = await poll(async () => { const x = await title(); return /^Claude מתחיל… \d+ שניות$/.test(x || '') ? x : null; }, 9000, 250);
  t.check('after about 5 seconds it says "Claude מתחיל… N שניות" (it is alive, only slow)', !!slow, String(slow));
  t.check('the elapsed seconds are 5 or more', !!slow && Number(/\d+/.exec(slow)[0]) >= 5, String(slow));
  await poll(async () => (await title()) === null, 12000, 250);
  t.check('when the start-up ends the cover is gone', (await title()) === null);
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
