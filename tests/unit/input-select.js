'use strict';
// T63: finding the typed text of the Claude input in the terminal buffer, the copy text and the delete plan (a fake buffer, no browser).
const path = require('path');
const { pathToFileURL } = require('url');
const { checker } = require('../lib/harness');

const fakeTerm = (rows, cursor, cols = 100) => ({
  cols,
  buffer: { active: { baseY: 0, cursorX: cursor.x, cursorY: cursor.y, length: rows.length, getLine: (y) => {
    const r = rows[y]; if (r == null) return undefined;
    const text = typeof r === 'string' ? r : r.text; const dim = typeof r === 'object' && !!r.dim;
    return { translateToString: (trim) => (trim ? text.replace(/\s+$/, '') : text), getCell: (x) => ({ getChars: () => (text[x] || ''), isDim: () => (dim && x >= 2 ? 1 : 0) }) };
  } } },
});
const RULE = '─'.repeat(100);
const LABELLED = '─'.repeat(86) + ' duo-worker ─'; // the real top rule has a label at its end
const NB = '\u00a0'; // the real marker is followed by a NON-BREAKING space

(async () => {
  const t = checker('Ctrl+A input detection (unit)');
  const { findInput, inputText, deletePlan } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'input-select.js')).href);

  /* ---------- borderless (the real Claude Code v2.1.301) ---------- */
  const one = fakeTerm(['header', '', RULE, '❯ hello world', RULE, '  ⏵⏵ auto mode on'], { x: 13, y: 3 });
  let r = findInput(one);
  t.check('one row: found between the two rules, marker and indent stripped, cursor mapped, not empty', !!r && r.rows.length === 1 && r.rows[0].body === 'hello world' && r.rows[0].startCol === 2 && r.cy === 0 && !r.empty && !r.boxed, JSON.stringify(r));
  t.check('the copy text is the typed text', inputText(r) === 'hello world');
  t.check('delete plan at the end: nothing after the cursor (only the spare), everything before it (+ spare)', JSON.stringify(deletePlan(r)) === JSON.stringify({ before: 11 + 2, after: 2 }), JSON.stringify(deletePlan(r)));

  const multi = fakeTerm(['x', RULE, '❯ line one', '  line two is a bit longer', '  three', RULE, '  mode'], { x: 7, y: 3 });
  r = findInput(multi);
  t.check('three rows, the cursor in the MIDDLE of the second row (5 characters in)', !!r && r.rows.length === 3 && r.cy === 1 && r.cx === 7, JSON.stringify(r && { cy: r.cy, cx: r.cx }));
  t.check('rows are separate lines (the first is far from the width: hard newlines)', inputText(r) === 'line one\nline two is a bit longer\nthree', JSON.stringify(inputText(r)));
  const plan = deletePlan(r);
  t.check('delete plan from the middle: Delete for everything after, Backspace for everything before, every row boundary counted (+ spare)', plan.before === (8 + 1) + 5 + 2 && plan.after === (24 - 5) + (5 + 1) + 2, JSON.stringify(plan));

  const long = 'word '.repeat(19).trimEnd(); // 94 characters: row 1 is full up to the width
  const wrapped = fakeTerm([RULE, '❯ ' + long, '  tail of the same line', RULE], { x: 24, y: 2 });
  r = findInput(wrapped);
  t.check('a row that fills the width continues on the next one: joined with a space, not a newline', !!r && inputText(r) === long + ' tail of the same line', JSON.stringify(r && inputText(r)));

  /* ---------- the REAL screen (T75): labelled top rule and a non-breaking space after the marker ---------- */
  const real = fakeTerm(['header', '', LABELLED, '❯' + NB + 'hello world', RULE, '  ⏵⏵ auto mode on'], { x: 13, y: 3 });
  r = findInput(real);
  t.check('REAL screen: labelled top rule and NBSP after the marker are found (this is what made the shipped feature a silent no-op)', !!r && r.rows[0].body === 'hello world' && !r.empty, JSON.stringify(r));
  t.check('REAL screen: a plain space after the marker still works (older fixture/boxed)', !!findInput(one));

  /* ---------- Hebrew rows are visual in the buffer ---------- */
  const heb = fakeTerm([RULE, '❯ םלוע םולש', RULE], { x: 12, y: 1 });
  r = findInput(heb);
  t.check('a Hebrew row is converted to logical order for the copy', !!r && inputText(r) === 'שלום עולם', JSON.stringify(r && inputText(r)));

  /* ---------- boxed (older style) ---------- */
  const boxed = fakeTerm(['x', '╭' + '─'.repeat(98) + '╮', '│ > boxed text' + ' '.repeat(84) + ' │', '│   second row' + ' '.repeat(85) + ' │', '╰' + '─'.repeat(98) + '╯'], { x: 16, y: 3 });
  r = findInput(boxed);
  t.check('boxed style: borders and the marker are stripped, two rows', !!r && r.boxed === true && r.rows.length === 2 && r.rows[0].body === 'boxed text' && r.rows[1].body === 'second row' && r.rows[0].startCol === 4, JSON.stringify(r && r.rows));
  t.check('boxed copy text', inputText(r) === 'boxed text\nsecond row');

  /* ---------- must NOT be found (the key then passes through) ---------- */
  t.check('the empty input (a DIM placeholder) is "empty"', findInput(fakeTerm([RULE, { text: '❯ Try "fix typecheck errors"', dim: true }, RULE], { x: 2, y: 1 })).empty === true);
  t.check('no rule lines: not found', findInput(fakeTerm(['❯ hello', 'more'], { x: 7, y: 0 })) === null);
  t.check('only one rule (the bottom is missing): not found', findInput(fakeTerm([RULE, '❯ hello', '  mode'], { x: 7, y: 1 })) === null);
  t.check('the cursor is not inside the region (a menu below): not found', findInput(fakeTerm([RULE, '❯ hello', RULE, '  menu'], { x: 3, y: 3 })) === null);
  t.check('a dialog option list ("❯ 1. Yes") is not an input box: not found', findInput(fakeTerm([RULE, '❯ 1. Yes', '  2. No', RULE], { x: 11, y: 1 })) === null);
  t.check('the first row must start with the marker: not found', findInput(fakeTerm([RULE, 'just text', RULE], { x: 9, y: 1 })) === null);
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
