//! FFI bindings to the C module in c/win32hooks, wrapped in a safe API.
//!
//! The pattern: raw `extern "C"` declarations stay private, and each one
//! gets a small safe Rust function. All `unsafe` lives in this file, next
//! to a comment saying why it is sound.

use std::ffi::{c_void, CStr};
use std::ptr::NonNull;
use std::sync::Mutex;

mod ffi {
    use std::ffi::{c_char, c_void};

    // Must match c/win32hooks/include/teto_win32.h exactly: the compiler
    // can't check this, which is why calling these is `unsafe`.
    pub type HotkeyCb = extern "C" fn(user: *mut c_void);

    /// C's opaque `teto_window_info`. Rust never sees its fields: a
    /// zero-sized private array makes it impossible to construct or copy
    /// from Rust, the pattern the Rustonomicon recommends for opaque types.
    #[repr(C)]
    pub struct WindowInfo {
        _private: [u8; 0],
    }

    extern "C" {
        pub fn teto_idle_ms() -> u32;
        pub fn teto_cursor_pos(x: *mut i32, y: *mut i32) -> i32;
        pub fn teto_hotkey_start(modifiers: u32, vk: u32, cb: HotkeyCb, user: *mut c_void) -> i32;
        pub fn teto_hotkey_stop();
        pub fn teto_kill_children_on_exit() -> i32;
        pub fn teto_foreground_window() -> *mut WindowInfo;
        pub fn teto_window_app(info: *const WindowInfo) -> *const c_char;
        pub fn teto_window_title(info: *const WindowInfo) -> *const c_char;
        pub fn teto_window_info_free(info: *mut WindowInfo);
    }
}

pub const MOD_ALT: u32 = 0x0001;
pub const MOD_CONTROL: u32 = 0x0002;
pub const VK_SPACE: u32 = 0x20;

/// Milliseconds since the last keyboard/mouse input anywhere on the desktop.
pub fn idle_ms() -> u32 {
    // SAFETY: no arguments, no pointers; the C function only reads OS state.
    unsafe { ffi::teto_idle_ms() }
}

/// Cursor position in physical screen pixels.
pub fn cursor_pos() -> Option<(i32, i32)> {
    let (mut x, mut y) = (0i32, 0i32);
    // SAFETY: both pointers point to live, writable i32s on our stack for
    // the whole call; C writes them only when it returns 1.
    let ok = unsafe { ffi::teto_cursor_pos(&mut x, &mut y) };
    (ok == 1).then_some((x, y))
}

/// Kill every child process when this process exits, even on a crash.
pub fn kill_children_on_exit() -> bool {
    // SAFETY: no arguments; the job handle is owned by the C side for the
    // lifetime of the process (intentionally never closed).
    unsafe { ffi::teto_kill_children_on_exit() == 1 }
}

/// A snapshot of the foreground window that OWNS the C allocation.
///
/// RAII: the C memory is freed exactly once, in `Drop`, when this value
/// goes out of scope. There's no `Clone` on purpose: two owners of one C
/// pointer would free it twice.
pub struct ForegroundWindow {
    ptr: NonNull<ffi::WindowInfo>, // non-null by construction: no null checks later
}

impl ForegroundWindow {
    /// `None` if no window has focus (or C ran out of memory).
    pub fn now() -> Option<Self> {
        // SAFETY: no arguments; C returns either NULL or a pointer we now own.
        let raw = unsafe { ffi::teto_foreground_window() };
        NonNull::new(raw).map(|ptr| Self { ptr })
    }

    /// The program's file name, e.g. `Code.exe`.
    ///
    /// The `&str` *borrows* from `self` (lifetime elision ties them), so
    /// the compiler rejects any use of it after the snapshot is dropped:
    /// C's "don't use the string after free" rule, enforced at compile time.
    pub fn app(&self) -> &str {
        // SAFETY: `ptr` is live (we own it); C returns a NUL-terminated
        // string owned by the snapshot, valid until teto_window_info_free.
        unsafe { borrow_c_str(ffi::teto_window_app(self.ptr.as_ptr())) }
    }

    /// The window title. Deliberately never sent to the UI (titles can be
    /// private); kept for learning and tests.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn title(&self) -> &str {
        // SAFETY: as in `app`.
        unsafe { borrow_c_str(ffi::teto_window_title(self.ptr.as_ptr())) }
    }
}

impl Drop for ForegroundWindow {
    fn drop(&mut self) {
        // SAFETY: we own `ptr` and this is the only place that frees it;
        // Drop runs exactly once per value.
        unsafe { ffi::teto_window_info_free(self.ptr.as_ptr()) }
    }
}

/// # Safety
/// `p` must be NULL or a NUL-terminated string that outlives `'a`.
unsafe fn borrow_c_str<'a>(p: *const std::ffi::c_char) -> &'a str {
    if p.is_null() {
        return "";
    }
    // SAFETY: guaranteed by the caller (see above). Invalid UTF-8 → "".
    unsafe { CStr::from_ptr(p) }.to_str().unwrap_or("")
}

/// A callback that can be shared with another thread (`Send + Sync`).
type HotkeyFn = Box<dyn Fn() + Send + Sync>;

/// The boxed closure that C calls back. Kept here so it outlives the hotkey.
/// Double box: `Box<dyn Fn>` is a *fat* pointer (data + vtable) and can't
/// travel as one `void*`; a Box of it is a thin pointer that can.
static HOTKEY: Mutex<Option<Box<HotkeyFn>>> = Mutex::new(None);

/// The C-callable trampoline: C knows nothing about Rust closures, so it
/// calls this plain function with the `user` pointer we gave it, and we
/// turn that pointer back into the closure.
extern "C" fn trampoline(user: *mut c_void) {
    // SAFETY: `user` is the pointer to the Box<dyn Fn> stored in HOTKEY,
    // which is only dropped after teto_hotkey_stop() has joined the C
    // thread, so it is valid for every call.
    let f = unsafe { &*(user as *const HotkeyFn) };
    // A panic must never unwind across the C boundary (undefined behavior).
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
}

/// Register a global hotkey; `on_press` runs on a background thread.
/// Returns false if another program already owns that key combination.
pub fn hotkey_start(modifiers: u32, vk: u32, on_press: impl Fn() + Send + Sync + 'static) -> bool {
    let mut slot = HOTKEY.lock().unwrap();
    if slot.is_some() {
        return false;
    }
    let boxed: Box<HotkeyFn> = Box::new(Box::new(on_press));
    let user = &*boxed as *const HotkeyFn as *mut c_void;
    // SAFETY: `user` points into `boxed`, which we store in HOTKEY below and
    // keep alive until hotkey_stop() has joined the C thread.
    let ok = unsafe { ffi::teto_hotkey_start(modifiers, vk, trampoline, user) } == 1;
    if ok {
        *slot = Some(boxed);
    }
    ok
}

/// Unregister the hotkey. After this returns, the callback never runs again.
pub fn hotkey_stop() {
    let mut slot = HOTKEY.lock().unwrap();
    // SAFETY: plain call; joins the C thread before returning.
    unsafe { ffi::teto_hotkey_stop() };
    *slot = None; // only now is it safe to free the closure
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_and_idle_work_through_ffi() {
        assert!(cursor_pos().is_some());
        assert!(idle_ms() < 30 * 24 * 3600 * 1000);
    }

    #[test]
    fn foreground_window_owns_and_frees_its_memory() {
        // Drop frees each snapshot; 5000 rounds would leak visibly if not.
        for _ in 0..5000 {
            if let Some(w) = ForegroundWindow::now() {
                let (app, title) = (w.app(), w.title());
                assert!(app.is_empty() || app.to_ascii_lowercase().ends_with(".exe"));
                let _ = title;
            } // <- `w` dropped here: teto_window_info_free runs
        }
    }

    #[test]
    fn hotkey_start_stop_restart() {
        const MOD_SHIFT: u32 = 0x0004;
        const VK_F9: u32 = 0x78; // not F12: Windows reserves F12 for debuggers (RegisterHotKey docs)
        let mods = MOD_CONTROL | MOD_ALT | MOD_SHIFT;
        if !hotkey_start(mods, VK_F9, || {}) {
            eprintln!("skipped: Ctrl+Alt+Shift+F9 is taken");
            return;
        }
        assert!(
            !hotkey_start(mods, VK_F9, || {}),
            "a second hotkey is refused"
        );
        hotkey_stop();
        assert!(
            hotkey_start(mods, VK_F9, || {}),
            "can register again after stop"
        );
        hotkey_stop();
        hotkey_stop(); // idempotent
    }
}
