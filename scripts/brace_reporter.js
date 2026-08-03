const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'popup', 'popup_main.js');
const s = fs.readFileSync(p, 'utf8');

function lineColFromIndex(idx) {
  const lines = s.slice(0, idx).split('\n');
  return { line: lines.length, col: lines[lines.length-1].length + 1 };
}

const pairs = { '(': ')', '{': '}', '[': ']' };
const openers = new Set(['(', '{', '[']);
const closers = new Set([')', '}', ']']);
const stack = [];

let i = 0;
let state = null; // null, '//', '/*', '"', "'", '`'
while (i < s.length) {
  const ch = s[i];
  const next = s[i+1];
  if (!state) {
    // detect comment/string/template start
    if (ch === '/' && next === '/') { state = '//'; i += 2; continue; }
    if (ch === '/' && next === '*') { state = '/*'; i += 2; continue; }
    if (ch === '"') { state = '"'; i++; continue; }
    if (ch === "'") { state = "'"; i++; continue; }
    if (ch === '`') { state = '`'; i++; continue; }
    // tokens
    if (openers.has(ch)) {
      stack.push({ ch, idx: i, pos: lineColFromIndex(i) });
    } else if (closers.has(ch)) {
      const last = stack[stack.length - 1];
      if (last && pairs[last.ch] === ch) {
        stack.pop();
      } else {
        // mismatched closer
        stack.push({ error: `Mismatched closer ${ch} at ${lineColFromIndex(i).line}:${lineColFromIndex(i).col}`, idx: i });
      }
    }
    i++;
  } else if (state === '//') {
    if (ch === '\n') state = null; i++; continue;
  } else if (state === '/*') {
    if (ch === '*' && s[i+1] === '/') { state = null; i += 2; continue; }
    i++; continue;
  } else if (state === '"' || state === "'") {
    if (ch === '\\') { i += 2; continue; }
    if (ch === state) { state = null; i++; continue; }
    i++; continue;
  } else if (state === '`') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === '$' && s[i+1] === '{') {
      // enter template expression parsing (like open brace)
      stack.push({ ch: '${', idx: i, pos: lineColFromIndex(i) });
      i += 2; // skip ${
      // Now parse until matching } for this expression, with nested braces allowed and inner strings/comments
      let innerState = null;
      let depth = 0;
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
      // after loop continue; we do not pop the '${' opener here; it will be left on stack if not closed
      continue;
    }
    if (ch === '`') { state = null; i++; continue; }
    i++; continue;
  } else {
    i++;
  }
}

// produce report
const outPath = path.resolve(__dirname, 'brace_report.txt');
let out = '';
if (stack.length === 0) {
  out = 'No unmatched openings found.\n';
} else {
  out = `Unmatched openings: ${stack.length}\n`;
  for (const item of stack) {
    if (item.error) { out += item.error + '\n'; continue; }
    const ctxStart = Math.max(0, item.idx - 100);
    const ctxEnd = Math.min(s.length, item.idx + 100);
    const snippet = s.slice(ctxStart, ctxEnd).replace(/\n/g, '↵');
    out += `- ${item.ch} at ${item.pos.line}:${item.pos.col} context: ${snippet}\n`;
  }
}
fs.writeFileSync(outPath, out, 'utf8');
console.log('Wrote', outPath);
