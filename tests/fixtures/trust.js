'use strict';
// "claude" מדומה לבדיקת האישור האוטומטי של שאלת האמון (T32, מתוקן ב-T40) ושל שלב ההפעלה (T41). ברירת המחדל משחזרת את הדיאלוג האמיתי של Claude Code:
//     Quick safety check: Is this a project you created or one you trust? ...
//     ❯ No, exit              <- המסומנת כברירת מחדל היא "No, exit" (!)
//       Yes, I trust this folder
//     Enter to confirm · Esc to cancel
// חיצי למעלה/למטה מזיזים את הסימון, Enter מאשר: על "No, exit" התהליך מדפיס EXITING_NO ויוצא (כמו Claude האמיתי: הטרמינל חוזר ל-PowerShell), על "Yes" מדפיס TRUSTED.
// כל מקש נרשם בפלט: KEY:DOWN / KEY:UP / KEY:ENTER, וגם המונים DOWNS=n ו-ENTERS=n. הדיאלוג מצויר מחדש במקום (ניקוי מסך), כמו Claude.
//   TRUST_LAYOUT=legacy   הניסוח הישן: "Do you trust the files in this folder?" ו-"Yes" מסומן ראשון (Enter לבדו מספיק)
//   TRUST_NUMBERED=1      האפשרויות ממוספרות ("1. No, exit")
//   TRUST_NOMARKER=1      אין סימון בכלל (מסך שאי אפשר לפענח בבטחה): אסור ללחוץ כלום
//   TRUST_STUCK=1         חץ למטה לא מזיז את הסימון (המסך לא מגיב): אסור להמשיך ללחוץ, ואסור Enter
//   TRUST_DELAY_MS=n      מדפיס את השאלה רק אחרי n מילישניות (שאלה מאוחרת מדי)
//   TRUST_REPEAT=1        אחרי TRUSTED מדפיס את השאלה שוב (אסור שזה יביא מקש נוסף)
// שלב ההפעלה (T41): אחרי TRUSTED (או מיד, כשאין שאלת אמון) מצויר המסך הראשי של Claude: תיבת הקלדה ו-"? for shortcuts".
//   STARTUP_SKIP_TRUST=1       תיקייה שכבר אושרה: אין שאלת אמון, המסך הראשי מיד
//   STARTUP_DIALOG=1           במקום שאלת האמון דיאלוג אחר שדורש אדם (בחירת ערכת נושא, "Enter to confirm"): אסור להסתיר אותו
//   STARTUP_SILENT=1           לא מדפיס כלום (ה-claude "תקוע"): השכבה יורדת רק בסוף ההמתנה
//   STARTUP_PROMPT_DELAY_MS=n  המסך הראשי מצויר רק n מילישניות אחרי TRUSTED (או אחרי ההפעלה); ברירת מחדל 200
const delay = Number(process.env.TRUST_DELAY_MS) || 0;
const promptDelay = Number(process.env.STARTUP_PROMPT_DELAY_MS) || 200;
const legacy = process.env.TRUST_LAYOUT === 'legacy';
const numbered = process.env.TRUST_NUMBERED === '1';
const noMarker = process.env.TRUST_NOMARKER === '1';
const stuck = process.env.TRUST_STUCK === '1';
let sel = 0; // אינדקס האפשרות המסומנת: בפריסה האמיתית האפשרות הראשונה היא No, exit; בישנה Yes
let enters = 0, downs = 0, shown = false;
const options = legacy ? ['Yes, I trust this folder', 'No, exit'] : ['No, exit', 'Yes, I trust this folder'];
const ESC = String.fromCharCode(27);
const CSI = ESC + '[';
const NL = '\r\n';
const draw = () => {
  shown = true;
  const out = [CSI + '2J' + CSI + 'H'];
  if (legacy) {
    out.push('Do you trust the files in this folder?', '', ' ' + process.cwd(), '');
  } else {
    out.push('Accessing workspace:', '', ' ' + process.cwd(), '', 'Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what\'s in this folder first.', '', 'Claude Code\'ll be able to read, edit, and execute files here.', '', 'Security guide', '');
  }
  options.forEach((o, i) => out.push((noMarker ? '  ' : (i === sel ? '❯ ' : '  ')) + (numbered ? (i + 1) + '. ' : '') + o));
  out.push('', 'Enter to confirm · Esc to cancel');
  process.stdout.write(out.join(NL) + NL);
};
// המסך הראשי של Claude: תיבת הקלדה ושורת העזר
const mainPrompt = () => {
  shown = false;
  const out = [CSI + '2J' + CSI + 'H', 'Claude Code v2.0 (fake)', '', '╭' + '─'.repeat(40) + '╮', '│ > Try "edit foo"' + ' '.repeat(23) + '│', '╰' + '─'.repeat(40) + '╯', '  ? for shortcuts'];
  process.stdout.write(out.join(NL) + NL);
};
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  if (!shown) return;
  // רצף חץ: ESC [ B / ESC [ A (ובצורת O); Enter: \r או \n
  const keys = d.match(/\x1b\[[AB]|\x1bO[AB]|\r|\n|./g) || [];
  for (const k of keys) {
    if (k === CSI + 'B' || k === ESC + 'OB') {
      downs++;
      console.log('KEY:DOWN DOWNS=' + downs);
      if (!stuck) { sel = Math.min(options.length - 1, sel + 1); draw(); }
    } else if (k === CSI + 'A' || k === ESC + 'OA') {
      console.log('KEY:UP');
      if (!stuck) { sel = Math.max(0, sel - 1); draw(); }
    } else if (k === '\r' || k === '\n') {
      enters++;
      console.log('KEY:ENTER ENTERS=' + enters + ' ON=' + options[sel].split(',')[0]);
      if (/^Yes/.test(options[sel])) {
        console.log('TRUSTED');
        setTimeout(mainPrompt, promptDelay);
        if (process.env.TRUST_REPEAT) setTimeout(draw, promptDelay + 800);
      } else {
        console.log('EXITING_NO');
        process.exit(0);
      }
    } else console.log('KEY:OTHER');
  }
});
if (process.env.STARTUP_SILENT === '1') { /* שותק */ }
else if (process.env.STARTUP_SKIP_TRUST === '1') setTimeout(mainPrompt, promptDelay);
else if (process.env.STARTUP_DIALOG === '1') {
  setTimeout(() => process.stdout.write(['Welcome to Claude Code', '', 'Choose the text style that looks best with your terminal', '', '❯ 1. Dark mode', '  2. Light mode', '', 'Enter to confirm · Esc to cancel'].join(NL) + NL), delay);
} else setTimeout(draw, delay);
setInterval(() => {}, 1 << 30);
