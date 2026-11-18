# Terminal Grid launcher (ASCII only on purpose: Windows PowerShell 5.1 misreads UTF-8 without BOM).
#
#   start.ps1                    make sure the server is running, then open (or raise) the window
#   start.ps1 "C:\some\folder"   additionally open a new terminal in that folder
#                                (this is what the right-click menu and dropping a folder on the shortcut use)
#   -Kind powershell             open a PowerShell terminal instead of Claude
#   -NoBrowser                   do not open/raise a window (for testing)
#   -Port 7795                   run a separate instance on another port (default 7791, unchanged behaviour). A non-default port
#                                keeps its own state and settings in .state-<port> next to this script, so it never touches the
#                                terminals or settings of the instance on 7791, and it never raises the window of another instance.
#                                ("Terminal Grid V4.cmd" runs this with 7795.) Its window opens in its own browser profile
#                                (.chrome-<port> next to this script), independent of the everyday browser profile.
param(
  [Parameter(Position = 0)][string]$Dir,
  [ValidateSet('claude', 'powershell')][string]$Kind = 'claude',
  [switch]$NoBrowser,
  [ValidateRange(1024, 65535)][int]$Port = 7791
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = $Port
$default = ($port -eq 7791)
$base = "http://127.0.0.1:$port"
$logFile = Join-Path $root 'launch.log'

function Write-Log($msg) { try { Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date -Format s), $msg) -Encoding UTF8 } catch { } }
function Test-Listening { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }

try {
  # 1. server
  if (-not (Test-Listening)) {
    $node = (Get-Command node -ErrorAction Stop).Source
    if (-not $default) {
      # separate instance: own port and own state/settings folder (the child process inherits these variables)
      $stateDir = Join-Path $root (".state-" + $port)
      New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
      $env:PORT = [string]$port
      $env:TG_STATE_FILE = Join-Path $stateDir 'state.json'
      $env:TG_SETTINGS_FILE = Join-Path $stateDir 'settings.json'
    }
    Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden
    for ($i = 0; $i -lt 50 -and -not (Test-Listening); $i++) { Start-Sleep -Milliseconds 200 }
  }
  $info = Invoke-RestMethod -Uri "$base/api/info" -TimeoutSec 5

  # 2. normalise the folder argument. A path like "C:\" arrives as C:" because of how quotes are parsed.
  $newId = $null
  if ($Dir) {
    $Dir = $Dir.Trim().Trim('"')
    if ($Dir -match '^[A-Za-z]:$') { $Dir = $Dir + '\' }
    if ($Dir.Length -gt 3) { $Dir = $Dir.TrimEnd('\') }
    $json = @{ cwd = $Dir; kind = $Kind } | ConvertTo-Json -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $res = Invoke-RestMethod -Method Post -Uri "$base/api/open" -Body $bytes `
      -ContentType 'application/json; charset=utf-8' -Headers @{ 'x-tg' = '1' } -TimeoutSec 10
    $newId = $res.id
  }

  if ($NoBrowser) { return }

  # 3. window: raise the one that is already open, otherwise open a new app window
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TgWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  public static bool RaiseHandle(IntPtr found) {
    if (found == IntPtr.Zero) return false;
    if (IsIconic(found)) ShowWindow(found, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);   // tap Alt so Windows lets us take the foreground
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(found);
    return true;
  }

  public static bool Raise(string needle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      StringBuilder sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      if (sb.ToString().IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return RaiseHandle(found);
  }
}
'@
  # A separate instance (non-default port) runs in its OWN browser profile folder (.chrome-<port> next to the script). The browser profile
  # of the user can hang on a brand-new local origin (a blank grey window was seen), and a dedicated profile also keeps the window
  # independent of the extensions and settings of the everyday browser. The profile starts its own browser instance: the user's browser
  # process is never reused or touched. The default port keeps the old behaviour exactly.
  $profileDir = Join-Path $root (".chrome-" + $port)
  function Get-InstanceWindow {
    $found = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and ($_.CommandLine -like '*--user-data-dir=*') -and ($_.CommandLine -like "*.chrome-$port*") -and ($_.CommandLine -notlike '*--type=*') }
    foreach ($p in @($found)) {
      $h = (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue).MainWindowHandle
      if ($h -and [int64]$h -ne 0) { return $h }
    }
    return $null
  }
  # T79: the window opens CENTRED on the primary monitor (85 percent of the work area, scripts\window-placement.js), but only when the browser profile has
  # no saved placement for the app window yet (Chrome keeps it under browser.app_window_placement once the user moved or resized the window: never override that).
  function Test-SavedPlacement($userDataDir) {
    try {
      $pref = Join-Path $userDataDir 'Default\Preferences'
      if (-not (Test-Path $pref)) { return $false }
      $p = (Get-Content -Raw -Path $pref | ConvertFrom-Json).browser.app_window_placement
      if (-not $p) { return $false }
      # Chrome stores the app name 127.0.0.1_/ as a nested dictionary 127 > 0 > 0 > 1_/ (the dots split the key), so the first level is "127"
      foreach ($n in $p.PSObject.Properties.Name) { if ($n -eq '127' -or $n -like '*127.0.0.1*') { return $true } }
    } catch { }
    return $false
  }
  function Get-PlacementArgs($userDataDir) {
    if (Test-SavedPlacement $userDataDir) { return '' }
    try {
      $nodeExe = (Get-Command node -ErrorAction Stop).Source
      Add-Type -AssemblyName System.Windows.Forms
      $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
      $out = (& $nodeExe (Join-Path $root 'scripts\window-placement.js') $wa.X $wa.Y $wa.Width $wa.Height | Out-String).Trim()
      if ($out -match '^(\d+),(\d+),(-?\d+),(-?\d+)$') { return ('--window-size={0},{1} --window-position={2},{3}' -f $Matches[1], $Matches[2], $Matches[3], $Matches[4]) }
    } catch { Write-Log ('placement: ' + $_.Exception.Message) }
    return ''
  }
  $raised = $false
  if ($info.clients -gt 0) {
    if ($default) { $raised = [TgWin]::Raise('Terminal Grid' + [char]0x200C) }
    else {
      # only the window of THIS port (found through its dedicated profile), never the window of the instance on 7791
      $h = Get-InstanceWindow
      if ($h) { $raised = [TgWin]::RaiseHandle($h) }
    }
  }
  if (-not $raised) {
    $candidates = @(
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )
    $browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    $url = if ($newId) { "$base/#f=$newId" } else { "$base/" }
    if (-not $browser) { Start-Process $url }
    elseif ($default) {
      $userData = if ($browser -like '*msedge*') { Join-Path $env:LocalAppData 'Microsoft\Edge\User Data' } else { Join-Path $env:LocalAppData 'Google\Chrome\User Data' }
      $place = Get-PlacementArgs $userData
      Start-Process -FilePath $browser -ArgumentList (("--app=$url " + $place).Trim())
    }
    else {
      New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
      $browserArgs = "--user-data-dir=`"$profileDir`" --no-first-run --no-default-browser-check --app=$url"
      $place = Get-PlacementArgs $profileDir
      if ($place) { $browserArgs = $browserArgs + " " + $place }
      Start-Process -FilePath $browser -ArgumentList $browserArgs
    }
  }
}
catch {
  Write-Log $_.Exception.Message
}
