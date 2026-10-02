pub fn state() -> &'static str {
    if locked() == Some(true) {
        return "locked";
    }
    match user_idle::UserIdle::get_time() {
        Ok(idle) if idle.as_seconds() >= 60 => "idle",
        Ok(_) => "active",
        Err(_) => "unknown",
    }
}

#[cfg(target_os = "linux")]
fn locked() -> Option<bool> {
    let result = std::process::Command::new("loginctl")
        .args([
            "show-session",
            "self",
            "--property=LockedHint",
            "--value",
            "--no-pager",
        ])
        .output()
        .ok()?;
    if !result.status.success() {
        return None;
    }
    match String::from_utf8_lossy(&result.stdout).trim() {
        "yes" => Some(true),
        "no" => Some(false),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn locked() -> Option<bool> {
    let result = std::process::Command::new("/usr/sbin/ioreg")
        .args(["-n", "Root", "-d", "1", "-l"])
        .output()
        .ok()?;
    if !result.status.success() {
        return None;
    }
    let output = String::from_utf8_lossy(&result.stdout);
    let value = output
        .lines()
        .find(|line| line.contains("\"IOConsoleLocked\""))?
        .split('=')
        .nth(1)?
        .trim();
    match value {
        "Yes" | "true" => Some(true),
        "No" | "false" => Some(false),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn locked() -> Option<bool> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_ACCESS_DENIED},
        System::StationsAndDesktops::{CloseDesktop, OpenInputDesktop, DESKTOP_READOBJECTS},
    };
    unsafe {
        let desktop = OpenInputDesktop(0, 0, DESKTOP_READOBJECTS);
        if desktop.is_null() {
            return if GetLastError() == ERROR_ACCESS_DENIED {
                Some(true)
            } else {
                None
            };
        }
        CloseDesktop(desktop);
        Some(false)
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn locked() -> Option<bool> {
    None
}
