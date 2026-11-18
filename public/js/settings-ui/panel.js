/* ---------- פאנל ההגדרות: חלון קטן בעמודה אחת. "תצוגה" פתוח תמיד, "מתקדם" מקופל ונזכר ---------- */
// השורות מוגדרות ב-rows.js והרכיבים ב-controls.js. השינויים חלים מיד ובשקט (בלי הודעות "נשמר").
// נפתח בכפתור ההגדרות ובאירוע 'open-settings' (Ctrl+,). Esc סוגר והמיקוד חוזר למי שפתח.
import { state, bus } from '../state.js';
import { $ } from '../dom.js';
import { icon } from '../icons.js';
import { fontStack } from '../fonts.js';
import { focusTerm } from '../layout.js';
import { getSetting, setSetting, onSetting, defaultOf, getSchema } from '../settings.js';
import { CONTROLS } from './controls.js';
import { GROUPS, ROWS } from './rows.js';

const dlg = $('#settingsDlg');
const contentEl = $('#settingsContent');

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let built = false;
let opener = null;
const items = [];   // { row, ctl }

/* ---------- בניית שורה ---------- */
function buildRow(row) {
  if (row.control === 'custom') { const x = row.build(); x.dataset.row = row.id; return x; }
  const rowEl = el('div', 'st-row' + (row.stack ? ' st-row-stack' : ''));
  rowEl.dataset.row = row.id;
  const labelId = `st-l-${row.id}`;
  const text = el('div', 'st-text');
  text.append(Object.assign(el('div', 'st-label', row.label), { id: labelId }));
  if (row.description) text.append(el('div', 'st-desc', row.description));
  rowEl.append(text);

  const note = el('div', 'st-row-note');
  note.hidden = true;
  const entry = getSchema().find((e) => e.path === row.path) || {};
  const opts = typeof row.options === 'function' ? row.options() : row.options;
  const ctl = CONTROLS[row.control]({
    labelledBy: labelId, value: getSetting(row.path), min: entry.min, max: entry.max, step: entry.step || 1,
    format: row.format, unit: row.unit, options: opts, number: row.number, variant: row.variant,
    onChange: async (v) => {
      // guard (למשל בקשת הרשאה להתראות) רץ בתוך הלחיצה; אם נדחה, ההגדרה לא משתנה והסיבה מוצגת מתחת לשורה
      if (row.apply) {
        // הרכיב כבר התהפך (מיד), ובזמן שהשרת עובד (קיצור דרך נוצר דרך PowerShell: 1-3 שניות) יש ספינר צמוד ואי אפשר ללחוץ שוב
        const spin = el('span', 'spin');
        spin.setAttribute('aria-hidden', 'true');
        side.prepend(spin);
        ctl.el.setAttribute('aria-busy', 'true');
        ctl.el.disabled = true;
        let r;
        try { r = await row.apply(v); } finally { spin.remove(); ctl.el.removeAttribute('aria-busy'); ctl.el.disabled = false; }
        note.hidden = r.ok;
        note.textContent = r.ok ? '' : r.note;
        if (!r.ok) ctl.set(getSetting(row.path));
        return;
      }
      if (row.guard && v) {
        const r = await row.guard();
        note.hidden = r.ok;
        note.textContent = r.ok ? '' : r.note;
        if (!r.ok) { ctl.set(getSetting(row.path)); return; }
      } else note.hidden = true;
      setSetting(row.path, v);
    },
  });
  // אין איפוס לכל שורה: מתג ובחירה פשוט לוחצים שוב, ומחוון או מספר מחזירים ביד. נשאר רק "איפוס כל ההגדרות" בקבוצת "מתקדם"
  const side = el('div', 'st-ctl');
  side.append(ctl.el);
  rowEl.append(side);
  if (row.sample) rowEl.append(buildSample());
  if (row.preview === 'rtl') rowEl.append(buildRtlPreview());
  rowEl.append(note);
  // שורה שמוצגת רק כשהגדרה אחרת בערך מסוים (למשל בחירת הסף רק במצב "מוקדם יותר")
  if (row.showWhen) {
    const apply = () => { rowEl.hidden = getSetting(row.showWhen.path) !== row.showWhen.equals; };
    apply();
    onSetting(row.showWhen.path, apply);
  }

  ctl.set(getSetting(row.path));
  onSetting(row.path, (v) => ctl.set(v));
  items.push({ row, ctl });
  return rowEl;
}

// תצוגה מקדימה חיה: אותו גופן, גודל, גובה שורה וסמן כמו בטרמינל
function buildSample() {
  const box = el('div', 'st-sample');
  box.setAttribute('dir', 'ltr');
  box.setAttribute('aria-hidden', 'true');
  const cursor = el('span', 'st-cursor');
  const l2 = el('div', 'st-sample-line', 'שלום עולם · const answer = 42; ');
  l2.append(cursor);
  box.append(el('div', 'st-sample-line', 'PS C:\\work\\shop-app> claude'), l2);
  const paint = () => {
    box.style.fontFamily = fontStack();
    box.style.fontSize = getSetting('terminal.fontSize') + 'px';
    box.style.lineHeight = String(getSetting('terminal.lineHeight'));
    cursor.dataset.style = getSetting('terminal.cursorStyle');
    cursor.dataset.blink = String(getSetting('terminal.cursorBlink'));
  };
  for (const p of ['terminal.fontFamily', 'terminal.fontSize', 'terminal.lineHeight', 'terminal.cursorStyle', 'terminal.cursorBlink']) onSetting(p, paint);
  paint();
  return box;
}

// תצוגה מקדימה של יישור עברית (T42): שתי שורות לדוגמה משמאל ומימין, והמצב הנוכחי מודגש: רואים את ההשפעה בלי לפתוח טרמינל
function buildRtlPreview() {
  const box = el('div', 'st-rtl-prev');
  box.setAttribute('aria-hidden', 'true');
  const card = (cls, caption) => {
    const c = el('div', 'rp-card ' + cls);
    c.append(el('div', 'rp-cap', caption), el('div', 'rp-line', 'שלום עולם, זו שורה לדוגמה'), el('div', 'rp-line', 'הכול עובד: 42 בדיקות עברו'));
    return c;
  };
  const right = card('right', 'מיושר לימין (דלוק)'), left = card('left', 'מיושר לשמאל (כבוי)');
  box.append(right, left);
  const paint = () => { const on = getSetting('appearance.rtlLayer'); right.classList.toggle('on', on); left.classList.toggle('on', !on); };
  onSetting('appearance.rtlLayer', paint);
  paint();
  return box;
}

/* ---------- איפוס הכול (שתי לחיצות, כמו סגירת טרמינל) ---------- */
let armTimer = null;
function buildResetAll() {
  const btn = el('button', 'btn st-reset-all', 'איפוס כל ההגדרות');
  btn.type = 'button';
  const disarm = () => { clearTimeout(armTimer); btn.classList.remove('armed'); btn.textContent = 'איפוס כל ההגדרות'; };
  btn.addEventListener('click', () => {
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = 'לאפס הכול? לחצו שוב';
      armTimer = setTimeout(disarm, 3500);
      return;
    }
    disarm();
    for (const { row } of items) if (!row.apply) setSetting(row.path, defaultOf(row.path));
  });
  dlg.addEventListener('close', disarm);
  return btn;
}

function build() {
  if (built) return;
  built = true;
  for (const g of GROUPS) {
    const box = el('section', 'st-group');
    box.dataset.group = g.id;
    const body = el('div', 'st-list');
    if (!g.collapsible) {
      box.append(el('h3', 'st-title', g.title), body);
    } else {
      // גילוי הדרגתי: כפתור עם aria-expanded שפותח/סוגר את הקבוצה, והמצב נשמר בהגדרות
      const toggle = el('button', 'st-adv-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-controls', `st-body-${g.id}`);
      toggle.innerHTML = `<span class="st-adv-chev">${icon('chevron', 14)}</span><span></span>`;
      $('span:last-child', toggle).textContent = g.title;
      body.id = `st-body-${g.id}`;
      const paint = (open) => { toggle.setAttribute('aria-expanded', String(open)); body.hidden = !open; };
      toggle.addEventListener('click', () => setSetting('ui.advancedOpen', toggle.getAttribute('aria-expanded') !== 'true'));
      onSetting('ui.advancedOpen', paint);
      paint(getSetting('ui.advancedOpen'));
      box.append(toggle, body);
    }
    for (const row of ROWS.filter((r) => r.group === g.id)) body.append(buildRow(row));
    if (g.collapsible) body.append(buildResetAll());
    contentEl.append(box);
  }
}

/* ---------- פתיחה וסגירה ---------- */
export function openSettings() {
  if (dlg.open) return;
  build();
  opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  dlg.showModal();
  items[0].ctl.focus();
}

function closeSettings() { if (dlg.open) dlg.close(); }

export function initSettingsPanel() {
  $('#settingsBtn').addEventListener('click', () => openSettings());
  $('#settingsClose').addEventListener('click', closeSettings);
  bus.on('open-settings', () => (dlg.open ? closeSettings() : openSettings()));
  // לחיצה על הרקע (מחוץ לתיבה) סוגרת
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSettings(); });
  dlg.addEventListener('close', () => {
    // המיקוד חוזר למי שפתח (כפתור או הטרמינל שהיה ממוקד)
    if (opener && opener.isConnected) opener.focus(); else if (state.focusId) focusTerm(state.focusId);
    opener = null;
  });
}
