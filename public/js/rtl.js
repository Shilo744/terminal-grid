/*
 * Terminal Grid — שכבת RTL לטרמינלים של Claude.
 *
 * Claude Code שולח לטרמינל שורות עברית כבר מסודרות חזותית, אבל מיושרות לשמאל: נקודת הרשימה בשמאל,
 * והשורה האחרונה של כל פסקה "תלויה" בצד שמאל. הטרמינל עצמו (xterm) רק מצייר תאים משמאל לימין.
 *
 * השכבה הזאת קוראת את שורות הטרמינל החיות (100% מהתוכן, בזמן אמת) ומציירת מחדש רק שורות שהן בעיקר עברית:
 * אותם תאים, אותם צבעים, אותו גופן ואותו גודל תא, רק מוזזים לימין (כולל נקודת הרשימה וההזחה, בתמונת מראה)
 * ועם סוגריים הפוכים מתוקנים. כל שורה אחרת נשארת הטרמינל המקורי, ואזור ההקלדה (תיבת הקלט של Claude) לא
 * נוגעים בו בכלל: הוא נשאר טרמינל אמיתי עם השלמות, בחירה וסמן.
 *
 * זו שכבת ציור (canvas שקוף לעכבר מעל הטרמינל). הטרמינל מתחתיו ממשיך לקבל הכול כרגיל, ולכן ההקלדה,
 * ההעתקה והגלילה לא משתנות.
 *
 * עכבר (T70): העכבר פועל על התאים המקוריים (משמאל), אבל המשתמש רואה ולוחץ על הטקסט המוזז. לכן באירועי עכבר מעל שורה
 * מוזזת מזיזים את x באותה הזזה (delta) בחזרה לתא המקורי לפני ש-xterm רואה אותם: גרירה, לחיצה כפולה, ריחוף וקישורים
 * פועלים על מה שמוצג. שורה שנבחרה נשארת מוזזת, וצבע הבחירה מצויר על הקנבס בתאים המוזזים.
 */
const HEB = /[֐-׿]/;
const LETTER = /[A-Za-z֐-׿]/;
const BOX = /[─-▟]/; // קווי מסגרת ובלוקים: טבלאות, מסגרות, תיבת הקלט
const MARKER = /^(?:[●•·✻✢✶⎿❯>*-]|\d{1,3}[.)])$/;
const SEPARATOR = /^[─━═-]{12,}$/;
const CLOSER = { ')': '(', ']': '[', '}': '{' };
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{' };
const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const CUBE = [0, 95, 135, 175, 215, 255];
const hex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');

function paletteColor(theme, i) {
  if (i < 16) return theme[NAMES[i]];
  if (i < 232) { const n = i - 16; return `rgb(${CUBE[Math.floor(n / 36)]},${CUBE[Math.floor(n / 6) % 6]},${CUBE[n % 6]})`; }
  const g = 8 + (i - 232) * 10;
  return `rgb(${g},${g},${g})`;
}

const isBlank = (s) => s.ch === ' ';

// שורת טרמינל -> רשימת תאים עם צבעים ומאפיינים
function readRow(line, cols, theme, reuse) {
  const segs = [];
  for (let x = 0; x < cols; x++) {
    const c = line.getCell(x, reuse);
    if (!c) break;
    const w = c.getWidth();
    if (w === 0) continue; // חצי שני של תו רחב
    const bold = !!c.isBold();
    let fg;
    if (c.isFgDefault()) fg = theme.foreground;
    else if (c.isFgRGB()) fg = hex(c.getFgColor());
    else { const i = c.getFgColor(); fg = paletteColor(theme, bold && i < 8 ? i + 8 : i); }
    let bg = null;
    if (!c.isBgDefault()) bg = c.isBgRGB() ? hex(c.getBgColor()) : paletteColor(theme, c.getBgColor());
    if (c.isInverse()) { const f = fg; fg = bg || theme.background; bg = f; }
    segs.push({
      x, w, ch: c.getChars() || ' ', fg, bg, bold,
      dim: !!c.isDim(), italic: !!c.isItalic(), underline: !!c.isUnderline(), hidden: !!c.isInvisible(),
    });
  }
  return segs;
}

// טרמינל רגיל (PowerShell, bash ועוד) כותב עברית בסדר לוגי, משמאל לימין. כדי להציג אותה נכון מסדרים את התאים בסדר חזותי:
// רצפים שמאליים (אנגלית, מספרים, נתיבים) נשארים כמו שהם, כל השאר הפוך, וסדר הרצפים מתהפך (אותו אלגוריתם של hebrew-copy.js, בכיוון ההפוך).
// מחזיר את התאים בסדר הציור, עם סוגריים הפוכים (במראה) בחלקים שהתהפכו.
const RUN = /[$~@#/\\]?[A-Za-z0-9_]+(?:[ .,:;\-/\\@#%+=~'"&_!?()[\]{}<>]+[A-Za-z0-9_]+)*%?/g;
function visualOrder(rest) {
  const str = rest.map((s) => s.ch).join('');
  if (str.length !== rest.length) return rest.map((s) => ({ s, ch: s.ch })); // תו מורכב (אימוג'י, צירוף): משאירים בסדר המקורי
  const toks = [];
  let last = 0, m;
  RUN.lastIndex = 0;
  while ((m = RUN.exec(str))) {
    if (m.index > last) toks.push({ a: last, b: m.index, rev: true });
    toks.push({ a: m.index, b: m.index + m[0].length, rev: false });
    last = m.index + m[0].length;
  }
  if (last < str.length) toks.push({ a: last, b: str.length, rev: true });
  const out = [];
  for (const k of toks.reverse()) {
    if (k.rev) for (let i = k.b - 1; i >= k.a; i--) out.push({ s: rest[i], ch: MIRROR[rest[i].ch] || rest[i].ch });
    else for (let i = k.a; i < k.b; i++) out.push({ s: rest[i], ch: rest[i].ch });
  }
  return out;
}

// מחליט אם השורה היא עברית (בעיקרה) ואיפה כל תא צריך לשבת. מחזיר null לשורה שנשארת כמו שהיא.
// logical: השורה מגיעה בסדר לוגי (טרמינל רגיל) ולא בסדר חזותי כמו מ-Claude
function layoutRow(segs, cols, logical) {
  // הודעות המשתמש ב-Claude מגיעות עם פס רקע שמסתיים ברווחים צבועים: הפס נשאר במקומו, והטקסט זז בתוכו
  // (והקצה הימני של הטקסט הוא סוף הפס, לא סוף המסך)
  let bar = null, edge = cols;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.ch === ' ' && !s.bg) continue;
    if (s.ch === ' ' && s.bg) {
      const first = segs.find((q) => q.bg === s.bg);
      bar = { from: first.x, to: s.x + s.w, bg: s.bg };
      edge = bar.to;
    }
    break;
  }
  let end = segs.length;
  while (end > 0 && isBlank(segs[end - 1])) end--;
  let start = 0;
  while (start < end && isBlank(segs[start])) start++;
  if (start >= end) return null;
  const body = segs.slice(start, end);

  let heb = 0, letters = 0;
  for (const s of body) {
    for (const ch of s.ch) {
      if (BOX.test(ch)) return null;
      if (HEB.test(ch)) { heb++; letters++; } else if (LETTER.test(ch)) letters++;
    }
  }
  if (!heb || heb < letters * 0.3) return null;

  // נקודת רשימה בתחילת השורה (● • - 1.) עוברת לימין, וההזחה מתהפכת: שוליים שמאליים -> שוליים ימניים
  let j = 0;
  while (j < body.length && !isBlank(body[j])) j++;
  let marker = null, rest = body;
  if (j < body.length && MARKER.test(body.slice(0, j).map((s) => s.ch).join(''))) {
    let k = j;
    while (k < body.length && isBlank(body[k])) k++;
    if (k < body.length) { marker = body.slice(0, j); rest = body.slice(k); }
  }

  // סוגריים: Claude לא הופך אותם ("(app.js)" מגיע כ-")app.js("). הופכים זוגות שהגיעו הפוכים.
  const stack = [];
  const mirrored = new Map();
  for (const s of rest) {
    if (CLOSER[s.ch]) stack.push(s);
    else if (s.ch === '(' || s.ch === '[' || s.ch === '{') {
      const top = stack[stack.length - 1];
      if (top && CLOSER[top.ch] === s.ch) { stack.pop(); mirrored.set(top, MIRROR[top.ch]); mirrored.set(s, MIRROR[s.ch]); }
    }
  }

  if (logical) {
    // סדר חזותי, מיושר לימין (בלי נקודת רשימה: בטרמינל רגיל אין כזאת). ההזזה לעכבר נשארת 0: הבחירה פועלת על התאים המקוריים
    const order = visualOrder(body);
    const total = order.reduce((n, o) => n + o.s.w, 0);
    let x = Math.max(0, edge - total);
    const placed = [];
    for (const o of order) { placed.push({ s: o.s, x, ch: o.ch }); x += o.s.w; }
    return { placed, bar, delta: 0, marker: null };
  }
  const textStart = rest[0].x;
  const textEnd = rest[rest.length - 1].x + rest[rest.length - 1].w;
  const delta = (edge - textStart) - textEnd; // הקצה הימני החדש = קצה השורה פחות ההזחה המקורית משמאל
  const placed = rest.map((s) => ({ s, x: s.x + delta, ch: mirrored.get(s) || s.ch }));
  let mx = 0;
  if (marker) {
    const mStart = marker[0].x;
    const mEnd = marker[marker.length - 1].x + marker[marker.length - 1].w;
    mx = edge - mStart - (mEnd - mStart);
    for (const s of marker) placed.push({ s, x: s.x - mStart + mx, ch: s.ch });
  }
  return { placed, bar, delta, marker: marker ? { from: marker[0].x, to: mx } : null };
}

export function attach(term, opts) {
  const theme = opts.theme;
  const isOn = opts.isOn || (() => true);
  const logical = !!opts.logical; // טרמינל רגיל: עברית בסדר לוגי
  const isHot = opts.isHot || (() => true); // פאן ממוקד: מצייר בכל רינדור; פאן ברקע: לכל היותר פעם ב-IDLE_MS
  const IDLE_MS = 100;
  const SCROLL_HOT_MS = 300; // כל עוד גוללים (גם פאן שאינו ממוקד) מציירים באותו פריים של xterm, ועוד רגע אחריו (T52)
  const stats = { n: 0, total: 0, max: 0 }; // מדידת עלות הציור (tests/tools/scroll-perf.js): כמה ציורים, סך הזמן והמקסימום
  const rowMaps = []; // לכל שורה בתצוגה שצוירה מוזזת: ההזזה (למיפוי העכבר)
  let canvas = null, ctx = null, drawn = false, failures = 0, raf = 0, w = 0, h = 0, dprUsed = 0, idleTimer = 0, scrollUntil = 0, drawnY = -1;
  const reuse = term.buffer.active.getNullCell();
  const disposables = [];

  function screenEl() {
    const el = term.element && term.element.querySelector('.xterm-screen');
    if (!el) return null;
    if (!canvas || canvas.parentNode !== el) {
      canvas = document.createElement('canvas');
      canvas.className = 'tg-rtl';
      canvas.setAttribute('aria-hidden', 'true');
      el.appendChild(canvas);
      ctx = canvas.getContext('2d');
      w = h = 0;
    }
    return el;
  }

  // היכן מתחיל אזור ההקלדה (באינדקס שורה מוחלט): מהמפריד שמעל הסמן ועד סוף המסך. שורות משם והלאה לא נוגעים בהן.
  function inputTop(buf) {
    const cur = buf.baseY + buf.cursorY;
    for (let i = cur; i >= Math.max(0, cur - 40); i--) {
      const l = buf.getLine(i);
      if (l && SEPARATOR.test(l.translateToString(true).trim())) return i;
    }
    let i = cur;
    while (i > 0) { const l = buf.getLine(i); if (l && l.isWrapped) i--; else break; }
    return i;
  }

  function clear() {
    if (ctx && drawn) ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawn = false;
    rowMaps.length = 0;
  }

  function draw() {
    raf = 0;
    const t0 = performance.now();
    try { drawNow(); } finally { stats.n++; const d = performance.now() - t0; stats.total += d; if (d > stats.max) stats.max = d; }
  }
  function drawNow() {
    drawnY = term.buffer.active.viewportY;
    if (failures > 3) return;
    try {
      const screen = screenEl();
      if (!screen) return;
      const buf = term.buffer.active;
      const W = screen.clientWidth, H = screen.clientHeight;
      // Claude Code עובד במסך חלופי (מסך מלא), לכן אין הגבלה לפי סוג המסך: השכבה מחוברת רק לטרמינלים של Claude
      if (!isOn() || !W || !H) { clear(); return; }

      const dpr = window.devicePixelRatio || 1;
      if (W !== w || H !== h || dpr !== dprUsed) {
        w = W; h = H; dprUsed = dpr;
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawn = false;
      rowMaps.length = 0;

      const cols = term.cols, rows = term.rows;
      const cw = W / cols, ch = H / rows;
      const family = term.options.fontFamily, size = term.options.fontSize;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.font = `${size}px ${family}`;
      const m = ctx.measureText('M');
      const asc = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : size * 0.8;
      const desc = m.fontBoundingBoxDescent != null ? m.fontBoundingBoxDescent : size * 0.2;
      const baseOff = (ch - (asc + desc)) / 2 + asc;

      const limit = inputTop(buf);
      const sel = term.getSelectionPosition();
      for (let r = 0; r < rows; r++) {
        const abs = buf.viewportY + r;
        if (abs >= limit) break;
        const line = buf.getLine(abs);
        if (!line) continue;
        if (!HEB.test(line.translateToString(true))) continue;
        const lay = layoutRow(readRow(line, cols, theme, reuse), cols, logical);
        if (!lay) continue;

        const y = r * ch;
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, y, W, ch);
        rowMaps[r] = lay;
        // בחירה (T70): שורה בחירה נשארת מוזזת, והצבע מצויר בתאים המוזזים. שורות באמצע הבחירה מודגשות לכל הרוחב כמו ב-xterm
        let selFrom = -1, selTo = -1;
        if (sel && abs >= sel.start.y && abs <= sel.end.y) {
          selFrom = abs === sel.start.y ? sel.start.x : 0;
          selTo = abs === sel.end.y ? sel.end.x : cols;
          if (abs > sel.start.y && abs < sel.end.y) { ctx.fillStyle = theme.selectionBackground; ctx.fillRect(0, y, W, ch); }
        }
        const barBg = lay.bar ? lay.bar.bg : null;
        if (lay.bar) { ctx.fillStyle = lay.bar.bg; ctx.fillRect(lay.bar.from * cw, y, (lay.bar.to - lay.bar.from) * cw, ch); }
        for (const p of lay.placed) {
          const s = p.s;
          const x = p.x * cw;
          if (s.bg && s.bg !== barBg) { ctx.fillStyle = s.bg; ctx.fillRect(x, y, s.w * cw, ch); }
          if (s.x >= selFrom && s.x < selTo) { ctx.fillStyle = theme.selectionBackground; ctx.fillRect(x, y, s.w * cw, ch); }
          if (s.hidden || p.ch === ' ') continue;
          ctx.font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${size}px ${family}`;
          ctx.globalAlpha = s.dim ? 0.5 : 1;
          ctx.fillStyle = s.fg;
          ctx.fillText(p.ch, x, y + baseOff);
          if (s.underline) ctx.fillRect(x, y + ch - 2, s.w * cw, 1);
        }
        ctx.globalAlpha = 1;
        drawn = true;
      }
      failures = 0;
    } catch (e) {
      failures++;
      if (failures === 1) console.error('RTL layer', e);
      clear();
    }
  }

  // ציור מיידי (באותו פריים שבו xterm צייר) כדי שלא יהיה הבהוב של שורה שמאלית לפני שהיא זזה לימין
  // ברינדור: הפאן הממוקד מצייר מיד (בלי הבהוב); פאן רעשן ברקע מצייר רק פעם ב-100ms, כך שטרמינלים שזורמים לא מבזבזים עיבוד על שכבה שאף אחד לא מסתכל עליה
  const onRender = () => {
    if (isHot() || performance.now() < scrollUntil) { draw(); return; }
    if (!idleTimer) idleTimer = setTimeout(() => { idleTimer = 0; draw(); }, IDLE_MS);
  };
  disposables.push(term.onRender(onRender));
  // גלילה: xterm מציג מיד את השורות החדשות, אז גם פאן ברקע חייב לצייר מחדש בפריים הזה, אחרת רואים יחד את השכבה הישנה ואת הטרמינל
  disposables.push(term.onScroll(() => { scrollUntil = performance.now() + SCROLL_HOT_MS; }));
  disposables.push(term.onResize(draw));
  // בחירה: מציירים מיד, ועוד פעם בפריים הבא (xterm מעדכן את מיקום הבחירה אחרי האירוע, ובלי זה הצבע נשאר ישן אחרי גרירה שנייה)
  disposables.push(term.onSelectionChange(() => { draw(); if (!raf) raf = requestAnimationFrame(draw); }));

  // מיפוי עכבר (T70): x שעל המסך -> x של התא המקורי באותה שורה. null: לא שורה מוזזת (השורה נשארת כמו שהיא)
  function mapX(e) {
    const screen = canvas && canvas.parentNode;
    if (!screen || !drawn || drawnY !== term.buffer.active.viewportY) return null;
    const rect = screen.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const lay = rowMaps[Math.floor((e.clientY - rect.top) / (rect.height / term.rows))];
    if (!lay) return null;
    const cw = rect.width / term.cols;
    const d = (e.clientX - rect.left) / cw;
    return rect.left + (lay.marker && d >= lay.marker.to ? d - lay.marker.to + lay.marker.from : d - lay.delta) * cw;
  }
  let replay = false, dragging = false;
  const onMouse = (e) => {
    // xterm לא מכריז על שינוי בחירה כשהבחירה זהה לקודמת, והקנבס מצויר מחדש בלי הצבע: אחרי כל לחיצה או שחרור מציירים מחדש בפריים הבא
    if (e.type !== 'mousemove' && !raf) raf = requestAnimationFrame(draw);
    // גרירה: מציירים מחדש את הסימון בכל תנועה (xterm מכריז על שינוי בחירה רק בשחרור), אחרי ש-xterm עדכן את הבחירה
    if (e.type === 'mousemove' && dragging && !raf) raf = requestAnimationFrame(draw);
    if (replay || !e.isTrusted || !isOn()) return;
    const inside = !!(term.element && term.element.contains(e.target));
    if (e.type === 'mousedown') { if (!inside) return; dragging = e.button === 0; } else if (!inside && !dragging) return;
    if (e.type === 'mouseup') dragging = false;
    const x = mapX(e);
    if (x == null || Math.abs(x - e.clientX) < 0.5) return;
    e.stopImmediatePropagation();
    const c = new MouseEvent(e.type, {
      bubbles: true, cancelable: true, composed: true, view: window, detail: e.detail, button: e.button, buttons: e.buttons,
      clientX: x, clientY: e.clientY, screenX: e.screenX + (x - e.clientX), screenY: e.screenY,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, relatedTarget: e.relatedTarget,
    });
    replay = true;
    try { e.target.dispatchEvent(c); } finally { replay = false; }
    if (c.defaultPrevented) e.preventDefault();
  };
  const MOUSE = ['mousedown', 'mousemove', 'mouseup'];
  for (const n of MOUSE) window.addEventListener(n, onMouse, true);

  // החלפת צד (T42): הדלקה: השכבה נכנסת משמאל בהחלקה של 120ms; כיבוי: היא יוצאת שמאלה ואז נמחקת. בלי תנועה כש-prefers-reduced-motion
  const motionOk = () => !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const api = {
    // מיקום התצוגה שעליו צוירה השכבה בפעם האחרונה (לבדיקות: חייב להיות שווה למיקום ה-xterm בסוף כל רינדור)
    get drawnViewportY() { return drawnY; },
    stats, // { n, total, max } במילישניות
    update() { if (!raf) raf = requestAnimationFrame(draw); },
    transition(on) {
      if (!canvas || !motionOk()) { api.update(); return; }
      if (on) {
        api.update();
        requestAnimationFrame(() => requestAnimationFrame(() => { if (canvas) canvas.animate([{ transform: 'translateX(-36px)', opacity: 0.15 }, { transform: 'none', opacity: 1 }], { duration: 120, easing: 'ease-out' }); }));
      } else {
        const a = canvas.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(-36px)', opacity: 0 }], { duration: 120, easing: 'ease-in', fill: 'forwards' });
        a.onfinish = () => { a.cancel(); api.update(); };
      }
    },
    dispose() {
      for (const d of disposables) { try { d.dispose(); } catch { /* ignore */ } }
      for (const n of MOUSE) window.removeEventListener(n, onMouse, true);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
  return api;
}

