# C++ concepts used in Teto

Every C++ concept and principle in `cpp/physics/`. The physics model
itself is explained in [ARCHITECTURE.md](ARCHITECTURE.md); this file is
about the language.

## Contents

1. [Headers, source files and `#pragma once`](#1-headers-source-files-and-pragma-once)
2. [Namespaces, including the anonymous namespace](#2-namespaces-including-the-anonymous-namespace)
3. [Classes: public/private, members, default initializers](#3-classes-publicprivate-members-default-initializers)
4. [Templates with a non-type parameter](#4-templates-with-a-non-type-parameter)
5. [`constexpr`, `inline` and `const` methods](#5-constexpr-inline-and-const-methods)
6. [Fixed-size arrays and static storage (no heap)](#6-fixed-size-arrays-and-static-storage-no-heap)
7. [Explicit conversions: `static_cast`](#7-explicit-conversions-static_cast)
8. [The ternary operator and clamping](#8-the-ternary-operator-and-clamping)
9. [Linkage: `extern "C"` and name mangling](#9-linkage-extern-c-and-name-mangling)
10. [Attributes and macros: `export_name`, `#define`](#10-attributes-and-macros-export_name-define)
11. [Freestanding C++: no standard library](#11-freestanding-c-no-standard-library)
12. [Numerical code: floats, approximations, stability](#12-numerical-code-floats-approximations-stability)
13. [Compiler flags and warnings as errors](#13-compiler-flags-and-warnings-as-errors)
14. [Testing native code from JavaScript](#14-testing-native-code-from-javascript)
15. [Principles applied](#15-principles-applied)
16. [Exercises](#16-exercises)
- [Memory management and the particle system](#memory-management-and-the-particle-system)
17. [References](#references)

## 1. Headers, source files and `#pragma once`

- `spring_chain.hpp` (header) holds the class; `exports.cpp` (source)
  includes it and defines the exported functions. In C++, templates usually
  live entirely in headers, because the compiler needs the full definition
  wherever the template is used.
- `#include "spring_chain.hpp"` literally pastes the file in (the preprocessor).
- `#pragma once` stops a header being pasted twice into one file. It's
  non-standard but supported by every major compiler; the portable spelling
  is an `#ifndef X / #define X / #endif` include guard (used in the C module).

## 2. Namespaces, including the anonymous namespace

```cpp
namespace teto { class SpringChain ... }      // teto::SpringChain
namespace { teto::SpringChain<16> g_chains[4]; int g_count = 0; }   // exports.cpp
```

- A named namespace prevents clashes (`teto::clamp` ≠ someone's `clamp`).
- An **anonymous namespace** gives *internal linkage*: `g_chains` is only
  visible inside `exports.cpp`, the modern replacement for `static` globals.

## 3. Classes: public/private, members, default initializers

```cpp
class SpringChain {
public:
    void step(float dt, ...);
    float angle(int i) const;
private:
    int joints_ = 0;               // default member initializer
    float theta_[MaxJoints] = {};  // = {} zero-fills the array
};
```

- `public:` is the API; `private:` is the state only the class may touch
  (**encapsulation**: callers can't break the invariants, e.g. set an angle
  past the ±1.2 clamp).
- Trailing underscore (`theta_`) marks members, a common style convention.
- A `class` defaults to `private`; a `struct` defaults to `public`.

## 4. Templates with a non-type parameter

```cpp
template <int MaxJoints>
class SpringChain { float theta_[MaxJoints] = {}; ... };
teto::SpringChain<16> g_chains[4];
```

`MaxJoints` is a **compile-time constant**, so array sizes are known and no
heap allocation is needed. `std::array<float, N>` uses the same trick.
Each distinct `N` generates a separate class (monomorphization), with zero
runtime cost.

## 5. `constexpr`, `inline` and `const` methods

- `constexpr float kPi = ...;` and `constexpr float clamp(...)`: can be
  evaluated at compile time; the `k` prefix marks constants.
- `inline float sin_approx(...)` in a header: allows the definition to
  appear in many source files without "multiple definition" link errors
  (the One Definition Rule). The optimizer decides separately whether to
  actually inline it.
- `float angle(int i) const`: a **const method** promises not to modify
  the object; callers holding a `const SpringChain&` may call it.

## 6. Fixed-size arrays and static storage (no heap)

`g_chains` lives in **static storage**, a fixed area of the wasm
module's linear memory, allocated once and never freed. There is no
`new`/`malloc`, so no leaks, no fragmentation, and nothing for the missing
allocator to do. The cost: hard limits (4 chains, 16 joints), enforced by
clamping in `phys_init` and `configure`.

## 7. Explicit conversions: `static_cast`

`static_cast<float>(i)` converts `int` → `float` explicitly. C++ would do
it implicitly, but `-Wall -Wextra` can warn about silent conversions, and
the cast documents intent. Prefer `static_cast` over C-style `(float)i`,
which can silently do more dangerous casts.

## 8. The ternary operator and clamping

`joints > MaxJoints ? MaxJoints : (joints < 1 ? 1 : joints)` clamps
untrusted input from JavaScript. **Every exported function validates its
indexes** (`chain >= 0 && chain < g_count`), because the wasm boundary is
a trust boundary: an out-of-range index would read or write arbitrary
module memory.

## 9. Linkage: `extern "C"` and name mangling

C++ supports overloading (`f(int)` and `f(float)`), so the compiler
encodes parameter types into symbol names: **name mangling**
(`phys_angle` → something like `_Z10phys_angleii`). `extern "C" { ... }`
turns mangling off for those functions, giving them plain C names that
JavaScript, Rust or C can find. The cost: no overloading inside `extern "C"`.

## 10. Attributes and macros: `export_name`, `#define`

```cpp
#define EXPORT(name) __attribute__((export_name(#name)))
EXPORT(phys_init) int phys_init(...)
```

- `__attribute__((export_name("x")))` is a **clang extension**: export this
  function from the wasm module as `"x"`.
- The macro's `#name` is the **stringizing operator**: `phys_init` → `"phys_init"`.
- Macros are plain text substitution with no types and no scope: keep them
  tiny. Here it removes repetition without hiding logic.

## 11. Freestanding C++: no standard library

With `--target=wasm32 -nostdlib` there is no `<cmath>`, no `<array>`, no
`printf`, no allocator. The code is **freestanding**: it uses only the
language core. Consequences visible in the code:

| Missing | Replacement |
| --- | --- |
| `std::sin`, `std::cos` | `sin_approx` (Taylor polynomial), `cos_approx(x) = sin(x + π/2)` |
| `std::clamp` | `teto::clamp` |
| `std::array` | built-in arrays |
| exceptions, RTTI (`dynamic_cast`, `typeid`) | turned off: `-fno-exceptions -fno-rtti` |

Payoff: a 1.4 KB module that imports **nothing**.

## 12. Numerical code: floats, approximations, stability

- `float` (32-bit) instead of `double`: plenty for pixels.
- `1.f / 30.f`: the `f` suffix makes float literals; without it they're
  `double` and get converted.
- **Range reduction** before the polynomial (`while (x > kPi) x -= 2*kPi`),
  because Taylor series are only accurate near 0.
- **Semi-implicit Euler** for stability, `dt` clamping against frame
  hitches, angle clamping against folding: see ARCHITECTURE.md.

## 13. Compiler flags and warnings as errors

`-Wall -Wextra -Werror` turns on most warnings and fails the build on any
of them, so warnings can't pile up unnoticed. `-std=c++20` pins the
language version, and `-O2` optimizes. Each flag of the build command is
explained in [ARCHITECTURE.md](ARCHITECTURE.md#the-build-command-flag-by-flag).

## 14. Testing native code from JavaScript

The tests (`cpp/physics/test/physics.test.mjs`) load the **real compiled
`.wasm`** in Node, so they test exactly what ships, including the export
list (`"exports only what we declared"`). That's a **contract test** on
the C ABI.

## 15. Principles applied

| Principle | Where |
| --- | --- |
| **Encapsulation** | private state in `SpringChain`, a tiny public API |
| **Validate at trust boundaries** | every exported function checks its indexes |
| **No hidden allocation** | static storage only |
| **Zero-cost abstraction** | template + inline: the class costs nothing at runtime |
| **Fail safe numerics** | clamped `dt`, clamped angles |

## 16. Exercises

1. Replace the arrays with your own tiny `Array<T, N>` template class with
   `operator[]`. Does the `.wasm` get bigger?
2. Remove `extern "C"` and rebuild. Run the export-list test. What do the
   names look like now?
3. Add `phys_reset(chain)` that zeroes one chain. Validate the index!
4. Self-check: why does `cos_approx` call `sin_approx` instead of having its own polynomial?

## Memory management and the particle system

`memory.hpp`, `particles.hpp` and `particles.cpp` (a second translation
unit linked into the same `.wasm`) apply C++'s memory tools without a
standard library. Full explanation: [docs/MEMORY.md](../../docs/MEMORY.md#c-raii-arenas-pools-and-data-layout).

| Concept | Where |
| --- | --- |
| arena (bump) allocator, alignment arithmetic | `teto::Arena::allocate` |
| placement new (we declare it ourselves: no `<new>`) | `operator new(size_t, void*)`, `Arena::create` |
| variadic templates | `template <typename T, typename... Args> T* create(Args... args)` |
| deleted copy constructor / assignment | `Arena(const Arena&) = delete;` |
| `constexpr` constructor + `constinit` | the global arena is built at compile time |
| object pool with a free list | `fx::Store::acquire` / `release` |
| struct of arrays, shared with JS zero-copy | `float x[N], y[N]…`; `fx_field()` returns their offsets |
| `.bss` vs `.data` (measured: 15 KB → 5.7 KB) | no default member initializers in `fx::Store` |
| `alignas(16)` | `g_arena_bytes` |
| `using size_t = decltype(sizeof(0))` | freestanding: no `<cstddef>` |
| `reinterpret_cast` to an integer address | `fx_field` (a wasm32 pointer is a byte offset) |

And OOP, explained in [docs/PARADIGMS.md](../../docs/PARADIGMS.md):

| Concept | Where |
| --- | --- |
| abstract base class, pure virtual functions (`= 0`) | `fx::Emitter::spawn`, `update` |
| inheritance, `final`, `override` | `class Sparkle final : public Emitter` |
| virtual dispatch through a vtable | `g_emitters[k]->update(...)`; the reason the wasm has a `TABLE` section |
| Template Method pattern | non-virtual `tick()` / `burst()` calling the virtual steps |
| protected non-virtual destructor | emitters are never deleted through `Emitter*` |
| `__cxa_pure_virtual` | normally from the C++ runtime; we provide it (it traps) |
| `enum` with an explicit underlying type | `enum Kind : unsigned char` |
| nested namespaces | `namespace teto::fx` |

## References

### Official / standard

- cppreference, classes: <https://en.cppreference.com/w/cpp/language/classes>
- cppreference, templates: <https://en.cppreference.com/w/cpp/language/templates>
- cppreference, `constexpr`: <https://en.cppreference.com/w/cpp/language/constexpr>
- cppreference, `inline` and the ODR: <https://en.cppreference.com/w/cpp/language/inline>
- cppreference, unnamed namespaces: <https://en.cppreference.com/w/cpp/language/namespace#Unnamed_namespaces>
- cppreference, language linkage (`extern "C"`): <https://en.cppreference.com/w/cpp/language/language_linkage>
- cppreference, freestanding implementations: <https://en.cppreference.com/w/cpp/freestanding>
- Clang, `export_name` attribute: <https://clang.llvm.org/docs/AttributeReference.html#export-name>
- Clang, diagnostic flags: <https://clang.llvm.org/docs/DiagnosticsReference.html>

### Other

- C++ Core Guidelines: <https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines>
- Surma, *Compiling C to WebAssembly without Emscripten*: <https://surma.dev/things/c-to-webassembly/>

### Further learning

- LearnCpp.com (free, thorough C++ course): <https://www.learncpp.com/>
- Compiler Explorer (see what your C++ compiles to, incl. wasm): <https://godbolt.org/>
- Exercism C++ track: <https://exercism.org/tracks/cpp>
