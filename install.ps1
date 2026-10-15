#Requires -Version 5.1
param(
    [string]$Version = $env:FL0W_VERSION,
    [string]$InstallDir = $env:FL0W_INSTALL_DIR,
    [string]$BinName = $env:FL0W_BIN_NAME,
    [string]$Repo = $env:FL0W_REPO
)

$ErrorActionPreference = "Stop"

if (-not $Version) { $Version = "latest" }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\fl0w" }
if (-not $BinName) { $BinName = "fl0w" }
if (-not $Repo) { $Repo = "jackmuva/fl0w-cli" }

function Resolve-ReleaseTag {
    param([string]$RequestedVersion)

    if ($RequestedVersion -ne "latest") {
        return $RequestedVersion
    }

    $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
    return $response.tag_name
}

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { "x64" }
    "ARM64" { "arm64" }
    default {
        throw "Unsupported architecture: $($env:PROCESSOR_ARCHITECTURE)"
    }
}

$asset = "fl0w-windows-$arch.exe"
$tag = Resolve-ReleaseTag -RequestedVersion $Version
$baseUrl = "https://github.com/$Repo/releases/download/$tag"
$assetUrl = "$baseUrl/$asset"
$checksumsUrl = "$baseUrl/SHA256SUMS"

Write-Host "Installing $BinName $tag ($asset)..."

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
    $assetPath = Join-Path $tempDir $asset
    $checksumsPath = Join-Path $tempDir "SHA256SUMS"

    Invoke-WebRequest -Uri $assetUrl -OutFile $assetPath
    Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsPath

    $expectedLine = Get-Content $checksumsPath | Where-Object { $_ -match " $([regex]::Escape($asset))$" }
    if (-not $expectedLine) {
        throw "Checksum entry not found for $asset"
    }

    $expectedHash = ($expectedLine -split '\s+')[0].ToLowerInvariant()
    $actualHash = (Get-FileHash -Algorithm SHA256 -Path $assetPath).Hash.ToLowerInvariant()

    if ($expectedHash -ne $actualHash) {
        throw "Checksum verification failed for $asset"
    }

    $destination = Join-Path $InstallDir "$BinName.exe"
    Copy-Item -Path $assetPath -Destination $destination -Force
}
finally {
    Remove-Item -Recurse -Force -Path $tempDir
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
    Write-Host ""
    Write-Host "Added $InstallDir to your user PATH."
}

Write-Host ""
Write-Host "Installed $BinName to $InstallDir\$BinName.exe"
Write-Host "Run '$BinName' to start fl0w."
