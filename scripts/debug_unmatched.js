const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'popup', 'popup_main.js');
const s = fs.readFileSync(file, 'utf8');
let line = 1, col = 0;
let stack = [];
let inSingle = false, inDouble = false, inTemplate = false, inBlock = false, inLine = false;
let escape = false;
for (let i=0;i<s.length;i++){
  const c = s[i];
  if (c === '\n') { line++; col =0; inLine = false; }
  col++;
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
  if (c === '/') {
    const n = s[i+1];
    if (n === '/') { inLine = true; i++; col++; continue; }
    if (n === '*') { inBlock = true; i++; col++; continue; }
  }
  if (c === "'") { inSingle = true; continue; }
  if (c === '"') { inDouble = true; continue; }
  if (c === '`') { inTemplate = true; continue; }
  if (c === '{' || c === '(' || c === '[') { stack.push({ch:c, line, col, index:i}); continue; }
  if (c === '}' || c === ')' || c === ']') {
    const open = (c === '}') ? '{' : (c === ')') ? '(' : '[';
    const last = stack.length ? stack[stack.length-1] : null;
    if (!last || last.ch !== open) {
      // report context
      const start = Math.max(0, i-120);
      const end = Math.min(s.length, i+120);
      const ctx = s.slice(start, end);
      // compute line/col in context
      const pre = s.slice(0, i);
      const ctxLine = pre.split('\n').length;
      const ctxCol = pre.split('\n').pop().length+1;
      console.log('Mismatch closing', c, 'at file index', i, 'line', line, 'col', col, 'expected', last ? last.ch : 'none');
      console.log('Context lines around mismatch (approx):\n---BEGIN---\n' + ctx + '\n---END---');
      // also print a few surrounding full lines
      const lines = s.split('\n');
      const from = Math.max(0, ctxLine-5);
      const to = Math.min(lines.length, ctxLine+5);
      console.log('Nearby lines:');
      for (let L=from;L<to;L++) console.log((L+1)+': '+lines[L]);
      process.exit(0);
    }
    stack.pop();
    continue;
  }
}
console.log('No mismatch found. stack length', stack.length);
console.log('inSingle', inSingle, 'inDouble', inDouble, 'inTemplate', inTemplate, 'inBlock', inBlock);
process.exit(0);
