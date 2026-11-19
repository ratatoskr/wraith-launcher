//! `wraith` on PATH. Forwards to the real wraith.exe.

use std::process::{Command, ExitCode};

use wraith_launcher_lib::cli;

fn main() -> ExitCode {
    let found = cli::root().and_then(|root| {
        let this = std::env::current_exe().map_err(|e| e.to_string())?;
        cli::find(std::env::var_os("WRAITH").as_deref(), &root, &this)
    });
    let exe = match found {
        Ok(exe) => exe,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(1);
        }
    };
    // Ctrl+C goes to the whole console. Wraith deals with it, we just wait for it
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::System::Console::SetConsoleCtrlHandler(None, 1);
    }
    match Command::new(&exe)
        .args(std::env::args_os().skip(1))
        .status()
    {
        Ok(status) => ExitCode::from(status.code().unwrap_or(1) as u8),
        Err(error) => {
            eprintln!("Couldn't run {}: {error}", exe.display());
            ExitCode::from(1)
        }
    }
}
