const fs = require('fs');
const path = process.argv[2] || 'popup/popup_main.js';
const s = fs.readFileSync(path, 'utf8');
let depth = 0; let line = 1; let col = 0;
let inS=false,inD=false,inB=false,inLine=false,inBlock=false,esc=false;
for(let i=0;i<s.length;i++){
  const ch=s[i];
  if(ch==='\n'){ line++; col=0; inLine=false; continue; }
  col++;
  if(esc){ esc=false; continue; }
  if(inLine){ continue; }
  if(inBlock){ if(ch==='*' && s[i+1]==='/'){ inBlock=false; i++; col++; } continue; }
  if(inS){ if(ch==='\\') esc=true; else if(ch==="'") inS=false; continue; }
  if(inD){ if(ch==='\\') esc=true; else if(ch==='"') inD=false; continue; }
  if(inB){ if(ch==='\\') esc=true; else if(ch==='`') inB=false; continue; }
  if(ch==='"') inD=true; else if(ch==="'") inS=true; else if(ch==='`') inB=true;
  else if(ch==='/' && s[i+1]=='/'){ inLine=true; i++; col++; continue; }
  else if(ch==='/' && s[i+1]=='*'){ inBlock=true; i++; col++; continue; }
  else if(ch==='{'){ depth++; }
  else if(ch==='}'){ depth--; if(depth<0){
      const startLine = Math.max(1, line-6);
      const lines = s.split(/\r?\n/);
      console.log('NEGATIVE at index', i, 'line', line, 'col', col);
      console.log('Context:');
      for(let L=startLine; L<=line+3 && L<=lines.length; L++){
        console.log((L===line? '=> ':'   ')+L+': '+lines[L-1]);
      }
      process.exit(0);
    }}
}
console.log('NO_NEGATIVE; FINAL_DEPTH', depth);
