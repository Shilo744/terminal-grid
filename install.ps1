# Terminal Grid installer (ASCII only on purpose: Windows PowerShell 5.1 misreads UTF-8 without BOM).
#   install.ps1              install / update for the current user (no admin needed)
#   install.ps1 -Uninstall   remove shortcuts, right-click entry and the installed copy (your state is kept unless -Purge)
param([switch]$Uninstall, [switch]$Purge, [switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'Terminal Grid'
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Terminal Grid.lnk'
$deskLnk = Join-Path $desktop 'Terminal Grid.lnk'

function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Refresh-Path {
  $env:Path = ([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User') -join ';')
}
function Run-Npm([string[]]$NpmArgs) { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & npm $NpmArgs 2>&1 | ForEach-Object { "$_" } | Write-Host } finally { $ErrorActionPreference = $old } }
function Has($n) { [bool](Get-Command $n -ErrorAction SilentlyContinue) }

if ($Uninstall) {
  Step 'Removing the right-click entry and shortcuts'
  $cm = Join-Path $dest 'install-context-menu.ps1'
  if (Test-Path $cm) { & $cm -Uninstall | Out-Null } else { & (Join-Path $src 'install-context-menu.ps1') -Uninstall | Out-Null }
  Remove-Item $deskLnk, $startMenu -ErrorAction SilentlyContinue
  Get-NetTCPConnection -LocalPort 7791 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  if ($Purge) { Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue }
  else {
    Get-ChildItem $dest -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin 'state.json', 'settings.json' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  Step 'Done.'
  return
}

# 1. Node.js
Step 'Checking Node.js'
Refresh-Path
$needNode = $true
if (Has 'node') { $v = (& node -v) -replace '^v', ''; if ([int]($v.Split('.')[0]) -ge 18) { $needNode = $false } }
if ($needNode) {
  if (-not (Has 'winget')) { throw 'Node.js 18+ is required and winget is not available. Install Node.js LTS from https://nodejs.org and run this again.' }
  Step 'Installing Node.js LTS (winget)'
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Has 'node')) { throw 'Node.js was installed but is not on PATH yet. Close this window and run the installer again.' }
}
Write-Host ("Node " + (& node -v))

# 2. copy the app (keeps state.json / settings.json of an existing install)
Step "Installing to $dest"
if ((Resolve-Path $src).Path -ne $dest) {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  & robocopy $src $dest /E /NFL /NDL /NJH /NJS /NP /XD node_modules .git tests docs .state-* .chrome-* /XF state.json settings.json launch.log | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy $LASTEXITCODE)" }
}

# 3. dependencies (node-pty ships Windows binaries; no compiler needed)
Step 'Installing dependencies (npm)'
Push-Location $dest
try {
  Run-Npm @("ci", "--omit=dev", "--no-audit", "--no-fund")
  if ($LASTEXITCODE -ne 0) { Run-Npm @("install", "--omit=dev", "--no-audit", "--no-fund") }
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
} finally { Pop-Location }

# 4. Claude Code (optional, needed only for Claude terminals)
if (-not (Has 'claude')) {
  Step 'Installing Claude Code (npm)'
  try { Run-Npm @("install", "-g", "@anthropic-ai/claude-code", "--no-audit", "--no-fund"); Refresh-Path } catch { }
  if (-not (Has 'claude')) { Write-Host 'Claude Code was not installed. Plain terminals still work; to add it later: npm i -g @anthropic-ai/claude-code' -ForegroundColor Yellow }
}

# 5. shortcuts + right-click menu
Step 'Creating shortcuts'
$sh = New-Object -ComObject WScript.Shell
foreach ($p in @($deskLnk, $startMenu)) {
  $l = $sh.CreateShortcut($p)
  $l.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $l.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dest 'start.ps1') + '"'
  $l.WorkingDirectory = $dest
  $l.IconLocation = Join-Path $dest 'terminal-grid.ico'
  $l.Description = 'Terminal Grid'
  $l.WindowStyle = 7
  $l.Save()
}
Step 'Adding "Terminal Grid" to the right-click menu'
& (Join-Path $dest 'install-context-menu.ps1') -ClassicMenu | Out-Null

Step 'Installed. Desktop shortcut: Terminal Grid. Right-click any folder -> Terminal Grid.'
if (-not $NoLaunch) { Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', (Join-Path $dest 'start.ps1') }
