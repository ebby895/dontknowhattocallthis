const fs = require('fs');
const p='c:/Users/Taylor/Documents/popup/popup_main.js';
const s=fs.readFileSync(p,'utf8');
const lines=s.split('\n');
const start=3428, end=3446;
for(let i=start;i<=end;i++){
  console.log((i+1).toString().padStart(6), lines[i]===undefined?'<EOF>':lines[i]);
}
