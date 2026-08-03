const fs = require('fs');
const s = fs.readFileSync('popup/popup_main.js','utf8');
try{
  new Function(s);
  console.log('OK');
}catch(e){
  console.error('ERROR:', e && e.message);
  console.error(e.stack);
  // print surrounding lines if possible
  if (e && e.stack) {
    const m = e.stack.match(/<anonymous>:(\d+):(\d+)/);
    if (m) {
      const ln = parseInt(m[1],10);
      const col = parseInt(m[2],10);
      const lines = s.split('\n');
      const start = Math.max(0, ln-6);
      const end = Math.min(lines.length, ln+3);
      console.error('--- context ---');
      for(let i=start;i<end;i++){
        console.error((i+1)+': '+lines[i]);
      }
    }
  }
}
