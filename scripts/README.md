Image optimization helpers

Two small helpers to optimize the PNG screenshots in `images/help`.

1) PowerShell + ImageMagick (recommended on Windows)
- Install ImageMagick and ensure `magick.exe` is in your PATH.
- Run from project scripts folder in PowerShell:
  .\optimize-images.ps1

2) Node + sharp (cross-platform)
- Install dependencies:
  npm install sharp
- Run:
  node optimize-images-node.js

Both scripts resize images to a maximum width of 1024px and apply PNG compression.
