[CmdletBinding()]
param(
  [string]$TaskName = "MulmoClaude Local Backup",
  [ValidateRange(0, 23)][int]$Hour = 3,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$backupScript = Join-Path $PSScriptRoot "backup-mulmo-data.ps1"

if ($Unregister) {
  $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -ne $existingTask) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
  } else {
    Write-Host "Scheduled task '$TaskName' is not registered."
  }
  exit 0
}

if (-not (Test-Path -LiteralPath $backupScript -PathType Leaf)) {
  throw "Backup script not found: $backupScript"
}

Write-Host "Creating an initial backup..."
$initialArchive = & $backupScript
Write-Host "Initial backup: $initialArchive"

$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$actionArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $backupScript
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $actionArgs -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($Hour))
$settings = New-ScheduledTaskSettingsSet `
  -Hidden `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Creates a local, versioned backup of MulmoClaude personal data and keeps 30 days." `
  -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' for $taskUser at $($Hour.ToString('00')):00 daily."
