/*
 * teto_win32: the small slice of the Windows API that Teto needs and the
 * webview can't provide. Plain C with a plain C ABI, so any language can
 * call it (Rust does, through FFI: rust/shell/src/native.rs).
 *
 * Every function is safe to call from any thread. Nothing here allocates
 * memory that the caller must free.
 */
#ifndef TETO_WIN32_H
#define TETO_WIN32_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Milliseconds since the last keyboard or mouse input anywhere on the
 * desktop (not just in Teto's window). Used to decide when she falls asleep. */
uint32_t teto_idle_ms(void);

/* Cursor position in physical screen pixels. Returns 1 on success, 0 on
 * failure (e.g. on the secure desktop), leaving *x and *y untouched. */
int teto_cursor_pos(int32_t *x, int32_t *y);

/* Called on the hotkey thread (NOT the UI thread) each time the hotkey is
 * pressed. `user` is the pointer given to teto_hotkey_start. */
typedef void (*teto_hotkey_cb)(void *user);

/* Modifier flags, same values as the Win32 MOD_* constants. */
#define TETO_MOD_ALT 0x0001
#define TETO_MOD_CONTROL 0x0002
#define TETO_MOD_SHIFT 0x0004
#define TETO_MOD_WIN 0x0008

/* Registers a system-wide hotkey (e.g. TETO_MOD_CONTROL|TETO_MOD_ALT, VK_SPACE
 * = 0x20) on a background thread. Returns 1 on success, 0 if the hotkey is
 * already taken by another program or a hotkey is already running.
 * `user` must stay valid until teto_hotkey_stop() returns. */
int teto_hotkey_start(uint32_t modifiers, uint32_t virtual_key, teto_hotkey_cb cb, void *user);

/* Unregisters the hotkey and joins the thread. Safe to call if not started. */
void teto_hotkey_stop(void);

/* Puts this process in a Job Object with KILL_ON_JOB_CLOSE. Every child
 * started afterwards joins the job automatically, and when this process
 * exits for ANY reason (even a crash), Windows kills them all.
 * Returns 1 on success, 0 on failure. Call once, early. */
int teto_kill_children_on_exit(void);

#ifdef __cplusplus
}
#endif

#endif /* TETO_WIN32_H */
