// Memory building blocks for freestanding C++ (no malloc, no <new>).
//
// WebAssembly gives the module ONE flat byte array ("linear memory").
// Without a standard library there's no malloc/new, so we manage memory
// ourselves with two classic tools:
//   * Arena (bump allocator): hand out memory by moving a pointer forward;
//     free everything at once with reset(). Great for "lives as long as
//     the system" objects (our emitters).
//   * Placement new: construct an object in memory we already own.
// See cpp/docs/CONCEPTS.md ("Memory management") and docs/MEMORY.md.
#pragma once

namespace teto {

// The type of sizeof(...). Normally from <cstddef>, which we don't have.
using size_t = decltype(sizeof(0));

}  // namespace teto

// Placement new: "construct a T at this address" (no allocation happens).
// Normally declared in <new>; in freestanding code we provide it ourselves.
inline void* operator new(teto::size_t, void* where) noexcept { return where; }

namespace teto {

class Arena {
public:
    // constexpr constructor: a global Arena is built at COMPILE time
    // (constant initialization), so no startup code is needed in wasm.
    constexpr Arena(unsigned char* buffer, size_t capacity) : buf_(buffer), cap_(capacity) {}

    // Not copyable: two arenas handing out the same bytes would be a bug.
    Arena(const Arena&) = delete;
    Arena& operator=(const Arena&) = delete;

    // Bump allocation: round `used_` up to the alignment, hand out the
    // block, move the pointer. O(1), no headers, no fragmentation.
    void* allocate(size_t size, size_t align) {
        const size_t start = (used_ + align - 1) & ~(align - 1);  // align must be a power of two
        if (start + size > cap_) return nullptr;                    // out of arena memory
        used_ = start + size;
        return buf_ + start;
    }

    // Allocate + construct. Returns nullptr if the arena is full.
    template <typename T, typename... Args>
    T* create(Args... args) {
        void* mem = allocate(sizeof(T), alignof(T));
        return mem ? new (mem) T(args...) : nullptr;
    }

    // Frees EVERYTHING at once. Destructors are NOT run, so only put
    // objects here whose destructors do nothing (ours own no resources).
    void reset() { used_ = 0; }

    size_t used() const { return used_; }
    size_t capacity() const { return cap_; }

private:
    unsigned char* buf_;
    size_t cap_;
    size_t used_ = 0;
};

}  // namespace teto
