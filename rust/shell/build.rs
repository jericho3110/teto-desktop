// Build script: Cargo compiles and runs this BEFORE compiling the crate.
// 1. tauri_build generates code from tauri.conf.json and capabilities/.
// 2. The `cc` crate compiles our C module into a static library and tells
//    Cargo to link it, so `extern "C"` declarations in native.rs resolve.
fn main() {
    let c_dir = std::path::Path::new("../../c/win32hooks");
    cc::Build::new()
        .file(c_dir.join("src/teto_win32.c"))
        .include(c_dir.join("include"))
        .warnings(true)
        .warnings_into_errors(true)
        .compile("teto_win32"); // -> libteto_win32.a / teto_win32.lib

    // GetCursorPos, RegisterHotKey, ... live in user32.lib.
    println!("cargo:rustc-link-lib=user32");

    // Rebuild when the C sources change (build scripts only rerun when told).
    println!("cargo:rerun-if-changed=../../c/win32hooks/src/teto_win32.c");
    println!("cargo:rerun-if-changed=../../c/win32hooks/include/teto_win32.h");

    tauri_build::build()
}
