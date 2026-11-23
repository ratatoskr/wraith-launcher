//! Games' art. First from what their store keeps on this PC: only Steam does, in its library cache,
//! as `<appid>_header.jpg` in older ones and a folder per game in newer ones. Then the Wraith Hub's
//! copies on dist, which it makes so the app never asks a store for them.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;

/// Bigger than any header Steam keeps, so a stray file can't be huge.
const MAX_BYTES: u64 = 4 << 20;

/// The header image for `id`, like `steam-632360`, as a data URL. None if the store has none here.
#[tauri::command]
pub async fn game_art(id: String) -> Option<String> {
    let appid = id.strip_prefix("steam-")?;
    let path = header_of(&steam_root()?, appid)?;
    if std::fs::metadata(&path).ok()?.len() > MAX_BYTES {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    let kind = if path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("png"))
    {
        "png"
    } else {
        "jpeg"
    };
    Some(format!(
        "data:image/{kind};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// What Steam calls the wide picture, best first. Newer Steam often only keeps `library_header.jpg`,
/// the same 460x215 header. The others are close enough to fill a tile.
const NAMES: [&str; 4] = [
    "header.jpg",
    "library_header.jpg",
    "library_capsule.jpg",
    "library_hero.jpg",
];

/// Where the header for `appid` is in Steam's library cache, any layout.
pub fn header_of(root: &Path, appid: &str) -> Option<PathBuf> {
    if appid.is_empty() || !appid.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let cache = root.join("appcache").join("librarycache");
    let flat = cache.join(format!("{appid}_header.jpg"));
    if flat.is_file() {
        return Some(flat);
    }
    let dir = cache.join(appid);
    // Some sit a folder deeper, under a hash
    let deeper: Vec<PathBuf> = std::fs::read_dir(&dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    NAMES.iter().find_map(|name| {
        std::iter::once(dir.join(name))
            .chain(deeper.iter().map(|d| d.join(name)))
            .find(|p| p.is_file())
    })
}

/// The hub's list of games, with its copies of their pictures.
const HUB_GAMES: &str = "https://dist.wraith.io/hub/v1/games.json";
/// Only pictures here, so the list can't send the app anywhere else.
const HUB_ART: &str = "https://dist.wraith.io/hub/v1/art/";

#[derive(serde::Deserialize)]
struct HubGames {
    games: Vec<HubGame>,
}

#[derive(serde::Deserialize)]
struct HubGame {
    idents: Vec<String>,
    image: Option<String>,
}

/// Every game id the hub has a picture for, to it.
#[tauri::command]
pub async fn hub_art() -> Result<HashMap<String, String>, String> {
    let json = crate::install::download(HUB_GAMES, Some(Duration::from_secs(10))).await?;
    hub_art_of(&json)
}

pub fn hub_art_of(json: &[u8]) -> Result<HashMap<String, String>, String> {
    let doc: HubGames = serde_json::from_slice(json)
        .map_err(|e| format!("The hub's games list didn't read: {e}"))?;
    let mut out = HashMap::new();
    for g in doc.games {
        let Some(image) = g
            .image
            .filter(|i| i.starts_with(HUB_ART) && !i.contains(".."))
        else {
            continue;
        };
        for ident in g.idents {
            out.insert(ident, image.clone());
        }
    }
    Ok(out)
}

#[cfg(windows)]
fn steam_root() -> Option<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let path: String = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Valve\Steam")
        .ok()?
        .get_value("SteamPath")
        .ok()?;
    Some(PathBuf::from(path))
}

#[cfg(not(windows))]
fn steam_root() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::header_of;
    use std::fs;

    fn cache() -> (std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "wraith-art-{}-{}",
            std::process::id(),
            rand_suffix()
        ));
        let cache = root.join("appcache").join("librarycache");
        fs::create_dir_all(&cache).unwrap();
        (root, cache)
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    #[test]
    fn finds_both_layouts() {
        let (root, cache) = cache();
        fs::write(cache.join("10_header.jpg"), b"old").unwrap();
        fs::create_dir_all(cache.join("20")).unwrap();
        fs::write(cache.join("20").join("header.jpg"), b"new").unwrap();
        fs::create_dir_all(cache.join("30").join("abc123")).unwrap();
        fs::write(
            cache.join("30").join("abc123").join("header.jpg"),
            b"hashed",
        )
        .unwrap();

        assert_eq!(fs::read(header_of(&root, "10").unwrap()).unwrap(), b"old");
        assert_eq!(fs::read(header_of(&root, "20").unwrap()).unwrap(), b"new");
        assert_eq!(
            fs::read(header_of(&root, "30").unwrap()).unwrap(),
            b"hashed"
        );
        assert_eq!(header_of(&root, "40"), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn newer_steam_names_count_too() {
        let (root, cache) = cache();
        // Like FF Resonance: only a library_header, under a hash, beside other pictures
        let game = cache.join("3259780");
        fs::create_dir_all(game.join("aa")).unwrap();
        fs::create_dir_all(game.join("bb")).unwrap();
        fs::write(game.join("icon.jpg"), b"icon").unwrap();
        fs::write(game.join("aa").join("library_hero.jpg"), b"hero").unwrap();
        fs::write(
            game.join("bb").join("library_header.jpg"),
            b"library header",
        )
        .unwrap();
        assert_eq!(
            fs::read(header_of(&root, "3259780").unwrap()).unwrap(),
            b"library header"
        );

        // The proper header wins when there's both
        fs::write(game.join("header.jpg"), b"header").unwrap();
        assert_eq!(
            fs::read(header_of(&root, "3259780").unwrap()).unwrap(),
            b"header"
        );

        // Only an icon is nothing to show
        fs::create_dir_all(cache.join("1260")).unwrap();
        fs::write(cache.join("1260").join("d8a2.jpg"), b"icon").unwrap();
        assert_eq!(header_of(&root, "1260"), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn hub_pictures_only_from_its_own_copies() {
        let json = br#"{ "format": 1, "games": [
            { "name": "Kai", "idents": ["kai", "steam-1"], "image": "https://dist.wraith.io/hub/v1/art/3-abc.jpg", "packages": 1 },
            { "name": "Elsewhere", "idents": ["gog-2"], "image": "https://cdn.store.example/x.jpg", "packages": 1 },
            { "name": "Sneaky", "idents": ["gog-3"], "image": "https://dist.wraith.io/hub/v1/art/../../evil", "packages": 1 },
            { "name": "None", "idents": ["gog-4"], "packages": 0 }
        ] }"#;
        let art = super::hub_art_of(json).unwrap();
        assert_eq!(art.len(), 2);
        assert_eq!(art["kai"], "https://dist.wraith.io/hub/v1/art/3-abc.jpg");
        assert_eq!(art["steam-1"], art["kai"]);
        assert!(super::hub_art_of(b"nope").is_err());
    }

    #[test]
    fn only_app_ids() {
        let (root, _) = cache();
        for bad in ["", "..", "..\\..\\x", "12a"] {
            assert_eq!(header_of(&root, bad), None, "{bad}");
        }
        fs::remove_dir_all(root).unwrap();
    }
}
