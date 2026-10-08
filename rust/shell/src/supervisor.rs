//! Starts and stops Teto's helper processes: the Go brain, the Java
//! reminder service and the C# companion. Each gets the shared token in
//! its environment (never on the command line, which other programs can read).

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub const BRAIN_PORT: u16 = 47800;
pub const REMINDERS_PORT: u16 = 47801;

/// 32 random bytes from the operating system, hex-encoded (64 chars).
/// Rust's standard library has no random number generator, hence getrandom.
pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("the OS random number generator is unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Where every helper lives. Two layouts:
/// - **dev** (`cargo tauri dev`, debug builds): the repo's own build outputs.
/// - **installed** (release builds from the installer): files next to the exe.
#[derive(Debug, Clone, PartialEq)]
pub struct Layout {
    pub brain: PathBuf,
    pub mood_script: PathBuf,
    pub java: PathBuf, // a java.exe path, or just "java" (looked up on PATH)
    pub java_classes: PathBuf,
    pub companion: PathBuf,
}

impl Layout {
    /// The repo layout. `env!` is a compile-time macro, so it's only
    /// compiled into DEBUG builds: a release binary must not contain the
    /// developer's folder path (it includes their Windows user name).
    #[cfg(debug_assertions)]
    pub fn dev() -> Self {
        Self::dev_at(&Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(".."))
    }

    // Used by debug builds (and tests); unused in release builds.
    #[cfg_attr(not(debug_assertions), allow(dead_code))]
    pub fn dev_at(root: &Path) -> Self {
        Self {
            brain: root.join("go/brain/bin/teto-brain.exe"),
            mood_script: root.join("python/mood/mood.py"),
            java: PathBuf::from("java"),
            java_classes: root.join("java/reminders/out"),
            companion: root.join("csharp/Companion/bin/Release/net10.0-windows/TetoCompanion.exe"),
        }
    }

    /// The installer's layout (see docs/PACKAGING.md): sidecars next to the
    /// exe, resources under helpers/, and a bundled jlink Java runtime.
    // Used by release builds (and tests); unused in debug builds.
    #[cfg_attr(debug_assertions, allow(dead_code))]
    pub fn installed_at(dir: &Path) -> Self {
        Self {
            brain: dir.join("teto-brain.exe"),
            mood_script: dir.join("helpers/mood/mood.py"),
            java: dir.join("helpers/java/runtime/bin/java.exe"),
            java_classes: dir.join("helpers/java/classes"),
            companion: dir.join("TetoCompanion.exe"),
        }
    }

    pub fn detect() -> Self {
        #[cfg(debug_assertions)]
        {
            Self::dev()
        }
        #[cfg(not(debug_assertions))]
        {
            let exe = std::env::current_exe().unwrap_or_default();
            Self::installed_at(exe.parent().unwrap_or(Path::new(".")))
        }
    }
}

/// The running helpers. Dropping this does NOT stop them; call `stop()`.
/// (Even if we crash, the C job object kills them: see native.rs.)
#[derive(Default)]
pub struct Services {
    children: Vec<(&'static str, Child)>,
}

impl Services {
    pub fn stop(&mut self) {
        for (name, child) in &mut self.children {
            if let Err(e) = child.kill() {
                eprintln!("supervisor: could not stop {name}: {e}");
            }
            let _ = child.wait(); // reap it, so it doesn't linger as a zombie entry
        }
        self.children.clear();
    }

    pub fn names(&self) -> Vec<&'static str> {
        self.children.iter().map(|(n, _)| *n).collect()
    }
}

/// Start every helper that exists. Missing ones are skipped with a
/// message: Teto degrades (no voice, no reminders) instead of failing.
pub fn start_all(token: &str, layout: &Layout) -> Services {
    let mut services = Services::default();
    let logs = log_dir();

    if layout.brain.exists() {
        let mut cmd = Command::new(&layout.brain);
        cmd.arg("-addr")
            .arg(format!("127.0.0.1:{BRAIN_PORT}"))
            .arg("-mood")
            .arg(&layout.mood_script)
            .arg("-reminders")
            .arg(format!("http://127.0.0.1:{REMINDERS_PORT}"));
        spawn(&mut services, "brain", cmd, token, &logs);
    } else {
        eprintln!(
            "supervisor: brain not found at {} (python main.py build)",
            layout.brain.display()
        );
    }

    if layout.java_classes.exists() {
        let mut cmd = Command::new(&layout.java);
        cmd.arg("-cp")
            .arg(&layout.java_classes)
            .arg("teto.reminders.ReminderServer")
            .arg(REMINDERS_PORT.to_string());
        spawn(&mut services, "reminders", cmd, token, &logs);
    }

    // The companion is a framework-dependent .NET app: without the .NET
    // Desktop Runtime it would pop up an error dialog, so check first.
    if layout.companion.exists() && dotnet_desktop_runtime_installed() {
        spawn(
            &mut services,
            "companion",
            Command::new(&layout.companion),
            token,
            &logs,
        );
    }
    services
}

/// Is `Microsoft.WindowsDesktop.App` 10.x installed (what the companion needs)?
fn dotnet_desktop_runtime_installed() -> bool {
    let program_files = std::env::var_os("ProgramFiles")
        .map(PathBuf::from)
        .unwrap_or_default();
    let shared = program_files.join("dotnet/shared/Microsoft.WindowsDesktop.App");
    fs::read_dir(shared)
        .map(|entries| {
            entries
                .flatten()
                .any(|e| e.file_name().to_string_lossy().starts_with("10."))
        })
        .unwrap_or(false)
}

fn spawn(services: &mut Services, name: &'static str, mut cmd: Command, token: &str, logs: &Path) {
    cmd.env("TETO_TOKEN", token).stdin(Stdio::null());
    // Each helper's output goes to %LOCALAPPDATA%\Teto\logs\<name>.log.
    if let Ok(f) = File::create(logs.join(format!("{name}.log"))) {
        if let Ok(f2) = f.try_clone() {
            cmd.stdout(f).stderr(f2);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000; // no console window popping up per helper
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.spawn() {
        Ok(child) => services.children.push((name, child)),
        Err(e) => eprintln!("supervisor: could not start {name}: {e}"),
    }
}

fn log_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("Teto").join("logs");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_long_hex_and_unique() {
        let (a, b) = (new_token(), new_token());
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn missing_helpers_are_skipped_not_fatal() {
        let empty = std::env::temp_dir().join("teto-no-such-repo");
        for layout in [Layout::dev_at(&empty), Layout::installed_at(&empty)] {
            let mut s = start_all("t", &layout);
            assert!(s.names().is_empty());
            s.stop();
        }
    }

    #[test]
    fn installed_layout_keeps_everything_next_to_the_exe() {
        let dir = Path::new(r"C:\Program Files\Teto");
        let l = Layout::installed_at(dir);
        for p in [
            &l.brain,
            &l.mood_script,
            &l.java,
            &l.java_classes,
            &l.companion,
        ] {
            assert!(
                p.starts_with(dir),
                "{} escapes the install folder",
                p.display()
            );
        }
    }
}
