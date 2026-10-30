# ClaudeLauncher'i Windows oturumu açıldığında gizli olarak başlatan zamanlanmış görevi kurar ve hemen çalıştırır.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node).Source
$user = "$env:USERDOMAIN\$env:USERNAME"

# conhost --headless: konsol penceresi açmadan çalıştırır.
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" `
  -Argument "--headless `"$node`" `"$root\src\main.js`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'ClaudeLauncher' -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description 'Telefondan VS Code + Claude Code oturumu açma servisi' -Force | Out-Null
Start-ScheduledTask -TaskName 'ClaudeLauncher'
Write-Host "ClaudeLauncher kuruldu ve başlatıldı. Log: $root\logs\claudelauncher.log"
