// 系统集成：全局媒体键 + 托盘图标 + 右键菜单
// 在 lib.rs 的 setup() 里调用 init(app) 完成注册
// 所有操作通过 emit "system-action" 事件传给前端，前端在 useShortcuts 里统一监听处理

use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::commands;

/// 全局事件名：媒体键 / 托盘菜单点击都走这个事件
pub const ACTION_EVENT: &str = "system-action";

/// 动作类型（前端按这个字符串分支）
#[derive(Clone, Copy)]
pub enum Action {
    PlayPause,
    Next,
    Prev,
    Stop,
    VolumeUp,
    VolumeDown,
    VolumeMute,
}

impl Action {
    fn as_str(self) -> &'static str {
        match self {
            Action::PlayPause => "play-pause",
            Action::Next => "next",
            Action::Prev => "prev",
            Action::Stop => "stop",
            Action::VolumeUp => "volume-up",
            Action::VolumeDown => "volume-down",
            Action::VolumeMute => "volume-mute",
        }
    }
}

fn emit_action(app: &AppHandle, action: Action) {
    let _ = app.emit(ACTION_EVENT, action.as_str());
}

/// 切换主窗口可见性（托盘左键点击 / "显示主窗口"菜单项）
fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

/// 注册全局媒体快捷键
fn register_global_shortcuts(app: &AppHandle) {
    let manager = app.global_shortcut();

    // 媒体键 → Action 映射表
    let shortcuts: &[(Code, Action)] = &[
        (Code::MediaPlayPause, Action::PlayPause),
        (Code::MediaTrackNext, Action::Next),
        (Code::MediaTrackPrevious, Action::Prev),
        (Code::MediaStop, Action::Stop),
        (Code::AudioVolumeUp, Action::VolumeUp),
        (Code::AudioVolumeDown, Action::VolumeDown),
        (Code::AudioVolumeMute, Action::VolumeMute),
    ];

    for (code, action) in shortcuts {
        let shortcut = Shortcut::new(Some(Modifiers::empty()), *code);
        let action_val = *action;
        let app_handle = app.clone();
        if let Err(e) = manager.on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                emit_action(&app_handle, action_val);
            }
        }) {
            eprintln!("[系统集成] 媒体快捷键注册跳过(已被占用): {:?}", e);
        }
    }

    // 快捷键：Ctrl + Alt + L 切换桌面歌词穿透锁定
    let lock_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyL);
    let app_handle_lock = app.clone();
    if let Err(e) = manager.on_shortcut(lock_shortcut, move |_app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            if let Err(e) = commands::toggle_lyric_overlay_lock(app_handle_lock.clone()) {
                eprintln!("[快捷键] 切换桌面歌词穿透锁定失败: {}", e);
            }
        }
    }) {
        eprintln!("[系统集成] Ctrl+Alt+L 快捷键注册跳过(已被其他软件占用): {:?}", e);
    }
}

/// 建托盘图标 + 右键菜单
fn build_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = Menu::with_items(app, &[
        &MenuItem::with_id(app, "show-window", "显示/隐藏主窗口", true, None::<&str>)?,
        &MenuItem::with_id(app, "toggle-overlay", "桌面歌词 (显示/隐藏)", true, None::<&str>)?,
        &MenuItem::with_id(app, "toggle-overlay-lock", "锁定/解锁桌面歌词 (穿透)", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "play-pause", "播放/暂停", true, None::<&str>)?,
        &MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?,
        &MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?,
    ])?;

    // 用打包后的应用图标作为托盘图标
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("缺少默认窗口图标")?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("MP3Freer")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event: MenuEvent| {
            let id = event.id().as_ref();
            match id {
                "toggle-overlay-lock" => {
                    if let Err(e) = commands::toggle_lyric_overlay_lock(app.clone()) {
                        eprintln!("[托盘] 切换桌面歌词锁定失败: {}", e);
                    }
                }
                "show-window" => toggle_main_window(app),
                "toggle-overlay" => {
                    // 调用命令函数直接处理（不经过前端）
                    if let Err(e) = commands::toggle_lyric_overlay(app.clone()) {
                        eprintln!("[托盘] 切换桌面歌词失败: {}", e);
                    }
                }
                "play-pause" => emit_action(app, Action::PlayPause),
                "prev" => emit_action(app, Action::Prev),
                "next" => emit_action(app, Action::Next),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event: TrayIconEvent| {
            // 左键单击：切换主窗口可见性
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// 在 lib.rs 的 setup() 里调用，初始化全局快捷键和托盘
pub fn init(app: &AppHandle) -> Result<(), String> {
    // 1. 优先创建托盘图标，保证托盘必出，绝不受快捷键冲突的影响
    build_tray(app).map_err(|e| format!("创建托盘图标失败: {}", e))?;
    // 2. 容错注册全局快捷键（即使个别键被占用，也不会中断）
    register_global_shortcuts(app);
    Ok(())
}
