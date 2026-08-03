SRC refactor README
====================

What this refactor includes:
- src/selectors.js: central place to store DOM selectors.
- src/ui_helpers.js: small utility functions for waiting and clicking.
- src/content_main.js: high-level exported functions that perform steps.

How to proceed:
1. Use a bundler (esbuild/rollup/webpack) to compile `src/content_main.js` into `dist/content.js`.
2. Replace `dist/content.js` with the bundled output when ready. Currently, dist/content.js contains the original content script to preserve behavior.
3. Iteratively port functionality from the original content.js into the src modules and tests.

Example build command with esbuild:
  npx esbuild src/content_main.js --bundle --format=iife --global-name=Fast4MPContent --outfile=dist/content.js


Cloud sync
----------
This build is AWS-only. Deploy the `aws-backend` with AWS SAM, copy the API base URL output, and paste it into the popup Menu (AWS API Base). Media and listing metadata are synced to S3 via the backend.