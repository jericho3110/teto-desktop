# cpp/: hair physics (C++ → WebAssembly)

| Component | What it is |
| --- | --- |
| [`physics/`](physics/) | spring-chain physics that makes Teto's drills swing; compiled with plain clang to a 1.4 KB WebAssembly module the UI loads |

**Why C++:** numeric code that runs 60 times a second; classes and
templates keep it tidy with zero runtime cost; WebAssembly runs it at
near-native speed inside the webview.

## Commands

Needs LLVM (`winget install LLVM.LLVM`) and Node.

| Command (in `cpp/physics`) | What it does |
| --- | --- |
| `npm run build` | `prebuild` creates `dist/`, then `clang++ --target=wasm32 ...` builds `dist/physics.wasm` (every flag explained in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-build-command-flag-by-flag)) |
| `npm test` | Node loads the real `.wasm` and runs 6 tests |

`npm` here is only a task runner: `package.json` has no dependencies.

## Docs

- [docs/CONCEPTS.md](docs/CONCEPTS.md): every C++ concept used
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the physics model, freestanding wasm, the build
- [CHANGELOG.md](CHANGELOG.md)

## References

- cppreference: <https://en.cppreference.com/>
- LLVM `wasm-ld`: <https://lld.llvm.org/WebAssembly.html>
