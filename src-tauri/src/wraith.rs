//! Runs `wraith.exe serve`, one JSON message per line each way. See wraith's `src/cli/serve.zig`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{Mutex, oneshot};

use crate::install;

/// Matches wraith's `serve.protocol`. Bump both on incompatible changes.
const PROTOCOL: u64 = 3;

pub const EVENT: &str = "wraith://event";
pub const STATUS_EVENT: &str = "wraith://status";

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Status {
    Starting,
    Installing {
        version: String,
    },
    Ready {
        version: String,
    },
    /// `needs` is "wraith" if it's older than us, "launcher" if newer.
    Mismatch {
        version: String,
        needs: &'static str,
        /// A dev build (`WRAITH` or the repo next door).
        dev: bool,
    },
    Failed {
        error: String,
    },
    Exited,
}

/// Errors are wraith's, like `NotOurs`, or ours, like `WraithNotRunning`.
pub type Reply = Result<Value, String>;

pub struct Wraith {
    status: StdMutex<Status>,
    /// Running a dev build of wraith (`overridden`), for telling the player what to update.
    dev: std::sync::atomic::AtomicBool,
    stdin: Mutex<Option<ChildStdin>>,
    pending: StdMutex<HashMap<u64, oneshot::Sender<Reply>>>,
    /// Killed on drop. It also exits when stdin closes.
    child: StdMutex<Option<Child>>,
}

impl Wraith {
    pub fn new() -> Self {
        Self {
            status: StdMutex::new(Status::Starting),
            dev: std::sync::atomic::AtomicBool::new(false),
            stdin: Mutex::new(None),
            pending: StdMutex::new(HashMap::new()),
            child: StdMutex::new(None),
        }
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    pub async fn start(self: Arc<Self>, app: AppHandle) {
        let stdout = match self.prepare(&app).await {
            Ok(exe) => self.spawn(&exe).await,
            Err(error) => Err(error),
        };
        let stdout = match stdout {
            Ok(stdout) => stdout,
            Err(error) => return self.set_status(&app, Status::Failed { error }),
        };
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            self.receive(&app, &line);
        }
        self.exited(&app);
    }

    /// A dev override wins. If we can't check for updates, we run what's installed.
    async fn prepare(&self, app: &AppHandle) -> Result<PathBuf, String> {
        if let Some(exe) = overridden() {
            self.dev.store(true, std::sync::atomic::Ordering::Relaxed);
            return Ok(exe);
        }
        let root = install::root()?;
        let installed = install::current(&root);
        match install::latest().await {
            Ok(release)
                if installed
                    .as_ref()
                    .is_none_or(|i| i.version != release.version) =>
            {
                self.set_status(
                    app,
                    Status::Installing {
                        version: release.version.clone(),
                    },
                );
                match install::install(&root, &release).await {
                    Ok(new) => return Ok(new.exe),
                    Err(error) if installed.is_none() => return Err(error),
                    Err(error) => eprintln!("Couldn't update Wraith: {error}"),
                }
            }
            Ok(_) => {}
            Err(error) if installed.is_none() => return Err(error),
            Err(error) => eprintln!("Couldn't check for a newer Wraith: {error}"),
        }
        installed
            .map(|i| i.exe)
            .ok_or_else(|| "Wraith isn't installed".into())
    }

    async fn spawn(&self, exe: &Path) -> Result<tokio::process::ChildStdout, String> {
        let mut command = Command::new(exe);
        command
            .arg("serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Couldn't start {}: {e}", exe.display()))?;
        let stdout = child.stdout.take().expect("stdout is piped");
        *self.stdin.lock().await = child.stdin.take();
        *self.child.lock().unwrap() = Some(child);
        Ok(stdout)
    }

    /// `id` must be unique among running requests.
    pub async fn request(&self, id: u64, method: &str, params: Value) -> Reply {
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().unwrap();
            if pending.contains_key(&id) {
                return Err("DuplicateId".into());
            }
            pending.insert(id, tx);
        }
        let line = json!({ "id": id, "method": method, "params": params }).to_string() + "\n";
        if self.write(line.as_bytes()).await.is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err("WraithNotRunning".into());
        }
        rx.await.unwrap_or_else(|_| Err("WraithExited".into()))
    }

    async fn write(&self, bytes: &[u8]) -> std::io::Result<()> {
        let mut stdin = self.stdin.lock().await;
        let stdin = stdin.as_mut().ok_or(std::io::ErrorKind::NotConnected)?;
        stdin.write_all(bytes).await?;
        stdin.flush().await
    }

    fn receive(&self, app: &AppHandle, line: &str) {
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            eprintln!("wraith sent something that isn't JSON: {line}");
            return;
        };
        if let Some(event) = message.get("event").and_then(Value::as_str) {
            if event == "ready" {
                self.ready(app, &message);
            }
            let _ = app.emit(EVENT, &message);
            return;
        }
        // No id means wraith couldn't read it, so there's no one to tell
        let Some(id) = message.get("id").and_then(Value::as_u64) else {
            eprintln!("wraith couldn't read a request: {line}");
            return;
        };
        let reply = match message.get("error") {
            Some(error) => Err(error.as_str().unwrap_or("Unknown").to_owned()),
            None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
        };
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(reply);
        }
    }

    fn ready(&self, app: &AppHandle, message: &Value) {
        // Before protocols, or not wraith at all. Too old either way
        let protocol = message.get("protocol").and_then(Value::as_u64).unwrap_or(0);
        let version = message
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("?")
            .to_owned();
        let dev = self.dev.load(std::sync::atomic::Ordering::Relaxed);
        self.set_status(app, ready_status(protocol, version, dev));
    }

    fn exited(&self, app: &AppHandle) {
        for (_, tx) in self.pending.lock().unwrap().drain() {
            let _ = tx.send(Err("WraithExited".into()));
        }
        if !matches!(
            self.status(),
            Status::Failed { .. } | Status::Mismatch { .. }
        ) {
            self.set_status(app, Status::Exited);
        }
    }

    fn set_status(&self, app: &AppHandle, status: Status) {
        *self.status.lock().unwrap() = status.clone();
        let _ = app.emit(STATUS_EVENT, status);
    }
}

fn ready_status(protocol: u64, version: String, dev: bool) -> Status {
    match protocol.cmp(&PROTOCOL) {
        std::cmp::Ordering::Equal => Status::Ready { version },
        order => Status::Mismatch {
            version,
            needs: if order.is_lt() { "wraith" } else { "launcher" },
            dev,
        },
    }
}

/// `WRAITH` if set, else in debug builds the one built in ../wraith.
fn overridden() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("WRAITH").filter(|p| !p.is_empty()) {
        let path = PathBuf::from(path);
        return Some(if path.is_dir() {
            path.join("wraith.exe")
        } else {
            path
        });
    }
    #[cfg(debug_assertions)]
    {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../wraith/zig-out/bin/wraith.exe");
        if dev.exists() {
            return Some(dev);
        }
    }
    None
}

#[cfg(test)]
mod protocol_tests {
    use super::*;

    #[test]
    fn older_side_updates() {
        assert!(matches!(
            ready_status(PROTOCOL, "1.0.0".into(), false),
            Status::Ready { .. }
        ));
        assert!(matches!(
            ready_status(PROTOCOL - 1, "0.9.0".into(), true),
            Status::Mismatch {
                needs: "wraith",
                dev: true,
                ..
            }
        ));
        assert!(matches!(
            ready_status(PROTOCOL + 1, "2.0.0".into(), false),
            Status::Mismatch {
                needs: "launcher",
                ..
            }
        ));
        // No protocol at all is an old wraith
        assert!(matches!(
            ready_status(0, "?".into(), false),
            Status::Mismatch {
                needs: "wraith",
                ..
            }
        ));
    }
}
