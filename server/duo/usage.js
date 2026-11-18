'use strict';
/*
 * Usage and cost of a pair (for the board header).
 * Claude Code writes every conversation to ~/.claude/projects/<folder>/<session>.jsonl with the token usage of each message.
 * A /clear starts a NEW conversation (a new file), so the cost shown by /cost inside the terminal starts again from zero;
 * here every file of the project folder that was touched since the pair was created is summed instead, so clearing never loses anything.
 *   - A message is written as several lines (one per content block) that repeat the same usage: counted once per message id (the largest values).
 *   - Files are read incrementally (append-only), so a 100 MB log is read once and then only its new tail.
 *   - The prices are Claude Code's own table for the model (PRICES below); a cache write is billed at the 5-minute or the 1-hour rate according to the log.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// $ per million tokens: the exact table of Claude Code for Sonnet 5.5 (tier_2_10_cache_read_0_10, read from the claude executable)
const PRICES = { input: 2, output: 10, cacheRead: 0.1, cacheWrite5m: 2.5, cacheWrite1h: 4 };
const PRICE_BY_MODEL = { 'claude-sonnet-5-5': PRICES }; // a model without a known table is priced like Sonnet 5.5 and listed in unknownModels
const CHUNK = 32 * 1024 * 1024;

const encode = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');
const projectsDir = () => path.join(process.env.TG_CLAUDE_HOME || os.homedir(), '.claude', 'projects');
const files = new Map(); // file -> { offset, byId }

function addLine(entry, line) {
  if (!line || line.indexOf('"usage"') < 0) return;
  let j;
  try { j = JSON.parse(line); } catch { return; }
  const m = j && j.type === 'assistant' && j.message;
  const u = m && m.usage;
  if (!u) return;
  const id = m.id || j.uuid || j.requestId;
  if (!id) return;
  const cc = u.cache_creation || {};
  const w1h = cc.ephemeral_1h_input_tokens || 0;
  const w5m = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : Math.max(0, (u.cache_creation_input_tokens || 0) - w1h); // no breakdown in the log: the 5-minute rate
  const prev = entry.byId.get(id) || [0, 0, 0, 0, 0, m.model || 'unknown'];
  entry.byId.set(id, [
    Math.max(prev[0], u.input_tokens || 0), Math.max(prev[1], u.output_tokens || 0),
    Math.max(prev[2], u.cache_read_input_tokens || 0), Math.max(prev[3], w5m), Math.max(prev[4], w1h), m.model || prev[5],
  ]);
}

async function readNew(file, size) {
  let entry = files.get(file);
  if (!entry || size < entry.offset) { entry = { offset: 0, byId: new Map() }; files.set(file, entry); }
  if (size === entry.offset) return entry;
  const fh = await fs.promises.open(file, 'r');
  try {
    while (entry.offset < size) {
      const want = Math.min(CHUNK, size - entry.offset);
      const buf = Buffer.allocUnsafe(want);
      const { bytesRead } = await fh.read(buf, 0, want, entry.offset);
      if (!bytesRead) break;
      const nl = buf.lastIndexOf(10, bytesRead - 1); // only complete lines: a half-written last line waits for the next read
      if (nl < 0) break;
      for (const l of buf.toString('utf8', 0, nl + 1).split('\n')) addLine(entry, l);
      entry.offset += nl + 1;
    }
  } finally { await fh.close(); }
  return entry;
}

const costOf = (t, p) => (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite5m * p.cacheWrite5m + t.cacheWrite1h * p.cacheWrite1h) / 1e6;
const cost = (t) => costOf(t, PRICES);

/** Totals of all conversations in the project folder that were touched at or after `since` (ms). */
async function projectUsage(project, since = 0) {
  const dir = path.join(projectsDir(), encode(project));
  let names = [];
  try { names = (await fs.promises.readdir(dir)).filter((n) => n.endsWith('.jsonl')); } catch { return null; }
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, files: 0, models: {}, unknownModels: [] };
  for (const n of names) {
    const f = path.join(dir, n);
    let st;
    try { st = await fs.promises.stat(f); } catch { continue; }
    if (st.mtimeMs < since) continue;
    const e = await readNew(f, st.size);
    total.files++;
    for (const v of e.byId.values()) {
      const model = v[5];
      if (model === '<synthetic>') continue; // Claude Code's own placeholder messages: no tokens were billed
      const mm = total.models[model] || (total.models[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
      mm.input += v[0]; mm.output += v[1]; mm.cacheRead += v[2]; mm.cacheWrite5m += v[3]; mm.cacheWrite1h += v[4];
      total.input += v[0]; total.output += v[1]; total.cacheRead += v[2]; total.cacheWrite5m += v[3]; total.cacheWrite1h += v[4];
    }
  }
  total.cost = 0;
  for (const [model, mm] of Object.entries(total.models)) {
    const price = PRICE_BY_MODEL[model];
    if (!price) total.unknownModels.push(model);
    mm.cost = costOf(mm, price || PRICES);
    total.cost += mm.cost;
  }
  total.cacheWrite = total.cacheWrite5m + total.cacheWrite1h;
  return total;
}

/** Size of the conversation right now: the prompt of the LAST model call of that session (input + cache read + cache write), or null when unknown. Reads only the tail of the log. */
function contextTokens(project, claudeId) {
  if (!claudeId) return null;
  const f = path.join(projectsDir(), encode(project), claudeId + '.jsonl');
  let fd;
  try {
    fd = fs.openSync(f, 'r');
    const size = fs.fstatSync(fd).size, want = Math.min(size, 512 * 1024);
    const buf = Buffer.allocUnsafe(want);
    fs.readSync(fd, buf, 0, want, size - want);
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (l.indexOf('"usage"') < 0 || l.indexOf('"type":"assistant"') < 0) continue;
      let j; try { j = JSON.parse(l); } catch { continue; }
      const u = j && j.message && j.message.usage;
      if (u && j.message.model !== '<synthetic>') return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
    return null;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

module.exports = { projectUsage, contextTokens, cost, encode, PRICES };
