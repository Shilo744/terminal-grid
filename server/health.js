'use strict';
/*
 * בריאות השרת: השהיית לולאת האירועים (monitorEventLoopDelay), זיכרון, ו"כלב שמירה" שרושם ביומן כשהלולאה נחסמה יותר מ-200ms.
 * לולאה חסומה = הקלדה שמגיעה לטרמינל באיחור (התחושה של "קפיאה"), ולכן זה המדד העיקרי להשוואה לפני/אחרי.
 */
const { monitorEventLoopDelay } = require('perf_hooks');

const WATCH_MS = 50;
const BLOCK_MS = 200;
const ns2ms = (n) => Math.round(n / 1e4) / 100; // ננו-שניות -> מילישניות עם שתי ספרות

function createHealth({ log = () => {} } = {}) {
  const hist = monitorEventLoopDelay({ resolution: 10 });
  hist.enable();
  const startedAt = Date.now();
  let last = Date.now();
  let blocks = 0;
  let worst = 0;

  // כלב שמירה: אם הטיימר הזה מתעכב משמעותית, מישהו חסם את הלולאה
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - last - WATCH_MS;
    last = now;
    if (lag > BLOCK_MS) {
      blocks++;
      worst = Math.max(worst, lag);
      log(`event loop blocked for ~${lag}ms`);
    }
  }, WATCH_MS);
  if (timer.unref) timer.unref();

  return {
    // reset: מאפס את ההיסטוגרמה (למדידה: מאפסים, מבצעים עבודה, קוראים)
    snapshot({ sessions = 0, clients = 0, reset = false } = {}) {
      const out = {
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        rssMB: Math.round(process.memoryUsage().rss / 1048576),
        sessions, clients,
        loopDelayMs: { p50: ns2ms(hist.percentile(50)), p99: ns2ms(hist.percentile(99)), max: ns2ms(hist.max), mean: ns2ms(hist.mean) },
        blocked: { count: blocks, worstMs: worst },
      };
      if (reset) { hist.reset(); blocks = 0; worst = 0; }
      return out;
    },
  };
}

module.exports = { createHealth };
