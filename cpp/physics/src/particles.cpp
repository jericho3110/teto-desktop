// The C ABI of the particle system (a second translation unit, linked
// with exports.cpp into the same physics.wasm).
//
// Memory layout inside the wasm module's linear memory:
//   g_store        the particle pool (struct of arrays), fixed size
//   g_arena_bytes  4 KB that the arena hands out to the emitter objects
// Nothing is ever malloc'ed, so memory never grows, which matters because
// JavaScript holds typed-array VIEWS into this memory (see particles.ts):
// growing wasm memory would detach every existing view.
#include "memory.hpp"
#include "particles.hpp"

#define EXPORT(name) __attribute__((export_name(#name)))

using namespace teto;
using namespace teto::fx;

namespace {
ParticleStore g_store;                       // static storage: zero-initialized, lives forever
alignas(16) unsigned char g_arena_bytes[4096];
constinit Arena g_arena{g_arena_bytes, sizeof g_arena_bytes};  // built at compile time
Emitter* g_emitters[kKinds] = {};            // non-owning pointers INTO the arena
Rng g_rng{0x7e70u};

Emitter* emitter(int kind) { return (kind >= 0 && kind < kKinds) ? g_emitters[kind] : nullptr; }
}  // namespace

// A pure virtual function is called only if an object is used during its
// own construction. The compiler points those vtable slots at this
// function, which normally comes from the C++ runtime library.
extern "C" void __cxa_pure_virtual() { __builtin_trap(); }

extern "C" {

// (Re)build everything. Returns the arena bytes used by the emitters.
EXPORT(fx_init) int fx_init(unsigned seed) {
    g_arena.reset();  // "free" the old emitters all at once
    g_store.reset();
    g_rng.state = seed ? seed : 0x7e70u;
    // Placement-new each concrete emitter into the arena; keep base pointers.
    g_emitters[kSparkle] = g_arena.create<Sparkle>();
    g_emitters[kHeart] = g_arena.create<Heart>();
    g_emitters[kSweat] = g_arena.create<Sweat>();
    g_emitters[kZzz] = g_arena.create<Zzz>();
    return static_cast<int>(g_arena.used());
}

EXPORT(fx_burst) int fx_burst(int kind, float x, float y, int count) {
    Emitter* e = emitter(kind);
    return e ? e->burst(g_store, g_rng, count, x, y) : 0;
}

EXPORT(fx_stream) void fx_stream(int kind, float rate, float x, float y) {
    if (Emitter* e = emitter(kind)) e->stream(rate, x, y);
}

EXPORT(fx_step) void fx_step(float dt) {
    if (g_emitters[0] == nullptr) return;  // not initialized yet: nothing to do (no null dereference)
    dt = clamp(dt, 0.f, 1.f / 20.f);
    for (int k = 0; k < kKinds; ++k) g_emitters[k]->tick(g_store, g_rng, dt);
    for (int i = 0; i < ParticleStore::capacity(); ++i) {
        const unsigned char k = g_store.kind[i];
        if (k == kFree) continue;
        g_store.age[i] += dt;
        if (g_store.age[i] >= g_store.life[i]) {
            g_store.release(i);  // back on the free list, O(1)
            continue;
        }
        g_emitters[k]->update(g_store, i, dt);  // virtual call: Sparkle/Heart/Sweat/Zzz decides
    }
}

EXPORT(fx_alive) int fx_alive() { return g_emitters[0] ? g_store.alive : 0; }
EXPORT(fx_capacity) int fx_capacity() { return ParticleStore::capacity(); }
EXPORT(fx_arena_used) int fx_arena_used() { return static_cast<int>(g_arena.used()); }

// Where each array lives in linear memory (a byte offset = a wasm32
// pointer). JS wraps it: new Float32Array(memory.buffer, offset, capacity).
// 0 x, 1 y, 2 size, 3 alpha (float32), 4 kind (uint8).
EXPORT(fx_field) unsigned fx_field(int which) {
    const void* p = nullptr;
    switch (which) {
        case 0: p = g_store.x; break;
        case 1: p = g_store.y; break;
        case 2: p = g_store.size; break;
        case 3: p = g_store.alpha; break;
        case 4: p = g_store.kind; break;
        default: return 0;
    }
    return static_cast<unsigned>(reinterpret_cast<__UINTPTR_TYPE__>(p));
}

}  // extern "C"
