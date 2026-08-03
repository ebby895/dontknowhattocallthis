const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'popup', 'popup_main.js');
const s = fs.readFileSync(p, 'utf8');

function lineColFromIndex(src, idx) {
  const lines = src.slice(0, idx).split('\n');
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  return { line, col };
}

const stack = [];
const pairs = { '(': ')', '{': '}', '[': ']' };
const openers = new Set(['(', '{', '[']);
const closers = new Set([')', '}', ']']);

for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  // naive skip for simple strings: skip inside // comments and /* */ and single/double quotes and backticks
  // We'll do a simple state machine
}

// Implement a basic scanner that tracks strings and comments, so we ignore braces inside them.
let i = 0;
let state = null; // null | '//' | '/*' | '"' | "'" | '`'
while (i < s.length) {
  const ch = s[i];
  const next = s[i+1];
  if (!state) {
    if (ch === '/' && next === '/') { state = '//'; i += 2; continue; }
    if (ch === '/' && next === '*') { state = '/*'; i += 2; continue; }
    if (ch === '"') { state = '"'; i++; continue; }
    if (ch === "'") { state = "'"; i++; continue; }
    if (ch === '`') { state = '`'; i++; continue; }
    if (openers.has(ch)) {
      stack.push({ ch, idx: i, pos: lineColFromIndex(s, i) });
    } else if (closers.has(ch)) {
      const last = stack[stack.length - 1];
      if (last && pairs[last.ch] === ch) {
        stack.pop();
      } else {
        const pos = lineColFromIndex(s, i);
        console.log(`Mismatched closer ${ch} at ${pos.line}:${pos.col} (expected ${last ? pairs[last.ch] : 'none'})`);
      }
    }
    i++;
  } else if (state === '//') {
    if (ch === '\n') state = null; i++; continue;
  } else if (state === '/*') {
    if (ch === '*' && s[i+1] === '/') { state = null; i += 2; continue; }
    i++; continue;
  } else if (state === '"' || state === "'") {
    const quote = state;
    if (ch === '\\') { i += 2; continue; }
    if (ch === quote) { state = null; i++; continue; }
    i++; continue;
  } else if (state === '`') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') { state = null; i++; continue; }
    i++; continue;
  } else {
    i++;
  }
}

if (stack.length === 0) {
  console.log('No unmatched openings found.');
} else {
  console.log('Unmatched openings:', stack.length);
  for (const item of stack) {
    const ctxStart = Math.max(0, item.idx - 80);
    const ctxEnd = Math.min(s.length, item.idx + 80);
    const snippet = s.slice(ctxStart, ctxEnd).replace(/\n/g, '↵');
    console.log(`- ${item.ch} at ${item.pos.line}:${item.pos.col} context: ${snippet}`);
  }
}
