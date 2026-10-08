/*
 * Implementation of teto_win32.h. See c/docs/CONCEPTS.md for a guided tour.
 */
#define WIN32_LEAN_AND_MEAN /* skip rarely used parts of <windows.h>: faster builds */
#include <windows.h>

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
