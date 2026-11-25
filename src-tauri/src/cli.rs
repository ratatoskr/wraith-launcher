//! The `wraith` shim in `<root>\bin`. Forwards to `WRAITH`, else the launcher's install.

use std::path::{Path, PathBuf};

pub fn root() -> Result<PathBuf, String> {
    if let Some(root) = std::env::var_os("WRAITH_ROOT").filter(|r| !r.is_empty()) {
        return Ok(root.into());
    }
    let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA isn't set")?;
    Ok(PathBuf::from(local).join("Wraith"))
}

/// What goes on PATH.
pub fn bin_dir(root: &Path) -> PathBuf {
    root.join("bin")
}

fn saved_file(root: &Path) -> PathBuf {
    root.join("settings").join("launcher_wraith_exe.txt")
}

/// The wraith.exe picked in the launcher's Dev tab, used like `WRAITH`.
pub fn saved_exe(root: &Path) -> Option<std::ffi::OsString> {
    let text = std::fs::read_to_string(saved_file(root)).ok()?;
    let path = text.trim();
    (!path.is_empty()).then(|| path.into())
}

/// None goes back to the installed one.
pub fn set_saved_exe(root: &Path, exe: Option<&Path>) -> Result<(), String> {
    let file = saved_file(root);
    let Some(exe) = exe else {
        return match std::fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(format!("Couldn't remove {}: {e}", file.display()))
            }
            _ => Ok(()),
        };
    };
    let exe = exe_in(exe);
    if !exe.is_file() {
        return Err(format!("There's no wraith.exe at {}", exe.display()));
    }
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Couldn't make {}: {e}", dir.display()))?;
    }
    std::fs::write(&file, exe.to_string_lossy().as_bytes())
        .map_err(|e| format!("Couldn't write {}: {e}", file.display()))
}

/// A folder means the wraith.exe in it.
pub fn exe_in(path: &Path) -> PathBuf {
    if path.is_dir() {
        path.join("wraith.exe")
    } else {
        path.to_path_buf()
    }
}

/// `WRAITH`, else the one picked in the Dev tab.
pub fn override_of(
    wraith_env: Option<&std::ffi::OsStr>,
    root: &Path,
) -> Option<std::ffi::OsString> {
    wraith_env
        .filter(|e| !e.is_empty())
        .map(|e| e.to_os_string())
        .or_else(|| saved_exe(root))
}

/// `this` is the shim, so an override pointing back at it is skipped.
pub fn find(
    wraith_env: Option<&std::ffi::OsStr>,
    root: &Path,
    this: &Path,
) -> Result<PathBuf, String> {
    if let Some(env) = override_of(wraith_env, root) {
        let exe = exe_in(Path::new(&env));
        if !same_file(&exe, this) {
            return if exe.is_file() {
                Ok(exe)
            } else {
                Err(format!(
                    "Wraith is set to {} (WRAITH, or the launcher's Dev tab), but there's no wraith.exe there",
                    exe.display()
                ))
            };
        }
    }
    let versions = root.join("framework");
    let folder = std::fs::read_to_string(versions.join("current.txt")).unwrap_or_default();
    let exe = versions.join(folder.trim()).join("wraith.exe");
    if !folder.trim().is_empty() && exe.is_file() {
        return Ok(exe);
    }
    Err(
        "Wraith isn't installed: open the Wraith app to install it, or set WRAITH to a wraith.exe"
            .into(),
    )
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Skipped while it's running, it'll catch up next time.
pub fn place_shim(shim: &Path, root: &Path) -> Result<(), String> {
    let dir = bin_dir(root);
    let target = dir.join("wraith.exe");
    let new = std::fs::read(shim).map_err(|e| format!("Couldn't read {}: {e}", shim.display()))?;
    if std::fs::read(&target).is_ok_and(|old| old == new) {
        return Ok(());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make {}: {e}", dir.display()))?;
    // Beside it then over it, so it's never half written
    let next = dir.join("wraith.exe.next");
    std::fs::write(&next, &new).map_err(|e| format!("Couldn't write {}: {e}", next.display()))?;
    std::fs::rename(&next, &target).map_err(|e| {
        let _ = std::fs::remove_file(&next);
        format!("Couldn't update {}: {e}", target.display())
    })
}

fn same_dir(a: &str, b: &str) -> bool {
    a.trim()
        .trim_end_matches(['\\', '/'])
        .eq_ignore_ascii_case(b.trim().trim_end_matches(['\\', '/']))
}

pub fn has_dir(path: &str, dir: &str) -> bool {
    path.split(';').any(|p| same_dir(p, dir))
}

/// Adds `dir` on the end, or removes it anywhere. Empty entries go too.
pub fn with_dir(path: &str, dir: &str, on: bool) -> String {
    let mut parts: Vec<&str> = path
        .split(';')
        .filter(|p| !p.trim().is_empty() && !same_dir(p, dir))
        .collect();
    if on {
        parts.push(dir);
    }
    parts.join(";")
}

#[cfg(windows)]
mod user_path {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_EXPAND_SZ};

    fn key(write: bool) -> Result<RegKey, String> {
        let flags = if write {
            KEY_READ | KEY_WRITE
        } else {
            KEY_READ
        };
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags("Environment", flags)
            .map_err(|e| format!("Couldn't open the user's environment: {e}"))
    }

    /// Unexpanded. Empty if there isn't one.
    pub fn get() -> Result<String, String> {
        Ok(key(false)?
            .get_value::<String, _>("Path")
            .unwrap_or_default())
    }

    /// As `REG_EXPAND_SZ` so `%VARS%` keep working.
    pub fn set(value: &str) -> Result<(), String> {
        let mut bytes: Vec<u8> = value
            .encode_utf16()
            .chain([0])
            .flat_map(u16::to_le_bytes)
            .collect();
        bytes.shrink_to_fit();
        let raw = winreg::RegValue {
            vtype: REG_EXPAND_SZ,
            bytes: bytes.into(),
        };
        key(true)?
            .set_raw_value("Path", &raw)
            .map_err(|e| format!("Couldn't change PATH: {e}"))?;
        broadcast();
        Ok(())
    }

    /// So Explorer and new terminals see the change without signing out.
    fn broadcast() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            HWND_BROADCAST, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_SETTINGCHANGE,
        };
        let what: Vec<u16> = "Environment".encode_utf16().chain([0]).collect();
        let mut result = 0;
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                what.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                5000,
                &mut result,
            );
        }
    }
}

#[cfg(windows)]
pub fn on_path(root: &Path) -> Result<bool, String> {
    Ok(has_dir(
        &user_path::get()?,
        &bin_dir(root).to_string_lossy(),
    ))
}

#[cfg(windows)]
pub fn set_on_path(root: &Path, on: bool) -> Result<(), String> {
    let current = user_path::get()?;
    let dir = bin_dir(root).to_string_lossy().into_owned();
    let next = with_dir(&current, &dir, on);
    if next != current {
        user_path::set(&next)?;
    }
    Ok(())
}

/// For the uninstaller. Takes it off PATH and deletes the shim.
#[cfg(windows)]
pub fn remove(root: &Path) {
    let _ = set_on_path(root, false);
    let _ = std::fs::remove_dir_all(bin_dir(root));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_add_remove() {
        let dir = r"C:\Users\u\AppData\Local\Wraith\bin";
        let on = with_dir(r"C:\a;;%USERPROFILE%\b", dir, true);
        assert_eq!(on, format!(r"C:\a;%USERPROFILE%\b;{dir}"));
        assert!(has_dir(&on, &dir.to_lowercase()));
        assert_eq!(
            with_dir(&format!(r"{dir}\;C:\a"), dir, true),
            format!(r"C:\a;{dir}")
        );
        let off = with_dir(&format!(r"C:\a;{}\", dir.to_uppercase()), dir, false);
        assert_eq!(off, r"C:\a");
        assert!(!has_dir(&off, dir));
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wraith-ui-cli-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn wraith_lookup_order() {
        let root = temp("find");
        let this = root.join("bin").join("wraith.exe");
        std::fs::create_dir_all(this.parent().unwrap()).unwrap();
        std::fs::write(&this, "shim").unwrap();
        assert!(find(None, &root, &this).is_err());

        let installed = root.join("framework").join("v0.2.0").join("wraith.exe");
        std::fs::create_dir_all(installed.parent().unwrap()).unwrap();
        std::fs::write(&installed, "").unwrap();
        std::fs::write(root.join("framework").join("current.txt"), "v0.2.0\n").unwrap();
        assert_eq!(find(None, &root, &this).unwrap(), installed);

        // A folder or the exe. Pointing at the shim itself is ignored
        let dev = root.join("dev");
        std::fs::create_dir_all(&dev).unwrap();
        std::fs::write(dev.join("wraith.exe"), "").unwrap();
        assert_eq!(
            find(Some(dev.as_os_str()), &root, &this).unwrap(),
            dev.join("wraith.exe")
        );
        assert_eq!(
            find(Some(this.parent().unwrap().as_os_str()), &root, &this).unwrap(),
            installed
        );
        assert!(find(Some(root.join("nope").as_os_str()), &root, &this).is_err());

        // Picked in the Dev tab, under WRAITH
        assert!(set_saved_exe(&root, Some(&root.join("nope"))).is_err());
        set_saved_exe(&root, Some(&dev)).unwrap();
        assert_eq!(find(None, &root, &this).unwrap(), dev.join("wraith.exe"));
        assert_eq!(
            find(Some(installed.as_os_str()), &root, &this).unwrap(),
            installed
        );
        set_saved_exe(&root, None).unwrap();
        assert_eq!(find(None, &root, &this).unwrap(), installed);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn shim_copy() {
        let root = temp("place");
        let shim = root.join("launcher-wraith.exe");
        std::fs::write(&shim, "one").unwrap();
        place_shim(&shim, &root).unwrap();
        assert_eq!(
            std::fs::read_to_string(bin_dir(&root).join("wraith.exe")).unwrap(),
            "one"
        );
        std::fs::write(&shim, "two").unwrap();
        place_shim(&shim, &root).unwrap();
        assert_eq!(
            std::fs::read_to_string(bin_dir(&root).join("wraith.exe")).unwrap(),
            "two"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
