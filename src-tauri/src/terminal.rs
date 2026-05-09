use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub struct TerminalPty {
    stdin: Arc<Mutex<std::process::ChildStdin>>,
}

impl TerminalPty {
    pub fn spawn(app_handle: AppHandle) -> Result<Self, String> {
        let shell = if cfg!(target_os = "windows") {
            "powershell.exe"
        } else {
            "bash"
        };

        let mut child = Command::new(shell)
            .arg(if cfg!(target_os = "windows") {
                "-NoLogo"
            } else {
                "-l"
            })
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;

        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(output) => {
                        let _ = app_handle.emit("terminal-output", output + "\r\n");
                    }
                    Err(e) => {
                        eprintln!("PTY read error: {}", e);
                        break;
                    }
                }
            }
        });

        Ok(Self {
            stdin: Arc::new(Mutex::new(stdin)),
        })
    }

    pub fn write_input(&self, input: String) -> Result<(), String> {
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        stdin
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))?;
        Ok(())
    }
}
