const fs = require('fs');
const p = 'c:/Users/jmac2/OneDrive/Documents/AutoList Pro/sharetown-automation/popup/popup_main.js';
try {
  const s = fs.readFileSync(p, 'utf8');
  console.log('FILE_LEN', s.length);
  try {
    new Function(s);
    console.log('PARSE_OK');
  } catch (e) {
    console.error('PARSE_ERR', e && (e.stack || e.toString()));
    const tail = s.slice(-800);
    console.error('TAIL_START');
    console.error(tail);
    console.error('TAIL_END');
    process.exit(1);
  }
} catch (e) {
  console.error('READ_ERR', e && e.stack || e);
  process.exit(2);
}
