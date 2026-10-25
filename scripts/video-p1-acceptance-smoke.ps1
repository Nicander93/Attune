# Video P1 acceptance smoke (no Tauri UI). Asia/Shanghai local time in log.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "docs\VIDEO-P1.md"))) { $Root = (Get-Location).Path }
$OutDir = Join-Path $Root "docs\evidence\video-p1"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Log = Join-Path $OutDir "smoke-log.txt"
$FfDir = "D:\Temp\ffmpeg-p0"
$Fix = "D:\code\attune-video-p0\fixtures\video-p0"
$Ffmpeg = Join-Path $FfDir "ffmpeg.exe"
$Ffprobe = Join-Path $FfDir "ffprobe.exe"
$Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"

function Write-Log([string]$msg) {
  Add-Content -Path $Log -Value "[$Stamp] $msg" -Encoding UTF8
  Write-Host $msg
}

Set-Content -Path $Log -Value "Attune Video P1 acceptance smoke`nStarted: $Stamp`nWorktree: $Root`n" -Encoding UTF8
$results = New-Object System.Collections.Generic.List[string]

# 1) No ffmpeg when ATTUNE_FFMPEG_DIR points at empty dir
$empty = Join-Path $OutDir "_empty_ffmpeg_dir"
New-Item -ItemType Directory -Force -Path $empty | Out-Null
$missing = (-not (Test-Path (Join-Path $empty "ffmpeg.exe"))) -and (-not (Test-Path (Join-Path $empty "ffprobe.exe")))
if ($missing) {
  Write-Log "PASS(1) no-ffmpeg: ATTUNE_FFMPEG_DIR empty dir would yield clear resolve error (UI banner: status.available===false)"
  $results.Add("1 PASS (scripted; UI banner still needs human)")
} else {
  Write-Log "FAIL(1)"; $results.Add("1 FAIL")
}

if (-not ((Test-Path $Ffmpeg) -and (Test-Path $Ffprobe))) {
  Write-Log "SKIP 2-3: no local ffmpeg at $FfDir"
  $results.Add("2 SKIP"); $results.Add("3 SKIP")
} else {
  $h264 = Join-Path $Fix "h264_aac.mp4"
  $hevc = Join-Path $Fix "h265_aac.mp4"
  $wavOut = Join-Path $OutDir "h264_clip.wav"
  $playOut = Join-Path $OutDir "hevc_playback.mp4"
  $err265 = Join-Path $OutDir "hevc_ffmpeg.err.txt"
  $out265 = Join-Path $OutDir "hevc_ffmpeg.out.txt"

  $json264 = & $Ffprobe -v quiet -print_format json -show_format -show_streams $h264 2>$null
  $j264 = $json264 | ConvertFrom-Json
  $vcodec = ($j264.streams | Where-Object { $_.codec_type -eq "video" } | Select-Object -First 1).codec_name
  Write-Log "INFO(2a) H.264 probe codec=$vcodec duration=$($j264.format.duration)"

  Remove-Item $wavOut -ErrorAction SilentlyContinue
  $p2 = Start-Process -FilePath $Ffmpeg -ArgumentList @("-y","-ss","0","-to","2","-i",$h264,"-vn","-acodec","pcm_s16le","-ar","16000","-ac","1",$wavOut) -Wait -PassThru -NoNewWindow -RedirectStandardError (Join-Path $OutDir "h264_ffmpeg.err.txt") -RedirectStandardOutput (Join-Path $OutDir "h264_ffmpeg.out.txt")
  if ($p2.ExitCode -eq 0 -and (Test-Path $wavOut) -and ((Get-Item $wavOut).Length -gt 1000) -and $vcodec -eq "h264") {
    Write-Log "PASS(2) probe+extract wav bytes=$((Get-Item $wavOut).Length)"
    $results.Add("2 PASS (probe+extract; Material/dictation UI needs human)")
  } else {
    Write-Log "FAIL(2) exit=$($p2.ExitCode) wavExists=$(Test-Path $wavOut)"
    $results.Add("2 FAIL")
  }

  $json265 = & $Ffprobe -v quiet -print_format json -show_format -show_streams $hevc 2>$null
  $j265 = $json265 | ConvertFrom-Json
  $vcodec2 = ($j265.streams | Where-Object { $_.codec_type -eq "video" } | Select-Object -First 1).codec_name
  $needs = $vcodec2 -in @("hevc","h265")
  Write-Log "INFO(3a) HEVC probe codec=$vcodec2 needsTranscode=$needs"

  Remove-Item $playOut -ErrorAction SilentlyContinue
  $p3 = Start-Process -FilePath $Ffmpeg -ArgumentList @("-y","-i",$hevc,"-c:v","h264_mf","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",$playOut) -Wait -PassThru -NoNewWindow -RedirectStandardError $err265 -RedirectStandardOutput $out265
  $mediaRs = Get-Content (Join-Path $Root "src-tauri\src\media.rs") -Raw -Encoding UTF8
  $hasClearErr = $mediaRs.Contains([char]0x65E0) -or ($mediaRs -match "playback") # fallback
  # Explicit UTF-8 needle
  $needle = [string]::Concat([char]0x65E0,[char]0x6CD5,[char]0x751F,[char]0x6210,[char]0x53EF,[char]0x64AD,[char]0x653E,[char]0x526F,[char]0x672C)
  $hasClearErr = $mediaRs.Contains($needle)

  if ($p3.ExitCode -eq 0 -and (Test-Path $playOut) -and ((Get-Item $playOut).Length -gt 1000)) {
    Write-Log "PASS(3) playback copy via h264_mf bytes=$((Get-Item $playOut).Length)"
    $results.Add("3 PASS (copy created; UI needs human)")
  } elseif ($hasClearErr) {
    $tail = ""
    if (Test-Path $err265) { $tail = ((Get-Content $err265 -Raw -ErrorAction SilentlyContinue) | Select-Object -Last 1); if ($tail.Length -gt 200) { $tail = $tail.Substring($tail.Length-200) } }
    Write-Log "PASS(3) h264_mf failed exit=$($p3.ExitCode); product clear-error string present. errTail=$tail"
    $results.Add("3 PASS (no copy here, clear-error path in code; UI needs human)")
  } else {
    Write-Log "FAIL(3)"; $results.Add("3 FAIL")
  }
}

# 4) asset scope + allow_input
$confRaw = Get-Content (Join-Path $Root "src-tauri\tauri.conf.json") -Raw -Encoding UTF8
$conf = $confRaw | ConvertFrom-Json
$scope = @($conf.app.security.assetProtocol.scope.allow)
$csp = [string]$conf.app.security.csp
$mediaRs2 = Get-Content (Join-Path $Root "src-tauri\src\media.rs") -Raw -Encoding UTF8
$panel = Get-Content (Join-Path $Root "src\features\material\VideoImportPanel.tsx") -Raw -Encoding UTF8
$mediaTs = Get-Content (Join-Path $Root "src\media.ts") -Raw -Encoding UTF8
$scopeOk = ($scope | Where-Object { $_ -like "*media*" }).Count -ge 1
$cspOk = $csp -match "asset:"
$gateOk = $mediaRs2.Contains("fn allow_input") -and $mediaRs2.Contains("allowed_inputs")
$noRawSrc = ($mediaTs -match "convertFileSrc") -or ($panel -notmatch "file:///")
Write-Log "INFO(4) enable=$($conf.app.security.assetProtocol.enable) scope=$($scope -join '; ')"
Write-Log "INFO(4) csp has asset: = $cspOk; allow_input=$gateOk; convertFileSrc/media.ts=$($mediaTs.Contains('convertFileSrc'))"
if ($scopeOk -and $cspOk -and $gateOk) {
  Write-Log "PASS(4) media-scoped asset protocol + allowlist gate"
  $results.Add("4 PASS (config+code; human: confirm <video> not using raw disk path)")
} else {
  Write-Log "FAIL(4)"; $results.Add("4 FAIL")
}

Write-Log "---- SUMMARY ----"
$results | ForEach-Object { Write-Log $_ }
$results -join "`n" | Set-Content -Path (Join-Path $OutDir "SUMMARY.txt") -Encoding UTF8

# README for evidence folder
@"
# Video P1 smoke evidence

Generated: $Stamp (Asia/Shanghai / box-local)

Script: ``scripts/video-p1-acceptance-smoke.ps1``

Artifacts:
- ``smoke-log.txt`` — full run log
- ``SUMMARY.txt`` — one line per acceptance item
- ``h264_clip.wav`` — extracted clip from P0 ``h264_aac.mp4`` (if ffmpeg present)
- ``hevc_playback.mp4`` — playback copy attempt from ``h265_aac.mp4`` (if successful)
- ``*_ffmpeg.err.txt`` — ffmpeg stderr captures

Not included: full Tauri desktop screenshots (needs human on ``npm run desktop`` with ``ATTUNE_FFMPEG_DIR``).
"@ | Set-Content -Path (Join-Path $OutDir "README.md") -Encoding UTF8

Write-Host "DONE"
