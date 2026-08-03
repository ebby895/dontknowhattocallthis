# PowerShell helper to delete S3 objects using AWS CLI
# Usage: Set $Bucket to your S3 bucket name, then run in PowerShell where AWS CLI is configured

$Bucket = "fast4mp-media-577638390772-us-west-1-a15" # pre-filled from aws-backend/samconfig.toml parameter_overrides
$PayloadFile = Join-Path $PSScriptRoot 'delete_keys.json'

if ($Bucket -like "<*") {
  Write-Host "Please edit the script and set the correct S3 bucket name in variable $Bucket" -ForegroundColor Yellow
  return
}

if (-not (Test-Path $PayloadFile)) {
  Write-Host "Payload file not found: $PayloadFile" -ForegroundColor Red
  return
}

Write-Host "About to delete objects listed in $PayloadFile from bucket $Bucket" -ForegroundColor Cyan
Write-Host "This action is irreversible. Press Enter to continue or Ctrl-C to abort." -ForegroundColor Yellow
Read-Host | Out-Null

# Read and prepare JSON in the format aws s3api expects
$payload = Get-Content $PayloadFile -Raw
try {
  $json = $payload | ConvertFrom-Json
} catch {
  Write-Host "Failed to parse JSON payload file." -ForegroundColor Red
  return
}

# The aws cli expects a JSON structure containing { "Objects": [{"Key":...}, ...] }
# We'll pass it via --delete 'file://...'
$tempFile = [System.IO.Path]::GetTempFileName() + '.json'
# Write JSON without UTF-8 BOM so aws CLI can parse it reliably
try {
  $jsonText = $json | ConvertTo-Json -Depth 5
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tempFile, $jsonText, $utf8NoBom)
} catch {
  Write-Host "Failed to write temp JSON file without BOM; falling back to Out-File (may include BOM)." -ForegroundColor Yellow
  $json | ConvertTo-Json -Depth 5 | Out-File -FilePath $tempFile -Encoding UTF8
}

Write-Host "Calling aws s3api delete-objects --bucket $Bucket --delete file://$tempFile"
try {
  $result = aws s3api delete-objects --bucket $Bucket --delete "file://$tempFile" | ConvertFrom-Json
  Write-Host "Delete completed. Result:" -ForegroundColor Green
  $result | ConvertTo-Json -Depth 5
} catch {
  Write-Host "AWS CLI delete failed:" -ForegroundColor Red
  Write-Host $_.Exception.Message
}

# Cleanup
try { Remove-Item $tempFile -ErrorAction SilentlyContinue } catch {}

Write-Host "Done." -ForegroundColor Cyan
