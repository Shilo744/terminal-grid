/* ---------- "הבא סוכן פתוח" ---------- */
// אי אפשר להעביר תהליך רץ לחלון אחר, לכן "מביאים": השרת סוגר את הסוכן במקור ופותח כאן claude --resume לאותה שיחה.
import { $ } from './dom.js';
import { basename } from './util.js';
import { toast } from './toast.js';

const adoptPop = $('#adoptPop');
const adoptList = $('#adoptList');
const adoptAll = $('#adoptAll');

function adoptMessage(text) {
  adoptList.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'recent-empty';
  li.textContent = text;
  adoptList.appendChild(li);
}

async function loadAdopt() {
  adoptAll.hidden = true;
  adoptMessage('בודק…');
  let items;
  try {
    const res = await fetch('/api/claude-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    items = (await res.json()).sessions || [];
  } catch { adoptMessage('הבדיקה נכשלה'); return; }
  if (!items.length) { adoptMessage('אין סוכנים פתוחים'); return; }
  adoptList.innerHTML = '';
  for (const it of items) adoptList.appendChild(adoptRow(it));
  adoptAll.hidden = items.length < 2;
  adoptAll.dataset.count = items.length;
}

// הכפתור דורש שתי לחיצות, כי הייבוא סוגר את הסוכן בחלון המקורי (גם אם הוא באמצע עבודה)
function twoStep(btn, idleText, askText, run) {
  let timer = null;
  btn.addEventListener('click', async () => {
    if (!timer) {
      btn.textContent = askText;
      btn.classList.add('danger-fill');
      timer = setTimeout(() => { timer = null; btn.textContent = idleText; btn.classList.remove('danger-fill'); }, 5000);
      return;
    }
    clearTimeout(timer);
    timer = null;
    btn.disabled = true;
    btn.textContent = '…';
    try { await run(); } catch (e) { toast(e.message || 'הייבוא נכשל', 'error'); }
    btn.disabled = false;
    btn.textContent = idleText;
    btn.classList.remove('danger-fill');
    if (!adoptPop.hidden) loadAdopt();
  });
}

async function postAdopt(body) {
  const res = await fetch('/api/adopt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'הייבוא נכשל');
  return j;
}

function adoptRow(it) {
  const busy = it.status === 'busy';
  const li = document.createElement('li');
  li.className = 'adopt-item';
  li.innerHTML = '<div class="adopt-info"><div class="adopt-name"><bdi class="n"></bdi><span class="adopt-state"></span></div><div class="adopt-path"></div></div>' +
    '<button type="button" class="btn adopt-go">ייבא</button>';
  $('.n', li).textContent = basename(it.cwd) || it.cwd;
  const st = $('.adopt-state', li);
  st.textContent = busy ? 'עובד' : 'ממתין';
  st.classList.toggle('busy', busy);
  $('.adopt-path', li).textContent = it.cwd;
  $('.adopt-path', li).title = it.cwd;
  twoStep($('.adopt-go', li), 'ייבא', 'לאשר?', async () => {
    await postAdopt({ pid: it.pid, sessionId: it.sessionId });
    closeAdopt();
  });
  return li;
}

// anchor: הכפתור שהחלון נפתח מתחתיו (החץ של "חדש" או כפתור "עוד")
let openFrom = null;
export function openAdopt(anchor) {
  openFrom = anchor;
  const r = anchor.getBoundingClientRect();
  adoptPop.hidden = false;
  adoptPop.style.top = (r.bottom + 8) + 'px';
  adoptPop.style.left = Math.max(8, Math.min(r.left, innerWidth - adoptPop.offsetWidth - 8)) + 'px';
  adoptPop.style.right = 'auto';
  loadAdopt();
}
function closeAdopt() {
  adoptPop.hidden = true;
}

export function initAdopt() {
  twoStep(adoptAll, 'ייבא הכל', 'לאשר?', async () => {
    const j = await postAdopt({ all: true });
    closeAdopt();
    if (j.failed) toast(`${j.done} יובאו, ${j.failed} נכשלו`, 'error');
  });
  document.addEventListener('pointerdown', (e) => {
    if (!adoptPop.hidden && !adoptPop.contains(e.target)) closeAdopt();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !adoptPop.hidden) { closeAdopt(); if (openFrom && openFrom.isConnected) openFrom.focus(); } });
}
