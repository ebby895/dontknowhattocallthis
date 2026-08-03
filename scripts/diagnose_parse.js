const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node diagnose_parse.js <file>'); process.exit(2); }
const s = fs.readFileSync(path, 'utf8');
try {
  new Function(s);
  console.log('PARSE_OK');
  process.exit(0);
} catch (e) {
  console.error('PARSE_ERROR');
  console.error('name:', e.name);
  console.error('message:', e.message);
  if (e.stack) console.error('stack0:', e.stack.split('\n')[0]);
  // Show last 2000 chars and the last 2000 chars split by line with numbers
  const tail = s.slice(-2000);
  const lines = tail.split(/\r?\n/);
  console.error('\n--- FILE TAIL (last 2000 chars) ---\n' + tail + '\n--- END TAIL ---');
  // Also print total length and total lines
  console.error('FILE_LENGTH:', s.length, 'TOTAL_LINES:', s.split(/\r?\n/).length);
  process.exit(3);
}
