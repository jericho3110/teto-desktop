// The C ABI surface of the physics module.
//
// C++ mangles names (phys_step becomes something like _Z9phys_stepffff);
// `extern "C"` turns that off so JavaScript can find "phys_step".
// `export_name` tells the wasm linker to export the function by that name.
// Only plain ints/floats cross the boundary: wasm functions can't take
// C++ objects, so the chains live in static memory inside the module.
#include "spring_chain.hpp"

namespace {
constexpr int kMaxChains = 4;
constexpr int kMaxJoints = 16;
teto::SpringChain<kMaxJoints> g_chains[kMaxChains];
int g_count = 0;
}  // namespace

#define EXPORT(name) __attribute__((export_name(#name)))

extern "C" {

EXPORT(phys_init) int phys_init(int chains, int joints, float stiffness, float damping, float falloff) {
    g_count = chains > kMaxChains ? kMaxChains : (chains < 0 ? 0 : chains);
    for (int c = 0; c < g_count; ++c) g_chains[c].configure(joints, stiffness, damping, falloff);
    return g_count;
}

// Stepped per chain: a mirrored drill (the right one) is passed -ax by the
// caller, because its local x axis points the other way.
EXPORT(phys_step_chain) void phys_step_chain(int chain, float dt, float ax, float ay, float gravity) {
    if (chain >= 0 && chain < g_count) g_chains[chain].step(dt, ax, ay, gravity);
}

EXPORT(phys_impulse) void phys_impulse(int chain, float strength) {
    if (chain >= 0 && chain < g_count) g_chains[chain].impulse(strength);
}

// Radians, relative to the parent joint. Positive = the tip swings toward
// +x. SVG's rotate() is clockwise on a y-down screen, which moves a
// hanging tip toward -x, so the renderer uses rotate(-angle).
EXPORT(phys_angle) float phys_angle(int chain, int joint) {
    return (chain >= 0 && chain < g_count) ? g_chains[chain].angle(joint) : 0.f;
}

}  // extern "C"
