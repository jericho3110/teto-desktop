/*
 * Implementation of teto_win32.h. See c/docs/CONCEPTS.md for a guided tour.
 */
#define WIN32_LEAN_AND_MEAN /* skip rarely used parts of <windows.h>: faster builds */
#include <windows.h>
#include <stdlib.h> /* malloc, calloc, free */
#include <wchar.h>  /* wcslen, wcsrchr */

#include "teto_win32.h"

/* ---- idle time ---------------------------------------------------------- */

uint32_t teto_idle_ms(void) {
    LASTINPUTINFO info;
    info.cbSize = sizeof info; /* Win32 "versioned struct": tell it the size we know */
    if (!GetLastInputInfo(&info)) {
        return 0;
    }
    /* Both are 32-bit tick counts that wrap every ~49.7 days. Unsigned
     * subtraction still gives the right difference across the wrap. */
    return (uint32_t)(GetTickCount() - info.dwTime);
}

/* ---- cursor -------------------------------------------------------------- */

int teto_cursor_pos(int32_t *x, int32_t *y) {
    POINT p;
    if (x == NULL || y == NULL || !GetCursorPos(&p)) {
        return 0;
    }
    *x = p.x;
    *y = p.y;
    return 1;
}

/* ---- global hotkey ------------------------------------------------------- */

/* RegisterHotKey delivers WM_HOTKEY to the message queue of the thread that
 * registered it, so we run a tiny dedicated thread with its own message loop. */

#define TETO_HOTKEY_ID 0x7E70 /* any id unique within this thread */

typedef struct {
    UINT modifiers;
    UINT vk;
    teto_hotkey_cb cb;
    void *user;
    HANDLE ready;  /* signalled once registration succeeded or failed */
    LONG ok;       /* registration result, read after `ready` */
} hotkey_args;

static HANDLE g_thread = NULL;
static DWORD g_thread_id = 0;
static hotkey_args g_args;
static CRITICAL_SECTION g_lock;
static INIT_ONCE g_lock_once = INIT_ONCE_STATIC_INIT;

static BOOL CALLBACK init_lock(PINIT_ONCE once, PVOID param, PVOID *ctx) {
    (void)once; (void)param; (void)ctx;
    InitializeCriticalSection(&g_lock);
    return TRUE;
}

static void lock(void) {
    InitOnceExecuteOnce(&g_lock_once, init_lock, NULL, NULL); /* thread-safe one-time init */
    EnterCriticalSection(&g_lock);
}

static void unlock(void) { LeaveCriticalSection(&g_lock); }

static DWORD WINAPI hotkey_thread(LPVOID param) {
    hotkey_args *a = (hotkey_args *)param;
    MSG msg;

    /* Calling PeekMessage creates this thread's message queue now, so a
     * WM_QUIT posted by teto_hotkey_stop can't arrive before the queue exists. */
    PeekMessageW(&msg, NULL, WM_USER, WM_USER, PM_NOREMOVE);

    /* MOD_NOREPEAT: holding the keys down fires once, not repeatedly. */
    a->ok = RegisterHotKey(NULL, TETO_HOTKEY_ID, a->modifiers | MOD_NOREPEAT, a->vk) ? 1 : 0;
    SetEvent(a->ready);
    if (!a->ok) {
        return 1;
    }

    /* GetMessage blocks until a message arrives; returns 0 on WM_QUIT. */
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        if (msg.message == WM_HOTKEY && msg.wParam == TETO_HOTKEY_ID) {
            a->cb(a->user);
        }
    }
    UnregisterHotKey(NULL, TETO_HOTKEY_ID);
    return 0;
}

int teto_hotkey_start(uint32_t modifiers, uint32_t virtual_key, teto_hotkey_cb cb, void *user) {
    int ok = 0;
    if (cb == NULL) {
        return 0;
    }
    lock();
    if (g_thread == NULL) {
        g_args.modifiers = modifiers;
        g_args.vk = virtual_key;
        g_args.cb = cb;
        g_args.user = user;
        g_args.ok = 0;
        g_args.ready = CreateEventW(NULL, TRUE, FALSE, NULL);
        if (g_args.ready != NULL) {
            g_thread = CreateThread(NULL, 0, hotkey_thread, &g_args, 0, &g_thread_id);
            if (g_thread != NULL) {
                WaitForSingleObject(g_args.ready, INFINITE);
                ok = (int)g_args.ok;
                if (!ok) { /* thread already exited after the failed registration */
                    WaitForSingleObject(g_thread, INFINITE);
                    CloseHandle(g_thread);
                    g_thread = NULL;
                }
            }
            CloseHandle(g_args.ready);
            g_args.ready = NULL;
        }
    }
    unlock();
    return ok;
}

void teto_hotkey_stop(void) {
    lock();
    if (g_thread != NULL) {
        PostThreadMessageW(g_thread_id, WM_QUIT, 0, 0);
        WaitForSingleObject(g_thread, INFINITE); /* "join": after this, cb is never called again */
        CloseHandle(g_thread);
        g_thread = NULL;
        g_thread_id = 0;
    }
    unlock();
}

/* ---- kill children on exit --------------------------------------------- */

int teto_kill_children_on_exit(void) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
    /* Deliberately never closed: the handle must live as long as the
     * process. When the process ends, Windows closes it, and
     * KILL_ON_JOB_CLOSE then terminates every process in the job. */
    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (job == NULL) {
        return 0;
    }
    ZeroMemory(&limits, sizeof limits);
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof limits) ||
        !AssignProcessToJobObject(job, GetCurrentProcess())) {
        CloseHandle(job);
        return 0;
    }
    return 1;
}

/* ---- the foreground window -------------------------------------------- */

/* The real layout, visible only in this file. Callers see an opaque
 * `teto_window_info *` and can't touch (or forget to free) the fields. */
struct teto_window_info {
    char *app;   /* heap, UTF-8, owned by this struct */
    char *title; /* heap, UTF-8, owned by this struct */
};

/* UTF-16 (what Windows uses) -> a NEW heap UTF-8 string, or NULL.
 * The classic Win32 two-call pattern: ask for the size, allocate, fill. */
static char *utf8_from_wide(const wchar_t *w, int wlen) {
    char *out;
    int n;
    if (wlen <= 0) {
        out = (char *)malloc(1);
        if (out != NULL) {
            out[0] = '\0';
        }
        return out;
    }
    n = WideCharToMultiByte(CP_UTF8, 0, w, wlen, NULL, 0, NULL, NULL); /* 1st call: how many bytes? */
    if (n <= 0) {
        return NULL;
    }
    /* +1: with an explicit input length the output is NOT NUL-terminated. */
    out = (char *)malloc((size_t)n + 1);
    if (out == NULL) {
        return NULL;
    }
    if (WideCharToMultiByte(CP_UTF8, 0, w, wlen, out, n, NULL, NULL) != n) { /* 2nd call: fill */
        free(out); /* never leak on an error path */
        return NULL;
    }
    out[n] = '\0';
    return out;
}

teto_window_info *teto_foreground_window(void) {
    wchar_t title[512];         /* stack buffers: freed automatically on return */
    wchar_t path[MAX_PATH * 4];
    DWORD path_len = (DWORD)(sizeof path / sizeof path[0]);
    const wchar_t *name = L"";
    DWORD pid = 0;
    HANDLE proc;
    int title_len;
    teto_window_info *info;
    HWND hwnd = GetForegroundWindow();

    if (hwnd == NULL) {
        return NULL;
    }
    /* calloc zeroes the struct: both pointers start NULL, so freeing a
     * half-built object on an error path is always safe. */
    info = (teto_window_info *)calloc(1, sizeof *info);
    if (info == NULL) {
        return NULL;
    }

    /* Copies at most 511 chars + NUL into our buffer: can't overflow. */
    title_len = GetWindowTextW(hwnd, title, (int)(sizeof title / sizeof title[0]));
    info->title = utf8_from_wide(title, title_len);

    /* Which program owns the window: window -> process id -> exe path. */
    GetWindowThreadProcessId(hwnd, &pid);
    proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid); /* least privilege: read-only query */
    if (proc != NULL) {
        if (QueryFullProcessImageNameW(proc, 0, path, &path_len)) {
            const wchar_t *slash = wcsrchr(path, L'\\');
            name = slash != NULL ? slash + 1 : path; /* points into `path`: valid until we return */
        }
        CloseHandle(proc);
    }
    info->app = utf8_from_wide(name, (int)wcslen(name)); /* copied to the heap before `path` dies */

    if (info->app == NULL || info->title == NULL) {
        teto_window_info_free(info);
        return NULL;
    }
    return info; /* ownership passes to the caller */
}

const char *teto_window_app(const teto_window_info *info) {
    return (info != NULL && info->app != NULL) ? info->app : "";
}

const char *teto_window_title(const teto_window_info *info) {
    return (info != NULL && info->title != NULL) ? info->title : "";
}

void teto_window_info_free(teto_window_info *info) {
    if (info == NULL) {
        return;
    }
    free(info->app); /* free(NULL) is defined to do nothing */
    free(info->title);
    free(info); /* the struct last: its fields were read just above */
}
