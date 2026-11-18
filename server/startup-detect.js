'use strict';
/*
 * מתי טרמינל Claude "מוכן" לפי מה שעל המסך (T72): שלב ההפעלה ("מכין את Claude…") נגמר ברגע שתיבת ההקלדה מופיעה, לא רק כש-hook מגיע או אחרי 12 שניות.
 * שלושה מבנים: (1) הישן "? for shortcuts"; (2) תיבה עם מסגרת "│ > "; (3) הפריסה האמיתית של Claude Code v2.1.301: קו אופקי (עם תווית בסוף, "──── duo-worker ─"),
 * שורה שפותחת ב-❯ ואחריו רווח שאינו נשבר (U+00A0), ואחריה קו. שורת אפשרויות של דיאלוג ("❯ 1. Yes") אינה תיבת הקלדה.
 */
const NEEDS_HUMAN = /Enter to (confirm|select|continue)|Esc to (cancel|exit)|\(y\/n\)|\[Y\/n\]|Press Enter/i;
const BOX_OLD = /\? for shortcuts|^\s*[\u2502|]\s*>\s/m;
const BOX_REAL = /^[\u2500\u2501\u2550-]{12,}[^\n]*\n[ \t]*[\u276f>][ \u00a0](?!\d+\.\s)/m;
const MAIN_PROMPT = { test: (text) => BOX_OLD.test(text) || BOX_REAL.test(text) };

module.exports = { NEEDS_HUMAN, MAIN_PROMPT };
