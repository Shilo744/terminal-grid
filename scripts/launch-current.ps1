# Terminal Grid: stable launcher. The desktop shortcut and the right-click menu point HERE, never at a version folder.
# It starts the version named in current.txt (for example V4.7) with the same arguments (a folder, -Kind, ...).
# To change the version for good: edit current.txt (the "Switch live to V4.x.cmd" steps in VERSIONS.md do the same).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ver = (Get-Content -LiteralPath (Join-Path $here 'current.txt') -TotalCount 1).Trim()
$start = Join-Path (Join-Path $here $ver) 'start.ps1'
if (-not (Test-Path -LiteralPath $start)) { throw "Terminal Grid: $start does not exist (check current.txt)" }
& $start @args
