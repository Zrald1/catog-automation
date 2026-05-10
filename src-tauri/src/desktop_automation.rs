//! Cross-platform desktop automation commands.
//! Supports macOS (NSAppleScript/AXUI), Windows (Win32), and Linux (X11/AT-SPI).

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunningProgram {
    pub pid: u32,
    pub name: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstalledApplication {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScreenSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScreenRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub data: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowEdges {
    pub top_left_x: i32,
    pub top_left_y: i32,
    pub top_right_x: i32,
    pub top_right_y: i32,
    pub bottom_left_x: i32,
    pub bottom_left_y: i32,
    pub bottom_right_x: i32,
    pub bottom_right_y: i32,
    pub title_bar_x: i32,
    pub title_bar_y: i32,
}

// ── Running Programs ───────────────────────────────────────────────────────────

fn dedupe_apps(names: Vec<String>) -> Vec<InstalledApplication> {
    let mut set = BTreeSet::new();
    for name in names {
        let cleaned = name.trim().to_string();
        if cleaned.is_empty() {
            continue;
        }
        set.insert(cleaned);
    }
    set.into_iter()
        .map(|name| InstalledApplication { name })
        .collect()
}

#[cfg(target_os = "macos")]
pub fn get_installed_applications_impl() -> Vec<InstalledApplication> {
    fn collect_apps(dir: &Path, names: &mut Vec<String>, depth: u32) {
        if depth > 3 {
            return;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) == Some("app") {
                    if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                        names.push(stem.to_string());
                    }
                } else if p.is_dir() {
                    collect_apps(&p, names, depth + 1);
                }
            }
        }
    }

    let mut names = Vec::new();
    let home_apps = std::env::var("HOME")
        .ok()
        .map(|home| format!("{}/Applications", home));
    let mut roots = vec![
        "/Applications".to_string(),
        "/System/Applications".to_string(),
    ];
    if let Some(path) = home_apps {
        roots.push(path);
    }

    for root in roots {
        let path = Path::new(&root);
        if !path.exists() {
            continue;
        }
        collect_apps(path, &mut names, 0);
    }

    dedupe_apps(names)
}

#[cfg(target_os = "windows")]
pub fn get_installed_applications_impl() -> Vec<InstalledApplication> {
    // Sources, in priority order:
    //   1. Registry "Uninstall" keys (HKLM 64/32-bit + HKCU) — same list the Settings/Control Panel "Apps" view shows.
    //   2. Start Menu .lnk shortcuts (machine-wide and per-user) — picks up most pinned/manually installed apps.
    //   3. AppX/UWP packages via Get-StartApps — Store apps, Calculator, Edge, etc.
    //   4. Executables under Program Files / Program Files (x86) / %LOCALAPPDATA%\Programs as a last resort.
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$names = New-Object System.Collections.Generic.List[string]

$uninstallRoots = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($root in $uninstallRoots) {
  if (Test-Path $root) {
    Get-ChildItem -Path $root | ForEach-Object {
      $props = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
      if ($props -and $props.DisplayName) {
        $isSystem = ($props.SystemComponent -eq 1) -or ($props.ParentKeyName) -or ($props.ReleaseType -eq 'Update') -or ($props.ReleaseType -eq 'Hotfix') -or ($props.ReleaseType -eq 'Security Update')
        if (-not $isSystem) {
          $names.Add([string]$props.DisplayName)
        }
      }
    }
  }
}

$startMenus = @(
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
)
foreach ($menu in $startMenus) {
  if (Test-Path $menu) {
    Get-ChildItem -Path $menu -Recurse -Filter *.lnk | ForEach-Object {
      $name = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
      if ($name) { $names.Add($name) }
    }
  }
}

try {
  Get-StartApps | ForEach-Object {
    if ($_.Name) { $names.Add([string]$_.Name) }
  }
} catch {}

$exeRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs")
foreach ($root in $exeRoots) {
  if ($root -and (Test-Path $root)) {
    Get-ChildItem -Path $root -Directory | ForEach-Object {
      Get-ChildItem -Path $_.FullName -Filter *.exe -File -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object {
        $name = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
        if ($name) { $names.Add($name) }
      }
    }
  }
}

$names | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Sort-Object -Unique
"#;

    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let names: Vec<String> = stdout
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty() && !is_noise_app_name(l))
                .collect();
            dedupe_apps(names)
        }
        Err(_) => Vec::new(),
    }
}

#[cfg(target_os = "windows")]
fn is_noise_app_name(name: &str) -> bool {
    // Filter common Start Menu shortcut clutter that isn't a real "app".
    let lower = name.to_lowercase();
    const NOISE: &[&str] = &[
        "uninstall",
        "readme",
        "release notes",
        "license",
        "documentation",
        "what's new",
        "user guide",
        "help",
    ];
    NOISE
        .iter()
        .any(|n| lower == *n || lower.starts_with(&format!("{} ", n)))
}

#[cfg(target_os = "linux")]
pub fn get_installed_applications_impl() -> Vec<InstalledApplication> {
    let mut names = Vec::new();
    let mut app_dirs = vec!["/usr/share/applications".to_string()];
    if let Ok(home) = std::env::var("HOME") {
        app_dirs.push(format!("{}/.local/share/applications", home));
    }

    for dir in app_dirs {
        let path = Path::new(&dir);
        if !path.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) != Some("desktop") {
                    continue;
                }
                if let Ok(content) = std::fs::read_to_string(&p) {
                    for line in content.lines() {
                        if let Some(name) = line.strip_prefix("Name=") {
                            names.push(name.to_string());
                            break;
                        }
                    }
                }
            }
        }
    }

    dedupe_apps(names)
}

#[cfg(target_os = "macos")]
pub fn get_running_programs_impl() -> Vec<RunningProgram> {
    let script = r#"
        tell application "System Events"
            set appList to every process whose background only is false
            set resultList to {}
            repeat with aApp in appList
                set appName to name of aApp
                try
                    tell application appName
                        set windowTitles to name of every window
                    end tell
                    repeat with wTitle in windowTitles
                        if wTitle is not "" then
                            copy {pid:aApp's unix id, name:appName, title:wTitle} to end of resultList
                        end if
                    end repeat
                on error
                    copy {pid:aApp's unix id, name:appName, title:appName} to end of resultList
                end try
            end repeat
            return resultList
        end tell
    "#;

    let output = Command::new("osascript").arg("-e").arg(script).output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout
                .lines()
                .filter_map(|line| {
                    let parts: Vec<&str> = line.splitn(3, ", ").collect();
                    if parts.len() >= 3 {
                        Some(RunningProgram {
                            pid: parts[0].parse().unwrap_or(0),
                            name: parts[1].to_string(),
                            title: parts[2].to_string(),
                        })
                    } else {
                        None
                    }
                })
                .collect()
        }
        Err(_) => Vec::new(),
    }
}

#[cfg(target_os = "windows")]
pub fn get_running_programs_impl() -> Vec<RunningProgram> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$rows = New-Object System.Collections.Generic.List[string]
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {
    $pid = $_.Id
    $name = $_.ProcessName
    $title = ($_.MainWindowTitle -replace '\t',' ' -replace '\r?\n',' ')
    if (-not $name) {
        try { $name = [System.IO.Path]::GetFileNameWithoutExtension($_.Path) } catch {}
    }
    if ($name -and $title) {
        $rows.Add("$pid`t$name`t$title")
    }
}
$rows | ForEach-Object { $_ }
"#;

    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(script)
        .output();

    let mut programs: Vec<RunningProgram> = match output {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(3, '\t').collect();
                if parts.len() < 3 {
                    return None;
                }
                let pid = parts[0].trim().parse::<u32>().ok()?;
                let name = parts[1].trim().to_string();
                let title = parts[2].trim().to_string();
                if name.is_empty() || title.is_empty() {
                    return None;
                }
                Some(RunningProgram { pid, name, title })
            })
            .collect(),
        Err(_) => Vec::new(),
    };

    if programs.is_empty() {
        programs = enum_running_programs_via_winapi();
    }

    programs
}

#[cfg(target_os = "windows")]
fn enum_running_programs_via_winapi() -> Vec<RunningProgram> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(
            enum_proc: Option<
                unsafe extern "system" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) -> i32,
            >,
            lparam: *mut std::ffi::c_void,
        ) -> i32;
        fn GetWindowTextW(hwnd: *mut std::ffi::c_void, text: *mut u16, count: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: *mut std::ffi::c_void, process_id: *mut u32) -> u32;
        fn IsWindowVisible(hwnd: *mut std::ffi::c_void) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        fn QueryFullProcessImageNameW(
            handle: *mut std::ffi::c_void,
            flags: u32,
            buf: *mut u16,
            size: *mut u32,
        ) -> i32;
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    fn process_name_for_pid(pid: u32) -> String {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return String::new();
            }
            let mut buf = [0u16; 1024];
            let mut size: u32 = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
            CloseHandle(handle);
            if ok == 0 || size == 0 {
                return String::new();
            }
            let path = OsString::from_wide(&buf[..size as usize])
                .to_string_lossy()
                .into_owned();
            Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string()
        }
    }

    unsafe {
        let mut results: Vec<RunningProgram> = Vec::new();

        unsafe extern "system" fn enum_callback(
            hwnd: *mut std::ffi::c_void,
            lparam: *mut std::ffi::c_void,
        ) -> i32 {
            if IsWindowVisible(hwnd) == 1 {
                let mut buffer = [0u16; 512];
                let len = GetWindowTextW(hwnd, buffer.as_mut_ptr(), 512) as usize;
                if len > 0 {
                    let title = OsString::from_wide(&buffer[..len])
                        .to_string_lossy()
                        .into_owned();
                    if !title.is_empty() {
                        let mut pid: u32 = 0;
                        GetWindowThreadProcessId(hwnd, &mut pid);
                        if pid > 0 {
                            let results = &mut *(lparam as *mut Vec<RunningProgram>);
                            results.push(RunningProgram {
                                pid,
                                name: String::new(),
                                title,
                            });
                        }
                    }
                }
            }
            1
        }

        EnumWindows(
            Some(enum_callback),
            &mut results as *mut Vec<RunningProgram> as *mut std::ffi::c_void,
        );

        for p in results.iter_mut() {
            if p.name.is_empty() {
                p.name = process_name_for_pid(p.pid);
            }
        }
        results.retain(|p| !p.name.is_empty());
        results
    }
}

#[cfg(target_os = "linux")]
pub fn get_running_programs_impl() -> Vec<RunningProgram> {
    // Prefer wmctrl -lp (with PID) so we can resolve the process name.
    if let Ok(out) = Command::new("wmctrl").arg("-lp").output() {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut results: Vec<RunningProgram> = Vec::new();
            for line in stdout.lines() {
                // Format: <winid> <desktop> <pid> <host> <title...>
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 5 {
                    continue;
                }
                let pid = parts[2].parse::<u32>().unwrap_or(0);
                // Reconstruct title: everything after the host (4th token)
                let mut idx = 0usize;
                let mut field = 0usize;
                let bytes = line.as_bytes();
                while idx < bytes.len() && field < 4 {
                    while idx < bytes.len() && (bytes[idx] as char).is_whitespace() {
                        idx += 1;
                    }
                    while idx < bytes.len() && !(bytes[idx] as char).is_whitespace() {
                        idx += 1;
                    }
                    field += 1;
                }
                while idx < bytes.len() && (bytes[idx] as char).is_whitespace() {
                    idx += 1;
                }
                let title = line[idx..].trim().to_string();
                if title.is_empty() {
                    continue;
                }
                let name = if pid > 0 {
                    linux_process_name(pid)
                } else {
                    String::new()
                };
                let name = if name.is_empty() { title.clone() } else { name };
                results.push(RunningProgram { pid, name, title });
            }
            if !results.is_empty() {
                return results;
            }
        }
    }

    // Fallback: xdotool
    if let Ok(out) = Command::new("xdotool")
        .arg("search")
        .arg("--onlyvisible")
        .arg("--name")
        .arg("")
        .output()
    {
        if out.status.success() {
            let mut results: Vec<RunningProgram> = Vec::new();
            for win_id in String::from_utf8_lossy(&out.stdout).lines() {
                let title = Command::new("xdotool")
                    .arg("getwindowname")
                    .arg(win_id)
                    .output()
                    .ok()
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                    .unwrap_or_default();
                let pid = Command::new("xdotool")
                    .arg("getwindowpid")
                    .arg(win_id)
                    .output()
                    .ok()
                    .and_then(|o| {
                        String::from_utf8_lossy(&o.stdout)
                            .trim()
                            .parse::<u32>()
                            .ok()
                    })
                    .unwrap_or(0);
                if title.is_empty() {
                    continue;
                }
                let name = if pid > 0 {
                    linux_process_name(pid)
                } else {
                    String::new()
                };
                let name = if name.is_empty() { title.clone() } else { name };
                results.push(RunningProgram { pid, name, title });
            }
            if !results.is_empty() {
                return results;
            }
        }
    }

    Vec::new()
}

#[cfg(target_os = "linux")]
fn linux_process_name(pid: u32) -> String {
    if let Ok(comm) = std::fs::read_to_string(format!("/proc/{}/comm", pid)) {
        let trimmed = comm.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    String::new()
}

// ── Click at coordinates ───────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn click_at_impl(x: i32, y: i32) -> Result<(), String> {
    let script = format!(
        r#"osascript -e 'tell application "System Events"
            click at {{{}, {}}}
        end tell'"#,
        x, y
    );
    Command::new("sh")
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn click_at_impl(x: i32, y: i32) -> Result<(), String> {
    win_input::set_cursor_pos(x, y)?;
    std::thread::sleep(std::time::Duration::from_millis(20));
    win_input::mouse_left_down();
    std::thread::sleep(std::time::Duration::from_millis(40));
    win_input::mouse_left_up();
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn click_at_impl(x: i32, y: i32) -> Result<(), String> {
    Command::new("xdotool")
        .arg("mousemove")
        .arg(x.to_string())
        .arg(y.to_string())
        .arg("click")
        .arg("1")
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Type text ────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn type_text_impl(text: &str) -> Result<(), String> {
    let parts = text.split('\n').collect::<Vec<_>>();
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            let script = r#"osascript -e 'tell application "System Events" to keystroke return'"#;
            Command::new("sh")
                .arg("-c")
                .arg(script)
                .output()
                .map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        if !part.is_empty() {
            let escaped = part.replace("'", "'\\''");
            let script = format!(
                r#"osascript -e 'tell application "System Events" to keystroke "{}"'"#,
                escaped
            );
            Command::new("sh")
                .arg("-c")
                .arg(&script)
                .output()
                .map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn type_text_impl(text: &str) -> Result<(), String> {
    win_input::type_unicode_text(text)
}

#[cfg(target_os = "linux")]
pub fn type_text_impl(text: &str) -> Result<(), String> {
    // Normalize CRLF/CR to LF so we don't double-press Enter, then split on \n
    // and press the real Return key between segments. xdotool's `type` does not
    // honor \n as Enter in many apps (gedit, browsers, terminals).
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let segments: Vec<&str> = normalized.split('\n').collect();
    for (i, seg) in segments.iter().enumerate() {
        if i > 0 {
            Command::new("xdotool")
                .arg("key")
                .arg("--delay")
                .arg("20")
                .arg("Return")
                .output()
                .map_err(|e| e.to_string())?;
        }
        if seg.is_empty() {
            continue;
        }
        // Pass the literal text via stdin (safer than shell-escaping). xdotool
        // reads from stdin with `--file -`.
        use std::io::Write;
        let mut child = Command::new("xdotool")
            .arg("type")
            .arg("--delay")
            .arg("15")
            .arg("--clearmodifiers")
            .arg("--file")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(seg.as_bytes()).map_err(|e| e.to_string())?;
        }
        let _ = child.wait().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Press key combo ─────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn press_key_combo_impl(keys: &str) -> Result<(), String> {
    // Token-based parser. Splits on '+', collects modifiers, then resolves the
    // remaining token as either a named special key (translated to "key code N")
    // or a literal keystroke string. Supports any combination of modifiers
    // (e.g. ctrl+shift+tab, cmd+option+left).
    let mut modifiers: Vec<&'static str> = Vec::new();
    let mut key_token: Option<String> = None;
    for raw in keys.split('+') {
        let tok = raw.trim().to_lowercase();
        match tok.as_str() {
            "cmd" | "command" | "meta" | "win" | "super" => modifiers.push("command down"),
            "ctrl" | "control" => modifiers.push("control down"),
            "shift" => modifiers.push("shift down"),
            "alt" | "option" => modifiers.push("option down"),
            _ => {
                // The non-modifier part — keep the LAST one if multiple.
                key_token = Some(tok);
            }
        }
    }
    let key = key_token.ok_or_else(|| format!("Empty key combo: {}", keys))?;

    // Map named keys to AppleScript "key code" so they fire as the right physical key.
    let named_keycode: Option<&'static str> = match key.as_str() {
        "enter" | "return" => Some("36"),
        "tab" => Some("48"),
        "escape" | "esc" => Some("53"),
        "space" | "spacebar" => Some("49"),
        "delete" | "backspace" => Some("51"),
        "forwarddelete" | "del" => Some("117"),
        "up" | "uparrow" => Some("126"),
        "down" | "downarrow" => Some("125"),
        "left" | "leftarrow" => Some("123"),
        "right" | "rightarrow" => Some("124"),
        "home" => Some("115"),
        "end" => Some("119"),
        "pageup" | "pgup" => Some("116"),
        "pagedown" | "pgdn" => Some("121"),
        "f1" => Some("122"),
        "f2" => Some("120"),
        "f3" => Some("99"),
        "f4" => Some("118"),
        "f5" => Some("96"),
        "f6" => Some("97"),
        "f7" => Some("98"),
        "f8" => Some("100"),
        "f9" => Some("101"),
        "f10" => Some("109"),
        "f11" => Some("103"),
        "f12" => Some("111"),
        _ => None,
    };

    let using_clause = if modifiers.is_empty() {
        String::new()
    } else if modifiers.len() == 1 {
        format!(" using {}", modifiers[0])
    } else {
        format!(" using {{{}}}", modifiers.join(", "))
    };

    let action = if let Some(code) = named_keycode {
        format!("key code {}{}", code, using_clause)
    } else {
        // Literal keystroke. Escape any embedded double-quote / backslash.
        let safe = key.replace('\\', "\\\\").replace('"', "\\\"");
        format!("keystroke \"{}\"{}", safe, using_clause)
    };

    let script = format!(
        "osascript -e 'tell application \"System Events\" to {}'",
        action
    );
    Command::new("sh")
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn press_key_combo_impl(keys: &str) -> Result<(), String> {
    win_input::press_key_combo(keys)
}

#[cfg(target_os = "linux")]
pub fn press_key_combo_impl(keys: &str) -> Result<(), String> {
    // Translate macOS-style "command+l" → "ctrl+l" for portability.
    // Map every named token to xdotool's keysym names, then join with '+' so
    // xdotool fires them as a real chord (ctrl down → l → ctrl up).
    fn map_token(tok: &str) -> String {
        let lower = tok.trim().to_lowercase();
        match lower.as_str() {
            "ctrl" | "control" => "ctrl".to_string(),
            "shift" => "shift".to_string(),
            "alt" | "option" => "alt".to_string(),
            "win" | "cmd" | "command" | "meta" | "super" => "ctrl".to_string(),
            "enter" | "return" => "Return".to_string(),
            "tab" => "Tab".to_string(),
            "esc" | "escape" => "Escape".to_string(),
            "space" | "spacebar" => "space".to_string(),
            "backspace" => "BackSpace".to_string(),
            "delete" | "del" => "Delete".to_string(),
            "insert" | "ins" => "Insert".to_string(),
            "home" => "Home".to_string(),
            "end" => "End".to_string(),
            "pageup" | "pgup" => "Page_Up".to_string(),
            "pagedown" | "pgdn" => "Page_Down".to_string(),
            "up" | "uparrow" => "Up".to_string(),
            "down" | "downarrow" => "Down".to_string(),
            "left" | "leftarrow" => "Left".to_string(),
            "right" | "rightarrow" => "Right".to_string(),
            "capslock" => "Caps_Lock".to_string(),
            "printscreen" => "Print".to_string(),
            "f1" => "F1".to_string(),
            "f2" => "F2".to_string(),
            "f3" => "F3".to_string(),
            "f4" => "F4".to_string(),
            "f5" => "F5".to_string(),
            "f6" => "F6".to_string(),
            "f7" => "F7".to_string(),
            "f8" => "F8".to_string(),
            "f9" => "F9".to_string(),
            "f10" => "F10".to_string(),
            "f11" => "F11".to_string(),
            "f12" => "F12".to_string(),
            // Single character — pass through lowercase letter / digit / punctuation.
            _ => lower,
        }
    }
    let combo: Vec<String> = keys.split('+').map(map_token).collect();
    if combo.is_empty() {
        return Err("Empty key combo".to_string());
    }
    let chord = combo.join("+");
    Command::new("xdotool")
        .arg("key")
        .arg("--clearmodifiers")
        .arg(&chord)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Screen size ──────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn get_screen_size_impl() -> ScreenSize {
    let output = Command::new("system_profiler")
        .arg("SPDisplaysDataType")
        .arg("-json")
        .output();

    match output {
        Ok(out) => {
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                if let Some(displays) = json.get("SPDisplaysDataType") {
                    if let Some(arr) = displays.as_array() {
                        for display in arr {
                            if let Some(builtin) = display.get("spdisplays_builtin") {
                                if builtin.as_bool() == Some(true) {
                                    if let Some(w) = display
                                        .get("spdisplays_vdisplay")
                                        .and_then(|v| v.as_i64())
                                        .or_else(|| {
                                            display
                                                .get("current_res")
                                                .and_then(|r| r.as_str())
                                                .and_then(|s| s.split('x').next())
                                                .and_then(|s| s.parse::<i64>().ok())
                                        })
                                    {
                                        if let Some(h) = display
                                            .get("spdisplays_pdisplay")
                                            .and_then(|v| v.as_i64())
                                            .or_else(|| {
                                                display
                                                    .get("current_res")
                                                    .and_then(|r| r.as_str())
                                                    .and_then(|s| s.split('x').nth(1))
                                                    .and_then(|s| s.parse::<i64>().ok())
                                            })
                                        {
                                            return ScreenSize {
                                                width: w as u32,
                                                height: h as u32,
                                            };
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Err(_) => {}
    }
    ScreenSize {
        width: 1920,
        height: 1080,
    }
}

#[cfg(target_os = "windows")]
pub fn get_screen_size_impl() -> ScreenSize {
    unsafe {
        #[link(name = "user32")]
        extern "system" {
            fn GetSystemMetrics(nIndex: i32) -> i32;
        }
        const SM_CXSCREEN: i32 = 0;
        const SM_CYSCREEN: i32 = 1;
        let width = GetSystemMetrics(SM_CXSCREEN) as u32;
        let height = GetSystemMetrics(SM_CYSCREEN) as u32;
        ScreenSize { width, height }
    }
}

#[cfg(target_os = "linux")]
pub fn get_screen_size_impl() -> ScreenSize {
    let output = Command::new("xrandr").arg("--current").output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines().rev() {
                if line.contains(" connected") {
                    if let Some(res) = line.split(' ').find(|s| s.contains('x')) {
                        let parts: Vec<&str> = res.split('x').collect();
                        if parts.len() == 2 {
                            if let (Ok(w), Ok(h)) =
                                (parts[0].parse::<u32>(), parts[1].parse::<u32>())
                            {
                                return ScreenSize {
                                    width: w,
                                    height: h,
                                };
                            }
                        }
                    }
                }
            }
        }
        Err(_) => {}
    }
    ScreenSize {
        width: 1920,
        height: 1080,
    }
}

// ── Read screen region ───────────────────────────────────────────────────────
// Basic implementation — returns region metadata. Full pixel capture needs platform-specific framebuffer access.

#[cfg(target_os = "macos")]
pub fn read_screen_region_impl(x: i32, y: i32, width: u32, height: u32) -> ScreenRegion {
    let tmp_path = "/tmp/aiz_capture.png";
    let _ = Command::new("screencapture")
        .arg("-x")
        .arg("-R")
        .arg(format!("{},{},{},{}", x, y, width, height))
        .arg(tmp_path)
        .output();
    let data = std::fs::read(tmp_path).ok().map(|bytes| {
        use std::io::Write;
        let mut b64 = Vec::new();
        {
            let mut encoder = base64::write::EncoderWriter::new(
                &mut b64,
                &base64::engine::general_purpose::STANDARD,
            );
            let _ = encoder.write_all(&bytes);
        }
        String::from_utf8(b64).unwrap_or_default()
    });
    ScreenRegion {
        x,
        y,
        width,
        height,
        data,
    }
}

#[cfg(target_os = "windows")]
pub fn read_screen_region_impl(x: i32, y: i32, width: u32, height: u32) -> ScreenRegion {
    let tmp_path = r"C:\Temp\aiz_capture.png";
    let _ = std::fs::create_dir_all(r"C:\Temp");
    let script = format!(
        r#"Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap({},{},[System.Drawing.Imaging.PixelFormat]::Format32bppArgb); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen({},{},[System.Drawing.Point]::Empty,[System.Drawing.Size]::new({},{})); $g.Dispose(); $bmp.Save('{}',[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()"#,
        width, height, x, y, width, height, tmp_path
    );
    let _ = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(&script)
        .output();
    let data = std::fs::read(tmp_path).ok().map(|bytes| {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    });
    ScreenRegion {
        x,
        y,
        width,
        height,
        data,
    }
}

#[cfg(target_os = "linux")]
pub fn read_screen_region_impl(x: i32, y: i32, width: u32, height: u32) -> ScreenRegion {
    let tmp_path = "/tmp/aiz_capture.png";
    let _ = Command::new("scrot")
        .arg("-a")
        .arg(format!("{}x{}+{}+{}", width, height, x, y))
        .arg(tmp_path)
        .output();
    let data = std::fs::read(tmp_path).ok().map(|bytes| {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    });
    ScreenRegion {
        x,
        y,
        width,
        height,
        data,
    }
}

// ── Launch Application ────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn launch_application_impl(name: &str) -> Result<(), String> {
    Command::new("open")
        .arg("-a")
        .arg(name)
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {}", name, e))?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn launch_application_impl(name: &str) -> Result<(), String> {
    // Resolve a friendly name like "Google Chrome", "Notepad", "Calculator", "Microsoft Word"
    // through several strategies, mirroring `open -a "<name>"` on macOS.
    //
    // 1. If the input is an absolute path or an existing file → launch it directly.
    // 2. App Paths registry (HKLM/HKCU\...\App Paths\<name>.exe) — covers Chrome, VS Code, etc.
    // 3. Start Menu .lnk shortcut whose name matches.
    // 4. AppX/UWP via Get-StartApps (Calculator, Photos, Microsoft Store apps).
    // 5. `Start-Process <name>` — covers things on PATH (notepad, calc, explorer, mspaint).
    //
    // We send all of this as a single PowerShell script so the user only pays the
    // PowerShell startup cost once, and so a partial match in step N doesn't run step N+1.

    let raw = name.trim();
    if raw.is_empty() {
        return Err("Application name is empty".to_string());
    }

    // Direct path → bypass PowerShell entirely.
    if Path::new(raw).is_file() || Path::new(raw).is_absolute() {
        Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(raw)
            .spawn()
            .map_err(|e| format!("Failed to launch {}: {}", raw, e))?;
        return Ok(());
    }

    let escaped = raw.replace("'", "''");
    let script = format!(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
$name = '{name}'
$nameLower = $name.ToLower()

function Try-Start([string]$target, [string[]]$argList) {{
    if (-not $target) {{ return $false }}
    try {{
        if ($argList -and $argList.Count -gt 0) {{
            Start-Process -FilePath $target -ArgumentList $argList | Out-Null
        }} else {{
            Start-Process -FilePath $target | Out-Null
        }}
        return $true
    }} catch {{ return $false }}
}}

# 1. Direct: maybe it's already a runnable command (notepad, calc, mspaint, explorer).
$direct = Get-Command -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1
if ($direct) {{
    if (Try-Start $direct.Source @()) {{ Write-Output 'OK direct'; exit 0 }}
}}

# 2. App Paths registry — DisplayName-style lookup used by the Run dialog.
$appPaths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths'
)
foreach ($root in $appPaths) {{
    if (-not (Test-Path $root)) {{ continue }}
    $match = Get-ChildItem -Path $root -ErrorAction SilentlyContinue | Where-Object {{
        $base = [System.IO.Path]::GetFileNameWithoutExtension($_.PSChildName)
        $base.ToLower() -eq $nameLower -or $_.PSChildName.ToLower() -eq $nameLower
    }} | Select-Object -First 1
    if ($match) {{
        $props = Get-ItemProperty -Path $match.PSPath -ErrorAction SilentlyContinue
        $exe = $props.'(default)'
        if (-not $exe) {{ $exe = $props.Path }}
        if ($exe -and (Test-Path $exe)) {{
            if (Try-Start $exe @()) {{ Write-Output 'OK apppath'; exit 0 }}
        }}
    }}
}}

# 3. Start Menu .lnk — covers most user-facing app names.
$startMenus = @(
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
)
$shortcuts = @()
foreach ($menu in $startMenus) {{
    if (Test-Path $menu) {{
        $shortcuts += Get-ChildItem -Path $menu -Recurse -Filter *.lnk -ErrorAction SilentlyContinue
    }}
}}
if ($shortcuts) {{
    $best = $shortcuts | Where-Object {{
        [System.IO.Path]::GetFileNameWithoutExtension($_.Name).ToLower() -eq $nameLower
    }} | Select-Object -First 1
    if (-not $best) {{
        $best = $shortcuts | Where-Object {{
            [System.IO.Path]::GetFileNameWithoutExtension($_.Name).ToLower().Contains($nameLower)
        }} | Sort-Object {{ [System.IO.Path]::GetFileNameWithoutExtension($_.Name).Length }} | Select-Object -First 1
    }}
    if ($best) {{
        if (Try-Start $best.FullName @()) {{ Write-Output 'OK shortcut'; exit 0 }}
    }}
}}

# 4. AppX / UWP — Calculator, Photos, Edge, Store apps.
try {{
    $startApps = Get-StartApps -ErrorAction SilentlyContinue
    if ($startApps) {{
        $appx = $startApps | Where-Object {{ $_.Name.ToLower() -eq $nameLower }} | Select-Object -First 1
        if (-not $appx) {{
            $appx = $startApps | Where-Object {{ $_.Name.ToLower().Contains($nameLower) }} | Sort-Object {{ $_.Name.Length }} | Select-Object -First 1
        }}
        if ($appx) {{
            if (Try-Start 'explorer.exe' @("shell:AppsFolder\$($appx.AppID)")) {{
                Write-Output 'OK appx'; exit 0
            }}
        }}
    }}
}} catch {{}}

# 5. Last-ditch attempt — let Start-Process resolve it (URI handlers, registered verbs, PATH).
try {{
    Start-Process -FilePath $name | Out-Null
    Write-Output 'OK fallback'; exit 0
}} catch {{}}

Write-Error "Application not found: $name"
exit 1
"#,
        name = escaped
    );

    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to invoke PowerShell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("Failed to launch {}: {}", raw, detail));
    }

    // Wait for the launched application's main window to appear and bring it
    // to the foreground — this matches the "open -a" UX on macOS, where the
    // app becomes active and ready to receive keyboard input.
    let target = raw.to_lowercase();
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(8000);
    while std::time::Instant::now() < deadline {
        if let Some(hwnd) = win_window::find_main_window_for_name(&target) {
            win_window::force_foreground(hwnd);
            // Settle: give the app a beat to actually receive focus.
            std::thread::sleep(std::time::Duration::from_millis(250));
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    // Timed out finding the window, but the launch succeeded — return Ok so the
    // chat agent doesn't think the launch failed; subsequent activate calls can retry.
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn launch_application_impl(name: &str) -> Result<(), String> {
    // Mirrors macOS `open -a "<name>"`: try a path, .desktop file, or just exec.
    let raw = name.trim();
    if raw.is_empty() {
        return Err("Application name is empty".to_string());
    }

    if Path::new(raw).is_file() {
        Command::new(raw)
            .spawn()
            .map_err(|e| format!("Failed to launch {}: {}", raw, e))?;
        wait_for_linux_window(raw);
        return Ok(());
    }

    let nl = raw.to_lowercase();
    let mut search_dirs = vec![
        "/usr/share/applications".to_string(),
        "/usr/local/share/applications".to_string(),
        "/var/lib/flatpak/exports/share/applications".to_string(),
    ];
    if let Ok(home) = std::env::var("HOME") {
        search_dirs.push(format!("{}/.local/share/applications", home));
        search_dirs.push(format!(
            "{}/.local/share/flatpak/exports/share/applications",
            home
        ));
    }

    let mut best_desktop: Option<std::path::PathBuf> = None;
    let mut best_score: i32 = i32::MAX;
    for dir in &search_dirs {
        let path = Path::new(dir);
        if !path.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) != Some("desktop") {
                    continue;
                }
                let stem = p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let mut display_name = String::new();
                if let Ok(content) = std::fs::read_to_string(&p) {
                    for line in content.lines() {
                        if let Some(v) = line.strip_prefix("Name=") {
                            display_name = v.trim().to_lowercase();
                            break;
                        }
                    }
                }
                // Score: 0 = exact match, 1 = display name contains, 2 = file stem contains
                let score = if stem == nl || display_name == nl {
                    0
                } else if !display_name.is_empty() && display_name.contains(&nl) {
                    1
                } else if stem.contains(&nl) {
                    2
                } else {
                    i32::MAX
                };
                if score < best_score {
                    best_score = score;
                    best_desktop = Some(p);
                }
            }
        }
    }

    if let Some(desktop) = best_desktop {
        // Prefer gtk-launch <basename without .desktop> — it handles Exec= field codes properly.
        if let Some(stem) = desktop.file_stem().and_then(|s| s.to_str()) {
            if Command::new("gtk-launch").arg(stem).spawn().is_ok() {
                wait_for_linux_window(raw);
                return Ok(());
            }
        }
        // Fallback: parse Exec= ourselves, stripping field codes %f %F %u %U etc.
        if let Ok(content) = std::fs::read_to_string(&desktop) {
            for line in content.lines() {
                if let Some(exec) = line.strip_prefix("Exec=") {
                    let cleaned: Vec<String> = exec
                        .split_whitespace()
                        .filter(|t| !t.starts_with('%'))
                        .map(|s| s.to_string())
                        .collect();
                    if let Some((cmd, args)) = cleaned.split_first() {
                        Command::new(cmd)
                            .args(args)
                            .spawn()
                            .map_err(|e| format!("Failed to launch {}: {}", name, e))?;
                        wait_for_linux_window(raw);
                        return Ok(());
                    }
                }
            }
        }
    }

    // Last resort: try the name as a binary on PATH.
    Command::new(raw)
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {}", name, e))?;
    wait_for_linux_window(raw);
    Ok(())
}

#[cfg(target_os = "linux")]
fn wait_for_linux_window(name: &str) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(6000);
    while std::time::Instant::now() < deadline {
        // Try wmctrl -a (activates by title substring).
        if Command::new("wmctrl")
            .arg("-a")
            .arg(name)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            std::thread::sleep(std::time::Duration::from_millis(250));
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
}

// ── Activate (bring to front) Application ──────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn activate_application_impl(name: &str) -> Result<(), String> {
    let script = format!(
        "osascript -e 'tell application \"{}\" to activate'",
        name.replace('"', "\\\"")
    );
    Command::new("sh")
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to activate {}: {}", name, e))?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn activate_application_impl(name: &str) -> Result<(), String> {
    let target = name.trim().to_lowercase();
    if target.is_empty() {
        return Err("activate_application: empty name".to_string());
    }
    match win_window::find_main_window_for_name(&target) {
        Some(hwnd) => {
            win_window::force_foreground(hwnd);
            Ok(())
        }
        None => Err(format!("No window found for application: {}", name)),
    }
}

#[cfg(target_os = "linux")]
pub fn activate_application_impl(name: &str) -> Result<(), String> {
    if let Ok(status) = Command::new("wmctrl").arg("-a").arg(name).status() {
        if status.success() {
            return Ok(());
        }
    }
    // Fallback to xdotool: search by name and activate the first match.
    if let Ok(out) = Command::new("xdotool")
        .arg("search")
        .arg("--onlyvisible")
        .arg("--name")
        .arg(name)
        .output()
    {
        let win_id = String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        if !win_id.is_empty() {
            let _ = Command::new("xdotool")
                .arg("windowactivate")
                .arg("--sync")
                .arg(&win_id)
                .status();
            return Ok(());
        }
    }
    Err(format!("No window found for application: {}", name))
}

#[tauri::command]
pub fn activate_application(name: String) -> Result<(), String> {
    activate_application_impl(&name)
}

// ── Clipboard read/write ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn clipboard_read_impl() -> Result<String, String> {
    let output = Command::new("pbpaste")
        .output()
        .map_err(|e| format!("Failed to read clipboard: {}", e))?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "windows")]
fn clipboard_read_impl() -> Result<String, String> {
    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg("Get-Clipboard")
        .output()
        .map_err(|e| format!("Failed to read clipboard: {}", e))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "linux")]
fn clipboard_read_impl() -> Result<String, String> {
    let output = Command::new("xclip")
        .arg("-selection")
        .arg("clipboard")
        .arg("-o")
        .output()
        .or_else(|_| Command::new("xsel").arg("--clipboard").arg("--output").output())
        .map_err(|e| format!("Failed to read clipboard: {}", e))?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "macos")]
fn clipboard_write_impl(text: &str) -> Result<(), String> {
    use std::io::Write;
    let mut child = Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to write clipboard: {}", e))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    }
    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn clipboard_write_impl(text: &str) -> Result<(), String> {
    let escaped = text.replace("'", "''");
    Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(format!("Set-Clipboard '{}'", escaped))
        .output()
        .map_err(|e| format!("Failed to write clipboard: {}", e))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn clipboard_write_impl(text: &str) -> Result<(), String> {
    use std::io::Write;
    let mut child = Command::new("xclip")
        .arg("-selection")
        .arg("clipboard")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .or_else(|_| {
            Command::new("xsel")
                .arg("--clipboard")
                .arg("--input")
                .stdin(std::process::Stdio::piped())
                .spawn()
        })
        .map_err(|e| format!("Failed to write clipboard: {}", e))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    }
    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clipboard_read() -> Result<String, String> {
    clipboard_read_impl()
}

#[tauri::command]
pub fn clipboard_write(text: String) -> Result<(), String> {
    clipboard_write_impl(&text)
}

// ── Hide / show own window ────────────────────────────────────────────────────
// Used to hide the Catog window before taking screenshots so the workflow
// output panel does not appear in the capture.

#[tauri::command]
pub fn hide_own_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_own_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Long press at coordinates ─────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn long_press_at_impl(x: i32, y: i32, duration_ms: u64) -> Result<(), String> {
    let script = format!(
        r#"osascript -e 'tell application "System Events"
            set awsPath to POSIX path of (path to me)
        end tell'
        do shell script "python3 -c \"
import subprocess, time, sys
subprocess.run(['cliclick', 'c:{},{}'])
time.sleep({})
subprocess.run(['cliclick', 'c:{},{}'])
\""#,
        x,
        y,
        duration_ms as f64 / 1000.0,
        x,
        y
    );
    let alt = format!(
        r#"osascript -e 'tell application "System Events" to click at {{{}, {}}}'"#,
        x, y
    );
    let _ = Command::new("sh").arg("-c").arg(&script).output();
    if duration_ms > 0 {
        std::thread::sleep(std::time::Duration::from_millis(duration_ms));
    }
    let _ = Command::new("sh").arg("-c").arg(&alt).output();
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn long_press_at_impl(x: i32, y: i32, duration_ms: u64) -> Result<(), String> {
    win_input::set_cursor_pos(x, y)?;
    std::thread::sleep(std::time::Duration::from_millis(20));
    win_input::mouse_left_down();
    std::thread::sleep(std::time::Duration::from_millis(duration_ms));
    win_input::mouse_left_up();
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn long_press_at_impl(x: i32, y: i32, duration_ms: u64) -> Result<(), String> {
    Command::new("xdotool")
        .arg("mousemove")
        .arg(x.to_string())
        .arg(y.to_string())
        .output()
        .map_err(|e| e.to_string())?;
    Command::new("xdotool")
        .arg("mousedown")
        .arg("1")
        .output()
        .map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(duration_ms));
    Command::new("xdotool")
        .arg("mouseup")
        .arg("1")
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Scroll at coordinates ─────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn scroll_at_impl(x: i32, y: i32, direction: &str, amount: u32) -> Result<(), String> {
    let clicks = match direction {
        "down" => amount as i32,
        "up" => -(amount as i32),
        _ => return Err(format!("Unknown scroll direction: {}", direction)),
    };
    let script = format!(
        r#"osascript -e 'tell application "System Events"
            click at {{{}, {}}}
        end tell'
        osascript -e 'tell application "System Events" to keystroke " "'"#,
        x, y
    );
    let _ = Command::new("sh").arg("-c").arg(&script).output();
    let scroll_script = format!(
        "osascript -e 'tell application \"System Events\" to repeat {} times\ndo shell script \"osascript -e \\\"tell application \\\\\\\"System Events\\\\\\\" to key code 125 using {{option down}}\\\"\"\nend repeat'",
        clicks.abs()
    );
    let _ = Command::new("sh").arg("-c").arg(&scroll_script).output();
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn scroll_at_impl(x: i32, y: i32, direction: &str, amount: u32) -> Result<(), String> {
    let amount = amount.max(1) as i32;
    let (dx, dy) = match direction {
        "down" => (0, -amount * 120),
        "up" => (0, amount * 120),
        "left" => (-amount * 120, 0),
        "right" => (amount * 120, 0),
        _ => return Err(format!("Unknown scroll direction: {}", direction)),
    };
    win_input::set_cursor_pos(x, y)?;
    std::thread::sleep(std::time::Duration::from_millis(20));
    if dy != 0 {
        win_input::mouse_wheel(dy, false);
    }
    if dx != 0 {
        win_input::mouse_wheel(dx, true);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn scroll_at_impl(x: i32, y: i32, direction: &str, amount: u32) -> Result<(), String> {
    Command::new("xdotool")
        .arg("mousemove")
        .arg(x.to_string())
        .arg(y.to_string())
        .output()
        .map_err(|e| e.to_string())?;
    let button = match direction {
        "down" => "5",
        "up" => "4",
        _ => return Err(format!("Unknown scroll direction: {}", direction)),
    };
    for _ in 0..amount {
        Command::new("xdotool")
            .arg("click")
            .arg(button)
            .output()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Drag from A to B ──────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn drag_impl(
    from_x: i32,
    from_y: i32,
    to_x: i32,
    to_y: i32,
    _duration_ms: u64,
) -> Result<(), String> {
    let script = format!(
        r#"osascript -e 'tell application "System Events"
            click at {{{}, {}}}
            delay 0.1
            click at {{{}, {}}}
        end tell'"#,
        from_x, from_y, to_x, to_y
    );
    Command::new("sh")
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn drag_impl(
    from_x: i32,
    from_y: i32,
    to_x: i32,
    to_y: i32,
    duration_ms: u64,
) -> Result<(), String> {
    let steps = ((duration_ms.max(1) as f64 / 16.0).ceil() as u32).max(1);
    let step_sleep = (duration_ms / steps as u64).max(1);
    win_input::set_cursor_pos(from_x, from_y)?;
    std::thread::sleep(std::time::Duration::from_millis(20));
    win_input::mouse_left_down();
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        let cx = (from_x as f64 + (to_x as f64 - from_x as f64) * t).round() as i32;
        let cy = (from_y as f64 + (to_y as f64 - from_y as f64) * t).round() as i32;
        let _ = win_input::set_cursor_pos(cx, cy);
        std::thread::sleep(std::time::Duration::from_millis(step_sleep));
    }
    std::thread::sleep(std::time::Duration::from_millis(20));
    win_input::mouse_left_up();
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn drag_impl(
    from_x: i32,
    from_y: i32,
    to_x: i32,
    to_y: i32,
    duration_ms: u64,
) -> Result<(), String> {
    Command::new("xdotool")
        .arg("mousemove")
        .arg(from_x.to_string())
        .arg(from_y.to_string())
        .output()
        .map_err(|e| e.to_string())?;
    Command::new("xdotool")
        .arg("mousedown")
        .arg("1")
        .output()
        .map_err(|e| e.to_string())?;
    if duration_ms > 0 {
        let steps = ((duration_ms as f64 / 16.0).ceil() as u32).max(1);
        for i in 1..=steps {
            let t = i as f64 / steps as f64;
            let cx = (from_x as f64 + (to_x as f64 - from_x as f64) * t).round() as i32;
            let cy = (from_y as f64 + (to_y as f64 - from_y as f64) * t).round() as i32;
            Command::new("xdotool")
                .arg("mousemove")
                .arg(cx.to_string())
                .arg(cy.to_string())
                .output()
                .map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
    } else {
        Command::new("xdotool")
            .arg("mousemove")
            .arg(to_x.to_string())
            .arg(to_y.to_string())
            .output()
            .map_err(|e| e.to_string())?;
    }
    Command::new("xdotool")
        .arg("mouseup")
        .arg("1")
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn get_active_window_bounds_impl() -> Result<WindowBounds, String> {
    let script = r#"
tell application "System Events"
    set frontProc to first process whose frontmost is true
    tell front window of frontProc
        set {px, py} to position
        set {ww, wh} to size
        return (px as string) & "," & (py as string) & "," & (ww as string) & "," & (wh as string)
    end tell
end tell
"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts = text.split(',').map(|s| s.trim()).collect::<Vec<_>>();
    if parts.len() != 4 {
        return Err(format!("Failed to parse active window bounds: {}", text));
    }
    let x = parts[0].parse::<i32>().map_err(|e| e.to_string())?;
    let y = parts[1].parse::<i32>().map_err(|e| e.to_string())?;
    let width = parts[2].parse::<u32>().map_err(|e| e.to_string())?;
    let height = parts[3].parse::<u32>().map_err(|e| e.to_string())?;
    Ok(WindowBounds {
        x,
        y,
        width,
        height,
    })
}

#[cfg(target_os = "windows")]
fn get_active_window_bounds_impl() -> Result<WindowBounds, String> {
    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut std::ffi::c_void;
        fn GetWindowRect(hwnd: *mut std::ffi::c_void, rect: *mut Rect) -> i32;
    }

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return Err("No foreground window".to_string());
        }
        let mut r = Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(hwnd, &mut r) == 0 {
            return Err("GetWindowRect failed".to_string());
        }
        let width = (r.right - r.left).max(0) as u32;
        let height = (r.bottom - r.top).max(0) as u32;
        Ok(WindowBounds {
            x: r.left,
            y: r.top,
            width,
            height,
        })
    }
}

#[cfg(target_os = "linux")]
fn get_active_window_bounds_impl() -> Result<WindowBounds, String> {
    // Use xdotool: getactivewindow, then getwindowgeometry --shell
    let win_id = Command::new("xdotool")
        .arg("getactivewindow")
        .output()
        .map_err(|e| format!("xdotool not available: {}", e))?;
    if !win_id.status.success() {
        return Err("xdotool getactivewindow failed".to_string());
    }
    let win_id = String::from_utf8_lossy(&win_id.stdout).trim().to_string();
    let geom = Command::new("xdotool")
        .arg("getwindowgeometry")
        .arg("--shell")
        .arg(&win_id)
        .output()
        .map_err(|e| e.to_string())?;
    if !geom.status.success() {
        return Err("xdotool getwindowgeometry failed".to_string());
    }
    let stdout = String::from_utf8_lossy(&geom.stdout);
    let mut x = 0i32;
    let mut y = 0i32;
    let mut w = 0u32;
    let mut h = 0u32;
    for line in stdout.lines() {
        if let Some(v) = line.strip_prefix("X=") {
            x = v.trim().parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("Y=") {
            y = v.trim().parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("WIDTH=") {
            w = v.trim().parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("HEIGHT=") {
            h = v.trim().parse().unwrap_or(0);
        }
    }
    Ok(WindowBounds {
        x,
        y,
        width: w,
        height: h,
    })
}

fn get_window_edges_from_bounds(bounds: &WindowBounds) -> WindowEdges {
    let right_x = bounds.x + bounds.width as i32;
    let bottom_y = bounds.y + bounds.height as i32;
    WindowEdges {
        top_left_x: bounds.x,
        top_left_y: bounds.y,
        top_right_x: right_x,
        top_right_y: bounds.y,
        bottom_left_x: bounds.x,
        bottom_left_y: bottom_y,
        bottom_right_x: right_x,
        bottom_right_y: bottom_y,
        title_bar_x: bounds.x + (bounds.width as i32 / 2),
        title_bar_y: bounds.y + 14,
    }
}

#[cfg(target_os = "macos")]
fn window_control_click_point(bounds: &WindowBounds, action: &str) -> Result<(i32, i32), String> {
    let y = bounds.y + 14;
    match action {
        "close" | "exit" | "close_window" => Ok((bounds.x + 14, y)),
        "minimize" | "minimize_window" => Ok((bounds.x + 34, y)),
        "maximize" | "maximize_window" => Ok((bounds.x + 54, y)),
        _ => Err(format!("Unknown window action: {}", action)),
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_active_window_bounds() -> Result<WindowBounds, String> {
    get_active_window_bounds_impl()
}

#[tauri::command]
pub fn get_active_window_edges() -> Result<WindowEdges, String> {
    let bounds = get_active_window_bounds_impl()?;
    Ok(get_window_edges_from_bounds(&bounds))
}

#[tauri::command]
pub fn window_control_action(action: String, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let bounds = get_active_window_bounds_impl()?;
        let (x, y) = window_control_click_point(&bounds, &action)?;
        return click_at(x, y, app);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        return window_control_action_windows(&action);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        return window_control_action_linux(&action);
    }
    #[allow(unreachable_code)]
    Err(format!(
        "window_control_action not supported on this platform (action={})",
        action
    ))
}

#[cfg(target_os = "windows")]
fn window_control_action_windows(action: &str) -> Result<(), String> {
    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut std::ffi::c_void;
        fn ShowWindow(hwnd: *mut std::ffi::c_void, cmd: i32) -> i32;
        fn PostMessageW(hwnd: *mut std::ffi::c_void, msg: u32, wparam: usize, lparam: isize)
            -> i32;
    }
    const SW_MINIMIZE: i32 = 6;
    const SW_MAXIMIZE: i32 = 3;
    const SW_RESTORE: i32 = 9;
    const WM_CLOSE: u32 = 0x0010;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return Err("No foreground window".to_string());
        }
        match action {
            "minimize" | "minimize_window" => {
                ShowWindow(hwnd, SW_MINIMIZE);
            }
            "maximize" | "maximize_window" => {
                ShowWindow(hwnd, SW_MAXIMIZE);
            }
            "restore" | "restore_window" => {
                ShowWindow(hwnd, SW_RESTORE);
            }
            "close" | "exit" | "close_window" => {
                PostMessageW(hwnd, WM_CLOSE, 0, 0);
            }
            other => return Err(format!("Unknown window action: {}", other)),
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn window_control_action_linux(action: &str) -> Result<(), String> {
    let arg = match action {
        "minimize" | "minimize_window" => "minimize",
        "maximize" | "maximize_window" => "maximized_vert,maximized_horz",
        "close" | "exit" | "close_window" => {
            // wmctrl -c :ACTIVE: closes the active window
            let status = Command::new("wmctrl")
                .arg("-c")
                .arg(":ACTIVE:")
                .status()
                .map_err(|e| format!("wmctrl not available: {}", e))?;
            if !status.success() {
                return Err("wmctrl close failed".to_string());
            }
            return Ok(());
        }
        other => return Err(format!("Unknown window action: {}", other)),
    };
    let status = Command::new("wmctrl")
        .arg("-r")
        .arg(":ACTIVE:")
        .arg("-b")
        .arg(format!("add,{}", arg))
        .status()
        .map_err(|e| format!("wmctrl not available: {}", e))?;
    if !status.success() {
        return Err("wmctrl action failed".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn launch_application(name: String) -> Result<(), String> {
    launch_application_impl(&name)
}

#[tauri::command]
pub fn get_running_programs() -> Vec<RunningProgram> {
    get_running_programs_impl()
}

#[tauri::command]
pub fn get_installed_applications() -> Vec<InstalledApplication> {
    get_installed_applications_impl()
}

#[tauri::command]
pub fn click_at(x: i32, y: i32, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let sf = app
            .get_webview_window("main")
            .and_then(|w| w.scale_factor().ok())
            .unwrap_or(1.0);
        let sf = sf.max(1.0);
        click_at_impl(
            (x as f64 / sf).round() as i32,
            (y as f64 / sf).round() as i32,
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        click_at_impl(x, y)
    }
}

#[tauri::command]
pub fn type_text(text: String) -> Result<(), String> {
    type_text_impl(&text)
}

#[tauri::command]
pub fn press_key_combo(keys: String) -> Result<(), String> {
    press_key_combo_impl(&keys)
}

#[tauri::command]
pub fn get_screen_size() -> ScreenSize {
    get_screen_size_impl()
}

#[tauri::command]
pub fn read_screen_region(x: i32, y: i32, width: u32, height: u32) -> ScreenRegion {
    read_screen_region_impl(x, y, width, height)
}

#[tauri::command]
pub fn save_file(
    filename: String,
    content: String,
    format: String,
    path: Option<String>,
) -> Result<String, String> {
    fn default_documents_dir() -> std::path::PathBuf {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(std::path::PathBuf::from);
        if let Some(home_dir) = home {
            let documents = home_dir.join("Documents");
            if documents.exists() || std::fs::create_dir_all(&documents).is_ok() {
                return documents;
            }
        }
        std::env::temp_dir()
    }

    let ext = match format.as_str() {
        "json" => "json",
        "csv" => "csv",
        "md" => "md",
        _ => "txt",
    };

    let base_dir = path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(default_documents_dir);
    std::fs::create_dir_all(&base_dir).map_err(|e| {
        format!(
            "Failed to create save directory '{}': {}",
            base_dir.to_string_lossy(),
            e
        )
    })?;

    let cleaned_filename = filename.trim().trim_matches(std::path::MAIN_SEPARATOR);
    let cleaned_filename = if cleaned_filename.is_empty() {
        "output"
    } else {
        cleaned_filename
    };
    let mut file_name = cleaned_filename.to_string();
    let expected_suffix = format!(".{}", ext);
    if !file_name.to_lowercase().ends_with(&expected_suffix) {
        file_name.push_str(&expected_suffix);
    }

    let full_path = base_dir.join(file_name);
    std::fs::write(&full_path, &content).map_err(|e| e.to_string())?;
    Ok(full_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn select_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg("POSIX path of (choose folder with prompt \"Select save location\")")
            .output()
            .map_err(|e| format!("Failed to open folder picker: {}", e))?;
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok((!path.is_empty()).then_some(path));
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.to_lowercase().contains("user canceled") || stderr.contains("-128") {
            return Ok(None);
        }
        return Err(format!("Folder picker failed: {}", stderr.trim()));
    }

    #[cfg(target_os = "windows")]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select save location'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
"#;
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", script])
            .output()
            .map_err(|e| format!("Failed to open folder picker: {}", e))?;
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok((!path.is_empty()).then_some(path));
        }
        return Err(format!(
            "Folder picker failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    #[cfg(target_os = "linux")]
    {
        for (program, args) in [
            ("zenity", vec!["--file-selection", "--directory", "--title=Select save location"]),
            ("kdialog", vec!["--getexistingdirectory", "."]),
        ] {
            let output = std::process::Command::new(program).args(args).output();
            match output {
                Ok(result) if result.status.success() => {
                    let path = String::from_utf8_lossy(&result.stdout).trim().to_string();
                    return Ok((!path.is_empty()).then_some(path));
                }
                Ok(result) => {
                    let stderr = String::from_utf8_lossy(&result.stderr).to_lowercase();
                    if stderr.contains("cancel") {
                        return Ok(None);
                    }
                }
                Err(_) => continue,
            }
        }
        Err("No supported folder picker found. Install zenity or kdialog, or type the path manually.".to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Ok(None)
    }
}

#[tauri::command]
pub fn select_file() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg("POSIX path of (choose file with prompt \"Select file to open\")")
            .output()
            .map_err(|e| format!("Failed to open file picker: {}", e))?;
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok((!path.is_empty()).then_some(path));
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.to_lowercase().contains("user canceled") || stderr.contains("-128") {
            return Ok(None);
        }
        return Err(format!("File picker failed: {}", stderr.trim()));
    }

    #[cfg(target_os = "windows")]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select file to open'
$dialog.CheckFileExists = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.FileName
}
"#;
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", script])
            .output()
            .map_err(|e| format!("Failed to open file picker: {}", e))?;
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok((!path.is_empty()).then_some(path));
        }
        return Err(format!(
            "File picker failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    #[cfg(target_os = "linux")]
    {
        for (program, args) in [
            ("zenity", vec!["--file-selection", "--title=Select file to open"]),
            ("kdialog", vec!["--getopenfilename", "."]),
        ] {
            let output = std::process::Command::new(program).args(args).output();
            match output {
                Ok(result) if result.status.success() => {
                    let path = String::from_utf8_lossy(&result.stdout).trim().to_string();
                    return Ok((!path.is_empty()).then_some(path));
                }
                Ok(result) => {
                    let stderr = String::from_utf8_lossy(&result.stderr).to_lowercase();
                    if stderr.contains("cancel") {
                        return Ok(None);
                    }
                }
                Err(_) => continue,
            }
        }
        Err("No supported file picker found. Install zenity or kdialog, or type the path manually.".to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Ok(None)
    }
}

#[tauri::command]
pub fn long_press_at(
    x: i32,
    y: i32,
    duration_ms: u64,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let sf = app
            .get_webview_window("main")
            .and_then(|w| w.scale_factor().ok())
            .unwrap_or(1.0);
        let sf = sf.max(1.0);
        long_press_at_impl(
            (x as f64 / sf).round() as i32,
            (y as f64 / sf).round() as i32,
            duration_ms,
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        long_press_at_impl(x, y, duration_ms)
    }
}

#[tauri::command]
pub fn scroll_at(
    x: i32,
    y: i32,
    direction: String,
    amount: u32,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let sf = app
            .get_webview_window("main")
            .and_then(|w| w.scale_factor().ok())
            .unwrap_or(1.0);
        let sf = sf.max(1.0);
        scroll_at_impl(
            (x as f64 / sf).round() as i32,
            (y as f64 / sf).round() as i32,
            &direction,
            amount,
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        scroll_at_impl(x, y, &direction, amount)
    }
}

#[tauri::command]
pub fn drag(
    from_x: i32,
    from_y: i32,
    to_x: i32,
    to_y: i32,
    duration_ms: u64,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let sf = app
            .get_webview_window("main")
            .and_then(|w| w.scale_factor().ok())
            .unwrap_or(1.0);
        let sf = sf.max(1.0);
        drag_impl(
            (from_x as f64 / sf).round() as i32,
            (from_y as f64 / sf).round() as i32,
            (to_x as f64 / sf).round() as i32,
            (to_y as f64 / sf).round() as i32,
            duration_ms,
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        drag_impl(from_x, from_y, to_x, to_y, duration_ms)
    }
}

// ── Windows native input helpers ───────────────────────────────────────────────
#[cfg(target_os = "windows")]
mod win_input {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MouseInput {
        dx: i32,
        dy: i32,
        mouse_data: u32,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct KeybdInput {
        w_vk: u16,
        w_scan: u16,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct HardwareInput {
        u_msg: u32,
        w_param_l: u16,
        w_param_h: u16,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    union InputUnion {
        mi: MouseInput,
        ki: KeybdInput,
        hi: HardwareInput,
    }

    #[repr(C)]
    struct InputRecord {
        r#type: u32,
        u: InputUnion,
    }

    const INPUT_MOUSE: u32 = 0;
    const INPUT_KEYBOARD: u32 = 1;

    const MOUSEEVENTF_MOVE: u32 = 0x0001;
    const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
    const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
    const MOUSEEVENTF_WHEEL: u32 = 0x0800;
    const MOUSEEVENTF_HWHEEL: u32 = 0x01000;
    const MOUSEEVENTF_ABSOLUTE: u32 = 0x8000;

    const KEYEVENTF_KEYUP: u32 = 0x0002;
    const KEYEVENTF_UNICODE: u32 = 0x0004;
    const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;

    #[link(name = "user32")]
    extern "system" {
        fn SendInput(c_inputs: u32, p_inputs: *mut InputRecord, cb_size: i32) -> u32;
        fn SetCursorPos(x: i32, y: i32) -> i32;
        fn GetSystemMetrics(n_index: i32) -> i32;
        fn VkKeyScanW(ch: u16) -> i16;
    }
    const SM_CXSCREEN: i32 = 0;
    const SM_CYSCREEN: i32 = 1;

    fn send_mouse(flags: u32, dx: i32, dy: i32, data: u32) {
        let mut input = InputRecord {
            r#type: INPUT_MOUSE,
            u: InputUnion {
                mi: MouseInput {
                    dx,
                    dy,
                    mouse_data: data,
                    dw_flags: flags,
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        };
        unsafe {
            SendInput(1, &mut input, std::mem::size_of::<InputRecord>() as i32);
        }
    }

    fn send_key(vk: u16, key_up: bool, extended: bool) {
        let mut flags = 0u32;
        if extended {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        if key_up {
            flags |= KEYEVENTF_KEYUP;
        }
        let mut input = InputRecord {
            r#type: INPUT_KEYBOARD,
            u: InputUnion {
                ki: KeybdInput {
                    w_vk: vk,
                    w_scan: 0,
                    dw_flags: flags,
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        };
        unsafe {
            SendInput(1, &mut input, std::mem::size_of::<InputRecord>() as i32);
        }
    }

    fn send_unicode(ch: u16, key_up: bool) {
        let flags = KEYEVENTF_UNICODE | if key_up { KEYEVENTF_KEYUP } else { 0 };
        let mut input = InputRecord {
            r#type: INPUT_KEYBOARD,
            u: InputUnion {
                ki: KeybdInput {
                    w_vk: 0,
                    w_scan: ch,
                    dw_flags: flags,
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        };
        unsafe {
            SendInput(1, &mut input, std::mem::size_of::<InputRecord>() as i32);
        }
    }

    pub fn set_cursor_pos(x: i32, y: i32) -> Result<(), String> {
        // Use absolute MOUSEMOVE so DPI-virtualized coordinates are respected,
        // then fall back to SetCursorPos for environments where SendInput is filtered.
        unsafe {
            let cx = GetSystemMetrics(SM_CXSCREEN).max(1);
            let cy = GetSystemMetrics(SM_CYSCREEN).max(1);
            let nx = ((x as i64 * 65535) / cx as i64) as i32;
            let ny = ((y as i64 * 65535) / cy as i64) as i32;
            send_mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, nx, ny, 0);
            if SetCursorPos(x, y) == 0 {
                // SetCursorPos can fail under high-integrity prompts; SendInput already moved.
            }
        }
        Ok(())
    }

    pub fn mouse_left_down() {
        send_mouse(MOUSEEVENTF_LEFTDOWN, 0, 0, 0);
    }
    pub fn mouse_left_up() {
        send_mouse(MOUSEEVENTF_LEFTUP, 0, 0, 0);
    }

    pub fn mouse_wheel(delta: i32, horizontal: bool) {
        let flag = if horizontal {
            MOUSEEVENTF_HWHEEL
        } else {
            MOUSEEVENTF_WHEEL
        };
        send_mouse(flag, 0, 0, delta as u32);
    }

    pub fn type_unicode_text(text: &str) -> Result<(), String> {
        // Translate \r\n and \r to \n so we don't double-press Enter.
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        for ch in normalized.chars() {
            if ch == '\n' {
                // Use the real VK_RETURN — many apps (Notepad, Word, browsers)
                // ignore the unicode \n keystroke and only honor VK_RETURN.
                send_key(0x0D, false, false);
                std::thread::sleep(std::time::Duration::from_millis(8));
                send_key(0x0D, true, false);
                std::thread::sleep(std::time::Duration::from_millis(20));
                continue;
            }
            if ch == '\t' {
                send_key(0x09, false, false);
                std::thread::sleep(std::time::Duration::from_millis(8));
                send_key(0x09, true, false);
                std::thread::sleep(std::time::Duration::from_millis(15));
                continue;
            }
            // UTF-16 encode the character (handles surrogate pairs for emoji etc.).
            let mut buf = [0u16; 2];
            let units = ch.encode_utf16(&mut buf);
            for unit in units.iter() {
                send_unicode(*unit, false);
                std::thread::sleep(std::time::Duration::from_millis(5));
                send_unicode(*unit, true);
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
        Ok(())
    }

    fn vk_for_named(name: &str) -> Option<(u16, bool)> {
        // Returns (virtual-key, extended-key)
        let n = name.trim().to_lowercase();
        // Keep this in sync with the doc string for press_key_combo.
        let result: Option<(u16, bool)> = match n.as_str() {
            "ctrl" | "control" => Some((0x11, false)),
            "shift" => Some((0x10, false)),
            "alt" | "option" => Some((0x12, false)),
            "win" | "cmd" | "command" | "meta" | "super" => Some((0x5B, true)),
            "enter" | "return" => Some((0x0D, false)),
            "tab" => Some((0x09, false)),
            "esc" | "escape" => Some((0x1B, false)),
            "space" | "spacebar" => Some((0x20, false)),
            "backspace" => Some((0x08, false)),
            "delete" | "del" => Some((0x2E, true)),
            "insert" | "ins" => Some((0x2D, true)),
            "home" => Some((0x24, true)),
            "end" => Some((0x23, true)),
            "pageup" | "pgup" => Some((0x21, true)),
            "pagedown" | "pgdn" => Some((0x22, true)),
            "up" | "uparrow" => Some((0x26, true)),
            "down" | "downarrow" => Some((0x28, true)),
            "left" | "leftarrow" => Some((0x25, true)),
            "right" | "rightarrow" => Some((0x27, true)),
            "capslock" => Some((0x14, false)),
            "printscreen" => Some((0x2C, true)),
            "f1" => Some((0x70, false)),
            "f2" => Some((0x71, false)),
            "f3" => Some((0x72, false)),
            "f4" => Some((0x73, false)),
            "f5" => Some((0x74, false)),
            "f6" => Some((0x75, false)),
            "f7" => Some((0x76, false)),
            "f8" => Some((0x77, false)),
            "f9" => Some((0x78, false)),
            "f10" => Some((0x79, false)),
            "f11" => Some((0x7A, false)),
            "f12" => Some((0x7B, false)),
            _ => None,
        };
        if result.is_some() {
            return result;
        }
        // Single character — map via VkKeyScanW (returns shift state in high byte).
        let mut chars = name.chars();
        if let (Some(c), None) = (chars.next(), chars.next()) {
            let scan = unsafe { VkKeyScanW(c as u16) };
            if scan != -1 {
                let vk = (scan & 0xFF) as u16;
                return Some((vk, false));
            }
        }
        None
    }

    pub fn press_key_combo(combo: &str) -> Result<(), String> {
        // Treat macOS-style "command+..." as Ctrl on Windows for portability of the AI's commands.
        let normalized = combo
            .split('+')
            .map(|s| {
                let lower = s.trim().to_lowercase();
                if lower == "command" || lower == "cmd" {
                    "ctrl".to_string()
                } else {
                    lower
                }
            })
            .collect::<Vec<_>>();

        let mut keys: Vec<(u16, bool)> = Vec::new();
        for part in &normalized {
            match vk_for_named(part) {
                Some(k) => keys.push(k),
                None => return Err(format!("Unknown key: {}", part)),
            }
        }
        if keys.is_empty() {
            return Err("Empty key combo".to_string());
        }
        // Press in order, release in reverse.
        for (vk, ext) in &keys {
            send_key(*vk, false, *ext);
            std::thread::sleep(std::time::Duration::from_millis(8));
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
        for (vk, ext) in keys.iter().rev() {
            send_key(*vk, true, *ext);
            std::thread::sleep(std::time::Duration::from_millis(8));
        }
        Ok(())
    }
}

// ── Windows window-focus helpers ───────────────────────────────────────────────
#[cfg(target_os = "windows")]
mod win_window {
    use std::ffi::{c_void, OsString};
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;

    type HWND = *mut c_void;
    type LPARAM = isize;
    type BOOL = i32;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(
            cb: Option<unsafe extern "system" fn(HWND, LPARAM) -> BOOL>,
            l: LPARAM,
        ) -> BOOL;
        fn IsWindowVisible(hwnd: HWND) -> BOOL;
        fn GetWindow(hwnd: HWND, cmd: u32) -> HWND;
        fn GetWindowTextW(hwnd: HWND, buf: *mut u16, max: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: HWND, pid: *mut u32) -> u32;
        fn GetForegroundWindow() -> HWND;
        fn AttachThreadInput(id_attach: u32, id_attach_to: u32, attach: BOOL) -> BOOL;
        fn AllowSetForegroundWindow(pid: u32) -> BOOL;
        fn SetForegroundWindow(hwnd: HWND) -> BOOL;
        fn BringWindowToTop(hwnd: HWND) -> BOOL;
        fn ShowWindow(hwnd: HWND, cmd: i32) -> BOOL;
        fn IsIconic(hwnd: HWND) -> BOOL;
        fn GetWindowLongW(hwnd: HWND, idx: i32) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> u32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn CloseHandle(h: *mut c_void) -> i32;
        fn QueryFullProcessImageNameW(
            h: *mut c_void,
            flags: u32,
            buf: *mut u16,
            size: *mut u32,
        ) -> i32;
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const SW_RESTORE: i32 = 9;
    const SW_SHOW: i32 = 5;
    const GW_OWNER: u32 = 4;
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: i32 = 0x00000080;

    fn window_text(hwnd: HWND) -> String {
        let mut buf = [0u16; 512];
        let len = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if len <= 0 {
            return String::new();
        }
        OsString::from_wide(&buf[..len as usize])
            .to_string_lossy()
            .into_owned()
    }

    fn process_image_name(pid: u32) -> String {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return String::new();
            }
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut size);
            CloseHandle(h);
            if ok == 0 || size == 0 {
                return String::new();
            }
            let path = OsString::from_wide(&buf[..size as usize])
                .to_string_lossy()
                .into_owned();
            Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string()
        }
    }

    fn is_alt_tab_window(hwnd: HWND) -> bool {
        unsafe {
            if IsWindowVisible(hwnd) == 0 {
                return false;
            }
            // Skip owned windows (dialogs, tooltips)
            if !GetWindow(hwnd, GW_OWNER).is_null() {
                return false;
            }
            let ex = GetWindowLongW(hwnd, GWL_EXSTYLE);
            if (ex & WS_EX_TOOLWINDOW) != 0 {
                return false;
            }
            true
        }
    }

    struct Search {
        needle: String,
        // Synonyms — friendly name → list of likely process image names.
        proc_synonyms: Vec<String>,
        best: HWND,
    }

    fn synonyms_for(needle: &str) -> Vec<String> {
        // Map common Mac-style or friendly app names to likely Windows process names.
        let n = needle.trim().to_lowercase();
        let mut out = vec![n.clone()];
        let extra: &[(&str, &[&str])] = &[
            ("microsoft word", &["winword"]),
            ("word", &["winword"]),
            ("microsoft excel", &["excel"]),
            ("excel", &["excel"]),
            ("microsoft powerpoint", &["powerpnt"]),
            ("powerpoint", &["powerpnt"]),
            ("microsoft outlook", &["outlook"]),
            ("outlook", &["outlook"]),
            ("microsoft onenote", &["onenote"]),
            ("onenote", &["onenote"]),
            ("google chrome", &["chrome"]),
            ("chrome", &["chrome"]),
            ("microsoft edge", &["msedge"]),
            ("edge", &["msedge"]),
            ("firefox", &["firefox"]),
            ("brave", &["brave"]),
            ("safari", &[]),
            ("vlc", &["vlc"]),
            ("notepad", &["notepad"]),
            ("notepad++", &["notepad++"]),
            ("calculator", &["calculatorapp", "applicationframehost"]),
            ("file explorer", &["explorer"]),
            ("explorer", &["explorer"]),
            ("settings", &["systemsettings", "applicationframehost"]),
            ("visual studio code", &["code"]),
            ("vs code", &["code"]),
            ("vscode", &["code"]),
            ("cursor", &["cursor"]),
            ("discord", &["discord"]),
            ("slack", &["slack"]),
            ("spotify", &["spotify"]),
            ("steam", &["steam"]),
            ("zoom", &["zoom"]),
            ("teams", &["teams", "ms-teams"]),
            ("microsoft teams", &["teams", "ms-teams"]),
            ("photoshop", &["photoshop"]),
            ("illustrator", &["illustrator"]),
            ("blender", &["blender"]),
            ("docker desktop", &["docker desktop"]),
            ("postman", &["postman"]),
            ("figma", &["figma"]),
            ("obs", &["obs64", "obs"]),
            ("obs studio", &["obs64", "obs"]),
        ];
        for (alias, procs) in extra.iter() {
            if *alias == n {
                for p in *procs {
                    out.push((*p).to_string());
                }
            }
        }
        out
    }

    unsafe extern "system" fn enum_cb(hwnd: HWND, l: LPARAM) -> BOOL {
        let s = &mut *(l as *mut Search);
        if !is_alt_tab_window(hwnd) {
            return 1;
        }
        let title = window_text(hwnd).to_lowercase();
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let pname = if pid != 0 {
            process_image_name(pid).to_lowercase()
        } else {
            String::new()
        };

        let needle = &s.needle;
        let title_match = !title.is_empty() && (title.contains(needle) || needle.contains(&title));
        let mut proc_match = false;
        for syn in &s.proc_synonyms {
            if !syn.is_empty() && (pname == *syn || pname.contains(syn)) {
                proc_match = true;
                break;
            }
        }
        if title_match || proc_match {
            // Prefer process-name matches (more reliable than title fuzz).
            if proc_match || s.best.is_null() {
                s.best = hwnd;
            }
        }
        1
    }

    pub fn find_main_window_for_name(name: &str) -> Option<HWND> {
        let needle = name.trim().to_lowercase();
        if needle.is_empty() {
            return None;
        }
        let mut search = Search {
            needle,
            proc_synonyms: synonyms_for(name),
            best: std::ptr::null_mut(),
        };
        unsafe {
            EnumWindows(Some(enum_cb), &mut search as *mut _ as LPARAM);
        }
        if search.best.is_null() {
            None
        } else {
            Some(search.best)
        }
    }

    /// Force a window to the foreground using the documented AttachThreadInput
    /// trick. Required because Windows blocks SetForegroundWindow from background
    /// callers unless the calling thread shares input state with the target.
    pub fn force_foreground(hwnd: HWND) {
        unsafe {
            if hwnd.is_null() {
                return;
            }
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            } else {
                ShowWindow(hwnd, SW_SHOW);
            }

            let fg = GetForegroundWindow();
            let mut target_pid: u32 = 0;
            let target_thread = GetWindowThreadProcessId(hwnd, &mut target_pid);
            let mut fg_pid: u32 = 0;
            let fg_thread = if !fg.is_null() {
                GetWindowThreadProcessId(fg, &mut fg_pid)
            } else {
                0
            };
            let cur_thread = GetCurrentThreadId();

            if target_pid != 0 {
                AllowSetForegroundWindow(target_pid);
            }

            let attached_fg = if fg_thread != 0 && fg_thread != cur_thread {
                AttachThreadInput(cur_thread, fg_thread, 1) != 0
            } else {
                false
            };
            let attached_target = if target_thread != 0 && target_thread != cur_thread {
                AttachThreadInput(cur_thread, target_thread, 1) != 0
            } else {
                false
            };

            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);

            if attached_target {
                AttachThreadInput(cur_thread, target_thread, 0);
            }
            if attached_fg {
                AttachThreadInput(cur_thread, fg_thread, 0);
            }
        }
    }
}
