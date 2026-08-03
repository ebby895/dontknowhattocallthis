const fs=require('fs'); const path=require('path'); const p=path.resolve(__dirname,'..','content','content_main.js'); const s=fs.readFileSync(p,'utf8'); let stack=[]; const pairs={'{':'}','(':')','[':']'}; for(let i=0;i<s.length;i++){ const ch=s[i]; if(ch==="\"" || ch==="'" || ch==='`'){ const q=ch; i++; while(i<s.length){ if(s[i]==='\\'){ i+=2; continue;} if(s[i]===q) break; i++; } continue;} if(ch==='/' && s[i+1]==='*'){ i+=2; while(i<s.length && !(s[i]==='*' && s[i+1]==='/')) i++; i+=1; continue;} if(ch==='/' && s[i+1]==='/'){ while(i<s.length && s[i]!=='\n') i++; continue;} // naive regex literal handling: skip until next unescaped '/' then skip flags
	if(ch==='/' && s[i+1] !== '*' && s[i+1] !== '/'){ // possible regex literal
		i++;
		while(i<s.length){
			if(s[i]==='\\'){ i+=2; continue; }
			if(s[i] === '/') { i++; break; }
			i++;
		}
		while(i<s.length && /[gimsuy]/.test(s[i])) i++;
		continue;
	}
	if(pairs[ch]) stack.push({ch,i}); else if(ch==='}' || ch===')' || ch===']'){ if(stack.length===0){ console.log('Unmatched closing', ch, 'at', i+1); } else { const top=stack.pop(); if(pairs[top.ch]!==ch){ console.log('MISMATCH: at', i+1, 'expected', pairs[top.ch], 'but found', ch, 'top was', top.ch, 'at', top.i+1); } } } } if(stack.length){ console.log('STACK non-empty length', stack.length); console.log(stack.map(x=>x.ch+'@'+(x.i+1)).join('\n')); } else { console.log('STACK empty'); }