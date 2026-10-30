# ClaudeLauncher zamanlanmış görevini durdurur ve kaldırır.
$root = Split-Path $PSScriptRoot -Parent
Stop-ScheduledTask -TaskName 'ClaudeLauncher' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'ClaudeLauncher' -Confirm:$false -ErrorAction SilentlyContinue
$lock = Join-Path $root 'claudelauncher.lock'
if (Test-Path $lock) {
  Stop-Process -Id ([int](Get-Content $lock)) -Force -ErrorAction SilentlyContinue
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
Write-Host 'ClaudeLauncher kaldırıldı.'
