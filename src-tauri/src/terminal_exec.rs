use futures::future::join;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

// ── Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamingCommandResult {
    pub command_id: String,
    pub exit_code: Option<i32>,
    pub success: bool,
    pub duration_ms: u64,
    pub timed_out: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub command_id: String,
    pub output_type: String, // "stdout" or "stderr"
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandStatus {
    pub command_id: String,
    pub status: String, // "running", "completed", "failed", "cancelled", "timeout"
    pub exit_code: Option<i32>,
}

// ── Command Manager ──

pub struct CommandManager {
    processes: Arc<Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>>,
}

impl CommandManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn execute_streaming(
        &self,
        command_id: String,
        command: String,
        cwd: Option<String>,
        env: Option<HashMap<String, String>>,
        timeout_ms: Option<u64>,
        app_handle: AppHandle,
    ) -> Result<StreamingCommandResult, String> {
        let start = std::time::Instant::now();
        let timeout_duration = timeout_ms.map(Duration::from_millis);

        // Determine shell based on OS
        let (shell, shell_arg) = get_shell_command();

        let mut cmd = Command::new(shell);
        cmd.arg(shell_arg)
            .arg(&command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());

        // Set working directory
        if let Some(ref dir) = cwd {
            let p = PathBuf::from(dir);
            if p.exists() {
                cmd.current_dir(p);
            }
        }

        // Set environment variables
        if let Some(env_vars) = env {
            for (key, value) in env_vars {
                cmd.env(key, value);
            }
        }

        // Spawn process
        let child = cmd.spawn()
            .map_err(|e| format!("Failed to spawn command: {}", e))?;

        // Store process handle for cancellation
        let child_handle = Arc::new(Mutex::new(Some(child)));
        {
            let mut processes = self.processes.lock().await;
            processes.insert(command_id.clone(), child_handle.clone());
        }

        // Emit status: running
        let _ = app_handle.emit("command-status", CommandStatus {
            command_id: command_id.clone(),
            status: "running".to_string(),
            exit_code: None,
        });

        // Get stdout and stderr
        let stdout = child_handle.lock().await.as_mut()
            .and_then(|c| c.stdout.take())
            .ok_or("Failed to capture stdout")?;
        
        let stderr = child_handle.lock().await.as_mut()
            .and_then(|c| c.stderr.take())
            .ok_or("Failed to capture stderr")?;

        // Spawn tasks to read stdout and stderr
        let app_handle_stdout = app_handle.clone();
        let command_id_stdout = command_id.clone();
        let stdout_task = tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_handle_stdout.emit("command-output", CommandOutput {
                    command_id: command_id_stdout.clone(),
                    output_type: "stdout".to_string(),
                    data: line,
                });
            }
        });

        let app_handle_stderr = app_handle.clone();
        let command_id_stderr = command_id.clone();
        let stderr_task = tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_handle_stderr.emit("command-output", CommandOutput {
                    command_id: command_id_stderr.clone(),
                    output_type: "stderr".to_string(),
                    data: line,
                });
            }
        });

        // Wait for process to complete (with optional timeout)
        let wait_result = if let Some(timeout_dur) = timeout_duration {
            let child_clone = child_handle.clone();
            timeout(timeout_dur, async move {
                child_clone.lock().await.as_mut()
                    .ok_or("Process not found")?
                    .wait()
                    .await
                    .map_err(|e| e.to_string())
            }).await
        } else {
            Ok(child_handle.lock().await.as_mut()
                .ok_or("Process not found")?
                .wait()
                .await
                .map_err(|e| e.to_string()))
        };

        // Wait for output tasks to complete
        let _ = join(stdout_task, stderr_task).await;

        // Clean up process handle
        {
            let mut processes = self.processes.lock().await;
            processes.remove(&command_id);
        }

        let duration_ms = start.elapsed().as_millis() as u64;

        // Handle result
        match wait_result {
            Ok(Ok(status)) => {
                let exit_code = status.code();
                let success = status.success();
                
                // Emit final status
                let _ = app_handle.emit("command-status", CommandStatus {
                    command_id: command_id.clone(),
                    status: if success { "completed" } else { "failed" }.to_string(),
                    exit_code,
                });

                Ok(StreamingCommandResult {
                    command_id,
                    exit_code,
                    success,
                    duration_ms,
                    timed_out: false,
                })
            }
            Ok(Err(e)) => {
                let _ = app_handle.emit("command-status", CommandStatus {
                    command_id: command_id.clone(),
                    status: "failed".to_string(),
                    exit_code: None,
                });
                Err(e)
            }
            Err(_) => {
                // Timeout - kill the process
                if let Some(mut child) = child_handle.lock().await.take() {
                    let _ = child.kill().await;
                }
                
                let _ = app_handle.emit("command-status", CommandStatus {
                    command_id: command_id.clone(),
                    status: "timeout".to_string(),
                    exit_code: None,
                });

                Ok(StreamingCommandResult {
                    command_id,
                    exit_code: None,
                    success: false,
                    duration_ms,
                    timed_out: true,
                })
            }
        }
    }

    pub async fn cancel_command(&self, command_id: &str) -> Result<(), String> {
        let mut processes = self.processes.lock().await;
        
        if let Some(child_handle) = processes.remove(command_id) {
            if let Some(mut child) = child_handle.lock().await.take() {
                child.kill().await
                    .map_err(|e| format!("Failed to kill process: {}", e))?;
                return Ok(());
            }
        }
        
        Err(format!("Command not found: {}", command_id))
    }

    pub async fn list_running_commands(&self) -> Vec<String> {
        let processes = self.processes.lock().await;
        processes.keys().cloned().collect()
    }
}

// ── Helper Functions ──

fn get_shell_command() -> (&'static str, &'static str) {
    if cfg!(target_os = "windows") {
        ("powershell.exe", "-Command")
    } else if cfg!(target_os = "macos") {
        // Prefer zsh on macOS (default since Catalina)
        ("zsh", "-c")
    } else {
        // Linux and others
        ("bash", "-c")
    }
}

// ── Tauri Commands ──

#[tauri::command]
pub async fn execute_command_streaming(
    command_id: String,
    command: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
    app_handle: AppHandle,
    manager: tauri::State<'_, Arc<Mutex<CommandManager>>>,
) -> Result<StreamingCommandResult, String> {
    let mgr = manager.lock().await;
    mgr.execute_streaming(command_id, command, cwd, env, timeout_ms, app_handle).await
}

#[tauri::command]
pub async fn cancel_command(
    command_id: String,
    manager: tauri::State<'_, Arc<Mutex<CommandManager>>>,
) -> Result<(), String> {
    let mgr = manager.lock().await;
    mgr.cancel_command(&command_id).await
}

#[tauri::command]
pub async fn list_running_commands(
    manager: tauri::State<'_, Arc<Mutex<CommandManager>>>,
) -> Result<Vec<String>, String> {
    let mgr = manager.lock().await;
    Ok(mgr.list_running_commands().await)
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_command_manager_creation() {
        let manager = CommandManager::new();
        let running = manager.list_running_commands().await;
        assert_eq!(running.len(), 0);
    }

    #[test]
    fn test_shell_command_detection() {
        let (shell, arg) = get_shell_command();
        
        if cfg!(target_os = "windows") {
            assert_eq!(shell, "powershell.exe");
            assert_eq!(arg, "-Command");
        } else if cfg!(target_os = "macos") {
            assert_eq!(shell, "zsh");
            assert_eq!(arg, "-c");
        } else {
            assert_eq!(shell, "bash");
            assert_eq!(arg, "-c");
        }
    }
}

// Made with Bob
