/* ---------- עזרי DOM ואלמנטים משותפים ---------- */
// הסקריפט נטען אחרי שהדף נבנה (מודולים רצים בדחייה), לכן אפשר לאתר אלמנטים כבר בטעינת המודול.
// כאן רק מה שכמה מודולים צריכים; אלמנטים של תכונה אחת נמצאים במודול של אותה תכונה.

export const $ = (sel, root = document) => root.querySelector(sel);

export const stage = $('#stage');
export const emptyEl = $('#empty');
export const gridBtn = $('#gridBtn');
export const offlineEl = $('#offline');
// מחזיק את הטרמינלים של זוגות הסוכנים כשהם לא מוצגים באחת מעמודות מסך הזוגות
export const duoHold = $('#duoHold');
