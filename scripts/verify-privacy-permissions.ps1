# TubeStack privacy permission audit — run before Chrome Web Store upload.
# Fails on invasive/unused permission patterns and Chrome History usage.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$manifest = Get-Content -Raw "manifest.json" | ConvertFrom-Json
$perms = @($manifest.permissions | Sort-Object)
$optPerms = @($manifest.optional_permissions)
$hostPerms = @($manifest.host_permissions)
$optHostPerms = @($manifest.optional_host_permissions)
$all = @($manifest.permissions) + $optPerms

$expectedPerms = @("contextMenus", "identity", "scripting", "sidePanel", "storage", "unlimitedStorage") | Sort-Object
$extra = Compare-Object -ReferenceObject $expectedPerms -DifferenceObject $perms | Where-Object { $_.SideIndicator -eq "=>" }
$missing = Compare-Object -ReferenceObject $expectedPerms -DifferenceObject $perms | Where-Object { $_.SideIndicator -eq "<=" }
if ($extra -or $missing) {
  Write-Error @"
manifest.json permissions must be exactly: $($expectedPerms -join ', ')
Found: $($perms -join ', ')
"@
}

$expectedHosts = @(
  "https://www.youtube.com/*",
  "https://m.youtube.com/*"
)
$hostSorted = @($hostPerms | Sort-Object)
$expectedHostsSorted = @($expectedHosts | Sort-Object)
if (Compare-Object $expectedHostsSorted $hostSorted) {
  Write-Error "manifest.json host_permissions must be exactly: $($expectedHosts -join ', ')"
}

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

$windowsHits = @()
foreach ($f in $codeFiles) {
  $m = Select-String -Path $f.FullName -Pattern 'chrome\.windows' -SimpleMatch:$false -ErrorAction SilentlyContinue
  if ($m) { $windowsHits += $m }
}
if ($windowsHits.Count -gt 0) {
  $msg = ($windowsHits | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }) -join "`n"
  Write-Error "Found chrome.windows usage (remove permission and use chrome.tabs instead):`n$msg"
}

$ctxBroad = Select-String -Path "background\service-worker.js" -Pattern 'http://\*/\*|https://\*/\*' -ErrorAction SilentlyContinue
if ($ctxBroad) {
  Write-Error "Context menus must not use all-URL documentUrlPatterns (http(s)://*/*)."
}

$evalHits = @()
foreach ($f in $codeFiles) {
  if ($f.Extension -notin @(".js", ".html")) { continue }
  $m = Select-String -Path $f.FullName -Pattern '\beval\s*\(|new\s+Function\s*\(' -ErrorAction SilentlyContinue
  if ($m) { $evalHits += $m }
}
if ($evalHits.Count -gt 0) {
  $msg = ($evalHits | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }) -join "`n"
  Write-Error "Found eval/new Function (forbidden for MV3 / CWS remote-code policy):`n$msg"
}

$declared = [ordered]@{
  contextMenus = 'chrome\.contextMenus'
  identity     = 'chrome\.identity'
  scripting    = 'chrome\.scripting'
  sidePanel    = 'chrome\.sidePanel'
  storage      = 'chrome\.storage'
  # unlimitedStorage has no chrome.* API; it raises chrome.storage.local quota for local library data.
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

$privacyHtml = Get-Content -Raw "privacy\privacy.html"
if ($privacyHtml -notmatch 'unlimitedStorage') {
  Write-Error "privacy/privacy.html must disclose unlimitedStorage."
}
if ($privacyHtml -notmatch 'Limited Use') {
  Write-Error "privacy/privacy.html must include a Chrome Web Store Limited Use disclosure."
}
if ($privacyHtml -notmatch 'Last updated') {
  Write-Error "privacy/privacy.html must include a Last updated date."
}

Write-Host "OK: Privacy permission audit passed."
Write-Host "  permissions: $($expectedPerms -join ', ')"
Write-Host "  host_permissions: $($expectedHosts -join ', ')"
