const fs = require('fs');
const p = 'c:/Users/Taylor/Documents/popup/popup_main.js';
const s = fs.readFileSync(p, 'utf8');
const opens = (s.match(/\{/g) || []).length;
const closes = (s.match(/\}/g) || []).length;
console.log('opens', opens, 'closes', closes);
// show last 200 chars to inspect trailing content
console.log('EOF snippet:', s.slice(-400));
