'use strict';
// T67: copying Hebrew from a Claude terminal gives the LOGICAL text (the buffer holds Claude's visual order).
// The golden rows below were captured from the REAL Claude Code v2.1.301 (a 100-column terminal, prompt typed in Hebrew with English words, a path,
// a version, a percentage and brackets); the expected text is what was typed / what Claude answered.
const path = require('path');
const { pathToFileURL } = require('url');
const { checker } = require('../lib/harness');

(async () => {
  const t = checker('copy Hebrew in logical order (unit)');
  const { logicalText, visualToLogical, selectionText } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'hebrew-copy.js')).href);

  // שורות אמיתיות מ-Claude (הקלדה של המשתמש בתיבת הקלט שנשארה בתמלול, בשתי שורות; ותשובה בשתי שורות)
  const IN1 = '❯  תא ,server.js ץבוקה תא ,Terminal Grid יוטיבה תא רכזה :םילכ ילב ,דבלב תירבעב תורצק תורוש יתשב הנע';
  const IN2 = '  .ףוסב הדוקנ םישו ,)הז ומכ( םיירגוס ךותב 25% רפסמה תאו V4.3 הסרגה';
  const ANS1 = '● .)םיעוציבב 25% לש רופיש( V4.3 הסרגל ןכדועמ Terminal Grid-ב server.js ץבוקה';
  const ANS2 = '  .תופסונ תולועפב ךרוצ ןיאו הפוצמכ דבוע לוכה';
  const TYPED = 'ענה בשתי שורות קצרות בעברית בלבד, בלי כלים: הזכר את הביטוי Terminal Grid, את הקובץ server.js, את הגרסה V4.3 ואת המספר 25% בתוך סוגריים (כמו זה), ושים נקודה בסוף.';
  const ANSWER = 'הקובץ server.js ב-Terminal Grid מעודכן לגרסה V4.3 (שיפור של 25% בביצועים). הכול עובד כמצופה ואין צורך בפעולות נוספות.';

  const first = logicalText(IN1 + '\n' + IN2);
  t.check('the real wrapped prompt (2 rows, ❯ marker, English phrase, file, version, percent, brackets, final dot) round-trips to exactly what was typed', first === '❯  ' + TYPED, first);
  const ans = logicalText(ANS1 + '\n' + ANS2);
  t.check('the real answer (● marker) comes out in reading order, "ב-Terminal Grid" and "(…25%…)." intact, wrapped rows joined with a space', ans === '● ' + ANSWER, ans);

  /* ---------- תרחישים בודדים ---------- */
  const one = (visual) => logicalText(visual);
  t.check('a pure Hebrew row is reversed back (first word first, letters in order)', one('ןחבמ לש הקידב ףוס') === 'סוף בדיקה של מבחן', one('ןחבמ לש הקידב ףוס'));
  t.check('English words, numbers and paths keep their own direction', one('server.js ץבוקב T52 תא יתנקית') === 'תיקנתי את T52 בקובץ server.js', one('server.js ץבוקב T52 תא יתנקית'));
  t.check('a path and a version inside Hebrew', one('V4.3 הסרגב src/server.js ץבוקה') === 'הקובץ src/server.js בגרסה V4.3', one('V4.3 הסרגב src/server.js ץבוקה'));
  t.check('brackets are kept (Claude moves them, the reversal moves them back)', one(')app.js( ץבוקה') === 'הקובץ (app.js)', one(')app.js( ץבוקה'));
  t.check('a bullet row keeps its marker and spacing at the start', one('- םיטירפה תמישר') === '- רשימת הפריטים', one('- םיטירפה תמישר'));
  t.check('a numbered row keeps "1." at the start', one('1. ןושאר ףד') === '1. דף ראשון', one('1. ןושאר ףד'));

  /* ---------- שורות שאינן עברית ובחירה מעורבת ---------- */
  const mixed = ['L  src/server.js (English only, must stay on the left)', '● םולש םלוע', '────────────────────────────────────────', '$ npm test'].join('\n');
  const mixedOut = one(mixed).split('\n');
  t.check('English rows, rules and shell lines are copied exactly as they are', mixedOut[0] === 'L  src/server.js (English only, must stay on the left)' && mixedOut[2] === '─'.repeat(40) && mixedOut[3] === '$ npm test', JSON.stringify(mixedOut));
  t.check('the Hebrew row in the middle is converted', mixedOut[1] === '● עולם שלום', mixedOut[1]);
  t.check('a table row (box characters) is never converted', one('│ םולש │ 12 │') === '│ םולש │ 12 │');
  t.check('text without any Hebrew is returned untouched (same string)', one('plain text\nsecond line') === 'plain text\nsecond line');

  /* ---------- הצטרפות שורות שנשברו ---------- */
  const shortFirst = logicalText('● הרצק הרושה\n  היינש הרוש');
  t.check('an indented Hebrew row under a Hebrew row joins it, whatever the length (Claude wraps at ~80 of 100 columns, so length says nothing)', shortFirst === '● השורה קצרה שורה שנייה', shortFirst);
  const blank = logicalText('● הרצק הרושה\n\n  היינש הרוש').split('\n');
  t.check('a blank row ends the paragraph: the next one stays separate', blank.length === 3 && blank[1] === '' && blank[2] === '  שורה שנייה', JSON.stringify(blank));
  const noIndent = logicalText(IN1.replace('❯  ', '') + '\n' + IN2.trim()).split('\n');
  t.check('a second row without indent is a new line (not joined)', noIndent.length === 2, JSON.stringify(noIndent));
  const bullets = logicalText(ANS1 + '\n' + '● ' + ANS2.trim()).split('\n');
  t.check('a second row that opens with a bullet is a new paragraph (not joined)', bullets.length === 2, JSON.stringify(bullets));
  const three = logicalText(IN1 + '\n' + IN2 + '\n' + IN1.replace('❯  ', '  ')).split('\n');
  t.check('a paragraph wrapped over 3 rows becomes ONE line', three.length === 1, JSON.stringify(three));

  const crlf = logicalText(['plain', '● םולש םלוע', 'also plain'].join('\r\n'));
  t.check('CRLF separators (xterm on Windows) are kept on every line, converted or not', crlf === 'plain\r\n● עולם שלום\r\nalso plain', JSON.stringify(crlf));

  /* ---------- selectionText: רק בפאן של Claude ---------- */
  const fakeTerm = (raw) => ({ getSelection: () => raw });
  t.check('a Claude pane is converted', selectionText(fakeTerm('ןחבמ'), 'claude') === 'מבחן');
  t.check('a shell pane (logical order in the buffer) is NOT converted', selectionText(fakeTerm('ןחבמ'), 'powershell') === 'ןחבמ');
  t.check('the converter never throws on odd input', logicalText('') === '' && logicalText(undefined) === undefined && visualToLogical('') === '');
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
