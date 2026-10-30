# ClaudeLauncher'i yeniden başlatır (config.json değiştikten sonra kullan).
$root = Split-Path $PSScriptRoot -Parent
$lock = Join-Path $root 'claudelauncher.lock'
if (Test-Path $lock) {
  Stop-Process -Id ([int](Get-Content $lock)) -Force -ErrorAction SilentlyContinue
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*$root\src\bot.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Stop-ScheduledTask -TaskName 'ClaudeLauncher' -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'ClaudeLauncher'
Write-Host 'ClaudeLauncher yeniden başlatıldı.'
