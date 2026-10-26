//! Local media probe / extract / playback-copy via ffmpeg+ffprobe.
//!
//! Binaries are **not** shipped in the NSIS installer. Resolve order:
//! 1. `ATTUNE_FFMPEG_DIR`
//! 2. `{app_data}/tools/ffmpeg/`
//! 3. `PATH`
//!
//! Commands use typed argv (no shell). Outputs only under `{app_data}/media/`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct MediaState {
    /// Extra roots allowed as ffmpeg inputs (user-picked sources).
    allowed_inputs: Mutex<Vec<PathBuf>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStreamInfo {
    pub index: u32,
    pub codec_type: String,
    pub codec_name: String,
    pub channels: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub path: String,
    pub duration: f64,
    pub format_name: String,
    pub streams: Vec<MediaStreamInfo>,
    pub video_compatible: bool,
    pub needs_transcode: bool,
    pub compatibility_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractAudioRequest {
    pub source_path: String,
    pub material_id: String,
    pub audio_stream: u32,
    pub clip_start: f64,
    pub clip_end: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractAudioResult {
    pub wav_path: String,
    pub duration: f64,
    pub sample_rate: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackCopyRequest {
    pub source_path: String,
    pub material_id: String,
    pub force_transcode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackCopyResult {
    pub playback_path: String,
    pub transcoded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractSubtitlesRequest {
    pub source_path: String,
    pub material_id: String,
    pub subtitle_stream: u32,
    pub clip_start: f64,
    pub clip_end: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractSubtitlesResult {
    pub srt_path: String,
    pub stream_index: u32,
    pub codec_name: String,
}



#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub available: bool,
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub source: String,
    pub hint: String,
}

pub(crate) fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))
}

pub(crate) fn media_dir(app: &AppHandle, material_id: &str) -> Result<PathBuf, String> {
    validate_material_id(material_id)?;
    let dir = app_data(app)?.join("media").join(material_id);
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建媒体缓存目录：{e}"))?;
    Ok(dir)
}


/// Text subtitle codecs ffmpeg can convert to SRT. Bitmap/PGS stays out (OCR = P4).
pub fn is_bitmap_subtitle_codec(codec: &str) -> bool {
    matches!(
        codec.to_ascii_lowercase().as_str(),
        "hdmv_pgs_subtitle"
            | "pgssub"
            | "dvd_subtitle"
            | "dvdsub"
            | "dvb_subtitle"
            | "xsub"
            | "vobsub"
    )
}

pub fn is_text_subtitle_codec(codec: &str) -> bool {
    matches!(
        codec.to_ascii_lowercase().as_str(),
        "subrip"
            | "srt"
            | "ass"
            | "ssa"
            | "mov_text"
            | "text"
            | "webvtt"
            | "wvtt"
            | "ttml"
            | "subtitle"
    )
}

pub(crate) fn validate_material_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("素材 ID 无效".into());
    }
    Ok(())
}

fn looks_dangerous(token: &str) -> bool {
    token.chars().any(|c| matches!(c, ';' | '&' | '|' | '<' | '>' | '`' | '\n' | '\r' | '\0'))
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
    if looks_dangerous(path.to_string_lossy().as_ref()) {
        return Err("路径包含非法字符".into());
    }
    let meta = fs::metadata(path).map_err(|_| format!("找不到文件：{}", path.display()))?;
    if !meta.is_file() {
        return Err("路径不是文件".into());
    }
    fs::canonicalize(path).map_err(|e| format!("无法解析路径：{e}"))
}

fn is_under(child: &Path, root: &Path) -> bool {
    child.starts_with(root)
}

pub(crate) fn allow_input(app: &AppHandle, state: &MediaState, path: &Path) -> Result<PathBuf, String> {
    let full = canonicalize_existing(path)?;
    let data = app_data(app)?;
    let media_root = data.join("media");
    if is_under(&full, &media_root) {
        return Ok(full);
    }
    let allowed = state
        .allowed_inputs
        .lock()
        .map_err(|_| "媒体状态不可用".to_string())?;
    if allowed.iter().any(|p| p == &full) {
        return Ok(full);
    }
    Err("该文件路径未授权。请通过「导入视频」对话框重新选择。".into())
}

pub(crate) fn allow_output(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let data = app_data(app)?;
    let media_root = fs::canonicalize(data.join("media")).or_else(|_| {
        fs::create_dir_all(data.join("media")).ok();
        fs::canonicalize(data.join("media"))
    }).map_err(|e| format!("无法准备媒体目录：{e}"))?;
    let parent = path.parent().ok_or("输出路径无效")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建输出目录：{e}"))?;
    let full = if path.exists() {
        fs::canonicalize(path).map_err(|e| format!("无法解析输出路径：{e}"))?
    } else {
        let canon_parent = fs::canonicalize(parent).map_err(|e| format!("无法解析输出目录：{e}"))?;
        canon_parent.join(path.file_name().ok_or("输出文件名无效")?)
    };
    if !is_under(&full, &media_root) {
        return Err("输出路径必须位于应用媒体缓存目录内".into());
    }
    Ok(full)
}

fn which_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let with_exe = dir.join(format!("{name}.exe"));
            if with_exe.is_file() {
                return Some(with_exe);
            }
        }
    }
    None
}

pub(crate) fn resolve_bins(app: &AppHandle) -> Result<(PathBuf, PathBuf, String), String> {
    let ffmpeg_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let ffprobe_name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };

    if let Ok(dir) = std::env::var("ATTUNE_FFMPEG_DIR") {
        let root = PathBuf::from(dir.trim());
        let ff = root.join(ffmpeg_name);
        let fp = root.join(ffprobe_name);
        if ff.is_file() && fp.is_file() {
            return Ok((ff, fp, "ATTUNE_FFMPEG_DIR".into()));
        }
        return Err(format!(
            "ATTUNE_FFMPEG_DIR 已设置，但未找到 {ffmpeg_name} / {ffprobe_name}：{}",
            root.display()
        ));
    }

    let tools = app_data(app)?.join("tools").join("ffmpeg");
    let ff = tools.join(ffmpeg_name);
    let fp = tools.join(ffprobe_name);
    if ff.is_file() && fp.is_file() {
        return Ok((ff, fp, "app_data/tools/ffmpeg".into()));
    }

    if let (Some(ff), Some(fp)) = (which_in_path("ffmpeg"), which_in_path("ffprobe")) {
        return Ok((ff, fp, "PATH".into()));
    }

    Err(
        "未找到 ffmpeg/ffprobe。开发环境可设置 ATTUNE_FFMPEG_DIR；正式版将按需下载 LGPL 构建到应用数据目录（安装包不附带 GPL ffmpeg）。"
            .into(),
    )
}

pub(crate) fn run_typed(bin: &Path, args: &[String]) -> Result<(String, String), String> {
    for a in args {
        if looks_dangerous(a) {
            return Err("参数包含非法字符".into());
        }
    }
    let mut cmd = Command::new(bin);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let output = cmd
        .output()
        .map_err(|e| format!("无法启动 {}：{e}", bin.display()))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        let detail = if stderr.trim().is_empty() { stdout } else { stderr };
        return Err(format!(
            "{} 失败（code {:?}）：{}",
            bin.file_name().and_then(|s| s.to_str()).unwrap_or("tool"),
            output.status.code(),
            detail.chars().take(800).collect::<String>()
        ));
    }
    Ok((stdout, stderr))
}

fn parse_probe(path: &str, json: &str) -> Result<MediaProbe, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("ffprobe JSON 无效：{e}"))?;
    let format = value.get("format").cloned().unwrap_or(serde_json::json!({}));
    let duration = format
        .get("duration")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    let format_name = format
        .get("format_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut streams = Vec::new();
    if let Some(arr) = value.get("streams").and_then(|v| v.as_array()) {
        for s in arr {
            let index = s.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let codec_type = s
                .get("codec_type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let codec_name = s
                .get("codec_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let channels = s.get("channels").and_then(|v| v.as_u64()).map(|n| n as u32);
            let width = s.get("width").and_then(|v| v.as_u64()).map(|n| n as u32);
            let height = s.get("height").and_then(|v| v.as_u64()).map(|n| n as u32);
            let language = s
                .get("tags")
                .and_then(|t| t.get("language"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            streams.push(MediaStreamInfo {
                index,
                codec_type,
                codec_name,
                channels,
                width,
                height,
                language,
            });
        }
    }

    let video = streams.iter().find(|s| s.codec_type == "video");
    let (video_compatible, needs_transcode, compatibility_note) = match video {
        None => (
            false,
            false,
            "未找到视频轨；仍可提取音轨用于听写。".to_string(),
        ),
        Some(v) if v.codec_name == "h264" => (
            true,
            false,
            "视频编码为 H.264，可作为播放基线。".to_string(),
        ),
        Some(v) if v.codec_name == "hevc" || v.codec_name == "h265" => (
            false,
            true,
            "视频编码为 H.265/HEVC。本机若无 HEVC 扩展则无法直接播放，将尝试生成 H.264 播放副本；失败时会给出明确错误。".to_string(),
        ),
        Some(v) => (
            false,
            true,
            format!(
                "视频编码为 {}，不在 H.264 基线内，需要转码播放副本或无法播放。",
                v.codec_name
            ),
        ),
    };

    Ok(MediaProbe {
        path: path.to_string(),
        duration,
        format_name,
        streams,
        video_compatible,
        needs_transcode,
        compatibility_note,
    })
}

#[tauri::command]
pub fn media_ffmpeg_status(app: AppHandle) -> FfmpegStatus {
    match resolve_bins(&app) {
        Ok((ff, fp, source)) => FfmpegStatus {
            available: true,
            ffmpeg: Some(ff.display().to_string()),
            ffprobe: Some(fp.display().to_string()),
            source,
            hint: String::new(),
        },
        Err(hint) => FfmpegStatus {
            available: false,
            ffmpeg: None,
            ffprobe: None,
            source: "missing".into(),
            hint,
        },
    }
}

#[tauri::command]
pub fn media_authorize_path(state: State<'_, MediaState>, path: String) -> Result<String, String> {
    let full = canonicalize_existing(Path::new(&path))?;
    let mut guard = state
        .allowed_inputs
        .lock()
        .map_err(|_| "媒体状态不可用".to_string())?;
    if !guard.iter().any(|p| p == &full) {
        guard.push(full.clone());
    }
    Ok(full.display().to_string())
}

#[tauri::command]
pub fn media_probe(
    app: AppHandle,
    state: State<'_, MediaState>,
    path: String,
) -> Result<MediaProbe, String> {
    let full = allow_input(&app, &state, Path::new(&path))?;
    let (_ff, fp, _) = resolve_bins(&app)?;
    let args = vec![
        "-v".into(),
        "quiet".into(),
        "-print_format".into(),
        "json".into(),
        "-show_format".into(),
        "-show_streams".into(),
        full.display().to_string(),
    ];
    let (stdout, _) = run_typed(&fp, &args)?;
    parse_probe(&full.display().to_string(), &stdout)
}

#[tauri::command]
pub fn media_extract_audio(
    app: AppHandle,
    state: State<'_, MediaState>,
    request: ExtractAudioRequest,
) -> Result<ExtractAudioResult, String> {
    if request.clip_end <= request.clip_start {
        return Err("时间范围无效：结束时间必须大于开始时间".into());
    }
    if request.clip_end - request.clip_start > 20.0 * 60.0 {
        return Err("首版自动提取建议不超过 20 分钟，请缩小时间范围".into());
    }
    let full = allow_input(&app, &state, Path::new(&request.source_path))?;
    let (ff, _, _) = resolve_bins(&app)?;
    let out = media_dir(&app, &request.material_id)?.join("clip-audio.wav");
    let out = allow_output(&app, &out)?;
    let duration = request.clip_end - request.clip_start;
    let args = vec![
        "-y".into(),
        "-ss".into(),
        format!("{:.3}", request.clip_start),
        "-i".into(),
        full.display().to_string(),
        "-t".into(),
        format!("{:.3}", duration),
        "-map".into(),
        format!("0:{}", request.audio_stream),
        "-vn".into(),
        "-acodec".into(),
        "pcm_s16le".into(),
        "-ar".into(),
        "16000".into(),
        "-ac".into(),
        "1".into(),
        out.display().to_string(),
    ];
    run_typed(&ff, &args)?;
    if !out.is_file() {
        return Err("提取后未找到音频文件".into());
    }
    Ok(ExtractAudioResult {
        wav_path: out.display().to_string(),
        duration,
        sample_rate: 16000,
    })
}

fn try_playback_copy(
    ff: &Path,
    source: &Path,
    out: &Path,
    transcode: bool,
) -> Result<(), String> {
    let mut args = vec![
        "-y".into(),
        "-i".into(),
        source.display().to_string(),
    ];
    if transcode {
        // Prefer Media Foundation H.264 on Windows so an LGPL ffmpeg build can encode
        // without libx264 (GPL). Fall back error is handled by caller.
        args.extend([
            "-c:v".into(),
            "h264_mf".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-c:a".into(),
            "aac".into(),
            "-movflags".into(),
            "+faststart".into(),
        ]);
    } else {
        args.extend([
            "-c".into(),
            "copy".into(),
            "-movflags".into(),
            "+faststart".into(),
        ]);
    }
    args.push(out.display().to_string());
    run_typed(ff, &args).map(|_| ())
}

#[tauri::command]
pub fn media_prepare_playback(
    app: AppHandle,
    state: State<'_, MediaState>,
    request: PlaybackCopyRequest,
) -> Result<PlaybackCopyResult, String> {
    let full = allow_input(&app, &state, Path::new(&request.source_path))?;
    let (ff, fp, _) = resolve_bins(&app)?;
    let probe_args = vec![
        "-v".into(),
        "quiet".into(),
        "-print_format".into(),
        "json".into(),
        "-show_format".into(),
        "-show_streams".into(),
        full.display().to_string(),
    ];
    let (stdout, _) = run_typed(&fp, &probe_args)?;
    let probe = parse_probe(&full.display().to_string(), &stdout)?;
    let out = media_dir(&app, &request.material_id)?.join("playback.mp4");
    let out = allow_output(&app, &out)?;

    let needs = request.force_transcode || probe.needs_transcode;
    if !needs {
        // Remux/copy into managed cache so asset protocol never needs the arbitrary source path.
        match try_playback_copy(&ff, &full, &out, false) {
            Ok(()) => {
                return Ok(PlaybackCopyResult {
                    playback_path: out.display().to_string(),
                    transcoded: false,
                });
            }
            Err(_) => {
                // Some containers refuse stream-copy to mp4; fall through to encode.
            }
        }
    }

    match try_playback_copy(&ff, &full, &out, true) {
        Ok(()) => Ok(PlaybackCopyResult {
            playback_path: out.display().to_string(),
            transcoded: true,
        }),
        Err(err) => Err(format!(
            "无法生成可播放副本。源视频编码不在 H.264 基线内，且本机转码失败。请改用 H.264/AAC 文件，或安装可用的 LGPL ffmpeg（支持 h264_mf）。详情：{err}"
        )),
    }
}

#[tauri::command]

pub fn media_extract_subtitles(
    app: AppHandle,
    state: State<'_, MediaState>,
    request: ExtractSubtitlesRequest,
) -> Result<ExtractSubtitlesResult, String> {
    if request.clip_end <= request.clip_start {
        return Err("时间范围无效：结束时间必须大于开始时间。".into());
    }
    let full = allow_input(&app, &state, Path::new(&request.source_path))?;
    let (ff, fp, _) = resolve_bins(&app)?;

    // Fresh probe so we can refuse bitmap subtitle codecs (OCR = P4).
    let args = vec![
        "-v".into(),
        "quiet".into(),
        "-print_format".into(),
        "json".into(),
        "-show_streams".into(),
        full.display().to_string(),
    ];
    let (stdout, _) = run_typed(&fp, &args)?;
    let probe = parse_probe(&full.display().to_string(), &stdout)?;
    let stream = probe
        .streams
        .iter()
        .find(|s| s.index == request.subtitle_stream)
        .ok_or_else(|| format!("找不到字幕流 #{}", request.subtitle_stream))?;
    if stream.codec_type != "subtitle" {
        return Err(format!("流 #{} 不是字幕轨。", request.subtitle_stream));
    }
    if !is_text_subtitle_codec(&stream.codec_name) {
        return Err(format!(
            "字幕编码 {} 是图像字幕，P3 只提取文字轨（SRT/ASS/mov_text 等）。OCR 留到 P4。",
            stream.codec_name
        ));
    }

    let out = media_dir(&app, &request.material_id)?.join("embedded.srt");
    let out = allow_output(&app, &out)?;
    let duration = request.clip_end - request.clip_start;
    let extract_args = vec![
        "-y".into(),
        "-ss".into(),
        format!("{:.3}", request.clip_start),
        "-i".into(),
        full.display().to_string(),
        "-t".into(),
        format!("{:.3}", duration),
        "-map".into(),
        format!("0:{}", request.subtitle_stream),
        "-c:s".into(),
        "srt".into(),
        out.display().to_string(),
    ];
    run_typed(&ff, &extract_args)?;
    if !out.is_file() {
        return Err("提取后未找到字幕文件。".into());
    }
    let meta = fs::metadata(&out).map_err(|e| format!("无法读取字幕文件：{e}"))?;
    if meta.len() == 0 {
        return Err("字幕轨提取结果为空（可能该片段没有字幕）。".into());
    }
    Ok(ExtractSubtitlesResult {
        srt_path: out.display().to_string(),
        stream_index: request.subtitle_stream,
        codec_name: stream.codec_name.clone(),
    })
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrBurnedInRequest {
    pub source_path: String,
    pub material_id: String,
    pub clip_start: f64,
    pub clip_end: f64,
    /// Seconds between sampled frames (clamped).
    pub sample_interval: Option<f64>,
    /// Hard cap on frames OCR'd in one run.
    pub max_samples: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrBurnedInResult {
    pub srt_path: String,
    pub cue_count: u32,
    pub sample_count: u32,
    pub backend: String,
    pub language: Option<String>,
}

#[tauri::command]
pub fn media_ocr_burned_in(
    app: AppHandle,
    state: State<'_, MediaState>,
    request: OcrBurnedInRequest,
) -> Result<OcrBurnedInResult, String> {
    if request.clip_end <= request.clip_start {
        return Err("时间范围无效：结束时间必须大于开始时间。".into());
    }
    let status = crate::ocr::ocr_status();
    if !status.available {
        return Err(status.hint);
    }
    let full = allow_input(&app, &state, Path::new(&request.source_path))?;
    let (ff, _, _) = resolve_bins(&app)?;
    let clip_duration = request.clip_end - request.clip_start;
    let interval = request.sample_interval.unwrap_or(0.75).clamp(0.25, 5.0);
    let max_samples = request.max_samples.unwrap_or(24).clamp(1, 48) as usize;

    let frames_dir = media_dir(&app, &request.material_id)?.join("ocr-frames");
    if frames_dir.exists() {
        let _ = fs::remove_dir_all(&frames_dir);
    }
    fs::create_dir_all(&frames_dir).map_err(|e| format!("无法创建 OCR 帧目录：{e}"))?;

    let mut samples: Vec<(f64, String)> = Vec::new();
    let mut sample_count = 0u32;
    let mut t = 0.0_f64;
    while t < clip_duration - 0.05 && samples.len() < max_samples {
        let abs_t = request.clip_start + t;
        let frame_path = frames_dir.join(format!("f_{:04}.png", sample_count));
        let out = allow_output(&app, &frame_path)?;
        let args = vec![
            "-y".into(),
            "-ss".into(),
            format!("{:.3}", abs_t),
            "-i".into(),
            full.display().to_string(),
            "-frames:v".into(),
            "1".into(),
            "-q:v".into(),
            "2".into(),
            out.display().to_string(),
        ];
        run_typed(&ff, &args)?;
        if out.is_file() {
            match crate::ocr::recognize_image_file(&out) {
                Ok(text) => samples.push((t, text)),
                Err(err) => {
                    // Soft-fail a single frame; keep going unless nothing works.
                    if sample_count == 0 {
                        return Err(err);
                    }
                }
            }
            sample_count += 1;
        }
        t += interval;
    }

    let cues = crate::ocr::merge_ocr_samples(&samples, clip_duration);
    if cues.is_empty() {
        return Err("OCR 未识别到可用字幕文本。可安装英文 OCR 语言包后重试，或改用语音识别。".into());
    }

    let srt_path = media_dir(&app, &request.material_id)?.join("ocr.srt");
    let srt_path = allow_output(&app, &srt_path)?;
    let mut body = String::new();
    for (i, (start, end, text)) in cues.iter().enumerate() {
        body.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            format_srt_time(*start),
            format_srt_time(*end),
            text
        ));
    }
    fs::write(&srt_path, body).map_err(|e| format!("无法写入 OCR SRT：{e}"))?;

    Ok(OcrBurnedInResult {
        srt_path: srt_path.display().to_string(),
        cue_count: cues.len() as u32,
        sample_count,
        backend: status.backend,
        language: status.preferred_language,
    })
}

fn format_srt_time(seconds: f64) -> String {
    let ms_total = (seconds.max(0.0) * 1000.0).round() as u64;
    let ms = ms_total % 1000;
    let s = (ms_total / 1000) % 60;
    let m = (ms_total / 60_000) % 60;
    let h = ms_total / 3_600_000;
    format!("{h:02}:{m:02}:{s:02},{ms:03}")
}


#[tauri::command]
pub fn media_clear_cache(app: AppHandle, material_id: String) -> Result<(), String> {
    validate_material_id(&material_id)?;
    let dir = app_data(&app)?.join("media").join(&material_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("清理媒体缓存失败：{e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_shell_metacharacters() {
        assert!(looks_dangerous("a;rm"));
        assert!(!looks_dangerous(r"D:\videos\lesson.mp4"));
    }

    #[test]
    fn material_id_rules() {
        assert!(validate_material_id("abc-123").is_ok());
        assert!(validate_material_id("../x").is_err());
        assert!(validate_material_id("").is_err());
    }

    #[test]
    fn h264_probe_flags() {
        let json = r#"{"format":{"duration":"3.0","format_name":"mov,mp4"},"streams":[{"index":0,"codec_type":"video","codec_name":"h264","width":640,"height":360},{"index":1,"codec_type":"audio","codec_name":"aac","channels":2}]}"#;
        let probe = parse_probe(r"D:\a.mp4", json).unwrap();
        assert!(probe.video_compatible);
        assert!(!probe.needs_transcode);
    }

    #[test]
    fn hevc_probe_flags() {
        let json = r#"{"format":{"duration":"3.0","format_name":"mov,mp4"},"streams":[{"index":0,"codec_type":"video","codec_name":"hevc","width":640,"height":360},{"index":1,"codec_type":"audio","codec_name":"aac","channels":1}]}"#;
        let probe = parse_probe(r"D:\a.mp4", json).unwrap();
        assert!(!probe.video_compatible);
        assert!(probe.needs_transcode);
    }

    #[test]
    fn text_subtitle_codecs() {
        assert!(is_text_subtitle_codec("subrip"));
        assert!(is_text_subtitle_codec("ass"));
        assert!(is_text_subtitle_codec("mov_text"));
        assert!(is_text_subtitle_codec("webvtt"));
        assert!(!is_text_subtitle_codec("hdmv_pgs_subtitle"));
        assert!(!is_text_subtitle_codec("dvd_subtitle"));
        assert!(is_bitmap_subtitle_codec("hdmv_pgs_subtitle"));
        assert!(is_bitmap_subtitle_codec("dvd_subtitle"));
        assert!(!is_bitmap_subtitle_codec("subrip"));
    }
}
