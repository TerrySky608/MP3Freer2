use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
#[cfg(desktop)]
use tauri::Emitter;
use tauri::ipc::Channel;
// lofty 0.21：properties/primary_tag/first_tag 是 trait 方法，必须显式引入
// TaggedFileExt 提供 primary_tag/first_tag，AudioFile 提供 properties
// Accessor 提供 tag.title()/artist()/album()
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;
// tokio 的 AsyncWriteExt（不是 tokio_util::io::AsyncWriteExt）
use tokio::io::AsyncWriteExt;

/// Rust 端返回的音频元数据
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioMetadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: f64,
    pub file_name: String,
}

/// 从本地音频文件解析真实 ID3/Vorbis/FLAC 元数据
#[tauri::command]
pub fn read_audio_metadata(file_path: String) -> Result<AudioMetadata, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }

    let tagged_file = lofty::read_from_path(path).map_err(|e| {
        format!("无法读取音频元数据: {} ({})", e, file_path)
    })?;

    let properties = tagged_file.properties();
    let duration_secs = properties.duration().as_secs_f64();

    // 尝试从 tag 获取 title/artist/album
    let title = tagged_file
        .primary_tag()
        .and_then(|t| t.title().map(|s| s.to_string()))
        .or_else(|| {
            tagged_file
                .first_tag()
                .and_then(|t| t.title().map(|s| s.to_string()))
        })
        .unwrap_or_default();

    let artist = tagged_file
        .primary_tag()
        .and_then(|t| t.artist().map(|s| s.to_string()))
        .or_else(|| {
            tagged_file
                .first_tag()
                .and_then(|t| t.artist().map(|s| s.to_string()))
        })
        .unwrap_or_default();

    let album = tagged_file
        .primary_tag()
        .and_then(|t| t.album().map(|s| s.to_string()))
        .or_else(|| {
            tagged_file
                .first_tag()
                .and_then(|t| t.album().map(|s| s.to_string()))
        })
        .unwrap_or_default();

    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(AudioMetadata {
        title,
        artist,
        album,
        duration_secs,
        file_name,
    })
}

fn try_prepare_writable_dir(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".mp3terry_write_probe");
    match std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 获取当前平台（桌面端 / Android）默认歌曲下载目录，不存在时自动创建
#[tauri::command]
pub fn get_default_download_dir(app: AppHandle) -> Result<String, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(not(target_os = "android"))]
    {
        if let Ok(d) = app.path().download_dir() {
            candidates.push(d.join("MP3Terry"));
        }
        if let Ok(d) = app.path().audio_dir() {
            candidates.push(d.join("MP3Terry"));
        }
        if let Ok(d) = app.path().app_local_data_dir() {
            candidates.push(d.join("Downloads"));
        }
    }

    #[cfg(target_os = "android")]
    {
        if let Ok(d) = app.path().audio_dir() {
            candidates.push(d.join("MP3Terry"));
        }
        if let Ok(d) = app.path().download_dir() {
            candidates.push(d.join("MP3Terry"));
        }
        if let Ok(d) = app.path().app_data_dir() {
            candidates.push(d.join("MP3Terry_Downloads"));
        }
        if let Ok(d) = app.path().app_local_data_dir() {
            candidates.push(d.join("MP3Terry_Downloads"));
        }
    }

    for dir in candidates {
        if try_prepare_writable_dir(&dir) {
            return Ok(dir.to_string_lossy().to_string());
        }
    }

    Err("未能找到可用的默认下载目录".to_string())
}

/// 确保目标目录存在（不存在则递归创建）
#[tauri::command]
pub fn ensure_directory(dir_path: String) -> Result<String, String> {
    let trimmed = dir_path.trim();
    if trimmed.is_empty() {
        return Err("目录路径不能为空".to_string());
    }
    let path = Path::new(trimmed);
    std::fs::create_dir_all(path).map_err(|e| format!("创建目录失败 ({}): {}", trimmed, e))?;
    Ok(trimmed.to_string())
}

/// 检查指定文件是否存在（直接透传文件系统，兼容自定义盘符/Android私有目录）
#[tauri::command]
pub fn file_exists(file_path: String) -> bool {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return false;
    }
    Path::new(trimmed).exists()
}

/// 列出目录下支持的音频文件名列表（自动忽略非音频文件；目录不存在时返回空列表）
#[tauri::command]
pub fn list_audio_files_in_dir(dir_path: String) -> Result<Vec<String>, String> {
    let trimmed = dir_path.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let dir = Path::new(trimmed);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(dir).map_err(|e| format!("读取目录失败 ({}): {}", trimmed, e))?;
    let mut files: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            if matches!(ext_lower.as_str(), "mp3" | "flac" | "wav" | "ogg" | "m4a") {
                if let Some(name) = entry.file_name().to_str() {
                    files.push(name.to_string());
                }
            }
        }
    }
    Ok(files)
}

/// 写入文本文件（用于保存 .lrc 歌词到任意下载路径）
#[tauri::command]
pub fn save_text_file(file_path: String, content: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
    std::fs::write(path, content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))
}

/// 读取文本文件（用于从任意下载/本地路径读取 .lrc 歌词，避开 WebView fs:scope 权限限制）
#[tauri::command]
pub fn read_text_file(file_path: String) -> Result<String, String> {
    let bytes = std::fs::read(Path::new(&file_path))
        .map_err(|e| format!("读取文件失败: {}", e))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn detect_audio_extension(content_type: Option<&str>, url: &str, fallback_ext: &str) -> String {
    if let Some(ct) = content_type {
        let ct_lower = ct.to_lowercase();
        if ct_lower.contains("flac") {
            return "flac".to_string();
        }
        if ct_lower.contains("mp4") || ct_lower.contains("m4a") || ct_lower.contains("aac") {
            return "m4a".to_string();
        }
        if ct_lower.contains("ogg") {
            return "ogg".to_string();
        }
        if ct_lower.contains("wav") {
            return "wav".to_string();
        }
        if ct_lower.contains("mpeg") || ct_lower.contains("mp3") {
            return "mp3".to_string();
        }
    }

    let url_path = url.split('?').next().unwrap_or(url).to_lowercase();
    for ext in ["flac", "m4a", "ogg", "wav", "mp3"] {
        if url_path.ends_with(&format!(".{}", ext)) {
            return ext.to_string();
        }
    }

    fallback_ext.to_string()
}

/// 带进度回调的文件下载命令：
/// 支持自动创建父目录、识别音频格式后缀、写临时文件校验大小，避免留下 0KB 或 HTML 损坏文件。
/// 返回最终写入的文件路径。
#[tauri::command]
pub async fn download_file(
    url: String,
    dest_path: String,
    on_progress: Channel<f64>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建下载客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("服务器返回状态码: {}", response.status()));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Some(ref ct) = content_type {
        let ct_lower = ct.to_lowercase();
        if ct_lower.contains("text/html") || ct_lower.contains("application/json") || ct_lower.contains("text/plain") {
            return Err(format!("目标链接返回非音频内容 ({})", ct));
        }
    }

    let orig_path = Path::new(&dest_path);
    let fallback_ext = orig_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3");
    let final_ext = detect_audio_extension(content_type.as_deref(), &url, fallback_ext);
    let final_path = orig_path.with_extension(&final_ext);
    let final_path_str = final_path.to_string_lossy().to_string();

    // 创建目标文件的父目录
    if let Some(parent) = final_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let temp_path = final_path.with_extension(format!("{}.part", final_ext));
    let total_size = response.content_length().unwrap_or(0);
    let downloaded = Arc::new(AtomicU64::new(0));

    let write_res: Result<u64, String> = async {
        let mut file = tokio::fs::File::create(&temp_path)
            .await
            .map_err(|e| format!("创建临时文件失败: {}", e))?;

        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;
        let mut first_chunk_checked = false;
        let mut total_bytes: u64 = 0;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("下载流错误: {}", e))?;
            if !first_chunk_checked && !chunk.is_empty() {
                first_chunk_checked = true;
                let prefix = String::from_utf8_lossy(&chunk[..chunk.len().min(64)]).trim_start().to_lowercase();
                if prefix.starts_with("<!doctype") || prefix.starts_with("<html") || prefix.starts_with("{\"code\"") {
                    return Err("返回内容为网页或接口错误，非有效音频流".to_string());
                }
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("写入文件失败: {}", e))?;
            let chunk_len = chunk.len() as u64;
            total_bytes += chunk_len;

            if total_size > 0 {
                let bytes_downloaded = downloaded.fetch_add(chunk_len, Ordering::Relaxed) + chunk_len;
                let progress = (bytes_downloaded as f64 / total_size as f64) * 100.0;
                let _ = on_progress.send(progress);
            }
        }

        file.flush().await.map_err(|e| format!("flush 失败: {}", e))?;
        file.shutdown().await.ok();
        Ok(total_bytes)
    }
    .await;

    match write_res {
        Ok(bytes) if bytes >= 1024 => {
            if final_path.exists() {
                let _ = tokio::fs::remove_file(&final_path).await;
            }
            tokio::fs::rename(&temp_path, &final_path)
                .await
                .map_err(|e| format!("保存目标文件失败: {}", e))?;
            let _ = on_progress.send(100.0);
            Ok(final_path_str)
        }
        Ok(bytes) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            Err(format!("下载文件内容过小 ({} 字节)，可能已失效", bytes))
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            Err(e)
        }
    }
}

/// 切换桌面悬浮歌词窗口的显示/隐藏
/// 返回切换后的可见状态（true=可见）
/// Android / iOS 无第二窗口，直接返回 false。
#[tauri::command]
pub fn toggle_lyric_overlay(app: AppHandle) -> Result<bool, String> {
    #[cfg(mobile)]
    {
        let _ = app;
        return Ok(false);
    }

    #[cfg(desktop)]
    {
        let overlay = app
            .get_webview_window("lyric-overlay")
            .ok_or_else(|| "桌面歌词窗口未找到".to_string())?;

        let now_visible = overlay.is_visible().unwrap_or(false);
        if now_visible {
            overlay
                .hide()
                .map_err(|e| format!("隐藏歌词窗口失败: {}", e))?;
            Ok(false)
        } else {
            overlay
                .show()
                .map_err(|e| format!("显示歌词窗口失败: {}", e))?;
            overlay
                .set_focus()
                .map_err(|e| format!("聚焦歌词窗口失败: {}", e))?;
            let _ = app.emit("overlay-visibility", true);
            Ok(true)
        }
    }
}

#[cfg(desktop)]
static OVERLAY_LOCKED: AtomicBool = AtomicBool::new(false);

/// 设置桌面悬浮歌词窗口的鼠标穿透（锁定）状态
#[tauri::command]
pub fn set_lyric_overlay_lock(app: AppHandle, locked: bool) -> Result<bool, String> {
    #[cfg(mobile)]
    {
        let _ = (app, locked);
        return Ok(false);
    }

    #[cfg(desktop)]
    {
        let overlay = app
            .get_webview_window("lyric-overlay")
            .ok_or_else(|| "桌面歌词窗口未找到".to_string())?;

        overlay
            .set_ignore_cursor_events(locked)
            .map_err(|e| format!("设置鼠标穿透失败: {}", e))?;

        // 强化置顶：确保在穿透与非穿透切换时始终维持在最顶层，防止被系统任务栏覆盖
        let _ = overlay.set_always_on_top(true);

        OVERLAY_LOCKED.store(locked, Ordering::SeqCst);
        let _ = app.emit("overlay-lock-state", locked);
        Ok(locked)
    }
}

/// 切换桌面悬浮歌词窗口的锁定/解锁状态（穿透切换）
#[tauri::command]
pub fn toggle_lyric_overlay_lock(app: AppHandle) -> Result<bool, String> {
    #[cfg(mobile)]
    {
        let _ = app;
        return Ok(false);
    }

    #[cfg(desktop)]
    {
        let current = OVERLAY_LOCKED.load(Ordering::SeqCst);
        let next = !current;
        set_lyric_overlay_lock(app, next)
    }
}
