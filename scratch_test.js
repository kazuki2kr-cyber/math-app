
const admin = require('firebase-admin');
// Initialize without real credentials just to test object creation
const update = {};
const unitId = "1.正負の数の加減";
update[`unitStats.${unitId}.maxScore`] = 100;
console.log(JSON.stringify(update, null, 2));
