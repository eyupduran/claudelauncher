# VS Code pencerelerini listeler (list) ya da tek bir pencereyi kapatir (close -Handle <hwnd>).
param([string]$Action = 'list', [long]$Handle = 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class VsWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  public static List<string> List() {
    var r = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int n = GetWindowTextLength(h);
      if (n == 0) return true;
      var sb = new StringBuilder(n + 1);
      GetWindowText(h, sb, sb.Capacity);
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      r.Add(h.ToInt64() + "\t" + pid + "\t" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
'@

if ($Action -eq 'list') {
  $codePids = @(Get-Process -Name Code -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $out = foreach ($line in [VsWin]::List()) {
    $p = $line -split "`t", 3
    if ($codePids -contains [int]$p[1]) { [pscustomobject]@{ hwnd = [long]$p[0]; title = $p[2] } }
  }
  ConvertTo-Json -InputObject @($out) -Compress
} elseif ($Action -eq 'close') {
  $h = [IntPtr]$Handle
  [void][VsWin]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)  # WM_CLOSE
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if (-not [VsWin]::IsWindow($h)) { 'closed'; exit 0 }
  }
  'open'
}
