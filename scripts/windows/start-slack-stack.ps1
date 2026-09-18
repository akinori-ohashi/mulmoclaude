[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$slackRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$slackEnvPath = Join-Path $slackRepoRoot ".env"
$slackLogRoot = Join-Path $env:LOCALAPPDATA "MulmoClaude\logs"
$slackLogPath = Join-Path $slackLogRoot "slack-stack.log"

New-Item -ItemType Directory -Path $slackLogRoot -Force | Out-Null

function Write-SlackStackLog {
  param([Parameter(Mandatory = $true)][string]$Message)

  $slackTimestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
  Add-Content -LiteralPath $slackLogPath -Value "[$slackTimestamp] $Message"
}

if (-not (Test-Path -LiteralPath $slackEnvPath -PathType Leaf)) {
  Write-SlackStackLog "Cannot start: $slackEnvPath does not exist. Copy .env.example to .env and fill the Slack settings."
  exit 1
}

$slackYarn = Get-Command yarn.cmd -ErrorAction SilentlyContinue
if ($null -eq $slackYarn) {
  $slackYarn = Get-Command yarn -ErrorAction SilentlyContinue
}
if ($null -eq $slackYarn) {
  Write-SlackStackLog "Cannot start: yarn was not found on PATH."
  exit 1
}

Set-Location -LiteralPath $slackRepoRoot
Write-SlackStackLog "Starting MulmoClaude and the Slack bridge from $slackRepoRoot"

& $slackYarn.Source slack:stack 2>&1 | Tee-Object -FilePath $slackLogPath -Append
$slackExitCode = $LASTEXITCODE
if ($null -eq $slackExitCode) {
  $slackExitCode = 1
}

Write-SlackStackLog "Slack stack exited with code $slackExitCode"
exit $slackExitCode
