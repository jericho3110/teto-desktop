// Particle effects: sparkles, hearts, sweat drops and Zzz's.
//
// Two ideas meet here:
//  1. DATA-ORIENTED memory: particles live in a fixed pool laid out as a
//     "struct of arrays" with a free list, so spawning/despawning is O(1)
//     and JavaScript can read the arrays straight out of wasm memory.
//  2. OBJECT-ORIENTED behavior: each effect is an Emitter subclass that
//     overrides how particles are born and move (inheritance + polymorphism).
#pragma once
#include "spring_chain.hpp"  // sin_approx, clamp (shared inline helpers)

namespace teto::fx {

enum Kind : unsigned char { kSparkle = 0, kHeart = 1, kSweat = 2, kZzz = 3, kKinds = 4, kFree = 255 };

// Tiny deterministic random numbers (xorshift32): no <random> here.
struct Rng {
    unsigned state;
    unsigned next() {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return state;
    }
    float unit() { return static_cast<float>(next() & 0xFFFFFF) / 16777216.f; }  // [0, 1)
    float range(float lo, float hi) { return lo + (hi - lo) * unit(); }
};

// ---- the pool --------------------------------------------------------------
//
// STRUCT OF ARRAYS (SoA): instead of Particle particles[N] (array of
// structs, AoS), each field is its own contiguous array. Loops that touch
// one field read memory sequentially, and each array can be handed to
// JavaScript as one Float32Array.
//
// FREE LIST: free slots form a linked list threaded through next_free[].
// acquire() pops the head, release() pushes it back: both O(1), no search,
// no allocation, no fragmentation. The pool's memory is reserved up front;
// when it's full, new particles are simply skipped.
template <int N>
struct Store {
    float x[N], y[N], vx[N], vy[N], age[N], life[N], size[N], alpha[N];
    unsigned char kind[N];
    int next_free[N];
    // No default member initializers on purpose: an all-zero global goes in
    // .bss (costs nothing in the .wasm file); ANY non-zero initializer would
    // force the whole ~9 KB struct into the DATA section (found by measuring).
    // So the store is only valid after reset(), which fx_init() calls.
    int free_head;
    int alive;

    void reset() {
        for (int i = 0; i < N; ++i) {
            kind[i] = kFree;
            alpha[i] = 0.f;
            next_free[i] = i + 1 < N ? i + 1 : -1;  // 0 → 1 → 2 → ... → N-1 → end
        }
        free_head = 0;
        alive = 0;
    }

    int acquire() {
        if (free_head < 0) return -1;  // pool exhausted
        const int i = free_head;
        free_head = next_free[i];
        ++alive;
        return i;
    }

    void release(int i) {
        kind[i] = kFree;
        alpha[i] = 0.f;  // JS draws nothing for alpha 0
        next_free[i] = free_head;
        free_head = i;
        --alive;
    }

    static constexpr int capacity() { return N; }
};

constexpr int kCapacity = 256;
using ParticleStore = Store<kCapacity>;

// ---- the behavior: an abstract base class -----------------------------------
//
// INHERITANCE + POLYMORPHISM: the update loop calls spawn()/update()
// through a base-class pointer; which code runs depends on the object's
// real type (a virtual call through its vtable).
// TEMPLATE METHOD pattern: tick() is fixed (non-virtual) and calls the
// virtual "steps" that each subclass fills in.
class Emitter {
public:
    explicit Emitter(Kind kind) : kind_(kind) {}

    // Continuous emission: `rate` particles per second at (x, y). 0 = off.
    void stream(float rate, float x, float y) {
        rate_ = clamp(rate, 0.f, 120.f);  // ENCAPSULATION: callers can't set an absurd rate
        x_ = x;
        y_ = y;
    }

    // One burst of `count` particles at (x, y).
    int burst(ParticleStore& s, Rng& rng, int count, float x, float y) {
        int made = 0;
        for (int n = 0; n < count; ++n) made += emit(s, rng, x, y) ? 1 : 0;
        return made;
    }

    // Template method: the timing logic is the same for every effect.
    void tick(ParticleStore& s, Rng& rng, float dt) {
        if (rate_ <= 0.f) return;
        pending_ += rate_ * dt;
        while (pending_ >= 1.f) {
            pending_ -= 1.f;
            emit(s, rng, x_, y_);
        }
    }

    // The two customization points ("pure virtual" = no default, subclasses must provide them).
    virtual void spawn(ParticleStore& s, int i, Rng& rng, float x, float y) = 0;
    virtual void update(ParticleStore& s, int i, float dt) = 0;

protected:
    // Protected, non-virtual destructor: emitters live in the arena and are
    // never deleted through an Emitter*, so no virtual destructor is needed
    // (and the arena never runs destructors anyway).
    ~Emitter() = default;

private:
    bool emit(ParticleStore& s, Rng& rng, float x, float y) {
        const int i = s.acquire();
        if (i < 0) return false;
        s.kind[i] = kind_;
        s.age[i] = 0.f;
        s.alpha[i] = 1.f;
        spawn(s, i, rng, x, y);  // virtual: the subclass sets position, speed, size, life
        return true;
    }

    Kind kind_;
    float rate_ = 0.f, x_ = 0.f, y_ = 0.f, pending_ = 0.f;
};

// Fade in fast, out slowly: 0 → 1 over the first 10% of life, → 0 at the end.
inline float fade(float age, float life) {
    const float t = clamp(age / life, 0.f, 1.f);
    return t < 0.1f ? t * 10.f : 1.f - (t - 0.1f) / 0.9f;
}

// ---- the concrete effects ("final": nothing derives from them) --------------

class Sparkle final : public Emitter {
public:
    Sparkle() : Emitter(kSparkle) {}
    void spawn(ParticleStore& s, int i, Rng& r, float x, float y) override {
        s.x[i] = x + r.range(-60.f, 60.f);
        s.y[i] = y + r.range(-40.f, 20.f);
        s.vx[i] = r.range(-15.f, 15.f);
        s.vy[i] = r.range(-50.f, -20.f);
        s.life[i] = r.range(0.7f, 1.3f);
        s.size[i] = r.range(5.f, 10.f);
    }
    void update(ParticleStore& s, int i, float dt) override {
        s.x[i] += s.vx[i] * dt;
        s.y[i] += s.vy[i] * dt;
        // twinkle: brightness flickers while fading
        s.alpha[i] = fade(s.age[i], s.life[i]) * (0.6f + 0.4f * sin_approx(s.age[i] * 25.f));
    }
};

class Heart final : public Emitter {
public:
    Heart() : Emitter(kHeart) {}
    void spawn(ParticleStore& s, int i, Rng& r, float x, float y) override {
        s.x[i] = x + r.range(-50.f, 50.f);
        s.y[i] = y + r.range(-10.f, 10.f);
        s.vx[i] = r.range(0.f, 6.2831f);  // reused as a phase for the sway
        s.vy[i] = r.range(-45.f, -30.f);
        s.life[i] = r.range(1.5f, 2.2f);
        s.size[i] = r.range(8.f, 12.f);
    }
    void update(ParticleStore& s, int i, float dt) override {
        s.x[i] += 18.f * sin_approx(s.age[i] * 3.f + s.vx[i]) * dt;  // sway side to side
        s.y[i] += s.vy[i] * dt;
        s.alpha[i] = fade(s.age[i], s.life[i]);
    }
};

class Sweat final : public Emitter {
public:
    Sweat() : Emitter(kSweat) {}
    void spawn(ParticleStore& s, int i, Rng& r, float x, float y) override {
        s.x[i] = x + r.range(-8.f, 8.f);
        s.y[i] = y;
        s.vx[i] = r.range(20.f, 60.f);
        s.vy[i] = r.range(-90.f, -50.f);
        s.life[i] = r.range(0.6f, 0.9f);
        s.size[i] = r.range(4.5f, 7.f);
    }
    void update(ParticleStore& s, int i, float dt) override {
        s.vy[i] += 420.f * dt;  // gravity: drops arc and fall
        s.x[i] += s.vx[i] * dt;
        s.y[i] += s.vy[i] * dt;
        s.alpha[i] = fade(s.age[i], s.life[i]);
    }
};

class Zzz final : public Emitter {
public:
    Zzz() : Emitter(kZzz) {}
    void spawn(ParticleStore& s, int i, Rng& r, float x, float y) override {
        s.x[i] = x;
        s.y[i] = y;
        s.vx[i] = r.range(10.f, 18.f);
        s.vy[i] = r.range(-22.f, -14.f);
        s.life[i] = r.range(2.5f, 3.2f);
        s.size[i] = 8.f;
    }
    void update(ParticleStore& s, int i, float dt) override {
        s.x[i] += (s.vx[i] + 8.f * sin_approx(s.age[i] * 2.f)) * dt;
        s.y[i] += s.vy[i] * dt;
        s.size[i] += 5.f * dt;  // grows as it drifts away
        s.alpha[i] = fade(s.age[i], s.life[i]);
    }
};

}  // namespace teto::fx
