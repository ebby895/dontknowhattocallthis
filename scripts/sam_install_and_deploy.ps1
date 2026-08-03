<#
Usage: .\sam_install_and_deploy.ps1

This script checks for the AWS SAM CLI, offers to install it via Chocolatey (with your confirmation),
and then runs `sam build` and `sam deploy --no-confirm-changeset --resolve-s3 --capabilities CAPABILITY_IAM`
from the `aws-backend` directory located under the repository root.

It will NOT perform any install without prompting you first.
#>

function Write-Info($m){ Write-Host "[info] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[warn] $m" -ForegroundColor Yellow }
function Write-ErrorAndExit($m){ Write-Host "[error] $m" -ForegroundColor Red; exit 1 }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
# If this script is placed in the repo `scripts/` folder, repo root is parent of script dir.
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$backendDir = Join-Path $repoRoot "aws-backend"

Write-Info "Repo root: $repoRoot"
Write-Info "Backend dir: $backendDir"

# Helper to check command existence
function Command-Exists($name) {
    return (Get-Command $name -ErrorAction SilentlyContinue) -ne $null
}

if (Command-Exists sam) {
    $samCmd = Get-Command sam
    Write-Info "Found SAM CLI: $($samCmd.Path)"
    & sam --version
} else {
    Write-Warn "AWS SAM CLI not found on PATH."
    if (Command-Exists choco) {
        Write-Info "Chocolatey detected on this system."
        $install = Read-Host "Install AWS SAM CLI via Chocolatey now? (Y/N)"
        if ($install -match '^[Yy]') {
            Write-Info "Installing AWS SAM CLI via Chocolatey (this requires admin privileges)..."
            & choco install aws-sam-cli -y
            if ($LASTEXITCODE -ne 0) { Write-ErrorAndExit "choco install failed (exit $LASTEXITCODE)" }
            # Try to refresh environment if refreshenv exists
            $refresh = Join-Path $env:ChocolateyInstall "bin\refreshenv.ps1"
            if (Test-Path $refresh) {
                Write-Info "Refreshing environment..."
                & powershell -NoProfile -ExecutionPolicy Bypass -Command "& '$refresh'"
            } else {
                Write-Info "If 'sam' is not available immediately, restart your shell."
            }
            if (-not (Command-Exists sam)) { Write-ErrorAndExit "SAM still not found after install. Restart your shell and rerun the script." }
            Write-Info "SAM installed: $(Get-Command sam)."
        } else {
            Write-ErrorAndExit "Aborting: SAM CLI is required to build/deploy. Install it and re-run the script. See https://aws.amazon.com/serverless/sam/"
        }
    } else {
        Write-Warn "Chocolatey was not found."
        $installMsi = Read-Host "Download and run the AWS SAM MSI installer now? (Y/N)"
        if ($installMsi -match '^[Yy]') {
            $msiUrl = "https://github.com/aws/aws-sam-cli/releases/latest/download/AWS_SAM_CLI_64_PY3.msi"
            $tmp = Join-Path $env:TEMP "AWS_SAM_CLI_installer.msi"
            Write-Info "Downloading MSI to $tmp ..."
            try {
                Invoke-WebRequest -Uri $msiUrl -OutFile $tmp -UseBasicParsing -ErrorAction Stop
            } catch {
                Write-ErrorAndExit "Failed to download MSI: $_"
            }
            Write-Info "Running MSI installer (this will require admin privileges)..."
            $proc = Start-Process msiexec.exe -ArgumentList "/i `"$tmp`" /qn" -Wait -PassThru
            if ($proc.ExitCode -ne 0) { Write-ErrorAndExit "MSI installer failed (exit $($proc.ExitCode))" }
            Write-Info "MSI installer finished. If 'sam' isn't found, restart your shell."
            if (-not (Command-Exists sam)) { Write-Warn "SAM not found immediately; you may need to restart your shell before it is on PATH." }
        } else {
            Write-ErrorAndExit "SAM CLI is required. Install via Chocolatey or MSI: https://aws.amazon.com/serverless/sam/"
        }
    }
}

# Run build and deploy from aws-backend
if (-not (Test-Path $backendDir)) { Write-ErrorAndExit "Backend directory not found: $backendDir" }

Push-Location $backendDir
try {
    Write-Info "Running: sam build"
    & sam build
    if ($LASTEXITCODE -ne 0) { Write-ErrorAndExit "sam build failed (exit $LASTEXITCODE)" }

    Write-Info "Running: sam deploy --no-confirm-changeset --resolve-s3 --capabilities CAPABILITY_IAM"
    & sam deploy --no-confirm-changeset --resolve-s3 --capabilities CAPABILITY_IAM
    if ($LASTEXITCODE -ne 0) { Write-ErrorAndExit "sam deploy failed (exit $LASTEXITCODE)" }

    Write-Info "sam build & deploy completed successfully."
} finally {
    Pop-Location
}
