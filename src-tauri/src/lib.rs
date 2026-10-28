// lib.rs：只负责模块声明和 Builder 配置
// 命令函数定义在 commands.rs，避免与 generate_handler! 同文件导致 E0255 冲突
// 系统集成（全局快捷键 + 托盘）仅桌面启用，见 system_integration.rs

mod commands;

#[cfg(desktop)]
mod system_integration;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::Builder as GsBuilder;

        tauri::Builder::default()
            .plugin(tauri_plugin_http::init())
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_opener::init())
            .plugin(GsBuilder::new().build())
            .invoke_handler(tauri::generate_handler![
                commands::read_audio_metadata,
                commands::download_file,
                commands::toggle_lyric_overlay,
                commands::set_lyric_overlay_lock,
                commands::toggle_lyric_overlay_lock,
            ])
            .setup(|app| {
                if let Err(e) = system_integration::init(app.handle()) {
                    eprintln!("[系统集成] 初始化失败: {}", e);
                }
                Ok(())
            })
            .on_window_event(|window, event| {
                // 点击窗口关闭按钮时改为隐藏，让托盘接管，避免误退出
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window.label() == "main" {
                        let _ = window.hide();
                        api.prevent_close();
                    }
                }
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }

    #[cfg(mobile)]
    {
        // Android / iOS：无托盘、无全局快捷键、无桌面歌词第二窗
        tauri::Builder::default()
            .plugin(tauri_plugin_http::init())
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_opener::init())
            .invoke_handler(tauri::generate_handler![
                commands::read_audio_metadata,
                commands::download_file,
                commands::toggle_lyric_overlay,
                commands::set_lyric_overlay_lock,
                commands::toggle_lyric_overlay_lock,
            ])
            .setup(|_app| Ok(()))
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
