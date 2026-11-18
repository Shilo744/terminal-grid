'use strict';
/*
 * מונע מהמחשב להירדם בזמן שזוג סוכנים פעיל (עבודה לילית). שינה מקפיאה את הסוכנים.
 * המימוש תלוי במערכת (Windows: SetThreadExecutionState, macOS: caffeinate, Linux: systemd-inhibit) וגר ב-server/platform.js.
 * התהליך יוצא לבד אם השרת נעלם, כדי שלא יישאר "ער" לנצח אחרי קריסה.
 */
const { awake } = require('../platform');

module.exports = { start: (log) => awake.start(log), stop: (log) => awake.stop(log), isOn: () => awake.isOn() };
