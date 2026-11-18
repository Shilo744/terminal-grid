'use strict';
/*
 * מראה (T36, T49): שלושה סגנונות אמיתיים (IDE / קלאסי / נייר) וצבע הדגשה. החלפה בהגדרות משנה מיד את מאפייני :root, את צבע הרקע של הטרמינלים
 * (גם xterm עצמו ושכבת ה-RTL), נשמרת בשרת, שורדת טעינה מחדש בלי הבהוב של מראה אחר, ומגיעה גם לשרת אחר מאותו קובץ הגדרות.
 * שלושת הסגנונות שונים בצורה שאפשר למדוד: רדיוס, color-scheme של השורש, בהירות הרקע, בהירות כותרת הפאן, וצורת הפאן הממוקד (קו מסגרת בצבע או צל בלבד).
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('appearance styles: IDE / classic / paper');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'A' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'B' });
  for (let i = 0; i < 100 && keeper.sessions.size < 2; i++) await sleep(100);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  const { ev } = page;
  await page.appReady(2);
  const saved = () => JSON.parse(fs.readFileSync(srv.settingsFile, 'utf8'));
  const until = async (pred) => { for (let i = 0; i < 50; i++) { try { if (pred(saved())) return true; } catch { /* עוד לא נכתב */ } await sleep(100); } return false; };

  const attr = (n) => ev(`document.documentElement.getAttribute('data-${n}')`);
  const css = (name, sel = 'document.documentElement') => ev(`getComputedStyle(${sel}).getPropertyValue('${name}').trim()`);
  const paneBg = () => ev(`getComputedStyle(document.querySelector('.pane-body')).backgroundColor`);
  // הצבעים שכל xterm פתוח מחזיק, וה-THEME המשותף (שכבת ה-RTL מציירת איתו)
  const themes = () => ev(`(async () => { const { state } = await import('/js/state.js'); const { THEME } = await import('/js/constants.js');
    return { terms: [...state.panes.values()].map((p) => p.term.options.theme), shared: THEME }; })()`);
  // מעבר הצבע (220ms) עדיין רץ כשהמאפיין משתנה: צבעים מחושבים נמדדים רק אחרי שהסתיים
  const settle = () => sleep(450);
  const pick = (kind, value) => ev(`document.querySelector('[data-row="${kind}"] .seg-opt[data-value="${value}"]').click()`);
  const checked = (kind) => ev(`document.querySelector('[data-row="${kind}"] .seg-opt[aria-checked="true"]').dataset.value`);
  const dotColor = (value) => ev(`getComputedStyle(document.querySelector('[data-row="accent"] .seg-opt[data-value="${value}"]')).backgroundColor`);
  // מדדים שמבדילים בין הסגנונות: בהירות (0-1) של הרקע ושל כותרת הפאן, רדיוס, color-scheme, וצבע המסגרת/הצל של פאן ממוקד
  const measure = () => ev(`(() => {
    const lum = (rgb) => { const m = rgb.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const root = getComputedStyle(document.documentElement);
    const pane = document.querySelector('.pane.focused') || document.querySelector('.pane');
    const ps = getComputedStyle(pane);
    return { radius: root.getPropertyValue('--radius').trim(), scheme: root.colorScheme, bgLum: lum(getComputedStyle(document.body).backgroundColor), headLum: lum(getComputedStyle(pane.querySelector('.pane-head')).backgroundColor),
      termLum: lum(getComputedStyle(pane.querySelector('.pane-body')).backgroundColor), borderTransparent: /rgba\\(\\d+, \\d+, \\d+, 0\\)|transparent/.test(ps.borderTopColor), shadow: ps.boxShadow !== 'none' };
  })()`);

  /* ---------- ברירת מחדל: IDE + ההדגשה שלו ---------- */
  t.check('defaults: ide + default accent', (await attr('style')) === 'ide' && (await attr('accent')) === 'default', `${await attr('style')} ${await attr('accent')}`);
  t.check('ide: accent #58aaff, terminal background = the UI background #1e1e1e, radius 4px', (await css('--accent')) === '#58aaff' && (await paneBg()) === 'rgb(30, 30, 30)' && (await css('--bg')) === '#1e1e1e' && (await css('--radius')) === '4px', `${await css('--accent')} ${await paneBg()}`);
  let th = await themes();
  t.check('every xterm and the shared theme start with the IDE terminal colours', th.terms.length === 2 && th.terms.every((x) => x.background === '#1e1e1e' && x.foreground === '#cccccc' && x.cursor === '#aeafad' && x.selectionBackground === '#264f78') && th.shared.background === '#1e1e1e', JSON.stringify(th.shared));
  const mIde = await measure();

  /* ---------- שורות ההגדרות ---------- */
  await ev(`document.querySelector('#settingsBtn').click()`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  t.check('"תצוגה" starts with the appearance rows: מראה (3 cards) and צבע הדגשה (7 dots)', await ev(`(() => { const rows = [...document.querySelectorAll('[data-group="display"] [data-row]')].map((r) => r.dataset.row);
    return rows[0] === 'style' && rows[1] === 'accent' && document.querySelectorAll('[data-row="style"] .seg-opt').length === 3 && document.querySelectorAll('[data-row="accent"] .seg-opt').length === 7; })()`));
  t.check('the cards (IDE, קלאסי, נייר) have a live preview of their own style, and the dots have Hebrew names', await ev(`(() => [...document.querySelectorAll('[data-row="style"] .st-prev')].map((p) => p.dataset.style).join() === 'ide,classic,paper'
    && [...document.querySelectorAll('[data-row="style"] .seg-name')].map((n) => n.textContent).join() === 'IDE,קלאסי,נייר'
    && [...document.querySelectorAll('[data-row="accent"] .seg-opt')].every((b) => b.getAttribute('aria-label') && b.title)
    && document.querySelector('[data-row="accent"] .seg-opt[data-value="default"]').title === 'ברירת המחדל של הסגנון')()`));
  // כל כרטיס מקבל את המשתנים של הסגנון שלו גם כשהמראה הפעיל אחר (לא יורש)
  t.check('a card previews its own palette, not the active one', (await css('--bg', `document.querySelector('[data-row="style"] .st-prev[data-style="paper"]')`)) === '#ece9e2'
    && (await css('--bg', `document.querySelector('[data-row="style"] .st-prev[data-style="classic"]')`)) === '#0a0d13');
  t.check('the three cards differ in structure, not only colour (status bar strip only in IDE; light canvas only in paper)', await ev(`(() => {
    const p = (s) => document.querySelector('[data-row="style"] .st-prev[data-style="' + s + '"]');
    const barShown = (s) => getComputedStyle(p(s).querySelector('.pv-bar')).display !== 'none';
    const bgOf = (s) => getComputedStyle(p(s)).backgroundColor;
    return barShown('ide') && !barShown('classic') && !barShown('paper') && bgOf('paper') !== bgOf('ide') && bgOf('classic') !== bgOf('ide') && bgOf('paper') !== bgOf('classic');
  })()`));
  t.check('ide and the default accent are the checked options', (await checked('style')) === 'ide' && (await checked('accent')) === 'default');

  /* ---------- נייר ---------- */
  await pick('style', 'paper');
  await page.waitFor(`document.documentElement.getAttribute('data-style') === 'paper'`, 3000);
  await settle();
  t.check('paper: root attribute, light canvas and surfaces, dark terminal background, radius 12px', (await attr('style')) === 'paper' && (await css('--surface')) === '#f6f4ef' && (await css('--bg')) === '#ece9e2' && (await paneBg()) === 'rgb(30, 30, 30)' && (await css('--radius')) === '12px', `${await css('--surface')} ${await paneBg()}`);
  th = await themes();
  t.check('paper: the terminals stay dark and keep the IDE terminal colours live (a light UI around dark terminals)', th.terms.every((x) => x.background === '#1e1e1e' && x.foreground === '#cccccc' && x.cursor === '#aeafad' && x.selectionBackground === '#264f78'), JSON.stringify(th.terms[0]));
  t.check('the shared theme (RTL layer) follows too', th.shared.background === '#1e1e1e' && th.shared.cursorAccent === '#1e1e1e');
  t.check('the 16 ANSI colours never change (Claude Code looks the same)', th.terms.every((x) => x.red === '#c50f1f' && x.brightGreen === '#16c60c' && x.blue === '#0037da'));
  t.check('the choice is saved in the server settings', await until((s) => s.appearance && s.appearance.style === 'paper'));
  t.check('the paper card is the checked one, and the default dot shows the terracotta', (await checked('style')) === 'paper' && (await dotColor('default')) === 'rgb(167, 66, 32)', await dotColor('default'));
  const mPaper = await measure();
  t.check('paper: color-scheme light on the root (forms, scrollbars, dialogs), light page background, light header strip over a dark terminal', mPaper.scheme === 'light' && mPaper.bgLum > 0.7 && mPaper.headLum > 0.7 && mPaper.termLum < 0.05, JSON.stringify(mPaper));
  t.check('paper: a pane is a card with a shadow and NO coloured edge (transparent border)', mPaper.borderTransparent && mPaper.shadow, JSON.stringify(mPaper));
  t.check('ide: dark scheme, dark page, a coloured focus edge (non-transparent border)', mIde.scheme === 'dark' && mIde.bgLum < 0.05 && mIde.headLum < 0.05 && !mIde.borderTransparent, JSON.stringify(mIde));
  t.check('paper: an explicit accent uses the darker variant that passes AA on light surfaces, with white ink', await (async () => { await pick('accent', 'violet'); await page.waitFor(`document.documentElement.getAttribute('data-accent') === 'violet'`, 3000); await settle(); return (await css('--accent')) === '#6b3fbf' && (await css('--accent-ink')) === '#ffffff' && (await dotColor('violet')) === 'rgb(107, 63, 191)'; })());
  await pick('accent', 'default');
  await settle();

  /* ---------- קלאסי + צבע הדגשה ---------- */
  await pick('style', 'classic');
  await pick('accent', 'blue');
  await page.waitFor(`document.documentElement.getAttribute('data-accent') === 'blue'`, 3000);
  await settle();
  t.check('classic + blue: attributes, accent colour, terminal background, rounder radius', (await attr('style')) === 'classic' && (await attr('accent')) === 'blue'
    && (await css('--accent')) === '#66b0ff' && (await paneBg()) === 'rgb(12, 12, 12)' && (await css('--radius')) === '10px', `${await css('--accent')} ${await paneBg()} ${await css('--radius')}`);
  th = await themes();
  t.check('classic: the old terminal colours (white cursor), and the accent does not touch the terminal', th.terms.every((x) => x.background === '#0c0c0c' && x.cursor === '#ffffff'), JSON.stringify(th.terms[0]));
  t.check('the default dot of classic shows the classic teal', (await dotColor('default')) === 'rgb(70, 227, 198)', await dotColor('default'));
  const mClassic = await measure();
  t.check('the three styles are pairwise different on measurable properties (radius, canvas brightness)', new Set([mIde.radius, mClassic.radius, mPaper.radius]).size === 3 && Math.abs(mPaper.bgLum - mIde.bgLum) > 0.5 && mClassic.bgLum !== mIde.bgLum, JSON.stringify({ mIde, mClassic, mPaper }));
  await pick('accent', 'rose');
  await page.waitFor(`document.documentElement.getAttribute('data-accent') === 'rose'`, 3000);
  t.check('changing only the accent recolours the UI (accent family) and leaves the terminals alone', (await css('--accent-rgb')) === '255, 133, 173' && (await css('--accent-ink')) === '#06130f'
    && (await themes()).terms.every((x) => x.cursor === '#ffffff'), `${await css('--accent-rgb')}`);
  t.check('the accent dots show the checked colour with a check mark', await ev(`(() => { const b = document.querySelector('[data-row="accent"] .seg-opt[aria-checked="true"]'); return b.dataset.value === 'rose' && !!b.querySelector('svg'); })()`));
  await pick('accent', 'default');
  await page.waitFor(`document.documentElement.getAttribute('data-accent') === 'default'`, 3000);
  t.check('picking the default accent again restores the style accent', (await attr('accent')) === 'default' && (await attr('style')) === 'classic' && (await css('--accent')) === '#46e3c6');

  /* ---------- שמירה וטעינה מחדש: בלי הבהוב של מראה אחר ---------- */
  await pick('style', 'paper');
  await pick('accent', 'violet');
  t.check('saved on the server', await until((s) => s.appearance.style === 'paper' && s.appearance.accent === 'violet'));
  await sleep(300);
  t.check('the cache read by index.html is written', (await ev(`localStorage.getItem('tg.appearanceStyle')`)) === '"paper"' && (await ev(`localStorage.getItem('tg.appearanceAccent')`)) === '"violet"');
  // רושמים כל ערך ש-data-style מקבל מרגע יצירת המסמך: הראשון חייב להיות paper (נקבע בסקריפט שבראש הדף, לפני הציור)
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__seen = []; new MutationObserver(() => window.__seen.push(document.documentElement.getAttribute('data-style') + '/' + document.documentElement.getAttribute('data-accent'))).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-style', 'data-accent'] });` });
  await page.reload();
  await page.appReady(2);
  await settle();
  const seen = await ev(`window.__seen`);
  t.check('after a reload the style is applied before the first paint (never ide first)', Array.isArray(seen) && seen.length > 0 && seen[0].startsWith('paper/') && !seen.some((s) => s.startsWith('ide/')), JSON.stringify(seen));
  t.check('after a reload: paper + violet, terminal colours too', (await attr('style')) === 'paper' && (await attr('accent')) === 'violet' && (await paneBg()) === 'rgb(30, 30, 30)' && (await css('--accent')) === '#6b3fbf', `${await paneBg()}`);
  th = await themes();
  t.check('after a reload the new xterms are created with the terminal colours of paper', th.terms.every((x) => x.background === '#1e1e1e' && x.foreground === '#cccccc'));

  /* ---------- שרת אחר (מקור אחר: localStorage ריק) מקבל את המראה מהגדרות השרת ---------- */
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.join('\n'));
  page.close();
  keeper.close();
  srv.stop();
  await sleep(500);
  const srv2 = await startServer({ binDir: path.join(FIXTURES, 'bin-args'), settingsFile: srv.settingsFile, keepState: true });
  const page2 = await openPage(`http://127.0.0.1:${srv2.port}/`, { width: 1200, height: 800 });
  await page2.appReady(0);
  t.check('another port, empty browser cache: the style comes from the server settings', await page2.waitFor(`document.documentElement.getAttribute('data-style') === 'paper' && document.documentElement.getAttribute('data-accent') === 'violet'`, 8000));
  t.check('and its surfaces are paper', (await page2.ev(`getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()`)) === '#f6f4ef');
  t.check('no JavaScript errors on the second server', page2.errors.length === 0, page2.errors.join('\n'));
  page2.close();
  srv2.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
