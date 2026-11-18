// קוד שרץ בתוך הדף (בהעתק הזמני של האפליקציה בלבד), לפני הממשק. window.__SCENE__ מוגדר לפניו על ידי scenes.js.
// מנקה אחסון, מחליף fetch של כתובות שמחזירות מידע אישי (היסטוריית שיחות, סוכנים פתוחים) בנתוני דמה,
// ומציב window.__sceneHelpers לתסריט של הסצנה.
(function () {
  const cfg = window.__SCENE__;
  try { localStorage.clear(); for (const [k, v] of Object.entries(cfg.storage || {})) localStorage.setItem('tg.' + k, JSON.stringify(v)); } catch (e) { /* חסום */ }

  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const key = String(url).split('?')[0];
    if (Object.prototype.hasOwnProperty.call(cfg.stubs, key)) {
      return Promise.resolve(new Response(JSON.stringify(cfg.stubs[key]), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return realFetch(url, opts);
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // בודק כל step מילישניות עד ש-fn מחזירה אמת; אחרי ms מוותר ומחזיר false (לא זורק, כדי שהצילום ייווצר בכל מקרה)
  async function waitFor(fn, ms = 12000, step = 50) {
    for (let i = 0; i < ms / step; i++) { if (fn()) return true; await sleep(step); }
    return false;
  }
  const click = async (sel) => {
    const el = $(sel);
    if (!el) throw new Error('לא נמצא אלמנט: ' + sel);
    el.click();
    await sleep(120);
  };

  async function ready() {
    await waitFor(() => document.fonts.status === 'loaded', 6000);
    const n = cfg.expectPanes;
    if (n) await waitFor(() => $$('.pane .xterm-screen').length >= n, 12000);
    else await waitFor(() => { const e = $('#empty'); return e && !e.hidden; }, 8000);
    await sleep(cfg.settle == null ? 2500 : cfg.settle);
  }

  // שגיאת תסריט נראית על המסך, כדי שלא תעבור בלי שמישהו שם לב
  function fail(e) {
    console.error('scene failed', e);
    const b = document.createElement('div');
    b.textContent = 'SCENE ERROR: ' + (e && e.message || e);
    b.style.cssText = 'position:fixed;inset-inline:0;bottom:0;z-index:99999;background:#c00;color:#fff;padding:8px 12px;font:14px monospace;direction:ltr';
    document.body.appendChild(b);
  }

  window.__sceneHelpers = { $, $$, sleep, waitFor, click, ready, fail, cfg };
})();
