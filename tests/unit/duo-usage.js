'use strict';
// server/duo/usage.js: tokens and estimated cost from the Claude logs of a project folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checker } = require('../lib/harness');

const t = checker('duo usage (tokens and estimated cost from the Claude logs)');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-usage-'));
process.env.TG_CLAUDE_HOME = home;
const usage = require('../../server/duo/usage');

const BS = String.fromCharCode(92);
const project = 'C:' + BS + 'work' + BS + 'my project';
const dir = path.join(home, '.claude', 'projects', usage.encode(project));
fs.mkdirSync(dir, { recursive: true });
const msg = (id, u) => JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: u[0], output_tokens: u[1], cache_read_input_tokens: u[2], cache_creation_input_tokens: u[3] } } });

(async () => {
  t.check('the folder name is encoded like Claude does', usage.encode(project) === 'C--work-my-project', usage.encode(project));
  t.check('no log folder -> null', (await usage.projectUsage('C:' + BS + 'nowhere', 0)) === null);

  // one message written as three lines with the same usage (and the last one with a larger output): counted ONCE, with the largest values
  fs.writeFileSync(path.join(dir, 's1.jsonl'), [msg('m1', [100, 10, 1000, 50]), msg('m1', [100, 10, 1000, 50]), msg('m1', [100, 40, 1000, 50]), msg('m2', [10, 5, 2000, 0]), 'not json', JSON.stringify({ type: 'user' })].join('\n') + '\n');
  let u = await usage.projectUsage(project, 0);
  t.check('a message with repeated lines is counted once (largest values)', u.input === 110 && u.output === 45 && u.cacheRead === 3000 && u.cacheWrite === 50, JSON.stringify(u));
  const expected = (110 * usage.PRICES.input + 45 * usage.PRICES.output + 3000 * usage.PRICES.cacheRead + 50 * usage.PRICES.cacheWrite5m) / 1e6;
  t.check('the cost follows the price table', Math.abs(u.cost - expected) < 1e-12, String(u.cost));

  // the 1-hour cache write has its own (higher) rate: the log carries the split
  fs.writeFileSync(path.join(dir, 's3.jsonl'), JSON.stringify({ type: 'assistant', message: { id: 'm9', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000000, cache_creation: { ephemeral_1h_input_tokens: 600000, ephemeral_5m_input_tokens: 400000 } } } }) + '\n');
  const only = await usage.projectUsage(project, Date.now() - 60000);
  t.check('a cache write is billed at the 5-minute and 1-hour rates by the log split', only.cacheWrite5m >= 400000 && Math.abs(usage.cost({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 400000, cacheWrite1h: 600000 }) - (0.4 * 2.5 + 0.6 * 4)) < 1e-9, JSON.stringify(only));
  fs.unlinkSync(path.join(dir, 's3.jsonl'));

  // a second conversation file (what /clear creates) is added to the total
  fs.writeFileSync(path.join(dir, 's2.jsonl'), msg('m3', [1, 1, 1, 1]) + '\n');
  u = await usage.projectUsage(project, 0);
  t.check('every conversation file of the project is summed (a /clear never loses anything)', u.files === 2 && u.input === 111 && u.output === 46, JSON.stringify(u));

  // appended lines are read incrementally; a half-written last line waits for the rest
  fs.appendFileSync(path.join(dir, 's1.jsonl'), msg('m4', [5, 5, 5, 5]).slice(0, 30));
  let u2 = await usage.projectUsage(project, 0);
  t.check('a half-written last line is not counted yet', u2.input === 111, JSON.stringify(u2));
  fs.appendFileSync(path.join(dir, 's1.jsonl'), msg('m4', [5, 5, 5, 5]).slice(30) + '\n');
  u2 = await usage.projectUsage(project, 0);
  t.check('...and is counted once it is complete', u2.input === 116, JSON.stringify(u2));

  // files not touched since the pair was created are ignored
  const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  fs.utimesSync(path.join(dir, 's2.jsonl'), old, old);
  u2 = await usage.projectUsage(project, Date.now() - 24 * 3600 * 1000);
  t.check('conversations older than the pair are ignored', u2.files === 1 && u2.input === 115, JSON.stringify(u2));

  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* temp */ }
  process.exit(t.finish() ? 0 : 1);
})();
