'use strict';
// "claude" for the Ctrl+A tests (T63): draws the input the way the REAL Claude Code v2.1.301 does (checked by hand) and reacts to keys like it:
//   borderless (default): a rule line, `❯ first row`, continuation rows indented by two columns, a rule line, a mode line. Empty input = a DIM placeholder.
//   INPUT_BOXED=1: the older boxed style (╭──╮ │ > text │ ╰──╯).
// Keys: printable text, Backspace (0x7f, joins lines at the start), Delete (ESC [ 3 ~), Shift+Enter (ESC CR) = new line, Ctrl+A / Ctrl+E = start / end of the CURRENT line,
// Left/Right/Up/Down, Enter = submit (prints SUBMITTED:<json> and clears), bracketed paste. INPUT_VISUAL=1: Hebrew rows are drawn in visual order (reversed words/letters), like Claude.
const COLS = process.stdout.columns || 100;
const ESC = String.fromCharCode(27);
const BOXED = process.env.INPUT_BOXED === '1';
const VISUAL = process.env.INPUT_VISUAL === '1';
const HEB = /[֐-׿]/;
const visualWord = (t) => (HEB.test(t) ? [...t].reverse().join('') : t);
const visualRow = (text) => {
  if (!VISUAL || !HEB.test(text)) return text;
  const words = text.split(' ');
  const groups = [];
  for (const w of words) { const heb = HEB.test(w), g = groups[groups.length - 1]; if (!heb && g && !g.heb) g.words.push(w); else groups.push({ heb, words: [w] }); }
  return groups.reverse().map((g) => (g.heb ? visualWord(g.words[0]) : g.words.join(' '))).join(' ');
};

let images = 0;
let lines = [''];
let row = 0, col = 0;
const TOP = 4; // 1-based screen row of the first rule

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdout.write(`${ESC}[?2004h${ESC}[2J${ESC}[H`);
process.stdout.write('Claude Code v2.1.301 (input-box fixture)\r\n');

// wrapped rows: a logical line is cut at the last space that fits the width (the space stays on that row), each piece is a screen row
function wrap(ln, width) {
  const out = [];
  let rest = ln;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width - 1) + 1;
    if (cut <= 0) cut = width;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest);
  return out;
}
function screenRows() {
  const width = COLS - (BOXED ? 6 : 2);
  const rows = [];
  let cursor = { r: 0, c: 0 };
  lines.forEach((ln, li) => {
    const pieces = wrap(ln, width);
    let off = 0;
    pieces.forEach((piece, pi) => {
      if (li === row && col >= off && (col < off + piece.length || pi === pieces.length - 1)) cursor = { r: rows.length, c: Math.min(col - off, width) };
      rows.push(piece);
      off += piece.length;
    });
  });
  return { rows, cursor, width };
}

function render() {
  const { rows, cursor } = screenRows();
  const empty = lines.length === 1 && lines[0] === '';
  const out = [`${ESC}[${TOP};1H${ESC}[J`];
  // the real top rule carries a label at its end ("──── duo-worker ─")
  const rule = BOXED ? '╭' + '─'.repeat(COLS - 2) + '╮' : '─'.repeat(COLS - 14) + ' duo-worker ─';
  out.push(rule + '\r\n');
  rows.forEach((piece, i) => {
    const lead = i === 0 ? '❯\u00a0' : '  '; // the real Claude puts a NON-BREAKING space after the marker
    const body = empty ? `${ESC}[2mTry "fix typecheck errors"${ESC}[22m` : visualRow(piece);
    if (BOXED) {
      const shown = (i === 0 ? '> ' : '  ') + (empty ? 'Try "fix typecheck errors"' : visualRow(piece));
      out.push('│ ' + (empty ? (i === 0 ? '> ' : '  ') + body : shown) + ' '.repeat(Math.max(0, COLS - 4 - shown.length)) + ' │\r\n');
    } else out.push(lead + body + '\r\n');
  });
  out.push((BOXED ? '╰' + '─'.repeat(COLS - 2) + '╯' : '─'.repeat(COLS)) + '\r\n');
  out.push('  ⏵⏵ auto mode on (shift+tab to cycle)');
  const startCol = BOXED ? 5 : 3;
  out.push(`${ESC}[${TOP + 1 + cursor.r};${startCol + cursor.c}H`);
  process.stdout.write(out.join(''));
}

function insert(text) {
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') { lines.splice(row + 1, 0, lines[row].slice(col)); lines[row] = lines[row].slice(0, col); row++; col = 0; }
    else { lines[row] = lines[row].slice(0, col) + ch + lines[row].slice(col); col++; }
  }
}
function backspace() {
  if (col > 0) { lines[row] = lines[row].slice(0, col - 1) + lines[row].slice(col); col--; }
  else if (row > 0) { col = lines[row - 1].length; lines[row - 1] += lines[row]; lines.splice(row, 1); row--; }
}
function del() {
  if (col < lines[row].length) lines[row] = lines[row].slice(0, col) + lines[row].slice(col + 1);
  else if (row < lines.length - 1) { lines[row] += lines[row + 1]; lines.splice(row + 1, 1); }
}

const fsLog = process.env.INPUT_LOG ? require('fs') : null;
process.stdin.on('data', (d) => {
  if (fsLog) fsLog.appendFileSync(process.env.INPUT_LOG, JSON.stringify(d) + String.fromCharCode(10)); // what the program received, for the pass-through checks
  let s = d;
  while (s.length) {
    let m;
    if ((m = /^\u001b\[200~([\s\S]*?)\u001b\[201~/.exec(s))) {
      const p = m[1].trim().replace(/^"|"$/g, '');
      if (/\.(png|jpe?g|gif|webp)$/i.test(p) && require('fs').existsSync(p)) insert('[Image #' + (++images) + ']'); // like the real Claude: an image path becomes a token
      else insert(m[1]);
      s = s.slice(m[0].length);
    }
    else if (s.startsWith(ESC + '[3~')) { del(); s = s.slice(4); }
    else if (s.startsWith(ESC + '\r')) { insert('\n'); s = s.slice(2); }
    else if (s.startsWith(ESC + '[C')) { if (col < lines[row].length) col++; else if (row < lines.length - 1) { row++; col = 0; } s = s.slice(3); }
    else if (s.startsWith(ESC + '[D')) { if (col > 0) col--; else if (row > 0) { row--; col = lines[row].length; } s = s.slice(3); }
    else if (s.startsWith(ESC + '[A')) { if (row > 0) { row--; col = Math.min(col, lines[row].length); } s = s.slice(3); }
    else if (s.startsWith(ESC + '[B')) { if (row < lines.length - 1) { row++; col = Math.min(col, lines[row].length); } s = s.slice(3); }
    else if (s.startsWith(ESC)) { s = s.slice(1); }
    else if (s[0] === '\u007f') { backspace(); s = s.slice(1); }
    else if (s[0] === '\u0001') { col = 0; s = s.slice(1); }
    else if (s[0] === '\u0005') { col = lines[row].length; s = s.slice(1); }
    else if (s[0] === '\r') {
      process.stdout.write(`${ESC}[1;1H${ESC}[2K`);
      console.log('SUBMITTED:' + JSON.stringify(lines.join('\n')));
      lines = ['']; row = 0; col = 0; s = s.slice(1);
    } else if (s.codePointAt(0) >= 32) { const ch = String.fromCodePoint(s.codePointAt(0)); insert(ch); s = s.slice(ch.length); }
    else s = s.slice(1);
  }
  render();
});
render();
setInterval(() => {}, 1 << 30);
