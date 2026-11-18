/* ---------- זוגות בתפריט הצד ובסרגל העליון ---------- */
import { $ } from '../dom.js';
import { bus } from '../state.js';
import { isRenameKey, isRenaming, afterRename } from '../rename.js';
import { openDuoMenu } from './ctx.js';
import { duos, closedDuos, selectDuo, setView, duoStatus, duoReason, selectedDuo, duoState, duoName, renameDuo } from './data.js';
import { openCreate } from './create.js';
import { send } from '../connection.js';
import { basename } from '../util.js';

const listEl = $('#duoList');

function render() {
  if (isRenaming()) { afterRename(render); return; } // T71
  listEl.replaceChildren();
  if (!duos.size) {
    const none = document.createElement('div');
    none.className = 'duo-none';
    none.textContent = 'אין עדיין. לחצו + כדי ליצור זוג.';
    listEl.appendChild(none);
    renderClosed();
    return;
  }
  const sel = selectedDuo();
  for (const d of duos.values()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'duo-item' + (sel && sel.id === d.id && duoState.view === 'duo' ? ' current' : '');
    b.dataset.status = duoStatus(d);
    b.innerHTML = '<i class="dot"></i><span class="nm"></span><span class="pr"></span>';
    $('.nm', b).textContent = duoName(d);
    const t = d.tasks.total ? `${d.tasks.counts.done}/${d.tasks.total}` : '';
    $('.pr', b).textContent = (d.paused ? 'מושהה · ' : '') + t;
    const why = duoReason(d);
    $('.dot', b).title = why;
    b.title = `${why}\n${duoName(d)} · ${d.project}\nלחיצה כפולה או F2: שינוי שם`;
    b.addEventListener('click', () => { selectDuo(d.id); setView('duo'); });
    b.addEventListener('dblclick', (e) => { e.preventDefault(); renameDuo(d, b.querySelector('.nm')); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); openDuoMenu(d, { point: { x: e.clientX, y: e.clientY } }, b.querySelector('.nm')); }); // T57
    b.addEventListener('keydown', (e) => { if (isRenameKey(e)) { e.preventDefault(); renameDuo(d, b.querySelector('.nm')); } });
    listEl.appendChild(b);
  }
  renderClosed();
}

// זוגות שנסגרו: אפשר להחזיר אותם (אותן שיחות של הסוכנים, אותן משימות). חוזרים מושהים
function renderClosed() {
  if (!closedDuos.length) return;
  const head = document.createElement('div');
  head.className = 'duo-closed-head';
  head.textContent = 'נסגרו לאחרונה';
  listEl.appendChild(head);
  for (const c of closedDuos.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'duo-closed';
    row.innerHTML = '<span class="nm"></span><span class="pr"></span><button type="button" class="btn duo-restore">שחזור</button>';
    $('.nm', row).textContent = c.name || basename(c.project);
    $('.pr', row).textContent = c.total ? `${c.done}/${c.total}` : '';
    row.title = `${c.project}
נסגר ${new Date(c.closedAt).toLocaleString('he-IL')}`;
    $('.duo-restore', row).addEventListener('click', (e) => { e.currentTarget.disabled = true; send({ t: 'duo', op: 'reopen', closedId: c.id, reqId: Math.random().toString(36).slice(2) }); });
    listEl.appendChild(row);
  }
}

export function initList() {
  $('#sideNewDuo').addEventListener('click', () => openCreate());
  bus.on('duo:changed', render);
  bus.on('duo:selected', render);
  bus.on('duo:view', render);
  render();
}
