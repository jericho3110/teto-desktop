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

/// Where the repo's build outputs live. In development that is the repo
/// itself, found from this crate's folder at compile time (env! is a
/// compile-time macro). A packaged release would bundle them instead.
pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
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

/// Start every helper that has been built. Missing ones are skipped with a
/// message: Teto degrades (no voice, no reminders) instead of failing.
pub fn start_all(token: &str, root: &Path) -> Services {
    let mut services = Services::default();
    let logs = log_dir();

    let brain = root.join("go/brain/bin/teto-brain.exe");
    if brain.exists() {
        let mut cmd = Command::new(&brain);
        cmd.arg("-addr")
            .arg(format!("127.0.0.1:{BRAIN_PORT}"))
            .arg("-mood")
            .arg(root.join("python/mood/mood.py"))
            .arg("-reminders")
            .arg(format!("http://127.0.0.1:{REMINDERS_PORT}"));
        spawn(&mut services, "brain", cmd, token, &logs);
    } else {
        eprintln!(
            "supervisor: {} not built (cd go/brain && go build -o bin/teto-brain.exe .)",
            brain.display()
        );
    }

    let java_out = root.join("java/reminders/out");
    if java_out.exists() {
        let mut cmd = Command::new("java");
        cmd.arg("-cp")
            .arg(&java_out)
            .arg("teto.reminders.ReminderServer")
            .arg(REMINDERS_PORT.to_string());
        spawn(&mut services, "reminders", cmd, token, &logs);
    }

    for config in ["Release", "Debug"] {
        let exe = root.join(format!(
            "csharp/Companion/bin/{config}/net10.0-windows/TetoCompanion.exe"
        ));
        if exe.exists() {
            spawn(&mut services, "companion", Command::new(exe), token, &logs);
            break;
        }
    }
    services
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
        let mut s = start_all("t", &empty);
        assert!(s.names().is_empty());
        s.stop();
    }
}
