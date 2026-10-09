#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod jobs;
mod models;
mod transcribe;

use jobs::JobSlot;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct Jobs {
    download: JobSlot,
    recognition: JobSlot,
    /// Samples arrive in several small IPC calls; one large payload crashes the WebView.
    pending_audio: Mutex<Vec<f32>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress<'a> {
    model_id: &'a str,
    downloaded_bytes: u64,
    total_bytes: u64,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("models"))
        .map_err(|e| format!("无法定位应用数据目录：{e}"))
}

async fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("后台任务异常结束：{e}"))?
}

#[tauri::command]
fn list_models(app: AppHandle) -> Result<Vec<models::ModelStatus>, String> {
    Ok(models::list(&models_dir(&app)?))
}

#[tauri::command]
async fn download_model(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    model_id: String,
    mirror: String,
) -> Result<(), String> {
    let job = jobs
        .download
        .start("已有模型正在下载，请等待完成或先取消。")?;
    let spec = models::find_spec(&model_id)?;
    let url = models::model_url(&mirror, spec)?;
    let dir = models_dir(&app)?;
    let cancel = job.cancel.clone();
    run_blocking(move || {
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        models::download(
            &url,
            spec,
            &dir,
            &cancel,
            |downloaded_bytes, total_bytes| {
                let finished = downloaded_bytes >= total_bytes;
                if finished || last_emit.elapsed() >= Duration::from_millis(200) {
                    last_emit = Instant::now();
                    let progress = DownloadProgress {
                        model_id: spec.id,
                        downloaded_bytes,
                        total_bytes,
                    };
                    let _ = app.emit("model-download-progress", progress);
                }
            },
        )
    })
    .await
}

#[tauri::command]
fn cancel_download(jobs: State<'_, Jobs>) {
    jobs.download.cancel();
}

#[tauri::command]
async fn import_model(app: AppHandle, path: String) -> Result<models::ModelStatus, String> {
    let dir = models_dir(&app)?;
    run_blocking(move || {
        models::import(
            Path::new(&path),
            &dir,
            models::CATALOG,
            transcribe::load_test,
        )
    })
    .await
}

fn pending_audio<'a>(jobs: &'a Jobs) -> Result<std::sync::MutexGuard<'a, Vec<f32>>, String> {
    jobs.pending_audio
        .lock()
        .map_err(|_| "音频缓存不可用，请重启应用。".to_string())
}

#[tauri::command]
fn clear_audio(jobs: State<'_, Jobs>) -> Result<(), String> {
    pending_audio(&jobs)?.clear();
    Ok(())
}

/// Body: a chunk of 16 kHz mono f32 little-endian samples.
#[tauri::command]
fn append_audio(jobs: State<'_, Jobs>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("音频数据无效，请重新导入音频。".into());
    };
    let samples = transcribe::samples_from_le_bytes(bytes)?;
    pending_audio(&jobs)?.extend(samples);
    Ok(())
}

/// Recognizes the samples sent with `append_audio`.
#[tauri::command]
async fn recognize(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    model_id: String,
) -> Result<Vec<transcribe::Sentence>, String> {
    let job = jobs
        .recognition
        .start("已有识别任务在进行，请等待完成或先取消。")?;
    let samples = std::mem::take(&mut *pending_audio(&jobs)?);
    if samples.is_empty() {
        // `cancel_recognition` discards the audio when it arrives before recognition starts.
        return Err(jobs::CANCELLED.into());
    }
    let model = models::installed_path(&models_dir(&app)?, &model_id)?;
    let cancel = job.cancel.clone();
    run_blocking(move || {
        transcribe::transcribe(&model, &samples, cancel, move |percent| {
            let _ = app.emit("recognition-progress", percent);
        })
    })
    .await
}

#[tauri::command]
fn cancel_recognition(jobs: State<'_, Jobs>) -> Result<(), String> {
    jobs.recognition.cancel();
    pending_audio(&jobs)?.clear();
    Ok(())
}

fn main() {
    whisper_rs::install_logging_hooks();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Jobs::default())
        .invoke_handler(tauri::generate_handler![
            list_models,
            download_model,
            cancel_download,
            import_model,
            clear_audio,
            append_audio,
            recognize,
            cancel_recognition
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Attune");
}
