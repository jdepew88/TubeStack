# TubeStack privacy permission audit — run before Chrome Web Store upload.
# Fails if manifest requests Chrome History or code calls chrome.history.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$manifest = Get-Content -Raw "manifest.json" | ConvertFrom-Json
$perms = @($manifest.permissions)
$optPerms = @($manifest.optional_permissions)
$all = $perms + $optPerms

if ($all -contains "history") {
  Write-Error "manifest.json must not include 'history' in permissions or optional_permissions."
}

$codeFiles = Get-ChildItem -Recurse -File -Include *.js,*.json,*.html |
  Where-Object { $_.FullName -notmatch '\\\.git\\' }
$hits = @()
foreach ($f in $codeFiles) {
  $m = Select-String -Path $f.FullName -Pattern 'chrome\.history' -SimpleMatch:$false -ErrorAction SilentlyContinue
  if ($m) { $hits += $m }
}
if ($hits.Count -gt 0) {
  $msg = ($hits | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }) -join "`n"
  Write-Error "Found chrome.history usage:`n$msg"
}

Write-Host "OK: No Chrome History permission in manifest.json and no chrome.history API usage in repo."
