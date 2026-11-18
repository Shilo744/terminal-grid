'use strict';
// T72: when is a Claude terminal "ready" on screen? Golden screens captured from the REAL Claude Code v2.1.301 (labelled top rule, a NON-BREAKING space after the marker).
const { checker } = require('../lib/harness');
const { MAIN_PROMPT, NEEDS_HUMAN } = require('../../server/startup-detect');

const t = checker('start-up ready detection (unit)');
const NB = '\u00a0';
const RULE = '\u2500'.repeat(86);
const real = [' \u2590\u259b\u2588\u2588\u2588\u259b\u2588   Claude Code v2.1.301', '\u259d\u259c\u2588\u2588\u2588\u2588\u2588\u2588\u2580  Sonnet 5.5 with medium effort \u00b7 Claude Max', ' \u259d\u259d   \u259d\u259d   C:\\project', '', '', RULE + ' duo-worker \u2500', '\u276f' + NB + 'Try "refactor <filepath>"', RULE, '  \u23f5\u23f5 auto mode on (shift+tab to cycle)'].join('\n');
t.check('the REAL empty prompt (labelled rule, ❯ + NBSP) is recognized as the input box', MAIN_PROMPT.test(real));
t.check('...also without a label on the rule', MAIN_PROMPT.test(['', RULE, '\u276f' + NB + 'hello', RULE].join('\n')));
t.check('...and with a plain space after the marker (older captures)', MAIN_PROMPT.test(['', RULE, '\u276f hello', RULE].join('\n')));
t.check('the old "? for shortcuts" and the boxed "│ > " layouts still count', MAIN_PROMPT.test('  ? for shortcuts') && MAIN_PROMPT.test('\u2502 > '));
t.check('the logo and welcome lines alone (Claude still loading) are NOT the input box', !MAIN_PROMPT.test(real.split('\n').slice(0, 5).join('\n')));
t.check('a dialog option list ("❯ 1. Yes, I trust this folder") is not an input box', !MAIN_PROMPT.test(['', RULE, '\u276f' + NB + '1. Yes, I trust this folder', '  2. No, exit', RULE].join('\n')));
t.check('a dialog that needs a person is recognized (Enter to confirm · Esc to cancel)', NEEDS_HUMAN.test('Enter to confirm \u00b7 Esc to cancel'));
process.exit(t.finish() ? 0 : 1);
