[CmdletBinding()]
param(
  [string]$TaskName = "MulmoClaude Slack",
  [switch]$ValidateOnly,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"

$slackRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$slackRunnerPath = Join-Path $PSScriptRoot "start-slack-stack.ps1"
$slackEnvPath = Join-Path $slackRepoRoot ".env"

if ($Unregister) {
  $slackExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -ne $slackExistingTask) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
  } else {
    Write-Host "Scheduled task '$TaskName' is not registered."
  }
  exit 0
}

function Read-SlackDotEnv {
  param([Parameter(Mandatory = $true)][string]$Path)

  $slackValues = @{}
  foreach ($slackLine in Get-Content -LiteralPath $Path) {
    if ($slackLine -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      continue
    }
    $slackKey = $Matches[1]
    $slackValue = $Matches[2]
    if ($slackValue.Length -ge 2) {
      $slackFirst = $slackValue[0]
      $slackLast = $slackValue[$slackValue.Length - 1]
      if (($slackFirst -eq '"' -and $slackLast -eq '"') -or ($slackFirst -eq "'" -and $slackLast -eq "'")) {
        $slackValue = $slackValue.Substring(1, $slackValue.Length - 2)
      }
    }
    $slackValues[$slackKey] = $slackValue
  }
  return $slackValues
}

if (-not (Test-Path -LiteralPath $slackEnvPath -PathType Leaf)) {
  throw "$slackEnvPath does not exist. Copy .env.example to .env and fill the Slack settings before installing the task."
}

$slackEnv = Read-SlackDotEnv -Path $slackEnvPath
$slackRequired = @(
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_ALLOWED_USERS",
  "SLACK_ALLOWED_CHANNELS",
  "MULMOCLAUDE_AUTH_TOKEN"
)
foreach ($slackKey in $slackRequired) {
  if (-not $slackEnv.ContainsKey($slackKey) -or [string]::IsNullOrWhiteSpace($slackEnv[$slackKey])) {
    throw "$slackKey must be set in $slackEnvPath before installing the task."
  }
}

if (-not $slackEnv["SLACK_BOT_TOKEN"].StartsWith("xoxb-")) {
  throw "SLACK_BOT_TOKEN must be a Bot User OAuth Token beginning with xoxb-."
}
if (-not $slackEnv["SLACK_APP_TOKEN"].StartsWith("xapp-")) {
  throw "SLACK_APP_TOKEN must be an App-Level Token beginning with xapp-."
}
if ($slackEnv["MULMOCLAUDE_AUTH_TOKEN"].Length -lt 32) {
  throw "MULMOCLAUDE_AUTH_TOKEN must contain at least 32 characters."
}

$slackExpectedSettings = @{
  SLACK_INVOCATION_MODE = "mention"
  SLACK_DM_ACCESS = "user"
  SLACK_SESSION_GRANULARITY = "thread"
}
foreach ($slackEntry in $slackExpectedSettings.GetEnumerator()) {
  if (-not $slackEnv.ContainsKey($slackEntry.Key) -or $slackEnv[$slackEntry.Key].ToLowerInvariant() -ne $slackEntry.Value) {
    throw "$($slackEntry.Key) must be set to '$($slackEntry.Value)' in $slackEnvPath."
  }
}

$slackAckValue = if ($slackEnv.ContainsKey("SLACK_ACK_REACTION")) { $slackEnv["SLACK_ACK_REACTION"].ToLowerInvariant() } else { "" }
if ($slackAckValue -notin @("", "0", "false", "off", "no")) {
  throw "SLACK_ACK_REACTION must be disabled for this least-privilege setup."
}

if ($ValidateOnly) {
  Write-Host "Slack .env validation succeeded."
  exit 0
}

$slackTaskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$slackPowerShell = Join-Path $PSHOME "powershell.exe"
if (-not (Test-Path -LiteralPath $slackPowerShell -PathType Leaf)) {
  $slackPowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
}

$slackActionArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $slackRunnerPath
$slackAction = New-ScheduledTaskAction -Execute $slackPowerShell -Argument $slackActionArgs -WorkingDirectory $slackRepoRoot
$slackTrigger = New-ScheduledTaskTrigger -AtLogOn -User $slackTaskUser -RandomDelay (New-TimeSpan -Seconds 15)
$slackSettings = New-ScheduledTaskSettingsSet `
  -Hidden `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)
$slackPrincipal = New-ScheduledTaskPrincipal -UserId $slackTaskUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $slackAction `
  -Trigger $slackTrigger `
  -Settings $slackSettings `
  -Principal $slackPrincipal `
  -Description "Starts MulmoClaude and its allowlisted Slack Socket Mode bridge at logon." `
  -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' for $slackTaskUser."
Write-Host "Logs: $env:LOCALAPPDATA\MulmoClaude\logs\slack-stack.log"
