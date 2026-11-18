'use strict';
// צל הטיוטה וקריאת תיבת הקלט מהמסך (T62, server/draft.js): רק לוגיקה, בלי שרת ובלי דפדפן.
const { Terminal } = require('@xterm/headless');
const { checker } = require('../lib/harness');
const { createDraft, screenState } = require('../../server/draft');

const t = checker('user draft: keystroke shadow and screen reading (unit)');
const ESC = '\x1b';

/* ---------- צל ההקשות ---------- */
const run = (...chunks) => { const d = createDraft(); const humans = chunks.map((c) => d.feed(c, 1000)); return { d, humans }; };
t.check('printable characters make a draft; the chunk counts as human input', (() => { const { d, humans } = run('a', 'bc'); return d.active && d.length === 3 && humans.every(Boolean); })());
t.check('Enter submits: the draft is gone', !run('abc', '\r').d.active);
t.check('Backspace shrinks it, and back to empty clears it (even in one chunk)', !run('abc', '\x7f\x7f\x7f').d.active && run('abc', '\x7f').d.length === 2);
t.check('Backspace on an empty draft stays empty (never negative)', run('\x7f\x7f', 'a').d.length === 1);
t.check('Ctrl+C and Ctrl+U clear it', !run('hello', '\x03').d.active && !run('hello', '\x15').d.active);
t.check('a double Esc clears it, a single Esc does not', !run('hello', ESC + ESC).d.active && run('hello', ESC).d.active);
t.check('Hebrew text counts per character, and an emoji counts once', run('שלום').d.length === 4 && run('\u{1F600}').d.length === 1);
t.check('a bracketed paste (any size, newlines included) is a draft; the markers themselves are not content', (() => { const d = run(`${ESC}[200~שורה\nשנייה${ESC}[201~`).d; return d.active && d.length === 10; })());
t.check('a paste split across chunks is still one paste', run(`${ESC}[200~abc`, `def${ESC}[201~`).d.length === 6);
t.check('Shift+Enter (Esc+CR) adds a line break inside a draft and does nothing to an empty input', run('a', ESC + '\r').d.length === 2 && !run(ESC + '\r').d.active);
t.check('arrows, focus reports, mouse reports and device replies are NOT typing and NOT content', (() => {
  const d = createDraft();
  const flags = [ESC + '[A', ESC + '[I', ESC + '[O', ESC + '[<0;10;5M', ESC + '[12;40R', ESC + 'OP'].map((s) => d.feed(s, 5));
  return flags.every((f) => f === false) && !d.active && d.lastAt === 0;
})());
t.check('an escape sequence in the middle of text does not eat the text around it', run('a' + ESC + '[D' + 'b').d.length === 2);
t.check('Alt+key is swallowed, not counted', run(ESC + 'b').d.length === 0);
t.check('lastAt is the time of the last human key', (() => { const d = createDraft(); d.feed('a', 111); d.feed(ESC + '[I', 999); return d.lastAt === 111; })());
t.check('clear() resets', (() => { const d = createDraft(); d.feed('abc'); d.clear(); return !d.active; })());

/* ---------- אמת מהמסך (אותם רצפי SGR ש-Claude Code v2.1.301 שולח בפועל) ---------- */
const RULE = '\u2500'.repeat(100);
const draw = async (lines) => {
  const term = new Terminal({ cols: 110, rows: 14, allowProposedApi: true });
  await new Promise((res) => term.write(ESC + '[2J' + ESC + '[H' + lines.join('\r\n'), res));
  return term;
};
const header = [' \u2590\u259b\u2588\u2588\u2588\u259b\u2588   Claude Code v2.1.301', ' C:\\project'];
(async () => {
  let term = await draw([...header, RULE, '\u276f ' + ESC + '[2mTry "fix lint errors"' + ESC + '[22m', RULE, '  \u23f5\u23f5 auto mode on (shift+tab to cycle) \u00b7 \u2190 for agents']);
  let st = screenState(term);
  t.check('the dim suggestion ("Try ...") is not a draft', st.found && st.draft === false && st.stashed === false, JSON.stringify(st));
  term = await draw([...header, RULE, '\u276f hello', RULE, '  \u23f5\u23f5 auto mode on (shift+tab to cycle)']);
  st = screenState(term);
  t.check('typed text is a draft', st.found && st.draft === true, JSON.stringify(st));
  term = await draw([...header, RULE, '\u276f a', '  b', RULE, '  \u23f5\u23f5 auto mode on (shift+tab to cycle)']);
  t.check('a two-line draft (Shift+Enter) is a draft', screenState(term).draft === true);
  term = await draw([...header, RULE, '\u276f ' + ESC + '[2mTry "write a test for <filepath>"' + ESC + '[22m', RULE, '  \u23f5\u23f5 auto mode on (shift+tab to cycle) \u00b7 \u2190 for agents    \u25c9 xhigh \u00b7 /effort \u00b7 \u203a stashed']);
  st = screenState(term);
  t.check('after Ctrl+S: an empty input with "stashed" in the footer', st.found && st.draft === false && st.stashed === true, JSON.stringify(st));
  term = await draw([...header, RULE, '\u276f [Pasted text #1 +59 lines]', RULE, '  paste again to expand        Draft restored']);
  st = screenState(term);
  t.check('a restored paste placeholder counts as a draft', st.found && st.draft === true && st.stashed === false, JSON.stringify(st));
  term = await draw(['PS C:\\Users\\me> dir', 'file1  file2']);
  t.check('a plain shell screen (no input box) is "not found": the caller falls back to the keystroke shadow', screenState(term).found === false);
  term = await draw([...header, 'Do you want to proceed?', '\u276f 1. Yes', '  2. No']);
  t.check('a menu without the two rules is "not found" too', screenState(term).found === false);
  term = await draw([...header, '\u276f old prompt that scrolled', RULE, 'working...', RULE, '  footer']);
  t.check('a box whose first row is not a prompt marker is "not found"', screenState(term).found === false);
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
