pub mod cli;
mod install;
mod wraith;

use std::sync::Arc;

use serde_json::Value;
use tauri::{Manager, State};

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            std::thread::spawn(place_shim);
            let wraith = Arc::new(Wraith::new());
            app.manage(wraith.clone());
            tauri::async_runtime::spawn(wraith.start(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            wraith_request,
            wraith_status,
            cli_status,
            set_cli_on_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
