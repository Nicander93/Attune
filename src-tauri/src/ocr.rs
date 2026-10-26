//! Subtitle OCR backends for burned-in / bitmap cues (P4).
//!
//! Default: Windows.Media.Ocr (WinRT) — zero installer delta beyond the OS language pack.
//! Optional ONNX/RapidOCR pack is gated by `ATTUNE_OCR_BACKEND=onnx` and is not shipped here.

use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    pub available: bool,
    pub backend: String,
    pub languages: Vec<String>,
    pub preferred_language: Option<String>,
    pub hint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OcrBackendKind {
    WinRt,
    /// Scaffold only — returns a clear error until an enhancement pack is installed.
    OnnxPack,
}

pub fn resolve_backend() -> OcrBackendKind {
    match std::env::var("ATTUNE_OCR_BACKEND")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "onnx" | "rapidocr" | "onnx-pack" => OcrBackendKind::OnnxPack,
        _ => OcrBackendKind::WinRt,
    }
}

pub fn backend_label(kind: &OcrBackendKind) -> &'static str {
    match kind {
        OcrBackendKind::WinRt => "winrt",
        OcrBackendKind::OnnxPack => "onnx",
    }
}

pub fn ocr_status() -> OcrStatus {
    match resolve_backend() {
        OcrBackendKind::OnnxPack => OcrStatus {
            available: false,
            backend: "onnx".into(),
            languages: vec![],
            preferred_language: None,
            hint: "ONNX/RapidOCR enhancement pack is not shipped in this build. Unset ATTUNE_OCR_BACKEND to use WinRT.".into(),
        },
        OcrBackendKind::WinRt => winrt_status(),
    }
}

pub fn recognize_image_file(path: &Path) -> Result<String, String> {
    match resolve_backend() {
        OcrBackendKind::OnnxPack => Err(
            "ONNX/RapidOCR pack is not installed. Unset ATTUNE_OCR_BACKEND or install the optional pack."
                .into(),
        ),
        OcrBackendKind::WinRt => winrt_recognize_file(path),
    }
}

/// Collapse timed OCR samples into clip-relative subtitle cues.
pub fn merge_ocr_samples(samples: &[(f64, String)], clip_duration: f64) -> Vec<(f64, f64, String)> {
    let mut cues: Vec<(f64, f64, String)> = Vec::new();
    for &(t, ref raw) in samples {
        let text = normalize_ocr_text(raw);
        if text.is_empty() {
            continue;
        }
        let t = t.clamp(0.0, clip_duration);
        if let Some(last) = cues.last_mut() {
            if same_ocr_text(&last.2, &text) && t - last.1 <= 1.25 {
                last.1 = (t + 0.4).min(clip_duration);
                continue;
            }
            // Close previous cue before starting a new one.
            if t > last.1 {
                last.1 = t.min(clip_duration);
            }
        }
        let end = (t + 0.8).min(clip_duration);
        cues.push((t, end.max(t + 0.2), text));
    }
    if let Some(last) = cues.last_mut() {
        if last.1 <= last.0 {
            last.1 = (last.0 + 0.4).min(clip_duration);
        }
    }
    cues
        .into_iter()
        .filter(|(s, e, _)| e - s >= 0.15)
        .collect()
}

pub fn normalize_ocr_text(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn same_ocr_text(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

#[cfg(windows)]
fn winrt_status() -> OcrStatus {
    match winrt_list_languages() {
        Ok((langs, preferred)) => {
            let available = !langs.is_empty() && preferred.is_some();
            let hint = if available {
                "Windows.Media.Ocr ready (OS language pack).".into()
            } else if langs.is_empty() {
                "No OCR language packs installed. Add English (or another) OCR pack in Windows Language settings.".into()
            } else {
                "OCR packs found but engine could not start. Check Windows Language → OCR.".into()
            };
            OcrStatus {
                available,
                backend: "winrt".into(),
                languages: langs,
                preferred_language: preferred,
                hint,
            }
        }
        Err(err) => OcrStatus {
            available: false,
            backend: "winrt".into(),
            languages: vec![],
            preferred_language: None,
            hint: format!("WinRT OCR unavailable: {err}"),
        },
    }
}

#[cfg(not(windows))]
fn winrt_status() -> OcrStatus {
    OcrStatus {
        available: false,
        backend: "winrt".into(),
        languages: vec![],
        preferred_language: None,
        hint: "Windows.Media.Ocr is only available on Windows.".into(),
    }
}

#[cfg(windows)]
fn winrt_list_languages() -> Result<(Vec<String>, Option<String>), String> {
    use windows::Media::Ocr::OcrEngine;

    let langs = OcrEngine::AvailableRecognizerLanguages()
        .map_err(|e| format!("AvailableRecognizerLanguages: {e}"))?;
    let mut tags = Vec::new();
    let count = langs.Size().map_err(|e| e.to_string())?;
    for i in 0..count {
        let lang = langs.GetAt(i).map_err(|e| e.to_string())?;
        let tag = lang.LanguageTag().map_err(|e| e.to_string())?.to_string();
        tags.push(tag);
    }

    let preferred = prefer_engine_language(&tags)?;
    Ok((tags, preferred))
}

#[cfg(windows)]
fn prefer_engine_language(tags: &[String]) -> Result<Option<String>, String> {
    use windows::Globalization::Language;
    use windows::Media::Ocr::OcrEngine;
    use windows::core::HSTRING;

    // Prefer English for Attune; fall back to any pack that can create an engine.
    let mut candidates: Vec<String> = tags
        .iter()
        .filter(|t| t.to_ascii_lowercase().starts_with("en"))
        .cloned()
        .collect();
    for tag in tags {
        if !candidates.iter().any(|c| c == tag) {
            candidates.push(tag.clone());
        }
    }

    for tag in candidates {
        let lang = match Language::CreateLanguage(&HSTRING::from(tag.as_str())) {
            Ok(l) => l,
            Err(_) => continue,
        };
        if OcrEngine::IsLanguageSupported(&lang).unwrap_or(false)
            && OcrEngine::TryCreateFromLanguage(&lang).is_ok()
        {
            return Ok(Some(tag));
        }
    }

    if OcrEngine::TryCreateFromUserProfileLanguages().is_ok() {
        return Ok(tags.first().cloned());
    }
    Ok(None)
}

#[cfg(windows)]
fn winrt_recognize_file(path: &Path) -> Result<String, String> {
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapDecoder, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::{FileAccessMode, StorageFile};
    use windows::core::HSTRING;

    if !path.is_file() {
        return Err(format!("OCR image not found: {}", path.display()));
    }
    let path_str = path
        .canonicalize()
        .map_err(|e| format!("canonicalize OCR image: {e}"))?
        .to_string_lossy()
        .to_string();
    // StorageFile wants a normal path; strip the extended \\?\ prefix when present.
    let path_str = path_str
        .strip_prefix(r"\\?\")
        .unwrap_or(path_str.as_str())
        .to_string();

    let status = winrt_status();
    if !status.available {
        return Err(status.hint);
    }
    let tag = status
        .preferred_language
        .ok_or_else(|| "No OCR language available".to_string())?;

    let lang = Language::CreateLanguage(&HSTRING::from(tag.as_str()))
        .map_err(|e| format!("CreateLanguage: {e}"))?;
    let engine = OcrEngine::TryCreateFromLanguage(&lang).map_err(|e| {
        format!("Could not create OcrEngine for {tag}: {e}. Install the OCR language pack.")
    })?;

    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path_str.as_str()))
        .map_err(|e| format!("GetFileFromPathAsync: {e}"))?
        .join()
        .map_err(|e| format!("GetFileFromPathAsync.join: {e}"))?;
    let stream = file
        .OpenAsync(FileAccessMode::Read)
        .map_err(|e| format!("OpenAsync: {e}"))?
        .join()
        .map_err(|e| format!("OpenAsync.join: {e}"))?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|e| format!("BitmapDecoder::CreateAsync: {e}"))?
        .join()
        .map_err(|e| format!("BitmapDecoder.join: {e}"))?;
    let bitmap: SoftwareBitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| format!("GetSoftwareBitmapAsync: {e}"))?
        .join()
        .map_err(|e| format!("GetSoftwareBitmapAsync.join: {e}"))?;

    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("RecognizeAsync: {e}"))?
        .join()
        .map_err(|e| format!("RecognizeAsync.join: {e}"))?;
    let text = result.Text().map_err(|e| format!("OcrResult.Text: {e}"))?;
    // Yield so callers sampling many frames do not starve the UI thread excessively.
    std::thread::sleep(Duration::from_millis(1));
    Ok(text.to_string())
}

#[cfg(not(windows))]
fn winrt_recognize_file(_path: &Path) -> Result<String, String> {
    Err("Windows.Media.Ocr is only available on Windows.".into())
}


#[tauri::command]
pub fn ocr_status_cmd() -> OcrStatus {
    ocr_status()
}

#[tauri::command]
pub fn ocr_recognize_image(path: String) -> Result<String, String> {
    recognize_image_file(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_stable_text_across_nearby_samples() {
        let samples = vec![
            (0.0, "HELLO WORLD".into()),
            (0.5, "hello world".into()),
            (1.0, "hello world".into()),
            (2.5, "NEXT LINE".into()),
        ];
        let cues = merge_ocr_samples(&samples, 5.0);
        assert_eq!(cues.len(), 2);
        assert!(cues[0].2.eq_ignore_ascii_case("HELLO WORLD"));
        assert!(cues[1].2.eq_ignore_ascii_case("NEXT LINE"));
    }

    #[test]
    fn drops_empty_samples() {
        let cues = merge_ocr_samples(&[(0.0, "  ".into()), (1.0, "Hi".into())], 3.0);
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].2, "Hi");
    }

    #[test]
    fn backend_defaults_to_winrt() {
        // Do not assert env-dependent onnx branch in unit tests.
        let _ = resolve_backend();
        assert_eq!(backend_label(&OcrBackendKind::WinRt), "winrt");
        assert_eq!(backend_label(&OcrBackendKind::OnnxPack), "onnx");
    }
}
