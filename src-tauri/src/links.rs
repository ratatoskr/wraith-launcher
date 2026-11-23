//! `wraith://` links, like the hub's Install button. Only ever asks: the UI shows the mod and the
//! player installs it, so a web page can't install anything by itself.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

/// What the UI listens for, with the mod's id.
pub const EVENT: &str = "launcher://install";

/// Asked for before the UI was listening, for it to take once it is.
#[derive(Default)]
pub struct Asked(Mutex<Option<String>>);

impl Asked {
    pub fn take(&self) -> Option<String> {
        self.0.lock().ok()?.take()
    }
}

/// The mod `wraith://install/<id>` asks for. Ids are what the hub allows, so anything else is refused.
pub fn install_id(url: &str) -> Option<String> {
    let rest = strip_prefix_ignore_case(url, "wraith://install/")?;
    let id = rest.trim_end_matches('/');
    let ok = (1..=64).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-' || b == b'.');
    ok.then(|| id.to_owned())
}

fn strip_prefix_ignore_case<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &s[prefix.len()..])
}

/// From the first launch or one forwarded by another. Brings the window up and tells the UI.
pub fn open(app: &AppHandle, urls: impl IntoIterator<Item = String>) {
    let Some(id) = urls.into_iter().find_map(|u| install_id(&u)) else {
        return;
    };
    if let Some(asked) = app.try_state::<Asked>() {
        if let Ok(mut slot) = asked.0.lock() {
            *slot = Some(id.clone());
        }
    }
    show(app);
    let _ = app.emit(EVENT, id);
}

/// Up front, since a link click usually comes from a browser in front of it.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::install_id;

    #[test]
    fn install_links_name_a_mod() {
        assert_eq!(install_id("wraith://install/kai_bones").as_deref(), Some("kai_bones"));
        assert_eq!(install_id("WRAITH://Install/unity-cam.v2/").as_deref(), Some("unity-cam.v2"));
    }

    #[test]
    fn anything_else_is_refused() {
        for url in [
            "wraith://install/",
            "wraith://install/../../evil",
            "wraith://install/Kai",
            "wraith://install/a b",
            "wraith://install/a?then=run",
            "wraith://remove/kai_bones",
            "https://install/kai_bones",
            "wraith://inst",
        ] {
            assert_eq!(install_id(url), None, "{url}");
        }
        assert_eq!(install_id(&format!("wraith://install/{}", "a".repeat(65))), None);
    }
}
