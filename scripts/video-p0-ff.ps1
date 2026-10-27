# Attune video P0 — typed-arg ffmpeg/ffprobe with path allowlist (no shell concat)
param(
  [Parameter(Mandatory)][ValidateSet('ffprobe','ffmpeg')][string]$Tool,
  [Parameter(Mandatory)][string[]]$FfArgs,
  [string]$BinDir = 'D:\Temp\ffmpeg-p0',
  [string[]]$AllowedRoots = @('D:\code\attune-video-p0\fixtures', 'D:\Temp\ffmpeg-p0')
)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $BinDir ($Tool + '.exe')
if (-not (Test-Path -LiteralPath $exe)) { throw "missing $exe" }

function Test-AllowedToken([string]$p, [string[]]$roots) {
  if ($p.StartsWith('-')) { return $true }
  if ($p -match '[;&|<>`]') { return $false }
  if ($p -match '[\\/]' -or $p -match '^[A-Za-z]:') {
    try { $full = [IO.Path]::GetFullPath($p) } catch { return $false }
    foreach ($root in $roots) {
      $r = [IO.Path]::GetFullPath($root).TrimEnd('\')
      if ($full.Equals($r, [StringComparison]::OrdinalIgnoreCase)) { return $true }
      if ($full.StartsWith($r + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
  }
  return ($p -match '^[A-Za-z0-9_.:%=,+-]+$')
}

foreach ($a in $FfArgs) {
  if (-not (Test-AllowedToken $a $AllowedRoots)) { throw "path rejected: $a" }
}

$out = Join-Path $env:TEMP 'attune-ff-out.txt'
$err = Join-Path $env:TEMP 'attune-ff-err.txt'
$p = Start-Process -FilePath $exe -ArgumentList $FfArgs -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
Write-Output "exit=$($p.ExitCode)"
if (Test-Path $out) { Get-Content $out -Raw }
if ($p.ExitCode -ne 0 -and (Test-Path $err)) { Get-Content $err -Tail 20 }
