// Stops an extra console window on Windows in release. Don't remove!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The installer runs these to put `wraith` on PATH, or take it off when uninstalling
    match std::env::args().nth(1).as_deref() {
        Some("--add-cli") => return wraith_launcher_lib::add_cli(),
        Some("--remove-cli") => {
            if let Ok(root) = wraith_launcher_lib::cli::root() {
                wraith_launcher_lib::cli::remove(&root);
            }
            return;
        }
        _ => {}
    }
    wraith_launcher_lib::run()
}
