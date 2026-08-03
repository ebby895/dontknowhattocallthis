const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'popup', 'popup_main.js');
const s = fs.readFileSync(file, 'utf8');
let line = 1, col = 0;
let stack = [];
let inSingle = false, inDouble = false, inTemplate = false, inBlock = false, inLine = false;
let escape = false;
let lastChar = '';
for (let i=0;i<s.length;i++){
  const c = s[i];
  if (c === '\n') { line++; col =0; inLine = false; }
  col++;
  if (inLine) {
    // do not start strings inside line comment
  }
  if (inBlock) {
    if (c === '*' && s[i+1] === '/') { inBlock = false; i++; col++; }
    continue;
  }
  if (inSingle) {
    if (escape) { escape = false; } else if (c === '\\') { escape = true; } else if (c === "'") { inSingle = false; }
    continue;
  }
  if (inDouble) {
    if (escape) { escape = false; } else if (c === '\\') { escape = true; } else if (c === '"') { inDouble = false; }
    continue;
  }
  if (inTemplate) {
    if (escape) { escape = false; } else if (c === '\\') { escape = true; } else if (c === '`') { inTemplate = false; }
    continue;
  }
  // not in any string/comment
  if (c === '/') {
    const n = s[i+1];
    if (n === '/') { inLine = true; i++; col++; continue; }
    if (n === '*') { inBlock = true; i++; col++; continue; }
  }
  if (c === "'") { inSingle = true; continue; }
  if (c === '"') { inDouble = true; continue; }
  if (c === '`') { inTemplate = true; continue; }
  if (c === '{' || c === '(' || c === '[') { stack.push({ch:c, line, col}); continue; }
  if (c === '}' || c === ')' || c === ']') {
    const open = (c === '}') ? '{' : (c === ')') ? '(' : '[';
    const last = stack.length ? stack[stack.length-1] : null;
    if (!last || last.ch !== open) {
      console.log('Mismatch closing', c, 'at', line, col, 'expected', last ? last.ch : 'none');
      process.exit(0);
    }
    stack.pop();
    continue;
  }
  lastChar = c;
}
console.log('done scanning');
console.log('inSingle', inSingle, 'inDouble', inDouble, 'inTemplate', inTemplate, 'inBlock', inBlock, 'inLine', inLine);
console.log('stack length', stack.length);
if (stack.length) console.log('top of stack', stack[stack.length-1]);
console.log('last 400 chars:\n', s.slice(-400));
if (inTemplate) process.exit(2);
if (inBlock) process.exit(3);
if (inSingle||inDouble) process.exit(4);
process.exit(0);
