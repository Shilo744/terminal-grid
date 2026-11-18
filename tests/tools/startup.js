'use strict';
/*
 * מדידת זמן ההפעלה של טרמינל Claude (T41): מהלחיצה עד טרמינל מוכן, בשלבים: spawn (השרת יצר את הטרמינל), first byte (הפלט הראשון), trust (שאלת האמון נענתה:
 * TRUSTED), ready (השרת שידר שהשכבה "מכין את Claude…" יכולה לרדת). claude מדומה (tests/fixtures/trust.js) שמשחזר את הדיאלוג האמיתי ואת המסך הראשי,
 * ולכן המספרים מודדים את החלק שלנו (שרת + בדיקת המסך + לחיצות) ולא את Claude האמיתי, שיכול להוסיף כמה שניות משלו.
 *
 *   node tests/tools/startup.js [--runs 3]
 *
 * מדלגים על מה שלא שלנו: הפיקסצ'ר מדפיס את השאלה 200ms אחרי ההפעלה (STARTUP_PROMPT_DELAY_MS) ואת המסך הראשי 200ms אחרי Enter.
 * "לפני" = קצב הבדיקה המקורי של T32 (בדיקת מסך כל 250ms, השהיה של 400ms); "אחרי" = T41 (100ms ו-150ms). מוגדרים בשרת דרך TG_TRUST_POLL_MS / TG_TRUST_SETTLE_MS (למדידה בלבד).
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, startServer, connect, strip } = require('../lib/harness');

const runs = Number((process.argv.indexOf('--runs') > 0 && process.argv[process.argv.indexOf('--runs') + 1]) || 3);
const bin = path.join(FIXTURES, 'bin-trust');
const dir = (n) => { const d = path.join(TMP, 'startup-tool', n); fs.mkdirSync(d, { recursive: true }); return d; };
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function grid(env, resume) {
  const srv = await startServer({ binDir: bin, env: { TG_STARTUP_TIMEOUT_MS: '30000', TG_STARTUP_QUIET_MS: '0', ...env } });
  try {
    const c = await connect(srv.port);
    const t0 = Date.now();
    c.send({ t: 'create', kind: 'claude', cwd: dir('g' + Math.random().toString(36).slice(2, 6)), name: 'm', ...(resume ? { resume: '11111111-2222-4333-8444-555555555555' } : {}) });
    const created = await poll(() => c.messages.find((m) => m.t === 'created'), 15000, 5);
    const spawn = Date.now() - t0;
    const id = created.session.id;
    const first = await poll(() => c.messages.find((m) => m.t === 'data' && m.id === id), 15000, 5) && Date.now() - t0;
    const trust = await poll(() => /TRUSTED/.test(strip(c.out.get(id) || '')), 15000, 5) && Date.now() - t0;
    const ready = await poll(() => c.messages.find((m) => m.t === 'startup' && m.id === id), 20000, 5) && Date.now() - t0;
    c.close();
    return { spawn, first, trust, ready };
  } finally { srv.stop(); await sleep(500); }
}

async function pair(env) {
  const srv = await startServer({ binDir: bin, env: { TG_STARTUP_TIMEOUT_MS: '30000', TG_STARTUP_QUIET_MS: '0', ...env } });
  try {
    const c = await connect(srv.port);
    const t0 = Date.now();
    c.send({ t: 'duo', op: 'create', project: dir('p' + Math.random().toString(36).slice(2, 6)), goal: 'x', reqId: 'm' });
    await poll(() => [...c.sessions.values()].filter((s) => s.duo).length === 2, 20000, 5);
    const spawn = Date.now() - t0;
    const ids = [...c.sessions.values()].filter((s) => s.duo).map((s) => s.id);
    await poll(() => ids.every((id) => c.messages.find((m) => m.t === 'startup' && m.id === id)), 30000, 5);
    const ready = Date.now() - t0;
    c.close();
    return { spawn, ready };
  } finally { srv.stop(); await sleep(500); }
}

(async () => {
  const OLD = { TG_TRUST_POLL_MS: '250', TG_TRUST_SETTLE_MS: '400' };
  const rows = [];
  for (const [label, env] of [['before (T32 polling: 250 ms / settle 400 ms)', OLD], ['after (T41: 100 ms / settle 150 ms)', {}]]) {
    const g = [], r = [], p = [];
    for (let i = 0; i < runs; i++) { g.push(await grid(env)); r.push(await grid(env, true)); p.push(await pair(env)); }
    rows.push({ label, g, r, p });
  }
  console.log(`\nStart-up of a new Claude terminal, fake claude (our part only), median of ${runs} runs, ms from the click:\n`);
  console.log('| case | spawn | first byte | trust handled | ready |\n|---|---|---|---|---|');
  for (const { label, g, r, p } of rows) {
    const m = (a, k) => med(a.map((x) => x[k]));
    console.log(`| grid Claude, ${label} | ${m(g, 'spawn')} | ${m(g, 'first')} | ${m(g, 'trust')} | ${m(g, 'ready')} |`);
    console.log(`| resume, ${label} | ${m(r, 'spawn')} | ${m(r, 'first')} | ${m(r, 'trust')} | ${m(r, 'ready')} |`);
    console.log(`| pair (both agents), ${label} | ${m(p, 'spawn')} | | | ${m(p, 'ready')} |`);
  }
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
