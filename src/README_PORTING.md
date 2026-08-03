Porting notes - automated wrapper created
========================================

I created src/original_content.js which exports runOriginal(window, document).
It contains the original content.js source as a string and will execute it in the current context
when runOriginal() is called. This is an automated, safe-preserving step to make the original source
available in the src/ folder for incremental refactoring.

How to gradually port:
1. Identify logical blocks in the original file (search for function declarations or well-commented sections).
2. Copy those blocks into dedicated modules under src/, exporting functions.
3. Replace those blocks in the original content by calling the new module functions.
4. Once the src/ modules fully implement the behavior, bundle them into dist/content.js (use esbuild/rollup).

Example usage (in a dev harness):
import { runOriginal } from './original_content.js';
runOriginal(window, document);

Notes:
- The wrapper uses the Function constructor to execute the original code. This keeps behavior identical but should be replaced
  by proper module imports once refactoring is complete.
- After porting, update manifest.json to ensure dist/content.js is used as the content script.