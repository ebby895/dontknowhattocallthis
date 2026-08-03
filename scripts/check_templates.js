const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'popup', 'popup_main.js');
const s = fs.readFileSync(p, 'utf8');

function lineCol(idx) {
  const lines = s.slice(0, idx).split('\n');
  return { line: lines.length, col: lines[lines.length-1].length + 1 };
}

let i = 0;
let state = null; // null, '//', '/*', '"', "'", '`'
const problems = [];
while (i < s.length) {
  const ch = s[i];
  const next = s[i+1];
  if (!state) {
    if (ch === '/' && next === '/') { state = '//'; i += 2; continue; }
    if (ch === '/' && next === '*') { state = '/*'; i += 2; continue; }
    if (ch === '"') { state = '"'; i++; continue; }
    if (ch === "'") { state = "'"; i++; continue; }
    if (ch === '`') { state = '`'; i++; continue; }
    i++; continue;
  }
  if (state === '//') { if (ch === '\n') state = null; i++; continue; }
  if (state === '/*') { if (ch === '*' && s[i+1] === '/') { state = null; i += 2; continue; } i++; continue; }
  if (state === '"' || state === "'") { if (ch === '\\') { i += 2; continue; } if (ch === state) { state = null; i++; continue; } i++; continue; }
  if (state === '`') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === '$' && s[i+1] === '{') {
      // found a template expression, scan for matching }
      const startIdx = i;
      let depth = 0;
      i += 2; // skip ${
      let innerState = null; // for quotes/comments inside expression
      while (i < s.length) {
        const c = s[i];
        const n = s[i+1];
        if (!innerState) {
          if (c === '/' && n === '/') { innerState = '//'; i += 2; continue; }
          if (c === '/' && n === '*') { innerState = '/*'; i += 2; continue; }
          if (c === '"') { innerState = '"'; i++; continue; }
          if (c === "'") { innerState = "'"; i++; continue; }
          if (c === '`') { innerState = '`'; i++; continue; }
          if (c === '{') { depth++; i++; continue; }
          if (c === '}') {
            if (depth === 0) { i++; break; } else { depth--; i++; continue; }
          }
          i++; continue;
        } else if (innerState === '//') { if (c === '\n') innerState = null; i++; continue; }
        else if (innerState === '/*') { if (c === '*' && s[i+1] === '/') { innerState = null; i += 2; continue; } i++; continue; }
        else if (innerState === '"' || innerState === "'") { if (c === '\\') { i += 2; continue; } if (c === innerState) { innerState = null; i++; continue; } i++; continue; }
        else if (innerState === '`') { if (c === '\\') { i += 2; continue; } if (c === '`') { innerState = null; i++; continue; } i++; continue; }
        else { i++; }
      }
      if (i >= s.length) {
        problems.push({ pos: lineCol(startIdx), reason: 'Unterminated ${ in template literal (file end reached)'});
        break;
      }
      continue;
    }
    if (ch === '`') { state = null; i++; continue; }
    i++; continue;
  }
}

if (problems.length === 0) {
  console.log('No unterminated template expressions found.');
} else {
  for (const pbl of problems) {
    console.error('Problem at', pbl.pos.line + ':' + pbl.pos.col, '-', pbl.reason);
  }
  process.exit(1);
}
