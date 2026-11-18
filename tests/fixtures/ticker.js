'use strict';
// "claude" מדומה לבדיקת האריחים: מדפיס שורת "<שם התיקייה> tick N" כל 300ms, כך שהשורות האחרונות ידועות ומשתנות כל הזמן
const name = require('path').basename(process.cwd());
let n = 0;
console.log('ready ' + name);
setInterval(() => console.log(`${name} tick ${++n}`), 300);
