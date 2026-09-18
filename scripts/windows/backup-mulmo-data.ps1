[CmdletBinding()]
param(
  [string]$SourcePath = (Join-Path $env:USERPROFILE "mulmoclaude"),
  [string]$DestinationPath = (Join-Path $env:USERPROFILE "mulmoclaude-backups"),
  [ValidateRange(1, 3650)][int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"
$backupEntries = @("data", "conversations", "artifacts")
$backupPrefix = "mulmoclaude-personal-"

function Get-NormalizedPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  return [System.IO.Path]::GetFullPath($Path).TrimEnd("\", "/")
}

function Assert-BackupPaths {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "MulmoClaude workspace not found: $Source"
  }
  $sourceWithSeparator = "$Source$([System.IO.Path]::DirectorySeparatorChar)"
  $destinationWithSeparator = "$Destination$([System.IO.Path]::DirectorySeparatorChar)"
  if ($destinationWithSeparator.StartsWith($sourceWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Backup destination must not be inside the MulmoClaude workspace."
  }
}

function Remove-ExpiredBackups {
  param(
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][datetime]$Cutoff
  )

  Get-ChildItem -LiteralPath $Destination -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "$backupPrefix*" -and $_.LastWriteTime -lt $Cutoff } |
    Remove-Item -Force
}

function Get-ArchiveExclusions {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string[]]$Entries
  )

  $sourcePrefix = $Source.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
  $exclusions = @(
    "--exclude=*/.git",
    "--exclude=*/.git/*",
    "--exclude=*/node_modules",
    "--exclude=*/node_modules/*",
    "--exclude=data/skills/catalog",
    "--exclude=data/skills/catalog/*"
  )
  foreach ($entry in $Entries) {
    $entryPath = Join-Path $Source $entry
    Get-ChildItem -LiteralPath $entryPath -Force -Recurse -Attributes ReparsePoint -ErrorAction SilentlyContinue | ForEach-Object {
      $relative = $_.FullName.Substring($sourcePrefix.Length).Replace("\", "/")
      $exclusions += "--exclude=$relative"
      $exclusions += "--exclude=$relative/*"
    }
  }
  return $exclusions | Sort-Object -Unique
}

function Write-BackupLog {
  param(
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$Message
  )

  $timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
  Add-Content -LiteralPath (Join-Path $Destination "backup.log") -Value "[$timestamp] $Message"
}

$source = Get-NormalizedPath -Path $SourcePath
$destination = Get-NormalizedPath -Path $DestinationPath
Assert-BackupPaths -Source $source -Destination $destination
New-Item -ItemType Directory -Path $destination -Force | Out-Null

$entries = @($backupEntries | Where-Object { Test-Path -LiteralPath (Join-Path $source $_) -PathType Container })
if ($entries.Count -eq 0) {
  throw "No personal-data directories were found under $source"
}

$archiveTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archiveName = "$backupPrefix$archiveTimestamp.zip"
$archivePath = Join-Path $destination $archiveName
$partialPath = Join-Path $destination "$archiveName.partial"
$tar = (Get-Command tar.exe -ErrorAction Stop).Source
$exclusions = @(Get-ArchiveExclusions -Source $source -Entries $entries)

try {
  Push-Location -LiteralPath $source
  try {
    & $tar -a -cf $partialPath @exclusions @entries
    if ($LASTEXITCODE -ne 0) {
      throw "tar failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  & $tar -tf $partialPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Archive verification failed with exit code $LASTEXITCODE"
  }

  Move-Item -LiteralPath $partialPath -Destination $archivePath
  $hash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
  $checksumPath = "$archivePath.sha256"
  Set-Content -LiteralPath $checksumPath -Value "$($hash.Hash) *$archiveName" -Encoding ascii
  Remove-ExpiredBackups -Destination $destination -Cutoff (Get-Date).AddDays(-$RetentionDays)
  Write-BackupLog -Destination $destination -Message "Created $archiveName ($((Get-Item -LiteralPath $archivePath).Length) bytes)."
  Write-Output $archivePath
} catch {
  Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
  Write-BackupLog -Destination $destination -Message "FAILED: $($_.Exception.Message)"
  throw
}
