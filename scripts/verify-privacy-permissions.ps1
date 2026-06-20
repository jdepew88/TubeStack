# TubeStack privacy permission audit — run before Chrome Web Store upload.
# Fails on invasive/unused permission patterns and Chrome History usage.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$manifest = Get-Content -Raw "manifest.json" | ConvertFrom-Json
$perms = @($manifest.permissions)
$optPerms = @($manifest.optional_permissions)
$hostPerms = @($manifest.host_permissions)
$optHostPerms = @($manifest.optional_host_permissions)
$all = $perms + $optPerms

$forbiddenApi = @("history", "tabs", "windows", "bookmarks", "topSites", "webNavigation", "debugger")
foreach ($p in $forbiddenApi) {
  if ($all -contains $p) {
    Write-Error "manifest.json must not include '$p' in permissions or optional_permissions."
  }
}

$broadHost = $hostPerms + $optHostPerms | Where-Object {
  $_ -match '\*://\*\/\*' -or $_ -eq '<all_urls>' -or $_ -eq '*://*/*'
}
if ($broadHost.Count -gt 0) {
  Write-Error "manifest.json must not use broad host patterns: $($broadHost -join ', ')"
}

$codeFiles = Get-ChildItem -Recurse -File -Include *.js,*.json,*.html |
  Where-Object { $_.FullName -notmatch '\\\.git\\' }

$historyHits = @()
foreach ($f in $codeFiles) {
  $m = Select-String -Path $f.FullName -Pattern 'chrome\.history' -SimpleMatch:$false -ErrorAction SilentlyContinue
  if ($m) { $historyHits += $m }
}
if ($historyHits.Count -gt 0) {
  $msg = ($historyHits | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }) -join "`n"
  Write-Error "Found chrome.history usage:`n$msg"
}

$ctxBroad = Select-String -Path "background\service-worker.js" -Pattern 'http://\*/\*|https://\*/\*' -ErrorAction SilentlyContinue
if ($ctxBroad) {
  Write-Error "Context menus must not use all-URL documentUrlPatterns (http(s)://*/*)."
}

$declared = [ordered]@{
  contextMenus = 'chrome\.contextMenus'
  identity     = 'chrome\.identity'
  scripting    = 'chrome\.scripting'
  storage      = 'chrome\.storage'
}
$jsFiles = Get-ChildItem -Recurse -File -Filter *.js | Where-Object { $_.FullName -notmatch '\\\.git\\' }
foreach ($perm in $declared.Keys) {
  if ($perms -notcontains $perm) { continue }
  $pattern = $declared[$perm]
  $found = $false
  foreach ($f in $jsFiles) {
    if (Select-String -Path $f.FullName -Pattern $pattern -Quiet) { $found = $true; break }
  }
  if (-not $found) {
    Write-Error "Declared permission '$perm' has no matching API usage in *.js"
  }
}

Write-Host "OK: Privacy permission audit passed (no History, no broad hosts, declared permissions used)."
