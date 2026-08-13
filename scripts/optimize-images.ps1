# PowerShell helper to optimize PNG images in images/help
# Requires ImageMagick (magick.exe) available in PATH.
# Usage: Open PowerShell and run: .\optimize-images.ps1

$src = Join-Path $PSScriptRoot "..\images\help"
Write-Host "Optimizing PNGs in: $src"
Get-ChildItem -Path $src -Filter *.png | ForEach-Object {
    $file = $_.FullName
    $tmp = "$file.tmp.png"
    Write-Host "Optimizing $file..."
    # Resize if wider than 1024px and optimize
    & magick.exe convert `"$file`" -strip -interlace Plane -gaussian-blur 0.05 -quality 85 -resize 1024x1024\> `"$tmp`"
    if (Test-Path $tmp) {
        Move-Item -Force $tmp $file
        Write-Host "Optimized $file"
    } else {
        Write-Host "Failed to optimize $file (magick convert returned no output)"
    }
}
Write-Host "Done."
