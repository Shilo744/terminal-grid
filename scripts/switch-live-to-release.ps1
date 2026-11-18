# Switch the LIVE Terminal Grid (port 7791) to a frozen release in the Versions folder, keeping every terminal and pair (they resume).
# release.js copies this file next to the releases ("Terminal Grid Versions"), together with one "Switch live to V<n>.cmd" per release.
# ASCII only on purpose (Windows PowerShell 5.1 misreads UTF-8 without BOM).
#
# Before you run it (the app saves its state when it shuts down by itself):
#   1. In the pair board press the pause button of every running pair (a running pair keeps the server alive on purpose).
#   2. Close the Terminal Grid window. About 10 seconds later the server shuts down by itself and saves everything.
#   3. Double click "Switch live to V<n>.cmd" (this script waits for step 2 to finish, copies the saved state and starts the release).
# After the start: open the window with the usual shortcut, press "resume" on the paused pairs. The terminals come back with --resume.
#
# Where the state comes from: the folder the live app ran from saved state.json when it shut down, so it has the newest state.json of all the
# candidates (the development folder and every V* release folder except the target). The script prints which one it used. -From <V4.1 or a full path>
# picks the source by hand. The target's old state.json/settings.json (if any) are kept as *.before-switch.
# After a successful start it also writes the version into current.txt next to the releases (when launch-current.ps1 is there): that is the pointer of the stable
# launcher. -NoStart never changes it.
# -Port and -NoStart exist only to try the script on a free port without starting anything (the live app uses 7791).
param(
  [Parameter(Mandatory = $true)][string]$Release,
  [string]$From = '',
  [string]$DevFolder = '',
  [int]$Port = 7791,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $DevFolder) { $DevFolder = Join-Path (Split-Path -Parent $root) 'Terminal Grid' }
$rel = Join-Path $root $Release
if (-not (Test-Path -LiteralPath (Join-Path $rel 'start.ps1'))) { Write-Host "Release folder not found: $rel"; exit 1 }

function Test-Listening { [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) }

Write-Host "Waiting for the current Terminal Grid server (port $Port) to shut down by itself (up to 90 seconds)..."
Write-Host "If it does not: pause every pair and close the Terminal Grid window."
$i = 0
while ((Test-Listening) -and $i -lt 90) { Start-Sleep -Seconds 1; $i++ }
if (Test-Listening) { Write-Host "The server on port $Port is still running. Nothing was changed."; exit 2 }
Write-Host "The old server is gone."

# which folder did the live app run from? the one with the newest state.json
$src = $null
if ($From) {
  $src = if (Test-Path -LiteralPath $From) { (Resolve-Path -LiteralPath $From).Path } else { Join-Path $root $From }
} else {
  $cands = @($DevFolder) + @(Get-ChildItem -LiteralPath $root -Directory -Filter 'V*' -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne $Release } | ForEach-Object { $_.FullName })
  $best = $null
  foreach ($c in $cands) {
    $f = Join-Path $c 'state.json'
    if (Test-Path -LiteralPath $f) {
      $t = (Get-Item -LiteralPath $f).LastWriteTime
      if (-not $best -or $t -gt $best.Time) { $best = [pscustomobject]@{ Dir = $c; Time = $t } }
    }
  }
  if ($best) { $src = $best.Dir; Write-Host ("Newest saved state: {0} ({1})" -f $best.Dir, $best.Time) }
}
if (-not $src -or -not (Test-Path -LiteralPath $src)) { Write-Host "No folder with a saved state.json was found. Starting $Release with its own (empty) state."; $src = $null }

if ($src) {
  Write-Host "Copying state and settings from $src into $Release ..."
  foreach ($n in 'state.json', 'settings.json') {
    $from = Join-Path $src $n
    $to = Join-Path $rel $n
    if (Test-Path -LiteralPath $from) {
      if (Test-Path -LiteralPath $to) { Copy-Item -LiteralPath $to -Destination ($to + '.before-switch') -Force }
      Copy-Item -LiteralPath $from -Destination $to -Force
      Write-Host "  copied $n"
    } else { Write-Host "  (no $n in $src)" }
  }
}

if ($NoStart) { Write-Host "NoStart: not starting $Release."; exit 0 }
Write-Host "Starting $Release ..."
& (Join-Path $rel 'start.ps1')

# T80: the release started without an error, so the stable launcher (launch-current.ps1, which the shortcut and the right-click menu point at) must follow it:
# current.txt holds the version it starts. Only when the launcher exists next to the releases; the shortcut and the registry are never touched from here.
if (Test-Path -LiteralPath (Join-Path $root 'launch-current.ps1')) {
  Set-Content -LiteralPath (Join-Path $root 'current.txt') -Value $Release -Encoding ASCII
  Write-Host "The stable launcher now starts $Release (current.txt)."
}
Write-Host "Done. If the window did not open, use the shortcut or run 'Terminal Grid $Release.cmd' in the release folder."
Write-Host "To go back: close the window, pause pairs, then run the switch for the previous release (its own state.json.before-switch keeps the older state)."
