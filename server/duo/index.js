'use strict';
// נקודת הכניסה היחידה של פיצ'ר "זוג סוכנים": השרת מייבא רק את זה.
const { createDuoManager } = require('./manager');
module.exports = { createDuoManager };
