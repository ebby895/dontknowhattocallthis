const fs=require('fs');
const p='c:/Users/Taylor/Documents/popup/popup_main.js';
const s=fs.readFileSync(p,'utf8');
const lines=s.split('\n');
const targetLine=3440; // 1-based
let pos=0;
for(let i=0;i<targetLine-1;i++) pos += lines[i].length+1; // +1 for newline
console.log('char pos of line start', pos);
// find the first '}' character on that line
const lineText = lines[targetLine-1];
const idxInLine = lineText.indexOf('}');
console.log('line text:', lineText);
if (idxInLine===-1) { console.log('no } on that line'); process.exit(0); }
const charPos = pos + idxInLine;
console.log('charPos of }', charPos);
// find try blocks and their matching closing brace positions
let tries=[];
for(let i=0;i<s.length;i++){
  if (s.slice(i,i+3)==='try') {
    // ensure it's a word boundary
    const before = s[i-1] || '';
    const after = s[i+3] || '';
    if (/[a-zA-Z0-9_$]/.test(before) || /[a-zA-Z0-9_$]/.test(after)) continue;
    const braceIndex = s.indexOf('{', i);
    if (braceIndex!=-1) {
      // find matching
      let depth=0; let j=braceIndex;
      for(;j<s.length;j++){
        if (s[j]==='{') depth++;
        else if (s[j]==='}') { depth--; if (depth===0) break; }
      }
      tries.push({start:i, openBrace:braceIndex, closeBrace:j});
    }
  }
}
console.log('Found tries:', tries.length);
for(const t of tries){
  if (t.closeBrace===charPos) {
    console.log('Found try whose close brace is target line. try at', s.slice(Math.max(0,t.start-60), t.start+20).replace(/\n/g,'\\n'));
    console.log('openBrace at', t.openBrace, 'closeBrace', t.closeBrace);
    const after = s.slice(t.closeBrace+1, t.closeBrace+30);
    console.log('after close:', after.replace(/\n/g,'\\n'));
  }
}

// Also find tries whose closeBrace is near
for(const t of tries){
  if (t.closeBrace>charPos-200 && t.closeBrace<charPos+200) {
    const lineNo = s.slice(0,t.start).split('\n').length;
    console.log('try near target', lineNo, 'openBrace', t.openBrace, 'closeBrace', t.closeBrace);
  }
}
