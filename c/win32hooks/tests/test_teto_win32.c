/*
 * Tests for teto_win32, in plain C with no framework: each CHECK prints
 * and counts; main returns non-zero if anything failed.
 *
 *   clang -std=c11 -Wall -Wextra -Werror -Iinclude src/teto_win32.c tests/test_teto_win32.c -luser32 -o build/test.exe
 *
 * The hotkey test registers a hotkey. Firing it uses SendInput, which types
 * REAL keystrokes into your desktop session (the modifier keys reach the
 * focused window), so that part only runs when TETO_TEST_INPUT=1 is set.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>

#include "teto_win32.h"

static int g_failed = 0, g_passed = 0;

#define CHECK(cond, what)                                   \
    do {                                                    \
        if (cond) { g_passed++; }                           \
        else { g_failed++; printf("FAILED: %s (%s:%d)\n", what, __FILE__, __LINE__); } \
    } while (0)

static volatile LONG g_hits = 0;

static void on_hotkey(void *user) {
    InterlockedIncrement(&g_hits); /* called on the hotkey thread: atomic, not ++ */
    SetEvent((HANDLE)user);
}

static void press(WORD vk, int up) {
    INPUT in;
    ZeroMemory(&in, sizeof in);
    in.type = INPUT_KEYBOARD;
    in.ki.wVk = vk;
    in.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
    SendInput(1, &in, sizeof in);
}

int main(void) {
    int32_t x = -1, y = -1;
    uint32_t idle;
    HANDLE fired;

    /* cursor */
    CHECK(teto_cursor_pos(&x, &y) == 1, "cursor position available");
    CHECK(teto_cursor_pos(NULL, &y) == 0, "NULL pointer rejected, not dereferenced");

    /* idle: we just ran, so the user can't have been idle for days */
    idle = teto_idle_ms();
    CHECK(idle < 30u * 24 * 3600 * 1000, "idle time is plausible");

    /* hotkey: Ctrl+Alt+Shift+F9 is very unlikely to be taken (not F12: Windows
     * reserves F12 for debuggers, per the RegisterHotKey docs) */
    teto_hotkey_stop(); /* stopping when not started is a no-op */
    fired = CreateEventW(NULL, FALSE, FALSE, NULL);
    if (teto_hotkey_start(TETO_MOD_CONTROL | TETO_MOD_ALT | TETO_MOD_SHIFT, VK_F9, on_hotkey, fired)) {
        CHECK(teto_hotkey_start(TETO_MOD_CONTROL, VK_F11, on_hotkey, fired) == 0, "second start refused");
        if (GetEnvironmentVariableA("TETO_TEST_INPUT", NULL, 0) > 0) {
            press(VK_CONTROL, 0); press(VK_MENU, 0); press(VK_SHIFT, 0); press(VK_F9, 0);
            press(VK_F9, 1); press(VK_SHIFT, 1); press(VK_MENU, 1); press(VK_CONTROL, 1);
            CHECK(WaitForSingleObject(fired, 3000) == WAIT_OBJECT_0, "hotkey callback fired");
            CHECK(g_hits == 1, "fired exactly once");
        } else {
            printf("SKIPPED: pressing the hotkey (set TETO_TEST_INPUT=1 to send real keystrokes)\n");
        }
        teto_hotkey_stop();
        /* after stop, the same hotkey can be registered again */
        CHECK(teto_hotkey_start(TETO_MOD_CONTROL | TETO_MOD_ALT | TETO_MOD_SHIFT, VK_F9, on_hotkey, fired) == 1,
              "restart after stop");
        teto_hotkey_stop();
    } else {
        printf("SKIPPED: hotkey test (Ctrl+Alt+Shift+F9 is taken)\n");
    }
    CHECK(teto_hotkey_start(0, VK_F9, NULL, NULL) == 0, "NULL callback refused");
    CloseHandle(fired);

    /* job object: last, because it changes this process for good */
    CHECK(teto_kill_children_on_exit() == 1, "job object created and assigned");

    printf("%s: %d passed, %d failed\n", g_failed ? "FAIL" : "OK", g_passed, g_failed);
    return g_failed ? 1 : 0;
}
