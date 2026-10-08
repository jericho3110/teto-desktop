//! Ways to control Teto from outside the chat: her tray icon (next to the
//! clock) and two commands the UI's right-click menu calls.
//!
//! Quitting always goes through `app.exit(0)`, which fires `RunEvent::Exit`
//! in lib.rs, where the hotkey thread is joined and every helper process is
//! stopped. (Even a crash is covered: the C job object kills the helpers.)

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const MAIN: &str = "main";

/// Show the window if hidden (and focus it), hide it if shown.
pub fn toggle(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN) {
        if win.is_visible().unwrap_or(true) {
            let _ = win.hide();
        } else {
            show(app);
        }
    }
}

/// Bring Teto back (used by the tray and the global hotkey).
pub fn show(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Builds the tray icon with its menu. Left-click toggles Teto.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle_item = MenuItem::with_id(app, "toggle", "Show / hide Teto", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Teto", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&toggle_item, &separator, &quit_item])?;

    let mut tray = TrayIconBuilder::with_id("teto")
        .tooltip("Teto (right-click for options)")
        .menu(&menu)
        .show_menu_on_left_click(false) // left-click toggles; right-click opens the menu
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone()); // Teto's face (rust/shell/icons)
    }
    tray.build(app)?;
    Ok(())
}

/// `invoke("quit_app")` from the right-click menu.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// `invoke("hide_window")`: she disappears; the tray icon or the hotkey brings her back.
#[tauri::command]
pub fn hide_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.hide();
    }
}
