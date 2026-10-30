# vscode-helper klasorunden .vsix paketi uretir ve VS Code'a kurar.
# Kullanim: npm run install-vscode-helper
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'vscode-helper'
$pkg = Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json
$vsix = Join-Path $env:TEMP "$($pkg.publisher).$($pkg.name)-$($pkg.version).vsix"

$contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>
'@

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$($pkg.name)" Version="$($pkg.version)" Publisher="$($pkg.publisher)"/>
    <DisplayName>$($pkg.displayName)</DisplayName>
    <Description xml:space="preserve">Opens ClaudeLauncher sessions in the Claude Code sidebar.</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)"/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>
"@

[System.IO.File]::Delete($vsix)
$zip = [System.IO.Compression.ZipFile]::Open($vsix, 'Create')
try {
  function Add-Text($name, $text) {
    $w = New-Object System.IO.StreamWriter(($zip.CreateEntry($name)).Open(), (New-Object System.Text.UTF8Encoding $false))
    $w.Write($text); $w.Dispose()
  }
  Add-Text '[Content_Types].xml' $contentTypes
  Add-Text 'extension.vsixmanifest' $manifest
  foreach ($f in 'package.json', 'extension.js') {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $src $f), "extension/$f") | Out-Null
  }
} finally { $zip.Dispose() }

$code = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'
if (-not (Test-Path $code)) { $code = 'code' }
& $code --install-extension $vsix --force
if ($LASTEXITCODE -ne 0) { throw "Kurulum basarisiz (cikis kodu $LASTEXITCODE)" }
[System.IO.File]::Delete($vsix)
Write-Host 'ClaudeLauncher Helper kuruldu. Acik VS Code pencereleri icin: Developer: Reload Window.'
