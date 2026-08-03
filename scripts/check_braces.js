const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'content', 'content_main.js');
const s = fs.readFileSync(p, 'utf8');
let stack = [];
const pairs = { '{': '}', '(': ')', '[': ']' };
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  // skip strings
  if (ch === '"' || ch === "'" || ch === '`') {
    const q = ch;
    i++;
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === q) { break; }
      i++;
    }
    continue;
  }
  // skip comments
  if (ch === '/' && s[i + 1] === '*') {
    i += 2;
    while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
    i += 1; continue;
  }
  if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
  if (pairs[ch]) { stack.push({ ch, i }); }
  else if (ch === '}' || ch === ')' || ch === ']') {
    if (stack.length === 0) { console.log('Unmatched closing', ch, 'at', i+1); reportIndex(i+1, 'Unmatched closing'); process.exit(1); }
    const top = stack.pop();
    if (pairs[top.ch] !== ch) {
      console.log('Mismatched at', i+1, 'expected', pairs[top.ch], 'but found', ch);
      console.log('Top of stack was', top.ch, 'opened at', top.i+1);
      console.log('Full stack (bottom->top):', stack.map(x => x.ch + '@' + (x.i+1)).join(' | '));
      reportIndex(i+1, 'Mismatched');
      process.exit(1);
    }
  }
}
if (stack.length) { const last = stack[stack.length-1]; console.log('Unclosed', last.ch, 'at', last.i+1); reportIndex(last.i+1, 'Unclosed'); process.exit(1); }
console.log('All balanced');
function reportIndex(i, msg) {
  const p = path.resolve(__dirname, '..', 'content', 'content_main.js');
  const s = fs.readFileSync(p, 'utf8');
  const upTo = s.slice(0, i);
  const lines = upTo.split(/\r?\n/);
  const lineNum = lines.length;
  const col = lines[lines.length-1].length + 1;
  const allLines = s.split(/\r?\n/);
  const start = Math.max(0, lineNum - 3);
  const end = Math.min(allLines.length, lineNum + 2);
  console.log(msg + ' at index ' + i + ' -> line ' + lineNum + ', col ' + col);
  for (let ln = start; ln < end; ln++) {
    const prefix = (ln + 1 === lineNum) ? '>> ' : '   ';
    console.log(prefix + (ln + 1) + ': ' + allLines[ln]);
  }
}

// If called with an index argument, report it and exit (helper)
if (process.argv && process.argv[2]) {
  const idx = Number(process.argv[2]);
  if (!isNaN(idx) && idx > 0) {
    reportIndex(idx, 'Manual report');
    process.exit(0);
  }
}
