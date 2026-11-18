'use strict';
// Output flushing (T26): a terminal that prints a lot arrives complete and in order, in messages of at most 64KB,
// and /api/health reports the event-loop delay.
const { sleep, poll, checker, startServer, connect, getJson } = require('../lib/harness');

(async () => {
  const t = checker('output flush: order, chunking, health');
  const srv = await startServer({});
  const c = await connect(srv.port);
  c.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'F', reqId: 'a' });
  await poll(() => c.sessions.size === 1, 15000);
  const id = [...c.sessions.keys()][0];
  await poll(() => (c.out.get(id) || '').includes('PS '), 20000);
  c.send({ t: 'input', id, d: '1..40000 | % { "LN$_ " + ("x" * 20) }\r' });
  await poll(() => /LN40000 /.test(c.out.get(id) || ''), 90000);
  await sleep(300);

  const out = c.out.get(id) || '';
  const nums = [...out.matchAll(/LN(\d+) x{20}/g)].map((m) => Number(m[1]));
  t.check('all 40000 lines arrived', nums.length >= 40000 && nums[nums.length - 1] === 40000, `${nums.length} lines, last ${nums[nums.length - 1]}`);
  t.check('in order, with no gaps and no duplicates', nums.every((n, i) => i === 0 || n === nums[i - 1] + 1), 'first break at ' + nums.findIndex((n, i) => i > 0 && n !== nums[i - 1] + 1));
  const sizes = c.messages.filter((m) => m.t === 'data' && m.id === id).map((m) => m.d.length);
  t.check('no data message is larger than 64KB', Math.max(...sizes) <= 64 * 1024, `largest ${Math.max(...sizes)}`);
  t.check('the output was batched (far fewer messages than lines)', sizes.length < 20000, `${sizes.length} messages`);

  const h = await getJson(`http://127.0.0.1:${srv.port}/api/health`);
  t.check('/api/health reports uptime, memory, sessions and loop delay', h.uptimeSec >= 0 && h.rssMB > 10 && h.sessions === 1 && typeof h.loopDelayMs.p99 === 'number' && typeof h.blocked.count === 'number', JSON.stringify(h));
  const reset = await getJson(`http://127.0.0.1:${srv.port}/api/health?reset=1`);
  const after = await getJson(`http://127.0.0.1:${srv.port}/api/health`);
  t.check('?reset=1 clears the histogram', after.loopDelayMs.max <= reset.loopDelayMs.max);

  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
