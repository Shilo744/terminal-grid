# Adds / removes the "Terminal Grid" entry in the Explorer right-click menu (current user only, no admin needed).
#   .\install-context-menu.ps1                 install the entry (folders, empty folder space, desktop, drives)
#   .\install-context-menu.ps1 -ClassicMenu    also switch Windows 11 to the classic right-click menu, so the entry is
#                                              shown directly instead of under "Show more options"
#   .\install-context-menu.ps1 -ModernMenu     go back to the Windows 11 right-click menu
#   .\install-context-menu.ps1 -Uninstall      remove the entry
# ASCII only on purpose: PowerShell 5.1 misreads UTF-8 without BOM.
param([switch]$Uninstall, [switch]$ClassicMenu, [switch]$ModernMenu)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$label = 'Terminal Grid'
$icon = Join-Path $root 'terminal-grid.ico'
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# %1 = the folder / drive that was right-clicked, %V = the folder whose empty space (or the desktop) was right-clicked.
# conhost --headless runs PowerShell with no console window, so nothing flashes on screen.
$targets = @(
  @{ Key = 'HKCU:\Software\Classes\Directory\shell\TerminalGrid';            Arg = '%1' },
  @{ Key = 'HKCU:\Software\Classes\Directory\Background\shell\TerminalGrid'; Arg = '%V' },
  @{ Key = 'HKCU:\Software\Classes\DesktopBackground\shell\TerminalGrid';    Arg = '%V' },
  @{ Key = 'HKCU:\Software\Classes\Drive\shell\TerminalGrid';                Arg = '%1' }
)

# The switch that brings back the classic menu (per user): an empty InprocServer32 under this CLSID.
$classicKey = 'HKCU:\Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}'

if ($ModernMenu) {
  Remove-Item -LiteralPath $classicKey -Recurse -ErrorAction SilentlyContinue
  'Windows 11 right-click menu restored (restart Explorer or sign out for it to apply).'
  return
}

foreach ($t in $targets) {
  if ($Uninstall) {
    Remove-Item -LiteralPath $t.Key -Recurse -ErrorAction SilentlyContinue
    continue
  }
  New-Item -Path $t.Key -Value $label -Force | Out-Null
  New-ItemProperty -Path $t.Key -Name 'Icon' -Value ('"{0}"' -f $icon) -Force | Out-Null
  New-ItemProperty -Path $t.Key -Name 'Position' -Value 'Top' -Force | Out-Null
  $cmd = '"{0}" --headless "{1}" -NoProfile -ExecutionPolicy Bypass -File "{2}" "{3}"' -f $conhost, $ps, (Join-Path $root 'start.ps1'), $t.Arg
  New-Item -Path (Join-Path $t.Key 'command') -Value $cmd -Force | Out-Null
}

if ($Uninstall) { 'Removed.'; return }

if ($ClassicMenu) {
  New-Item -Path (Join-Path $classicKey 'InprocServer32') -Value '' -Force | Out-Null
  'Installed + classic right-click menu enabled (restart Explorer or sign out for it to apply).'
} else {
  'Installed. Right-click -> Show more options -> ' + $label
}
