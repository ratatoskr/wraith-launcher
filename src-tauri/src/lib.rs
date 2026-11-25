mod art;
pub mod cli;
mod install;
mod links;
mod wraith;

use std::sync::Arc;

use serde_json::Value;
use tauri::{Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

use wraith::{Reply, Status, Wraith};

#[tauri::command]
async fn wraith_request(
    wraith: State<'_, Arc<Wraith>>,
    id: u64,
    method: String,
    params: Value,
) -> Reply {
    wraith.request(id, &method, params).await
}

#[tauri::command]
fn wraith_status(wraith: State<'_, Arc<Wraith>>) -> Status {
    wraith.status()
}

/// A mod a `wraith://install/<id>` link asked for before the UI was listening.
#[tauri::command]
fn take_install_link(asked: State<'_, links::Asked>) -> Option<String> {
    asked.take()
}

#[derive(serde::Serialize)]
struct CliStatus {
    dir: String,
    on_path: bool,
}

#[tauri::command]
fn cli_status() -> Result<CliStatus, String> {
    let root = cli::root()?;
    Ok(CliStatus {
        dir: cli::bin_dir(&root).to_string_lossy().into_owned(),
        on_path: cli::on_path(&root)?,
    })
}

#[tauri::command]
fn set_cli_on_path(on: bool) -> Result<CliStatus, String> {
    cli::set_on_path(&cli::root()?, on)?;
    cli_status()
}

#[derive(serde::Serialize)]
struct WraithExe {
    /// Picked in the Dev tab.
    saved: Option<String>,
    /// `WRAITH`, which wins over it.
    env: Option<String>,
}

#[tauri::command]
fn wraith_exe() -> Result<WraithExe, String> {
    let root = cli::root()?;
    Ok(WraithExe {
        saved: cli::saved_exe(&root).map(|p| p.to_string_lossy().into_owned()),
        env: std::env::var_os("WRAITH")
            .filter(|e| !e.is_empty())
            .map(|e| e.to_string_lossy().into_owned()),
    })
}

/// Null goes back to the installed one. Takes effect when the launcher starts again.
#[tauri::command]
fn set_wraith_exe(exe: Option<String>) -> Result<WraithExe, String> {
    cli::set_saved_exe(&cli::root()?, exe.as_deref().map(std::path::Path::new))?;
    wraith_exe()
}

/// Keeps `<root>\bin\wraith.exe` the same as the one shipped beside the launcher.
fn place_shim() {
    let shipped = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join("wraith.exe")));
    let (Some(shipped), Ok(root)) = (shipped, cli::root()) else {
        return;
    };
    if !shipped.is_file() {
        return;
    }
    if let Err(error) = cli::place_shim(&shipped, &root) {
        eprintln!("{error}");
    }
}

/// `--add-cli`, for the installer.
pub fn add_cli() {
    place_shim();
    if let Err(error) = cli::root().and_then(|root| cli::set_on_path(&root, true)) {
        eprintln!("{error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch from a link goes to this one instead. Its URL reaches deep-link's on_open_url
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            links::show(app)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            std::thread::spawn(place_shim);
            app.manage(links::Asked::default());
            // The installer registers wraith:// too. This keeps it pointing here, like for dev builds
            #[cfg(windows)]
            if let Err(error) = app.deep_link().register_all() {
                eprintln!("Couldn't register wraith:// links: {error}");
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                links::open(&handle, event.urls().into_iter().map(|u| u.to_string()))
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                links::open(app.handle(), urls.into_iter().map(|u| u.to_string()));
            }
            let wraith = Arc::new(Wraith::new());
            app.manage(wraith.clone());
            tauri::async_runtime::spawn(wraith.start(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            wraith_request,
            wraith_status,
            cli_status,
            set_cli_on_path,
            wraith_exe,
            set_wraith_exe,
            take_install_link,
            art::game_art,
            art::hub_art
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
