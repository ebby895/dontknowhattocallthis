/*
Node fallback to optimize PNGs using sharp. Install dependencies first:
  npm install sharp
Then run:
  node optimize-images-node.js
*/
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const dir = path.join(__dirname, '..', 'images', 'help');
(async () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  for (const f of files) {
    const p = path.join(dir, f);
    console.log('Processing', p);
    try {
      const img = sharp(p);
      const metadata = await img.metadata();
      const width = Math.min(metadata.width || 1024, 1024);
      await img.resize(width).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(p + '.tmp');
      fs.renameSync(p + '.tmp', p);
      console.log('Optimized', f);
    } catch (e) { console.error('Failed', f, e); }
  }
})();
