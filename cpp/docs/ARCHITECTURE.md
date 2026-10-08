# Hair physics architecture (C++ → WebAssembly)

How Teto's drills bounce, and how C++ ends up running inside a web page.

## Contents

1. [The model](#the-model)
2. [Integrating it: semi-implicit Euler](#integrating-it-semi-implicit-euler)
3. [Freestanding WebAssembly](#freestanding-webassembly)
4. [The build command, flag by flag](#the-build-command-flag-by-flag)
5. [Calling it from TypeScript](#calling-it-from-typescript)
6. [Tests](#tests)
7. [Exercises](#exercises)
8. [References](#references)

## The model

Each drill is a **chain of 7 joints**. Joint *i* has an angle θᵢ
relative to its parent (0 = the drawn rest pose) and an angular velocity
ωᵢ. Every frame, each joint gets an angular acceleration:

```text
α = − kᵢ·θ            spring: pull back to the drawn shape
    − c·ω             damping: lose energy, so it stops wobbling
    − 0.004·depth·a⊥  inertia: head moves left → hair lags to the right
    − 0.002·g·sin(φ)  gravity: hang down when the chain is tilted
```

- `kᵢ = stiffness · falloffⁱ`: joints near the tip are floppier.
- `a⊥` is the head's acceleration across the segment; `depth` grows
  toward the tip, so tips swing more.
- `φ` is the joint's absolute angle (sum of the parents' angles).
- Angles are clamped to ±1.2 rad so hair never folds through itself.

This is a **game-feel model**, not real rigid-body dynamics: the numbers
were tuned to look right, not derived. A physically exact chain would need
to solve the coupled equations of all joints together (e.g. Featherstone's
algorithm), which is overkill for hair.

**Sign convention:** positive θ = tip swings toward +x. SVG `rotate()` is
clockwise on a y-down screen, which moves a hanging tip toward −x, so
`skin.ts` applies `rotate(-θ)`. The right drill is mirrored with
`scale(-1,1)`, so `physics.ts` feeds it `−aₓ`.

## Integrating it: semi-implicit Euler

```cpp
omega_[i] += alpha * dt;          // 1. velocity from acceleration
theta_[i] += omega_[i] * dt;      // 2. position from the NEW velocity
```

Using the *new* velocity in step 2 (semi-implicit, or "symplectic", Euler)
keeps springs stable. Plain explicit Euler uses the *old* velocity and
slowly pumps energy into a spring until it explodes. `dt` is also clamped
to 1/30 s, so a frame hitch (window dragged, laptop asleep) can't fire
the hair into orbit.

## Freestanding WebAssembly

Usually C++ → wasm goes through **Emscripten**, which ships a whole C
library and JS glue. Here we use plain clang with **no standard library**:

| Normal C++ | Here | Why |
| --- | --- | --- |
| `#include <cmath>`, `std::sin` | `sin_approx()`: a 7th-order polynomial | there is no libm to link against |
| `std::array<float, N>` | `float arr[N]` | no libc++ headers in a bare `wasm32` target |
| `new` / `malloc` | static arrays (`g_chains[4]`) | no allocator |
| exceptions, RTTI | `-fno-exceptions -fno-rtti` | they need runtime support we don't have |

The result is **1,395 bytes** with *no imports*: JS instantiates it with an
empty import object `{}`. That makes it a great way to see what a `.wasm`
really is: a list of functions plus a block of linear memory.

`extern "C"` turns off C++ **name mangling** (C++ encodes argument types
into symbol names so overloads can coexist), and
`__attribute__((export_name("phys_step_chain")))` tells the linker to
export the function under exactly that name.

## The build command, flag by flag

```text
clang++ --target=wasm32 -O2 -std=c++20 -nostdlib -fno-exceptions -fno-rtti
        -Wall -Wextra -Werror -Wl,--no-entry -Wl,--strip-all
        -o dist/physics.wasm src/exports.cpp
```

| Flag | Meaning |
| --- | --- |
| `--target=wasm32` | cross-compile for 32-bit WebAssembly instead of your PC |
| `-O2` | optimize (inlining, constant folding) |
| `-std=c++20` | language version |
| `-nostdlib` | don't link the C/C++ standard libraries (we have none for this target) |
| `-fno-exceptions -fno-rtti` | disable features needing runtime support |
| `-Wall -Wextra -Werror` | lots of warnings, and treat them as errors |
| `-Wl,--no-entry` | `-Wl,` passes the flag to the linker (`wasm-ld`): there is no `main()` |
| `-Wl,--strip-all` | drop debug info and symbol names to keep the file tiny |

## Calling it from TypeScript

```ts
const { instance } = await WebAssembly.instantiateStreaming(fetch("/physics.wasm"), {});
const x = instance.exports;
x.phys_init(2, 7, 55, 9, 0.78);              // chains, joints, stiffness, damping, falloff
x.phys_step_chain(0, 1/60, ax, ay, 900);     // every frame, per chain
x.phys_angle(0, 3);                          // radians
```

`instantiateStreaming` compiles while downloading; it requires the
server to send `Content-Type: application/wasm` (Vite and Tauri do).

## Tests

`cpp/physics/test/physics.test.mjs` loads the real `.wasm` in Node and checks:
it exports only what we declared; at rest it stays at rest; accelerating
left swings every joint positive (tip more than root) and then settles;
huge inputs stay finite and clamped; bad indexes are safe.

```text
cd cpp/physics; npm run build; npm test
```

## Exercises

1. Set `falloff` to 1.0 in the skin manifest. What happens to the tips, and why?
2. Replace semi-implicit Euler with explicit Euler (swap the two lines'
   order so θ uses the old ω). Run the "settles" test. What fails?
3. Add an `ahoge` chain: give the ahoge 3 nested segments in the generator
   and a third entry in `manifest.chains`.
4. Self-check: why can't `phys_init` take a `std::vector<float>`?

## References

**Model and integration**
- Glenn Fiedler, *Integration Basics* (why explicit Euler blows up): <https://gafferongames.com/post/integration_basics/>
- Wikipedia, *Semi-implicit Euler method*: <https://en.wikipedia.org/wiki/Semi-implicit_Euler_method>
- Wikipedia, *Featherstone's algorithm*: <https://en.wikipedia.org/wiki/Featherstone%27s_algorithm>

**WebAssembly toolchain**
- Clang attributes, `export_name` ✔ (used and verified by the "exports only what we declared" test): <https://clang.llvm.org/docs/AttributeReference.html#export-name>
- LLVM `wasm-ld` (`--no-entry`, `--strip-all`): <https://lld.llvm.org/WebAssembly.html>
- MDN, `WebAssembly.instantiateStreaming` ✔ (needs `application/wasm`): <https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/instantiateStreaming_static>
- Surma, *Compiling C to WebAssembly without Emscripten*: <https://surma.dev/things/c-to-webassembly/>
- cppreference, language linkage (`extern "C"`): <https://en.cppreference.com/w/cpp/language/language_linkage>
