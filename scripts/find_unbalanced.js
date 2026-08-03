const fs = require('fs');
const path = process.argv[2] || 'popup/popup_main.js';
const s = fs.readFileSync(path, 'utf8');
let depth = 0; let line = 1; let col = 0;
let inS=false,inD=false,inB=false,inLine=false,inBlock=false,esc=false;
const depths=[]; // record depth at each line start
for(let i=0;i<s.length;i++){
  const ch=s[i];
  if(ch==='\n'){
    depths.push({line,depth});
    line++; col=0; inLine=false; continue;
  }
  col++;
  if(esc){ esc=false; continue; }
  if(inLine){ continue; }
  if(inBlock){ if(ch==='*' && s[i+1]==='/'){ inBlock=false; i++; col++; } continue; }
  if(inS){ if(ch==='\\') esc=true; else if(ch==="'") inS=false; continue; }
  if(inD){ if(ch==='\\') esc=true; else if(ch==='"') inD=false; continue; }
  if(inB){ if(ch==='\\') esc=true; else if(ch==='`') inB=false; continue; }
  if(ch==='"') inD=true; else if(ch==="'") inS=true; else if(ch==='`') inB=true;
  else if(ch==='/' && s[i+1]=='/'){ inLine=true; i++; col++; }
  else if(ch==='/' && s[i+1]=='*'){ inBlock=true; i++; col++; }
  else if(ch==='{'){ depth++; }
  else if(ch==='}'){ depth--; if(depth<0){ console.log('NEGATIVE at line',line,'col',col); break; } }
}
console.log('FINAL_DEPTH',depth);
if(depth>0){ // report context
  const idx = s.lastIndexOf('{');
  const start = Math.max(0, idx-200);
  const ctx = s.slice(start, Math.min(s.length, idx+200));
  console.log('LAST_OPEN_BRACE_AT', idx);
  console.log('CONTEXT:\n' + ctx);
}
// Also check for unclosed string/template/comment at EOF
if(inS) console.log('EOF_IN_SINGLE_QUOTE');
if(inD) console.log('EOF_IN_DOUBLE_QUOTE');
if(inB) console.log('EOF_IN_BACKTICK');
if(inBlock) console.log('EOF_IN_BLOCK_COMMENT');
if(inLine) console.log('EOF_IN_LINE_COMMENT');
