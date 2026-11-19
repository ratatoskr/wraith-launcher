//! Installs each Wraith version beside the old ones, since a game might still have one loaded.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};

const MANIFEST_URL: &str = "https://dist.wraith.io/wraith/latest.json";
/// How long to wait for the latest release info before just running what's installed.
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Installed {
    pub version: String,
    pub exe: PathBuf,
}

#[derive(Debug, PartialEq, Deserialize)]
pub struct Release {
    pub version: String,
    url: String,
    sha256: String,
}

pub fn root() -> Result<PathBuf, String> {
    Ok(crate::cli::root()?.join("framework"))
}

/// e.g. `v0.2.0`.
fn folder(version: &str) -> String {
    format!("v{version}")
}

pub fn current(root: &Path) -> Option<Installed> {
    let folder = std::fs::read_to_string(root.join("current.txt")).ok()?;
    let folder = folder.trim();
    let exe = root.join(folder).join("wraith.exe");
    exe.is_file().then(|| Installed {
        version: folder.trim_start_matches('v').to_owned(),
        exe,
    })
}

async fn download(url: &str, timeout: Option<Duration>) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("WraithUI/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("Couldn't make an HTTP client: {e}"))?;
    let mut request = client.get(url);
    if let Some(timeout) = timeout {
        request = request.timeout(timeout);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Couldn't reach {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} answered {}", response.status()));
    }
    response
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Couldn't download {url}: {e}"))
}

pub async fn latest() -> Result<Release, String> {
    let json = download(MANIFEST_URL, Some(CHECK_TIMEOUT)).await?;
    serde_json::from_slice(&json).map_err(|e| format!("{MANIFEST_URL} isn't a Wraith release: {e}"))
}

pub async fn install(root: &Path, release: &Release) -> Result<Installed, String> {
    let dir = root.join(folder(&release.version));
    if !dir.join("wraith.exe").is_file() {
        let zip = download(&release.url, None).await?;
        check(release, &zip)?;
        let (root, version) = (root.to_owned(), release.version.clone());
        tauri::async_runtime::spawn_blocking(move || unpack(&root, &version, &zip))
            .await
            .map_err(|e| e.to_string())??;
    }
    make_current(root, &release.version)
}

fn check(release: &Release, zip: &[u8]) -> Result<(), String> {
    let got = Sha256::digest(zip)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    if got.eq_ignore_ascii_case(&release.sha256) {
        Ok(())
    } else {
        Err(format!(
            "Wraith {}'s download is corrupt (its SHA-256 is {got}, not {})",
            release.version, release.sha256
        ))
    }
}

/// Via a temp folder so a half-done unpack never looks installed.
fn unpack(root: &Path, version: &str, zip: &[u8]) -> Result<(), String> {
    let partial = root.join(format!(".{}.partial", folder(version)));
    let result = unpack_into(&partial, root, version, zip);
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&partial);
    }
    result
}

fn unpack_into(partial: &Path, root: &Path, version: &str, zip: &[u8]) -> Result<(), String> {
    let dir = root.join(folder(version));
    let failed = |e: &dyn std::fmt::Display| format!("Couldn't unpack Wraith {version}: {e}");
    if partial.exists() {
        std::fs::remove_dir_all(partial).map_err(|e| failed(&e))?;
    }
    std::fs::create_dir_all(partial).map_err(|e| failed(&e))?;
    let mut archive = zip::ZipArchive::new(Cursor::new(zip)).map_err(|e| failed(&e))?;
    archive.extract(partial).map_err(|e| failed(&e))?;
    if !partial.join("wraith.exe").is_file() {
        return Err(failed(&"there's no wraith.exe in it"));
    }
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| failed(&e))?;
    }
    std::fs::rename(partial, &dir).map_err(|e| failed(&e))
}

/// Written then renamed over, so it's never half written.
fn make_current(root: &Path, version: &str) -> Result<Installed, String> {
    let failed = |e: std::io::Error| format!("Couldn't make Wraith {version} the one to run: {e}");
    let next = root.join("current.txt.next");
    std::fs::write(&next, format!("{}\n", folder(version))).map_err(failed)?;
    std::fs::rename(&next, root.join("current.txt")).map_err(failed)?;
    current(root).ok_or_else(|| format!("Wraith {version} didn't install"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Under the system temp dir. Deleted on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("wraith-ui-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn zip_of(files: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in files {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(data.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn hash_mismatch() {
        // SHA-256 of "abc"
        let release: Release = serde_json::from_str(
            r#"{"version":"0.2.0","url":"https://dist.wraith.io/wraith/0.2.0/wraith-0.2.0-windows-x64.zip",
                "sha256":"BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"}"#,
        )
        .unwrap();
        assert!(check(&release, b"abc").is_ok());
        assert!(check(&release, b"abd").is_err());
    }

    #[test]
    fn versions_side_by_side() {
        let root = TempDir::new("install");
        assert!(current(&root.0).is_none());

        unpack(
            &root.0,
            "0.1.0",
            &zip_of(&[("wraith.exe", "1"), ("x64/wraith_bootstrap.dll", "")]),
        )
        .unwrap();
        make_current(&root.0, "0.1.0").unwrap();
        unpack(&root.0, "0.2.0", &zip_of(&[("wraith.exe", "2")])).unwrap();
        let installed = make_current(&root.0, "0.2.0").unwrap();

        assert_eq!(installed.version, "0.2.0");
        assert_eq!(std::fs::read_to_string(&installed.exe).unwrap(), "2");
        assert_eq!(current(&root.0).unwrap().version, "0.2.0");
        // Old one stays for games that still have it loaded
        assert!(root.0.join("v0.1.0/x64/wraith_bootstrap.dll").is_file());
        assert_eq!(
            std::fs::read_to_string(root.0.join("current.txt"))
                .unwrap()
                .trim(),
            "v0.2.0"
        );
    }

    #[test]
    fn zip_without_wraith() {
        let root = TempDir::new("bad-zip");
        assert!(unpack(&root.0, "0.3.0", &zip_of(&[("readme.txt", "")])).is_err());
        assert!(!root.0.join("v0.3.0").exists());
        assert!(!root.0.join(".v0.3.0.partial").exists());
    }
}
