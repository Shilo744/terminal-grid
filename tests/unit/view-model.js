'use strict';
// מצב התצוגה עם לשוניות (T60, server/view.js): מיגרציה מהתצוגה הישנה, אימות, ניקוי, הפעלה מחדש, והעברה בין לשוניות.
const { checker } = require('../lib/harness');
const V = require('../../server/view');

const t = checker('grid tabs: the view model (unit)');
const shape = (v) => JSON.stringify(v.tabs.map((x) => [x.id, x.order, x.expanded, x.focus])) + '|' + v.active;

/* ---------- מיגרציה מהתצוגה הישנה ---------- */
let v = V.normalizeView({ order: ['3', '1', '2'], expanded: '1', focus: '2' }, ['1', '2', '3']);
t.check('the old single view becomes the first tab, nothing lost (order, expanded, focus)', v.tabs.length === 1 && v.tabs[0].id === 't1' && v.tabs[0].order.join() === '3,1,2' && v.tabs[0].expanded === '1' && v.tabs[0].focus === '2' && v.active === 't1', shape(v));
v = V.normalizeView(null, ['5', '2']);
t.check('no saved view at all: one empty-named tab holding the live terminals in id order', v.tabs.length === 1 && v.tabs[0].order.join() === '2,5' && v.tabs[0].name === '', shape(v));
v = V.normalizeView({ tabs: [] }, ['1']);
t.check('an empty tab list still gives one tab', v.tabs.length === 1 && v.tabs[0].order.join() === '1');

/* ---------- אימות וניקוי ---------- */
v = V.normalizeView({ tabs: [{ id: 'a', name: '  עבודה   א  ', order: ['1', '9', '2', '1'], expanded: '2', focus: '9' }, { id: 'b', name: 'x'.repeat(100), order: ['2', '3'], expanded: '3', focus: '1' }], active: 'b' }, ['1', '2', '3', '4']);
t.check('only live terminals, each in ONE tab (the first that lists it), names cleaned and cut', v.tabs[0].order.join() === '1,2' && v.tabs[1].order.join() === '3,4' && v.tabs[0].name === 'עבודה א' && v.tabs[1].name === 'x'.repeat(60), shape(v) + ' ' + v.tabs.map((x) => x.name.length));
t.check('a terminal that no tab lists joins the ACTIVE tab (4 went to b), expanded/focus must belong to their own tab', v.tabs[1].order.includes('4') && v.tabs[0].expanded === '2' && v.tabs[0].focus === null && v.tabs[1].expanded === '3' && v.tabs[1].focus === null, shape(v));
t.check('the active tab is kept when it exists, else the first', v.active === 'b' && V.normalizeView({ tabs: [{ id: 'a', order: [] }], active: 'zz' }, []).active === 'a');
v = V.normalizeView({ tabs: [{ id: 'a', order: [] }, { id: 'a', order: [] }, { id: 'bad id!', order: [] }, 7, null] }, []);
t.check('duplicate or invalid tab ids get fresh ids; non-objects are dropped', v.tabs.length === 3 && new Set(v.tabs.map((x) => x.id)).size === 3 && v.tabs.every((x) => /^[\w-]{1,24}$/.test(x.id)), shape(v));
v = V.normalizeView({ tabs: Array.from({ length: 80 }, (_, i) => ({ id: 'x' + i, order: [] })) }, []);
t.check('at most 40 tabs', v.tabs.length === V.MAX_TABS);
t.check('garbage input does not throw and gives one tab', V.normalizeView('x', ['1']).tabs.length === 1 && V.normalizeView({ tabs: 'no' }, []).tabs.length === 1 && V.normalizeView({ tabs: [{ order: 'no' }] }, ['1']).tabs[0].order.join() === '1');

/* ---------- סגירה, הפעלה מחדש, חיפוש ---------- */
v = V.normalizeView({ tabs: [{ id: 'a', order: ['1', '2'], expanded: '1', focus: '2' }, { id: 'b', order: ['3'], focus: '3' }], active: 'a' }, ['1', '2', '3']);
V.replaceId(v, '2', '7');
t.check('restart: the new terminal takes the old one\'s place, focus and tab', v.tabs[0].order.join() === '1,7' && v.tabs[0].focus === '7', shape(v));
V.removeId(v, '1');
t.check('close: the terminal leaves its tab and its expanded/focus are cleared', v.tabs[0].order.join() === '7' && v.tabs[0].expanded === null, shape(v));
t.check('tabOf and activeTab', V.tabOf(v, '3').id === 'b' && V.tabOf(v, 'nope') === null && V.activeTab(v).id === 'a');
t.check('cleanName strips control characters and non-strings', V.cleanName('a\u0000b\n c') === 'a b c' && V.cleanName(5) === '' && V.cleanName(null) === '');
process.exit(t.finish() ? 0 : 1);
