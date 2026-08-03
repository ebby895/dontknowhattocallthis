const fs = require('fs');
const s = fs.readFileSync('popup/popup_main.js', 'utf8');
const lines = s.split('\n');
const stack = [];
let inBlock=false,inLine=false,inSingle=false,inDouble=false,inTemplate=false,escape=false;
for(let ln=0; ln<lines.length; ln++){
  const line = lines[ln];
  inLine=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(inBlock){ if(c==='*' && line[i+1]==='/'){ inBlock=false; i++; continue;} else continue; }
    if(inLine) continue;
    if(inSingle){ if(escape){ escape=false;} else if(c==='\\') escape=true; else if(c==="'") inSingle=false; continue; }
    if(inDouble){ if(escape){ escape=false;} else if(c==='\\') escape=true; else if(c==='"') inDouble=false; continue; }
    if(inTemplate){ if(escape){ escape=false;} else if(c==='\\') escape=true; else if(c==='`') inTemplate=false; continue; }
    if(c==='/'){ const n=line[i+1]; if(n==='/' ){ inLine=true; i++; continue;} if(n==='*'){ inBlock=true; i++; continue;} }
    if(c==="'") { inSingle=true; continue; }
    if(c==='"'){ inDouble=true; continue; }
    if(c==='`'){ inTemplate=true; continue; }
    if(c==='{'||c==='('||c==='['){ stack.push({ch:c,line:ln+1,col:i+1,context:line.slice(0,200)}); }
    if(c==='}'||c===')'||c===']'){
      const expected = (c==='}') ? '{' : (c===')' ? '(' : '[');
      if(stack.length===0){ console.log('Unmatched closer',c,'at',ln+1,i+1); }
      else{
        const top = stack[stack.length-1];
        if(top.ch===expected) stack.pop(); else {
          console.log('Mismatched closer',c,'at',ln+1,i+1,'expected to close',top.ch,'opened at',top.line);
          // try to pop until matching or empty
          let found=false;
          for(let j=stack.length-1;j>=0;j--){ if(stack[j].ch===expected){ stack.splice(j,1); found=true; break; } }
          if(!found){ /* ignore */ }
        }
      }
    }
  }
}
if(stack.length===0) console.log('All matched'); else{ console.log('Unmatched openings:',stack.length); stack.forEach(s=> console.log(s.ch,'opened at line',s.line,'col',s.col,'context:',s.context)); }
console.log('done');
