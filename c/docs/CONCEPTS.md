# C concepts used in Teto

Every C concept and principle in `c/win32hooks/`, plus the Windows API
ideas it relies on.

## Contents

1. [Headers vs source files, include guards](#1-headers-vs-source-files-include-guards)
2. [The C ABI and `extern "C"` in headers](#2-the-c-abi-and-extern-c-in-headers)
3. [Fixed-width integers (`stdint.h`)](#3-fixed-width-integers-stdinth)
4. [Pointers and out-parameters](#4-pointers-and-out-parameters)
5. [Function pointers and `void *user` callbacks](#5-function-pointers-and-void-user-callbacks)
6. [`static`: internal linkage and global state](#6-static-internal-linkage-and-global-state)
7. [Structs and `sizeof`](#7-structs-and-sizeof)
8. [Macros: `#define`, `do { } while (0)`](#8-macros-define-do--while-0)
9. [Unsigned arithmetic and wraparound](#9-unsigned-arithmetic-and-wraparound)
10. [Windows API basics: handles, BOOL, W functions](#10-windows-api-basics-handles-bool-w-functions)
11. [Threads, message loops and hotkeys](#11-threads-message-loops-and-hotkeys)
12. [Synchronization: critical sections, events, one-time init, atomics](#12-synchronization-critical-sections-events-one-time-init-atomics)
13. [Job objects: killing children when we die](#13-job-objects-killing-children-when-we-die)
14. [Building: clang, cl, static libraries, linking user32](#14-building-clang-cl-static-libraries-linking-user32)
15. [Testing C without a framework](#15-testing-c-without-a-framework)
16. [Principles applied](#16-principles-applied)
17. [Exercises](#17-exercises)
- [Heap memory: the foreground-window snapshot](#heap-memory-the-foreground-window-snapshot)
18. [References](#references)

## 1. Headers vs source files, include guards

- `include/teto_win32.h` = the **interface**: declarations other code may call.
- `src/teto_win32.c` = the **implementation**.
- `#ifndef TETO_WIN32_H / #define TETO_WIN32_H / ... #endif` is an
  **include guard**: if the header is included twice, the second copy is skipped.

## 2. The C ABI and `extern "C"` in headers

The **ABI** (application binary interface) is how compiled functions are
called: which registers hold arguments, how names appear in object files.
C's ABI is simple and stable, which is why Rust, Go, C#, Python and
JavaScript (wasm) can all call C. The header wraps declarations in

```c
#ifdef __cplusplus
extern "C" {
#endif
```

so a C++ compiler including it won't mangle the names.

## 3. Fixed-width integers (`stdint.h`)

`int` and `long` have different sizes on different platforms. `uint32_t`
and `int32_t` are exactly 32 bits everywhere, which matters at a language
boundary: Rust's `u32`/`i32` must match exactly (`rust/shell/src/native.rs`).

## 4. Pointers and out-parameters

```c
int teto_cursor_pos(int32_t *x, int32_t *y);   /* writes through x and y */
```

C functions return one value, so extra results go through **pointers**
the caller provides. The function **checks for NULL** before writing:
dereferencing NULL crashes the whole process. Returning 1/0 for
success/failure and leaving outputs untouched on failure is a common C contract.

## 5. Function pointers and `void *user` callbacks

```c
typedef void (*teto_hotkey_cb)(void *user);
int teto_hotkey_start(uint32_t mods, uint32_t vk, teto_hotkey_cb cb, void *user);
```

- `typedef` names the type "pointer to a function taking `void*`".
- `void *user` is an opaque **context pointer**: C stores it and passes it
  back to the callback without knowing what it is. Rust passes a pointer
  to its closure; the test passes an event handle. This is C's version of a closure.

## 6. `static`: internal linkage and global state

`static HANDLE g_thread;` at file scope = visible **only in this file**
(internal linkage), so other code can't touch it. `static` on a function
(`hotkey_thread`, `lock`) does the same. The `g_` prefix marks globals.

## 7. Structs and `sizeof`

`hotkey_args` bundles everything the thread needs into one pointer.
`info.cbSize = sizeof info;` is the Win32 **versioned struct** pattern:
you tell the API how big *your* version of the struct is, so Windows can
add fields later without breaking old programs. `ZeroMemory(&limits, sizeof limits)`
starts structs from all zeros.

## 8. Macros: `#define`, `do { } while (0)`

- `#define WIN32_LEAN_AND_MEAN` *before* `<windows.h>` skips rarely used
  headers (faster builds, fewer name clashes).
- `#define TETO_MOD_ALT 0x0001`: constants that are usable in C *and* readable by Rust's author.
- The test's `CHECK` macro is wrapped in `do { ... } while (0)` so it acts
  like **one statement** (safe inside `if/else` without braces).
  `__FILE__`/`__LINE__` give the location of the failing check.

## 9. Unsigned arithmetic and wraparound

`GetTickCount()` counts milliseconds in 32 bits and wraps to 0 after
~49.7 days. `GetTickCount() - info.dwTime` still gives the right
difference across the wrap, because unsigned arithmetic in C is defined
modulo 2³² (signed overflow, by contrast, is undefined behavior).

## 10. Windows API basics: handles, BOOL, W functions

- A **HANDLE** is an opaque reference to a kernel object (thread, event,
  job). You `CloseHandle` it when done, except the job handle, which
  must live as long as the process.
- Most calls return `BOOL` (nonzero = success); details come from `GetLastError()`.
- `...W` functions (`CreateEventW`, `GetMessageW`) take UTF-16 ("wide")
  strings; the `A` versions take the local code page. Prefer `W`.
- `WINAPI`/`CALLBACK` mark the **stdcall calling convention** some Win32
  callbacks require (on x64 there's only one convention, but the
  annotation keeps code portable).

## 11. Threads, message loops and hotkeys

`RegisterHotKey(NULL, id, mods, vk)` delivers `WM_HOTKEY` to the
**message queue of the thread that registered it**. So the module starts
its own thread that:

1. calls `PeekMessage` once, which creates the thread's queue (otherwise a
   `WM_QUIT` posted too early would be lost),
2. registers the hotkey and signals `ready` with the result,
3. loops on `GetMessage` (blocks until a message arrives; returns 0 on `WM_QUIT`),
4. on `WM_HOTKEY` calls the user's callback,
5. unregisters on the way out.

`teto_hotkey_stop` posts `WM_QUIT` and **joins** the thread
(`WaitForSingleObject`), which guarantees the callback never runs after
stop returns. Rust relies on that before freeing its closure.

## 12. Synchronization: critical sections, events, one-time init, atomics

| Primitive | Where | Purpose |
| --- | --- | --- |
| `CRITICAL_SECTION` | `lock()`/`unlock()` | a mutex: start/stop can be called from different threads |
| `InitOnceExecuteOnce` | `lock()` | thread-safe **one-time initialization** of that mutex |
| manual-reset **event** | `g_args.ready` | "registration finished" signal from the thread |
| `WaitForSingleObject` | start/stop | wait for an event or for a thread to exit |
| `InterlockedIncrement` | test | an **atomic** `++` from the hotkey thread |

## 13. Job objects: killing children when we die

On Windows, child processes **survive** their parent by default. If Teto
crashed, the brain, Claude, Python, Java and C# would keep running. A
**job object** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, with the current
process assigned to it, fixes that: children started later join the job
automatically, and when the last handle to the job closes (our process
ends for *any* reason), Windows terminates everything in it.

## 14. Building: clang, cl, static libraries, linking user32

- Tests: `clang -std=c11 -Wall -Wextra -Werror -Iinclude src/teto_win32.c tests/test_teto_win32.c -luser32 -o build/test_teto_win32.exe`
  (`-I` adds a header search folder; `-luser32` links `user32.lib`, home of
  `GetCursorPos`, `RegisterHotKey`, …).
- In the app, Rust's build script uses the `cc` crate to compile the
  same `.c` file with MSVC into a **static library** that's linked into
  the Rust executable, so there's no separate DLL to ship.

## 15. Testing C without a framework

`tests/test_teto_win32.c` is a `main()` with a `CHECK` macro that counts
passes/failures and returns non-zero on failure. Side-effect-heavy
checks are opt-in: actually *pressing* the hotkey uses `SendInput`, which
types real keys into your session, so it only runs with `TETO_TEST_INPUT=1`.

## 16. Principles applied

| Principle | Where |
| --- | --- |
| **Small, stable interface** | 5 functions, plain types, documented in the header |
| **Defensive input checks** | NULL checks, NULL callback refused |
| **Ownership is explicit** | header says who owns `user`, when callbacks stop, nothing to free |
| **Information hiding** | `static` internals |
| **Thread-safety documented** | "safe to call from any thread"; callbacks run on the hotkey thread |

## 17. Exercises

1. Add `int teto_foreground_title(wchar_t *buf, int cap)` using
   `GetForegroundWindow` + `GetWindowTextW`. How do you avoid overflowing `buf`?
2. Make the hotkey thread support two hotkeys. What changes in the API?
3. Self-check: why must `teto_hotkey_stop` *join* the thread instead of
   just posting `WM_QUIT`?

## Heap memory: the foreground-window snapshot

`teto_foreground_window()` is the module's one heap allocation, and it's
written to show every C memory habit (full explanation in
[docs/MEMORY.md](../../docs/MEMORY.md#c-manual-memory-made-explicit)):

| Habit | Code |
| --- | --- |
| an **opaque type**: encapsulation in C | `typedef struct teto_window_info teto_window_info;` in the header, fields only in the `.c` file |
| ownership written in the header | "the CALLER owns the result and must release it exactly once" |
| `calloc` so a half-built object is safe to free | `info = calloc(1, sizeof *info)` |
| `sizeof *info` instead of `sizeof(struct ...)` | stays correct if the type changes |
| stack buffer, then copy to the heap before returning | `wchar_t title[512]` → `utf8_from_wide` |
| two-call sizing with `WideCharToMultiByte` | ask the size, `malloc(n + 1)`, fill, add `'\0'` |
| least privilege | `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, …)`, closed right away |
| NULL-safe free, `free(NULL)` is a no-op | `teto_window_info_free` |
| a leak check in the tests | 20,000 alloc/free cycles, compare `PrivateUsage` |
| data minimization | titles never leave the C/Rust layer; only the `.exe` name goes to the UI |

## References

### Official

- C reference (cppreference): <https://en.cppreference.com/w/c>
- `stdint.h`: <https://en.cppreference.com/w/c/types/integer>
- `GetLastInputInfo`: <https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo>
- `RegisterHotKey` ✔ (WM_HOTKEY goes to the registering thread's queue): <https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey>
- Message loops: <https://learn.microsoft.com/en-us/windows/win32/winmsg/using-messages-and-message-queues>
- `PostThreadMessage` (queue creation note): <https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-postthreadmessagew>
- Job objects / `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
- One-time initialization: <https://learn.microsoft.com/en-us/windows/win32/sync/one-time-initialization>
- Critical sections: <https://learn.microsoft.com/en-us/windows/win32/sync/critical-section-objects>

### Other

- Raymond Chen, *The Old New Thing* (Win32 history and gotchas): <https://devblogs.microsoft.com/oldnewthing/>
- Beej's Guide to C Programming: <https://beej.us/guide/bgc/>
