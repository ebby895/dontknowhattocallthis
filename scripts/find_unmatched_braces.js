const fs = require('fs');
const p = 'c:/Users/Taylor/Documents/popup/popup_main.js';
const s = fs.readFileSync(p,'utf8');
let stack = [];
let line = 1;
for (let i=0;i<s.length;i++){
  const ch = s[i];
  if (ch === '\n') line++;
  if (ch === '{') stack.push({pos:i,line});
  else if (ch === '}') {
    if (stack.length) stack.pop();
    else console.log('Extra closing brace at', line, 'pos', i);
  }
}
console.log('Unmatched opening braces:', stack.length);
for (let k=Math.max(0,stack.length-10); k<stack.length; k++){
  const it = stack[k];
  const start = Math.max(0,it.pos-60);
  const snippet = s.slice(start, Math.min(s.length, it.pos+60));
  const lineNo = it.line;
  console.log('--- Unmatched { at line', lineNo, 'pos', it.pos, '---');
  console.log(snippet.replace(/\n/g,'\\n'));
}
