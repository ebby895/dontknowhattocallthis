const fs = require('fs');
const p = 'c:/Users/Taylor/Documents/popup/popup_main.js';
const s = fs.readFileSync(p,'utf8');
const tryPositions = [];
for (let i=0;i<s.length;i++){
  if (s.slice(i,i+4) === 'try ' || s.slice(i,i+4) === 'try{') {
    // find nearest '{' after i
    const braceIndex = s.indexOf('{', i);
    if (braceIndex !== -1) tryPositions.push({i, braceIndex});
  }
}
console.log('Found try blocks:', tryPositions.length);
for (const t of tryPositions) {
  // find matching closing brace for this try's opening brace
  let depth = 0;
  let j = t.braceIndex;
  for (; j<s.length; j++){
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const after = s.slice(j+1, j+50);
  const before = s.slice(Math.max(0,t.braceIndex-50), t.braceIndex+1);
  const lineNo = s.slice(0,t.braceIndex).split('\n').length;
  if (!after.match(/^\s*(catch|finally)\b/)) {
    console.log('Try at line', lineNo, 'missing catch/finally. Context before:', before.replace(/\n/g,'\\n'), 'after:', after.replace(/\n/g,'\\n'));
  }
}
