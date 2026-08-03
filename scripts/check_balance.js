const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'popup', 'popup_main.js');
const s = fs.readFileSync(file, 'utf8');
let line=1,col=0;
function pos(i){
  const prefix = s.slice(0,i);
  const lines = prefix.split('\n');
  return { line: lines.length, col: lines[lines.length-1].length+1 };
}

const stack = [];
let i=0;
let state = { inSingle:false, inDouble:false, inTemplate:false, inBlockComment:false, inLineComment:false, esc:false };
for(i=0;i<s.length;i++){
  const ch = s[i];
  const nxt = s[i+1];
  // update line/col
  if(ch==='\n'){ line++; col=0; } else col++;

  // handle comments
  if(state.inBlockComment){
    if(ch==='*' && nxt==='/' ){ state.inBlockComment=false; i++; col++; continue; }
    continue;
  }
  if(state.inLineComment){
    if(ch==='\n'){ state.inLineComment=false; }
    continue;
  }

  if(state.inSingle){
    if(state.esc){ state.esc=false; continue; }
    if(ch==='\\') { state.esc=true; continue; }
    if(ch==="'" ) { state.inSingle=false; continue; }
    continue;
  }
  if(state.inDouble){
    if(state.esc){ state.esc=false; continue; }
    if(ch==='\\') { state.esc=true; continue; }
    if(ch==='"' ) { state.inDouble=false; continue; }
    continue;
  }
  if(state.inTemplate){
    if(state.esc){ state.esc=false; continue; }
    if(ch==='\\') { state.esc=true; continue; }
    if(ch==='`') { state.inTemplate=false; continue; }
    // handle ${ expression }
    if(ch==='\$' && nxt==='{'){ stack.push({type:'${', pos:pos(i)}); i++; col++; continue; }
    if(ch==='}'){
      const top = stack[stack.length-1];
      if(top && top.type==='${'){ stack.pop(); continue; }
      // otherwise a normal } inside template literal - allowed
    }
    continue;
  }

  // not in any string/comment
  if(ch==='/' && nxt==='*'){ state.inBlockComment=true; i++; col++; continue; }
  if(ch==='/' && nxt=='/'){ state.inLineComment=true; i++; col++; continue; }
  if(ch==="'") { state.inSingle=true; continue; }
  if(ch==='"') { state.inDouble=true; continue; }
  if(ch==='`') { state.inTemplate=true; continue; }
  if(ch==='(' || ch==='[' || ch==='{' ){ stack.push({type:ch, pos:pos(i)}); continue; }
  if(ch===')' || ch===']' || ch==='}'){
    const map = {')':'(', ']':'[', '}':'{'};
    const need = map[ch];
    const top = stack[stack.length-1];
    if(!top || top.type!==need){
      console.error('Mismatch or unexpected closing', ch, 'at', pos(i));
      console.error('Context:', s.slice(Math.max(0,i-80), Math.min(s.length,i+40)));
      process.exit(2);
    }
    stack.pop();
    continue;
  }
}

// finished scanning
if(state.inSingle || state.inDouble || state.inTemplate || state.inBlockComment || state.inLineComment){
  console.error('Unterminated construct at EOF:', {
    inSingle: state.inSingle,
    inDouble: state.inDouble,
    inTemplate: state.inTemplate,
    inBlockComment: state.inBlockComment,
  });
  console.error('Tail:', s.slice(Math.max(0,s.length-300)));
  process.exit(3);
}
if(stack.length){
  console.error('Unclosed stack at EOF. Top items:');
  console.error(stack.slice(-10));
  // show tail for context
  const last = stack[stack.length-1];
  console.error('Last open at', last.pos);
  console.error('Tail:', s.slice(Math.max(0,s.length-300)));
  process.exit(4);
}
console.log('All balanced. No unterminated strings/comments and all brackets closed.');
process.exit(0);
