//! Whisper model catalog, resumable download with checksum verification, and local import.

use crate::jobs::{is_cancelled, CANCELLED};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub file: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// English-only ggml models published in ggerganov/whisper.cpp on Hugging Face.
pub const CATALOG: &[ModelSpec] = &[
    ModelSpec {
        id: "tiny.en",
        label: "tiny.en（约 74 MB，最快）",
        file: "ggml-tiny.en.bin",
        size: 77_704_715,
        sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
    },
    ModelSpec {
        id: "base.en",
        label: "base.en（约 141 MB，推荐）",
        file: "ggml-base.en.bin",
        size: 147_964_211,
        sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    },
    ModelSpec {
        id: "small.en",
        label: "small.en（约 465 MB，更准但更慢）",
        file: "ggml-small.en.bin",
        size: 487_614_201,
        sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
    },
];

const LOCAL_PREFIX: &str = "local:";
const LOCAL_DIR: &str = "local";
/// Placeholder for the model file name in a download URL template.
pub const FILE_PLACEHOLDER: &str = "{file}";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: String,
    pub label: String,
    pub size_bytes: u64,
    pub downloaded_bytes: u64,
    pub installed: bool,
}

fn catalog_status(dir: &Path, spec: &ModelSpec) -> ModelStatus {
    let installed = dir.join(spec.file).is_file();
    let partial = fs::metadata(part_path(dir, spec))
        .map(|m| m.len())
        .unwrap_or(0);
    ModelStatus {
        id: spec.id.into(),
        label: spec.label.into(),
        size_bytes: spec.size,
        downloaded_bytes: if installed { spec.size } else { partial },
        installed,
    }
}

fn local_status(path: &Path) -> Option<ModelStatus> {
    let name = path.file_name()?.to_str()?;
    if !name.ends_with(".bin") {
        return None;
    }
    let size = fs::metadata(path).ok()?.len();
    Some(ModelStatus {
        id: format!("{LOCAL_PREFIX}{name}"),
        label: format!("本地导入：{name}"),
        size_bytes: size,
        downloaded_bytes: size,
        installed: true,
    })
}

pub fn list(dir: &Path) -> Vec<ModelStatus> {
    let mut models: Vec<ModelStatus> = CATALOG.iter().map(|s| catalog_status(dir, s)).collect();
    if let Ok(entries) = fs::read_dir(dir.join(LOCAL_DIR)) {
        let mut local: Vec<ModelStatus> = entries
            .flatten()
            .filter_map(|e| local_status(&e.path()))
            .collect();
        local.sort_by(|a, b| a.id.cmp(&b.id));
        models.extend(local);
    }
    models
}

pub fn find_spec(id: &str) -> Result<&'static ModelSpec, String> {
    CATALOG
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("未知模型：{id}"))
}

fn is_plain_file_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\']) && name != "." && name != ".."
}

/// Path of an installed (verified) model, or an error telling the user what to do.
pub fn installed_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    let path = match id.strip_prefix(LOCAL_PREFIX) {
        Some(name) if is_plain_file_name(name) => dir.join(LOCAL_DIR).join(name),
        Some(_) => return Err("模型名称无效。".into()),
        None => dir.join(find_spec(id)?.file),
    };
    if path.is_file() {
        Ok(path)
    } else {
        Err("识别模型还没有下载，请先在识别设置中下载或导入模型。".into())
    }
}

/// Expands a download URL template such as `https://host/.../resolve/main/{file}`.
pub fn model_url(template: &str, spec: &ModelSpec) -> Result<String, String> {
    let template = template.trim();
    if !(template.starts_with("https://") || template.starts_with("http://")) {
        return Err("下载地址需要以 https:// 或 http:// 开头。".into());
    }
    if !template.contains(FILE_PLACEHOLDER) {
        return Err("下载地址需要包含 {file}，下载时会替换成模型文件名。".into());
    }
    Ok(template.replace(FILE_PLACEHOLDER, spec.file))
}

fn part_path(dir: &Path, spec: &ModelSpec) -> PathBuf {
    dir.join(format!("{}.part", spec.file))
}

pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// Downloads `spec` into `dir`, resuming a previous partial file when the server supports
/// HTTP Range. The model only appears under its final name after size and SHA-256 match.
pub fn download(
    url: &str,
    spec: &ModelSpec,
    dir: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("无法创建模型目录：{e}"))?;
    let part = part_path(dir, spec);
    let mut offset = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if offset > spec.size {
        fs::remove_file(&part).map_err(|e| format!("无法清理下载文件：{e}"))?;
        offset = 0;
    }
    if offset < spec.size {
        fetch(url, &part, offset, spec.size, cancel, &mut progress)?;
    }
    install_verified(&part, &dir.join(spec.file), spec)
}

fn fetch(
    url: &str,
    part: &Path,
    offset: u64,
    total: u64,
    cancel: &AtomicBool,
    progress: &mut impl FnMut(u64, u64),
) -> Result<(), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(30))
        .build();
    let mut request = agent.get(url);
    if offset > 0 {
        request = request.set("Range", &format!("bytes={offset}-"));
    }
    let response = request.call().map_err(|e| format!("下载失败：{e}"))?;
    let resumed = offset > 0 && response.status() == 206;
    if resumed && !content_range_starts_at(response.header("Content-Range"), offset) {
        return Err("服务器返回的续传范围不正确，请稍后重试。".into());
    }
    let mut file = if resumed {
        OpenOptions::new().append(true).open(part)
    } else {
        File::create(part)
    }
    .map_err(|e| format!("无法写入模型文件：{e}"))?;
    let mut done = if resumed { offset } else { 0 };
    let mut reader = response.into_reader();
    let mut buffer = vec![0u8; 256 * 1024];
    progress(done, total);
    loop {
        if is_cancelled(cancel) {
            return Err(CANCELLED.into());
        }
        let read = reader.read(&mut buffer).map_err(|e| interrupted(done, e))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("无法写入模型文件：{e}"))?;
        done += read as u64;
        progress(done, total);
    }
    file.sync_all()
        .map_err(|e| format!("无法写入模型文件：{e}"))?;
    if done < total {
        return Err(interrupted(done, "连接提前结束"));
    }
    Ok(())
}

fn interrupted(done: u64, reason: impl std::fmt::Display) -> String {
    format!(
        "下载中断（{reason}），已保存 {:.1} MB。再次下载会从断点继续。",
        done as f64 / 1_048_576.0
    )
}

fn content_range_starts_at(header: Option<&str>, offset: u64) -> bool {
    header
        .and_then(|h| h.strip_prefix("bytes "))
        .and_then(|h| h.split('-').next())
        .and_then(|start| start.trim().parse::<u64>().ok())
        == Some(offset)
}

fn install_verified(part: &Path, target: &Path, spec: &ModelSpec) -> Result<(), String> {
    let size = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    let valid = size == spec.size
        && sha256_file(part).map_err(|e| format!("无法读取模型文件：{e}"))? == spec.sha256;
    if !valid {
        let _ = fs::remove_file(part);
        return Err(
            "模型校验失败（大小或 SHA-256 不符），没有启用。已删除下载文件，请重新下载或更换镜像。"
                .into(),
        );
    }
    fs::rename(part, target).map_err(|e| format!("无法启用模型：{e}"))
}

fn sanitized_file_name(source: &Path) -> String {
    let name: String = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("model.bin")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    if name.ends_with(".bin") {
        name
    } else {
        format!("{name}.bin")
    }
}

/// Copies a model file the user already has into `dir`. A file matching a catalog checksum
/// becomes that catalog model; any other file must pass `load_test` before it is enabled.
pub fn import(
    source: &Path,
    dir: &Path,
    catalog: &[ModelSpec],
    load_test: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<ModelStatus, String> {
    let hash = sha256_file(source).map_err(|e| format!("无法读取所选文件：{e}"))?;
    if let Some(spec) = catalog.iter().find(|s| s.sha256 == hash) {
        copy_then_rename(source, &dir.join(spec.file))?;
        return Ok(catalog_status(dir, spec));
    }
    let target = dir.join(LOCAL_DIR).join(sanitized_file_name(source));
    let staging = target.with_extension("importing");
    copy_to(source, &staging)?;
    if let Err(error) = load_test(&staging) {
        let _ = fs::remove_file(&staging);
        return Err(format!("所选文件不是可用的 whisper 模型：{error}"));
    }
    fs::rename(&staging, &target).map_err(|e| format!("无法启用模型：{e}"))?;
    local_status(&target).ok_or_else(|| "无法启用模型。".into())
}

fn copy_to(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建模型目录：{e}"))?;
    }
    fs::copy(source, destination)
        .map(|_| ())
        .map_err(|e| format!("无法复制模型文件：{e}"))
}

fn copy_then_rename(source: &Path, target: &Path) -> Result<(), String> {
    let staging = target.with_extension("importing");
    copy_to(source, &staging)?;
    fs::rename(&staging, target).map_err(|e| format!("无法启用模型：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// The frontend's default download source (ModelScope).
    const DEFAULT_URL_TEMPLATE: &str =
        "https://www.modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/{file}";

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("attune-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn body() -> Vec<u8> {
        (0..300_000u32).map(|i| (i % 251) as u8).collect()
    }

    fn spec_for(body: &[u8]) -> ModelSpec {
        let sha = format!("{:x}", Sha256::digest(body));
        ModelSpec {
            id: "test",
            label: "test",
            file: "ggml-test.bin",
            size: body.len() as u64,
            sha256: Box::leak(sha.into_boxed_str()),
        }
    }

    #[derive(Clone, Copy)]
    enum Behaviour {
        /// Honour Range; the first response is cut off after this many bytes.
        CutFirstAt(usize),
        /// Ignore Range and always send the full body with 200.
        IgnoreRange,
    }

    /// Minimal HTTP/1.1 file server. Returns its URL and the Range start of every request.
    fn serve(body: Vec<u8>, behaviour: Behaviour) -> (String, Arc<Mutex<Vec<Option<usize>>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model.bin", listener.local_addr().unwrap());
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let seen = ranges.clone();
        thread::spawn(move || {
            for (index, stream) in listener.incoming().enumerate() {
                let mut stream = stream.unwrap();
                let mut reader = io::BufReader::new(stream.try_clone().unwrap());
                let mut range = None;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line.trim().is_empty() {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        range = value.trim().trim_end_matches('-').parse::<usize>().ok();
                    }
                }
                seen.lock().unwrap().push(range);
                let start = match behaviour {
                    Behaviour::IgnoreRange => 0,
                    Behaviour::CutFirstAt(_) => range.unwrap_or(0),
                };
                let head = if start > 0 {
                    format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{}/{}\r\nConnection: close\r\n\r\n",
                        body.len() - start,
                        body.len() - 1,
                        body.len()
                    )
                } else {
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                };
                stream.write_all(head.as_bytes()).unwrap();
                let end = match behaviour {
                    Behaviour::CutFirstAt(cut) if index == 0 => cut.min(body.len()),
                    _ => body.len(),
                };
                let _ = stream.write_all(&body[start..end]);
            }
        });
        (url, ranges)
    }

    #[test]
    fn resumes_an_interrupted_download_and_enables_it_after_verification() {
        let dir = TempDir::new("resume");
        let data = body();
        let spec = spec_for(&data);
        let (url, ranges) = serve(data.clone(), Behaviour::CutFirstAt(100_000));
        let cancel = AtomicBool::new(false);

        let first = download(&url, &spec, &dir.0, &cancel, |_, _| {});
        assert!(first.unwrap_err().contains("断点"));
        assert_eq!(
            fs::metadata(part_path(&dir.0, &spec)).unwrap().len(),
            100_000
        );
        assert!(!dir.0.join(spec.file).exists());

        let mut last = (0, 0);
        download(&url, &spec, &dir.0, &cancel, |done, total| {
            last = (done, total)
        })
        .unwrap();
        assert_eq!(*ranges.lock().unwrap(), vec![None, Some(100_000)]);
        assert_eq!(last, (data.len() as u64, data.len() as u64));
        assert_eq!(fs::read(dir.0.join(spec.file)).unwrap(), data);
        assert!(!part_path(&dir.0, &spec).exists());
    }

    #[test]
    fn restarts_from_zero_when_the_server_ignores_range() {
        let dir = TempDir::new("norange");
        let data = body();
        let spec = spec_for(&data);
        fs::write(part_path(&dir.0, &spec), &data[..5_000]).unwrap();
        let (url, _) = serve(data.clone(), Behaviour::IgnoreRange);
        download(&url, &spec, &dir.0, &AtomicBool::new(false), |_, _| {}).unwrap();
        assert_eq!(fs::read(dir.0.join(spec.file)).unwrap(), data);
    }

    #[test]
    fn refuses_to_enable_a_model_with_the_wrong_checksum() {
        let dir = TempDir::new("checksum");
        let data = body();
        let mut spec = spec_for(&data);
        spec.sha256 = "0000000000000000000000000000000000000000000000000000000000000000";
        let (url, _) = serve(data, Behaviour::CutFirstAt(usize::MAX));
        let error = download(&url, &spec, &dir.0, &AtomicBool::new(false), |_, _| {});
        assert!(error.unwrap_err().contains("校验失败"));
        assert!(!dir.0.join(spec.file).exists());
        assert!(!part_path(&dir.0, &spec).exists());
    }

    #[test]
    fn cancelling_keeps_the_partial_file_for_later() {
        let dir = TempDir::new("cancel");
        let data = body();
        let spec = spec_for(&data);
        let (url, _) = serve(data, Behaviour::CutFirstAt(usize::MAX));
        let error = download(&url, &spec, &dir.0, &AtomicBool::new(true), |_, _| {});
        assert_eq!(error.unwrap_err(), CANCELLED);
        assert!(!dir.0.join(spec.file).exists());
    }

    #[test]
    fn imports_a_file_matching_the_catalog_as_that_model() {
        let dir = TempDir::new("import-known");
        let data = body();
        let source = dir.0.join("download.bin");
        fs::write(&source, &data).unwrap();
        let catalog = [spec_for(&data)];
        let models = dir.0.join("models");
        let status = import(&source, &models, &catalog, |_| panic!("not needed")).unwrap();
        assert_eq!(status.id, "test");
        assert!(status.installed);
        assert_eq!(fs::read(models.join("ggml-test.bin")).unwrap(), data);
    }

    #[test]
    fn imports_an_unknown_file_only_when_it_loads() {
        let dir = TempDir::new("import-unknown");
        let source = dir.0.join("my model.bin");
        fs::write(&source, b"not a model").unwrap();
        let models = dir.0.join("models");

        let rejected = import(&source, &models, CATALOG, |_| Err("bad magic".into()));
        assert!(rejected.unwrap_err().contains("bad magic"));
        assert_eq!(list(&models).len(), CATALOG.len());

        let accepted = import(&source, &models, CATALOG, |_| Ok(())).unwrap();
        assert_eq!(accepted.id, "local:my_model.bin");
        assert!(installed_path(&models, "local:my_model.bin").is_ok());
        assert!(installed_path(&models, "local:../secret.bin").is_err());
    }

    #[test]
    fn expands_url_templates() {
        let spec = find_spec("base.en").unwrap();
        assert_eq!(
            model_url(DEFAULT_URL_TEMPLATE, spec).unwrap(),
            "https://www.modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/ggml-base.en.bin"
        );
        assert_eq!(
            model_url(
                " https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file} ",
                spec
            )
            .unwrap(),
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
        );
        assert!(model_url("https://hf-mirror.com", spec)
            .unwrap_err()
            .contains("{file}"));
        assert!(model_url("ftp://example.com/{file}", spec).is_err());
    }

    /// Real network check: `ATTUNE_MODELS_DIR=... cargo test -- --ignored real_download`.
    /// Cancels the first attempt after `ATTUNE_CANCEL_AFTER_SECS` (default 8), then resumes it.
    #[test]
    #[ignore]
    fn real_download_resumes_from_the_mirror() {
        let dir = PathBuf::from(std::env::var("ATTUNE_MODELS_DIR").unwrap());
        let template = std::env::var("ATTUNE_MODEL_URL").unwrap_or(DEFAULT_URL_TEMPLATE.into());
        let model = std::env::var("ATTUNE_REAL_MODEL").unwrap_or("tiny.en".into());
        let spec = find_spec(&model).unwrap();
        let url = model_url(&template, spec).unwrap();
        println!("downloading {url}");
        let cancel_after =
            std::env::var("ATTUNE_CANCEL_AFTER_SECS").map_or(8, |s| s.parse().unwrap());
        let cancel = Arc::new(AtomicBool::new(false));
        let timer = cancel.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(cancel_after));
            timer.store(true, std::sync::atomic::Ordering::Relaxed);
        });
        assert_eq!(
            download(&url, spec, &dir, &cancel, |_, _| {}).unwrap_err(),
            CANCELLED
        );
        let partial = fs::metadata(part_path(&dir, spec)).unwrap().len();
        println!("cancelled with {partial} bytes on disk");
        assert!(partial > 0 && partial < spec.size);

        let mut first_progress = None;
        download(&url, spec, &dir, &AtomicBool::new(false), |done, _| {
            first_progress.get_or_insert(done);
        })
        .unwrap();
        println!("resumed from {first_progress:?}");
        assert_eq!(first_progress, Some(partial));
        assert!(installed_path(&dir, spec.id).is_ok());
    }
}
