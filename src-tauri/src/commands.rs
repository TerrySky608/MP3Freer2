use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::{Emitter, Manager};
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

/// 带进度回调的文件下载命令
#[tauri::command]
pub async fn download_file(
    url: String,
    dest_path: String,
    on_progress: Channel<f64>,
) -> Result<(), String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("下载请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("服务器返回状态码: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let downloaded = Arc::new(AtomicU64::new(0));

    // 创建目标文件的父目录
    if let Some(parent) = Path::new(&dest_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let mut file = tokio::fs::File::create(&dest_path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载流错误: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;
        file.flush().await.map_err(|e| format!("flush 失败: {}", e))?;

        if total_size > 0 {
            let bytes_downloaded = downloaded.fetch_add(chunk.len() as u64, Ordering::Relaxed) + chunk.len() as u64;
            let progress = (bytes_downloaded as f64 / total_size as f64) * 100.0;
            let _ = on_progress.send(progress);
        }
    }

    file.shutdown().await.ok();
    Ok(())
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
