'use strict';
// server/trust.js (T40): מה מותר ללחוץ על שאלת האמון. הכלל החשוב: Enter אף פעם לא על "No, exit".
// הדגימה האמיתית (tests/fixtures/trust-real-prompt.txt) היא הטקסט שהמשתמש צילם מ-Claude Code: "No, exit" מסומן ראשון.
const fs = require('fs');
const path = require('path');
const { checker, FIXTURES } = require('../lib/harness');
const { trustChoice, trustPromptShown } = require('../../server/trust');

const t = checker('trustChoice: what may be pressed on the trust prompt (unit)');
const real = fs.readFileSync(path.join(FIXTURES, 'trust-real-prompt.txt'), 'utf8');
const swap = (text) => text.replace('❯ No, exit\n  Yes, I trust this folder', '  No, exit\n❯ Yes, I trust this folder');

t.check('the real prompt (marker on "No, exit") -> down, never enter', trustChoice(real) === 'down', String(trustChoice(real)));
t.check('the marker on "Yes, I trust this folder" -> enter', trustChoice(swap(real)) === 'enter', String(trustChoice(swap(real))));
t.check('the real prompt is recognised as the trust prompt', trustPromptShown(real) === true);
t.check('CRLF line endings do not matter', trustChoice(real.replace(/\n/g, '\r\n').replace(/\r\n/g, '\n')) === 'down');
t.check('numbered options ("1. No, exit"): down', trustChoice(real.replace('❯ No, exit\n  Yes, I trust this folder', '❯ 1. No, exit\n  2. Yes, I trust this folder')) === 'down');
t.check('numbered options with the marker on "2. Yes": enter', trustChoice(real.replace('❯ No, exit\n  Yes, I trust this folder', '  1. No, exit\n❯ 2. Yes, I trust this folder')) === 'enter');
t.check('the legacy question with "Yes" highlighted first: enter', trustChoice('Do you trust the files in this folder?\n\n C:\\work\n\n ❯ 1. Yes, I trust this folder\n   2. No, exit') === 'enter');
t.check('the legacy question with "No" highlighted: down', trustChoice('Do you trust the files in this folder?\n\n ❯ 1. No, exit\n   2. Yes, I trust this folder') === 'down');
t.check('other marker characters (› and >) work the same', trustChoice(real.replace('❯', '›')) === 'down' && trustChoice(swap(real).replace('❯', '>')) === 'enter');

// ---------- מקרים שבהם אסור ללחוץ כלום ----------
t.check('no marker at all -> nothing', trustChoice(real.replace('❯ No, exit', '  No, exit')) === null);
t.check('two markers (ambiguous) -> nothing', trustChoice(real.replace('  Yes, I trust this folder', '❯ Yes, I trust this folder')) === null);
t.check('the marker on a line that is neither Yes nor No -> nothing', trustChoice(real.replace('❯ No, exit', '❯ Security guide\n  No, exit')) === null);
t.check('the marker on "No" with no "Yes, I trust" option below it -> nothing (never Enter, no blind Down)', trustChoice(real.replace('  Yes, I trust this folder\n', '')) === null);
t.check('a "Yes" option that is not the trust option is not confirmed', trustChoice(real.replace('❯ No, exit\n  Yes, I trust this folder', '  No, exit\n❯ Yes, accept all permissions')) === null);
t.check('without "Enter to confirm" (not the dialog, e.g. a chat line) -> nothing', trustChoice(real.replace('Enter to confirm · Esc to cancel', '')) === null);
t.check('unrelated text, empty text and non-strings -> nothing', trustChoice('PS C:\Users\user> claude\n❯ hello') === null && trustChoice('') === null && trustChoice(null) === null && trustChoice(undefined) === null);
t.check('Enter is never the answer while the marked line is "No"', ['❯ No, exit', '❯ 1. No, exit', '> No, exit', '› no, exit'].every((l) => trustChoice(real.replace('❯ No, exit', l)) !== 'enter'));
process.exit(t.finish() ? 0 : 1);
