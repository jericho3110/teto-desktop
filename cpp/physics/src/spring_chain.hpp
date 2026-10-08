// Spring-chain physics for Teto's drills (and anything else that dangles).
//
// Built *freestanding*: no C/C++ standard library is available when we
// compile with `clang --target=wasm32 -nostdlib`, so this file brings its
// own tiny math (sin/cos approximations, clamp). See cpp/docs/CONCEPTS.md.
#pragma once

namespace teto {

// ---- minimal math (no <cmath> in freestanding wasm) --------------------
constexpr float kPi = 3.14159265358979f;

constexpr float clamp(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Wrap to [-pi, pi], then a 7th-order Taylor-style polynomial.
// Max error ~1e-4 rad in range: plenty for hair.
inline float sin_approx(float x) {
    while (x > kPi) x -= 2 * kPi;
    while (x < -kPi) x += 2 * kPi;
    const float x2 = x * x;
    return x * (1.f - x2 / 6.f * (1.f - x2 / 20.f * (1.f - x2 / 42.f)));
}
inline float cos_approx(float x) { return sin_approx(x + kPi / 2); }

// ---- the model ---------------------------------------------------------
//
// Each joint i has a *relative* angle theta[i] (0 = hanging straight down
// in the skin's rest pose) and an angular velocity omega[i]. Per step:
//
//   alpha = -stiffness * theta          spring back to rest shape
//           - damping * omega           lose energy (stops endless wobble)
//           - inertia * (a . normal)    head moves left -> hair swings right
//           - gravity * sin(absolute)   hang downward when tilted
//
// Semi-implicit Euler (update omega, then theta with the new omega) is
// stable for stiff springs at 60 fps, unlike plain explicit Euler.
template <int MaxJoints>
class SpringChain {
public:
    void configure(int joints, float stiffness, float damping, float falloff) {
        joints_ = joints > MaxJoints ? MaxJoints : (joints < 1 ? 1 : joints);
        for (int i = 0; i < joints_; ++i) {
            // Joints near the tip are floppier: stiffness shrinks by `falloff` per joint.
            float k = stiffness;
            for (int j = 0; j < i; ++j) k *= falloff;
            stiffness_[i] = k;
            theta_[i] = omega_[i] = 0.f;
        }
        damping_ = damping;
    }

    // ax, ay: acceleration of the anchor (px/s^2); gravity in px/s^2.
    void step(float dt, float ax, float ay, float gravity) {
        dt = clamp(dt, 0.f, 1.f / 30.f);  // a frozen tab must not explode the sim
        float absolute = 0.f;
        for (int i = 0; i < joints_; ++i) {
            absolute += theta_[i];
            const float c = cos_approx(absolute), s = sin_approx(absolute);
            // Component of the anchor acceleration across the segment.
            const float across = ax * c + ay * s;
            const float depth = 1.f + 0.35f * static_cast<float>(i);  // tips react more
            const float alpha = -stiffness_[i] * theta_[i]
                              - damping_ * omega_[i]
                              - 0.004f * depth * across
                              - 0.002f * gravity * s;
            omega_[i] += alpha * dt;
            theta_[i] += omega_[i] * dt;
            theta_[i] = clamp(theta_[i], -1.2f, 1.2f);  // never fold through itself
        }
    }

    // A sudden kick (head shake, a happy hop, the user poking her).
    void impulse(float strength) {
        for (int i = 0; i < joints_; ++i) omega_[i] += strength * (1.f + 0.25f * static_cast<float>(i));
    }

    float angle(int i) const { return (i >= 0 && i < joints_) ? theta_[i] : 0.f; }
    int joints() const { return joints_; }

private:
    int joints_ = 0;
    float damping_ = 0.f;
    float stiffness_[MaxJoints] = {};
    float theta_[MaxJoints] = {};
    float omega_[MaxJoints] = {};
};

}  // namespace teto
