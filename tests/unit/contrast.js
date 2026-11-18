'use strict';
// tokens.css (T36, T49): ניגודיות AA לכל שילוב של סגנון (IDE / קלאסי / נייר) וצבע הדגשה (ברירת מחדל + שישה), ושאין צבע קבוע מחוץ ל-tokens.css.
// הבדיקה קוראת את הקובץ עצמו (לא עותק של הצבעים), מפענחת את המשתנים כמו הדפדפן ומחשבת יחס ניגודיות לפי WCAG 2.
// `node tests/unit/contrast.js --table` מדפיס את הטבלה בפורמט של docs/design-principles.md.
const fs = require('fs');
const path = require('path');
const { checker, APP } = require('../lib/harness');

const t = checker('appearance tokens: contrast and consistency (unit)');
const CSS_DIR = path.join(APP, 'public', 'css');
const tokensCss = fs.readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/* ---------- מפענח את tokens.css: בלוקים -> משתנים ---------- */
const blocks = [];
for (const m of tokensCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sels = m[1].split(',').map((s) => s.trim());
  const vars = {};
  for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
  blocks.push({ sels, vars });
}
const STYLES = ['ide', 'classic', 'paper'];
const ACCENTS = ['default', 'blue', 'teal', 'violet', 'green', 'amber', 'rose'];
const where = (sel) => blocks.filter((b) => b.sels.includes(sel));
function varsFor(style, accent) {
  const out = {};
  for (const b of where(':root')) Object.assign(out, b.vars);
  if (style !== 'ide') for (const b of where(`:root[data-style="${style}"]`)) Object.assign(out, b.vars);
  if (accent !== 'default') for (const b of where(`:root[data-accent="${accent}"]`)) Object.assign(out, b.vars);
  // הדגשה מפורשת בסגנון מסוים (נייר: גרסאות כהות יותר, ספציפיות גבוהה יותר)
  if (accent !== 'default') for (const b of where(`:root[data-style="${style}"][data-accent="${accent}"]`)) Object.assign(out, b.vars);
  return out;
}
const subst = (vars, v) => { let s = v, n = 0; while (/var\(--/.test(s) && n++ < 10) s = s.replace(/var\((--[\w-]+)\)/g, (m, k) => (k in vars ? vars[k] : m)); return s; };

/* ---------- צבעים ---------- */
function parseColor(str) {
  str = str.trim();
  let m;
  if (str === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if ((m = /^#([0-9a-f]{6})$/i.exec(str))) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(str))) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  if ((m = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*white\)$/.exec(str))) {
    const c = parseColor(m[1]), p = +m[2] / 100;
    return { r: c.r * p + 255 * (1 - p), g: c.g * p + 255 * (1 - p), b: c.b * p + 255 * (1 - p), a: 1 };
  }
  throw new Error('cannot parse colour: ' + str);
}
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function palette(style, accent) {
  const vars = varsFor(style, accent);
  const get = (name) => parseColor(subst(vars, vars[name]));
  const surfaces = { bg: get('--bg'), surface: get('--surface'), 'surface-2': get('--surface-2'), 'surface-3': get('--surface-3') };
  return { vars, get, surfaces };
}

/* ---------- הבדיקות ---------- */
const rows = [];   // לטבלה: { style, accent, name, min }
let worst = {};
function note(style, accent, name, value, need) {
  const key = `${style}|${name}`;
  if (!worst[key] || value < worst[key].value) worst[key] = { style, accent, name, value, need };
  return value >= need;
}

const failures = [];
function expect(style, accent, name, value, need) {
  if (!note(style, accent, name, value, need)) failures.push(`${style}/${accent}: ${name} = ${value.toFixed(2)} (needs ${need})`);
}

for (const style of STYLES) {
  for (const accent of ACCENTS) {
    const p = palette(style, accent);
    const g = p.get;
    const S = p.surfaces;
    for (const [sn, sc] of Object.entries(S)) {
      expect(style, accent, 'text / surfaces', ratio(over(g('--text'), sc), sc), 4.5);
      expect(style, accent, 'text-muted / surfaces', ratio(g('--text-muted'), sc), 4.5);
      expect(style, accent, sn === 'surface-3' ? 'text-dim / hover fill (surface-3)' : 'text-dim / surfaces', ratio(g('--text-dim'), sc), sn === 'surface-3' ? 3 : 4.5);
      if (sn !== 'bg') {
        expect(style, accent, sn === 'surface-3' ? 'accent / hover fill (surface-3)' : 'accent / surfaces', ratio(g('--accent'), sc), sn === 'surface-3' ? 3 : 4.5);
        if (sn !== 'surface-3') expect(style, accent, 'accent on accent-dim / surfaces', ratio(g('--accent'), over(g('--accent-dim'), sc)), 4.5);
      }
    }
    expect(style, accent, 'accent-ink on accent-fill (primary button)', ratio(g('--accent-ink'), g('--accent-fill')), 4.5);
    expect(style, accent, 'accent-ink on accent-fill-hi (hover)', ratio(g('--accent-ink'), g('--accent-fill-hi')), 4.5);
    for (const [name, key] of [['warn', '--warn'], ['danger', '--danger'], ['claude (agent)', '--claude'], ['shell (terminal)', '--shell']]) {
      expect(style, accent, `${name} / surface-2`, ratio(g(key), S['surface-2']), 4.5);
    }
    expect(style, accent, 'warn-ink on warn', ratio(g('--warn-ink'), g('--warn')), 4.5);
    expect(style, accent, 'danger-ink on danger', ratio(g('--danger-ink'), g('--danger')), 4.5);
    // טרמינל: טקסט (7:1), סמן (3:1 לרכיב גרפי), טקסט על בחירה (4.5:1)
    const tb = g('--term-bg');
    expect(style, accent, 'terminal text / background (AAA)', ratio(g('--term-fg'), tb), 7);
    expect(style, accent, 'terminal cursor / background', ratio(g('--term-cursor'), tb), 3);
    expect(style, accent, 'terminal text on selection', ratio(g('--term-fg'), over(g('--term-select'), tb)), 4.5);
    // קווים: שקטים אבל נראים (לא דרישת WCAG; ראו design-principles.md)
    expect(style, accent, 'border-strong / surface-2 (quiet but visible)', ratio(over(g('--border-strong'), S['surface-2']), S['surface-2']), 1.3);
  }
}
t.check(`AA contrast holds for ${STYLES.length} styles x ${ACCENTS.length} accents (${Object.keys(worst).length} measured pairs)`, failures.length === 0, failures.slice(0, 8).join(' | '));

/* ---------- עקביות ---------- */
t.check('tokens.css defines every style and every accent', STYLES.every((s) => s === 'ide' || where(`:root[data-style="${s}"]`).length === 1) && where(':root[data-style="paper"][data-accent="blue"]').length === 1 && ACCENTS.every((a) => a === 'default' || where(`:root[data-accent="${a}"]`).length === 1));
const needed = [...new Set(blocks.filter((b) => b.sels.some((s) => s.includes('data-style="ide"'))).flatMap((b) => Object.keys(b.vars)))];
const missing = [];
for (const s of STYLES) {
  if (s === 'ide') continue;
  const have = new Set(where(`:root[data-style="${s}"]`).flatMap((b) => Object.keys(b.vars)));
  for (const k of needed) if (!have.has(k)) missing.push(`${s}:${k}`);
}
t.check(`every preset overrides every style token (${needed.length} tokens), so previews never inherit from the active preset`, missing.length === 0, missing.join(', '));
const serverSrc = fs.readFileSync(path.join(APP, 'server', 'settings.js'), 'utf8');
const listOf = (src, re) => { const m = re.exec(src); return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : []; };
const serverStyles = listOf(serverSrc, /appearance\.style'[^\]]*values: \[([^\]]*)\]/);
const serverAccents = listOf(serverSrc, /appearance\.accent'[^\]]*values: \[([^\]]*)\]/);
const consts = fs.readFileSync(path.join(APP, 'public', 'js', 'constants.js'), 'utf8');
const clientStyles = listOf(consts, /APPEARANCE_STYLES = \[([^\]]*)\]/);
const clientAccents = listOf(consts, /ACCENTS = \[([^\]]*)\]/);
t.check('server schema, client constants and tokens.css list the same styles and accents',
  JSON.stringify(serverStyles) === JSON.stringify(STYLES) && JSON.stringify(clientStyles) === JSON.stringify(STYLES) &&
  JSON.stringify(serverAccents) === JSON.stringify(ACCENTS) && JSON.stringify(clientAccents) === JSON.stringify(ACCENTS), JSON.stringify({ serverStyles, serverAccents, clientStyles, clientAccents }));
const swatches = ACCENTS.every((a) => `--sw-${a}` in varsFor('classic', 'teal'));
t.check('every accent has a swatch colour for the settings dots', swatches);

// אין צבע קבוע (hex או rgb עם מספרים) מחוץ ל-tokens.css: כל צבע בא ממשתנה
const offenders = [];
for (const f of fs.readdirSync(CSS_DIR)) {
  if (f === 'tokens.css') continue;
  const src = fs.readFileSync(path.join(CSS_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const hits = src.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g);
  if (hits) offenders.push(`${f}: ${hits.slice(0, 3).join(' ')}`);
}
t.check('no colour literals outside tokens.css (only var(--...))', offenders.length === 0, offenders.join(' | '));

if (process.argv.includes('--table')) {
  console.log('\n| pair | need | ' + STYLES.join(' | ') + ' |\n|---|---|' + STYLES.map(() => '---').join('|') + '|');
  const names = [...new Set(Object.values(worst).map((w) => w.name))];
  for (const n of names) {
    const cells = STYLES.map((s) => { const w = worst[`${s}|${n}`]; return `${w.value.toFixed(1)}`; });
    console.log(`| ${n} | ${worst[`ide|${n}`].need} | ${cells.join(' | ')} |`);
  }
}
process.exit(t.finish() ? 0 : 1);
