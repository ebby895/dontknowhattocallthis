<#
Install Node.js (LTS) via winget if available, otherwise download MSI and run it.
Then verify node/npm, and run `sam build` in `aws-backend`.
If an AWS profile named `fast4mp` exists, the script will offer to run `sam deploy`.

This script does NOT run installers without prompting the user for confirmation.
Usage: Run from repo root (or any location):
    .\scripts\install_node_and_deploy.ps1
#>

function Write-Info($m){ Write-Host "[info] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[warn] $m" -ForegroundColor Yellow }
function Write-ErrorAndExit($m){ Write-Host "[error] $m" -ForegroundColor Red; exit 1 }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$backendDir = Join-Path $repoRoot "aws-backend"

Write-Info "Repo root: $repoRoot"
Write-Info "Backend dir: $backendDir"

function Command-Exists($name) { return (Get-Command $name -ErrorAction SilentlyContinue) -ne $null }

if (Command-Exists node -and Command-Exists npm) {
    Write-Info "Node and npm already installed: $(node --version) / $(npm --version)"
} else {
    Write-Warn "Node/npm not found. Preparing to install Node.js LTS."
    if (Command-Exists winget) {
        Write-Info "winget is available. Will offer to install Node.js LTS via winget."
        $ok = Read-Host "Install Node.js LTS via winget now? (Y/N)"
        if ($ok -match '^[Yy]') {
            Write-Info "Installing Node.js LTS via winget..."
            & winget install --id OpenJS.NodeJS.LTS -e
            if ($LASTEXITCODE -ne 0) { Write-Warn "winget install returned exit $LASTEXITCODE" }
        } else { Write-ErrorAndExit "Node installation cancelled." }
    } else {
        Write-Info "winget not available. Will download Node MSI and run installer." 
        $nodeMsi = Join-Path $env:TEMP 'node-lts.msi'
        $nodeUrl = 'https://nodejs.org/dist/latest-v18.x/node-v18.20.0-x64.msi'
        Write-Info "Download: $nodeUrl"
        try { Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing -ErrorAction Stop } catch { Write-ErrorAndExit "Failed to download Node MSI: $_" }
        $ok = Read-Host "Run MSI installer as Administrator now? (Y/N)"
        if ($ok -match '^[Yy]') {
            Write-Info "Launching MSI installer..."
            Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn" -Verb RunAs -Wait
            if ($LASTEXITCODE -ne 0) { Write-Warn "msiexec exited with $LASTEXITCODE (may still have installed)." }
        } else { Write-ErrorAndExit "Node installation cancelled." }
    }
}

# Refresh environment in this session if possible
if (Test-Path "$env:ChocolateyInstall\bin\refreshenv.ps1") {
    & powershell -NoProfile -ExecutionPolicy Bypass -Command "& '$env:ChocolateyInstall\bin\refreshenv.ps1'"
}

# Verify node/npm now
if (-not (Command-Exists node)) { Write-ErrorAndExit "node still not found. Restart your shell or VS Code and re-run this script." }
if (-not (Command-Exists npm)) { Write-Warn "npm not found even though node exists; continuing with caution." }
Write-Info "Node version: $(node --version)"
if (Command-Exists npm) { Write-Info "npm version: $(npm --version)" }

# Ensure SAM is present
if (-not (Command-Exists sam)) { Write-ErrorAndExit "sam CLI not found on PATH. Install SAM and re-run this script." }
Write-Info "SAM CLI: $(sam --version)"

# Run sam build
if (-not (Test-Path $backendDir)) { Write-ErrorAndExit "Backend directory missing: $backendDir" }
Push-Location $backendDir
try {
    Write-Info "Running sam build in $backendDir"
    & sam build
    if ($LASTEXITCODE -ne 0) { Write-ErrorAndExit "sam build failed with exit code $LASTEXITCODE" }
    Write-Info "sam build completed successfully."

    # Check if AWS profile exists
    $profileExists = $false
    try {
        $profiles = & aws configure list-profiles 2>$null
        if ($profiles -and ($profiles -contains 'fast4mp')) { $profileExists = $true }
    } catch { }

    if ($profileExists) {
        $runDeploy = Read-Host "AWS profile 'fast4mp' found. Run 'sam deploy' now? (Y/N)"
        if ($runDeploy -match '^[Yy]') {
            & sam deploy --no-confirm-changeset --resolve-s3 --capabilities CAPABILITY_IAM
            if ($LASTEXITCODE -ne 0) { Write-ErrorAndExit "sam deploy failed with exit code $LASTEXITCODE" }
            Write-Info "sam deploy completed successfully."
        } else { Write-Info "Skipped sam deploy per user choice." }
    } else {
        Write-Warn "AWS profile 'fast4mp' not found. Run 'aws configure --profile fast4mp' then run 'sam deploy' manually."
    }
} finally { Pop-Location }

Write-Info "Script finished."
