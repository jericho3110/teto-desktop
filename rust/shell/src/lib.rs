//! Teto's desktop shell: one transparent, always-on-top window that shows
//! the TypeScript UI, plus the native glue the webview can't do itself.

mod native;
mod supervisor;

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

/// What the UI needs to start. Sent to TypeScript by `get_config`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")] // brain_url -> brainUrl, matching types in main.ts
struct Config {
    brain_url: String,
    token: String,
    skin: String,
}

/// A Tauri command: TypeScript calls `invoke("get_config")`.
#[tauri::command]
fn get_config(config: tauri::State<'_, Config>) -> Config {
    config.inner().clone()
}

#[derive(Clone, Copy, PartialEq, Serialize)]
struct CursorEvent {
    x: f64,
    y: f64,
}

#[derive(Clone, Serialize)]
struct IdleEvent {
    ms: u32,
}

/// Only the program name, never the window title (data minimization).
#[derive(Clone, Serialize)]
struct AppEvent {
    app: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // First, before any child exists: children join our job object and
    // die with us, even if we crash.
    if !native::kill_children_on_exit() {
        eprintln!("warning: could not create the job object; helpers may outlive Teto");
    }

    let token = supervisor::new_token();
    let services = supervisor::start_all(&token, &supervisor::Layout::detect());
    eprintln!("supervisor: started {:?}", services.names());
    let config = Config {
        brain_url: format!("http://127.0.0.1:{}", supervisor::BRAIN_PORT),
        token,
        skin: "teto-chibi".into(),
    };

    let app = tauri::Builder::default()
        .manage(config) // shared state: commands receive it as tauri::State<Config>
        .manage(Mutex::new(services))
        .invoke_handler(tauri::generate_handler![get_config])
        .setup(|app| {
            let handle = app.handle().clone();
            spawn_native_pollers(handle.clone());
            let hotkey_handle = handle.clone();
            let ok = native::hotkey_start(
                native::MOD_CONTROL | native::MOD_ALT,
                native::VK_SPACE,
                move || {
                    let _ = hotkey_handle.emit("native://hotkey", ());
                },
            );
            if !ok {
                eprintln!("warning: Ctrl+Alt+Space is taken by another program; hotkey disabled");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Tauri app");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            native::hotkey_stop();
            app.state::<Mutex<supervisor::Services>>()
                .lock()
                .unwrap()
                .stop();
        }
    });
}

/// Polls the C module and forwards changes to the UI as events:
/// the cursor ~30x per second (only when it moved), idle time every 2 s.
fn spawn_native_pollers(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_cursor: Option<CursorEvent> = None;
        let mut last_idle = Instant::now() - Duration::from_secs(60);
        let mut last_app = String::new();
        loop {
            std::thread::sleep(Duration::from_millis(33));
            let Some(win) = app.get_webview_window("main") else {
                continue;
            };
            if let (Some((cx, cy)), Ok(pos), Ok(scale)) = (
                native::cursor_pos(),
                win.inner_position(),
                win.scale_factor(),
            ) {
                // Screen pixels -> CSS pixels relative to the window.
                let ev = CursorEvent {
                    x: f64::from(cx - pos.x) / scale,
                    y: f64::from(cy - pos.y) / scale,
                };
                if last_cursor != Some(ev) {
                    last_cursor = Some(ev);
                    let _ = app.emit("native://cursor", ev);
                }
            }
            if last_idle.elapsed() >= Duration::from_secs(2) {
                last_idle = Instant::now();
                let _ = app.emit(
                    "native://idle",
                    IdleEvent {
                        ms: native::idle_ms(),
                    },
                );
                // `fg` owns a C allocation; it's freed at the end of this
                // block by Drop. `name` copies the borrowed &str into an
                // owned String first, because `fg` won't outlive the block.
                if let Some(fg) = native::ForegroundWindow::now() {
                    let name = fg.app().to_owned();
                    if !name.is_empty() && name != last_app && name != "teto-shell.exe" {
                        last_app = name.clone();
                        let _ = app.emit("native://app", AppEvent { app: name });
                    }
                }
            }
        }
    });
}
