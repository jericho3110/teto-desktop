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

/* ---- the foreground window (heap memory crossing the API) -------------
 *
 * An OPAQUE type: callers only ever hold a pointer and use the functions
 * below; the struct's fields are private to teto_win32.c. That's
 * encapsulation in plain C.
 *
 * OWNERSHIP: teto_foreground_window() allocates; the CALLER owns the result
 * and must release it exactly once with teto_window_info_free(). The
 * strings returned by the getters belong to the info object: they stay
 * valid until it is freed, and must not be freed separately.
 */
typedef struct teto_window_info teto_window_info;

/* Snapshot of the window you're using now. NULL if there is none (e.g. the
 * desktop has focus) or memory ran out. */
teto_window_info *teto_foreground_window(void);

/* The program's file name, e.g. "Code.exe" (UTF-8). Never NULL; "" if unknown. */
const char *teto_window_app(const teto_window_info *info);

/* The window title (UTF-8). Never NULL; "" if none. Titles can contain
 * private things (document names, email subjects): Teto never sends them
 * anywhere (data minimization), only the app name. */
const char *teto_window_title(const teto_window_info *info);

/* Releases the snapshot and both strings. Safe to call with NULL. */
void teto_window_info_free(teto_window_info *info);

#ifdef __cplusplus
}
#endif

#endif /* TETO_WIN32_H */
