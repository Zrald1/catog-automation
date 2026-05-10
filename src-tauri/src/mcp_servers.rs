use crate::contracts::{AddMcpServerRequest, McpServerStatus, ToolCallRequest, ToolDefinition};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStderr, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct McpServerManager {
    servers: Arc<Mutex<HashMap<String, ServerEntry>>>,
}

struct ServerEntry {
    config: AddMcpServerRequest,
    process: Option<Child>,
    tools: Vec<ToolDefinition>,
    connected: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: u32,
    method: String,
    params: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: u32,
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<serde_json::Value>,
}

impl McpServerManager {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn add_server(&self, request: AddMcpServerRequest) -> Result<McpServerStatus, String> {
        let mut servers = self.servers.lock().map_err(|e| e.to_string())?;

        let (status, child) = self.start_server_internal(&request)?;

        servers.insert(
            request.name.clone(),
            ServerEntry {
                config: request.clone(),
                process: Some(child),
                tools: status.tools.clone(),
                connected: status.connected,
                error: status.error.clone(),
            },
        );

        Ok(status)
    }

    pub fn remove_server(&self, name: &str) -> Result<(), String> {
        let mut servers = self.servers.lock().map_err(|e| e.to_string())?;

        if let Some(mut entry) = servers.remove(name) {
            if let Some(mut child) = entry.process.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }

        Ok(())
    }

    pub fn list_servers(&self) -> Result<Vec<McpServerStatus>, String> {
        let servers = self.servers.lock().map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for (name, entry) in servers.iter() {
            result.push(McpServerStatus {
                name: name.clone(),
                connected: entry.connected,
                error: entry.error.clone(),
                tools: entry.tools.clone(),
            });
        }

        Ok(result)
    }

    pub fn reconnect_server(&self, name: &str) -> Result<McpServerStatus, String> {
        let mut servers = self.servers.lock().map_err(|e| e.to_string())?;

        if let Some(entry) = servers.get_mut(name) {
            if let Some(mut child) = entry.process.take() {
                let _ = child.kill();
                let _ = child.wait();
            }

            let (status, child) = self.start_server_internal(&entry.config)?;
            entry.connected = status.connected;
            entry.error = status.error.clone();
            entry.tools = status.tools.clone();
            entry.process = Some(child);

            return Ok(McpServerStatus {
                name: name.to_string(),
                connected: entry.connected,
                error: entry.error.clone(),
                tools: entry.tools.clone(),
            });
        }

        Err(format!("Server '{}' not found", name))
    }

    pub fn list_tools(&self, server_name: &str) -> Result<Vec<ToolDefinition>, String> {
        let servers = self.servers.lock().map_err(|e| e.to_string())?;

        if let Some(entry) = servers.get(server_name) {
            if entry.connected {
                return Ok(entry.tools.clone());
            } else {
                return Err(format!("Server '{}' is not connected", server_name));
            }
        }

        Err(format!("Server '{}' not found", server_name))
    }

    pub fn call_tool(&self, request: ToolCallRequest) -> Result<String, String> {
        let mut servers = self.servers.lock().map_err(|e| e.to_string())?;

        if let Some(entry) = servers.get_mut(&request.server_name) {
            if !entry.connected {
                return Err(format!("Server '{}' is not connected", request.server_name));
            }

            if let Some(ref mut child) = entry.process {
                return Self::send_tool_request(child, &request.tool_name, request.arguments);
            }
        }

        Err(format!("Server '{}' not found", request.server_name))
    }

    fn start_server_internal(
        &self,
        config: &AddMcpServerRequest,
    ) -> Result<(McpServerStatus, Child), String> {
        // On Windows, common Node CLI commands ship as .cmd shims. Resolve them
        // explicitly so the spawn doesn't fail with ENOENT or a console flash.
        let resolved_command: String = if cfg!(target_os = "windows") {
            let lower = config.command.to_lowercase();
            match lower.as_str() {
                "npx" => "npx.cmd".to_string(),
                "npm" => "npm.cmd".to_string(),
                "yarn" => "yarn.cmd".to_string(),
                "pnpm" => "pnpm.cmd".to_string(),
                _ => config.command.clone(),
            }
        } else {
            config.command.clone()
        };

        let mut cmd = Command::new(&resolved_command);
        cmd.args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Suppress the console window that pops up when launching .cmd shims
        // on Windows — it also stops Windows from severing the stdio pipes
        // when the parent (the GUI app) has no console attached.
        #[cfg(target_os = "windows")]
        cmd.creation_flags(WINDOWS_CREATE_NO_WINDOW);

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to start MCP server '{}': {} (command: {} {})",
                config.name,
                e,
                resolved_command,
                config.args.join(" ")
            )
        })?;

        // Drain stderr in a background thread so it doesn't block, and so we
        // can surface the real reason the child died (npx download error,
        // package not found, etc.) instead of a generic broken-pipe message.
        let stderr_handle = child.stderr.take().map(Self::spawn_stderr_collector);

        let init_result = Self::initialize_server(&mut child);

        let tools = match init_result {
            Ok(t) => t,
            Err(e) => {
                // The child may already be gone (npx exited with an error).
                // Give the stderr collector a moment to flush, then build a
                // diagnostic message that includes the actual stderr output.
                thread::sleep(Duration::from_millis(200));
                let _ = child.kill();
                let _ = child.wait();
                let stderr_text = stderr_handle
                    .and_then(|h| h.join().ok())
                    .unwrap_or_default();
                let combined = if stderr_text.trim().is_empty() {
                    format!(
                        "{}\n\nHint: command was `{} {}`. On Windows, install Node.js and ensure `npx` is on PATH. Try running it manually first to pre-cache the package.",
                        e,
                        resolved_command,
                        config.args.join(" ")
                    )
                } else {
                    format!(
                        "{}\n\n--- child stderr ---\n{}",
                        e,
                        stderr_text.trim()
                    )
                };
                return Ok((
                    McpServerStatus {
                        name: config.name.clone(),
                        connected: false,
                        error: Some(combined),
                        tools: vec![],
                    },
                    child,
                ));
            }
        };

        Ok((
            McpServerStatus {
                name: config.name.clone(),
                connected: true,
                error: None,
                tools,
            },
            child,
        ))
    }

    fn spawn_stderr_collector(stderr: ChildStderr) -> thread::JoinHandle<String> {
        thread::spawn(move || {
            let mut buf = String::new();
            let mut reader = stderr;
            // Cap captured stderr at 8 KB so a runaway server can't OOM us.
            let mut tmp = [0u8; 1024];
            let mut total = 0usize;
            loop {
                match reader.read(&mut tmp) {
                    Ok(0) => break,
                    Ok(n) => {
                        total += n;
                        if total > 8 * 1024 {
                            buf.push_str(&String::from_utf8_lossy(&tmp[..n]));
                            buf.push_str("\n...[stderr truncated]");
                            break;
                        }
                        buf.push_str(&String::from_utf8_lossy(&tmp[..n]));
                    }
                    Err(_) => break,
                }
            }
            buf
        })
    }

    fn initialize_server(child: &mut Child) -> Result<Vec<ToolDefinition>, String> {
        // Step 1: send initialize request
        let init_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "catog-automation",
                    "version": "1.0.0"
                }
            }),
        };
        Self::send_jsonrpc(child, &init_req).map_err(|e| {
            format!(
                "MCP initialize handshake failed while sending request: {}. The child process likely exited early — check stderr above for the real cause (most common: npx couldn't download the package, or the command/args are wrong).",
                e
            )
        })?;

        // Step 2: read initialize response (npx first-run installs may take ~30s)
        let line = Self::read_response_line(child, Duration::from_secs(60))
            .map_err(|e| format!("MCP initialize handshake failed waiting for reply: {}", e))?;
        let resp: JsonRpcResponse = serde_json::from_str(&line).map_err(|e| {
            format!(
                "Invalid JSON-RPC initialize response: {} (line: {})",
                e,
                line.chars().take(200).collect::<String>()
            )
        })?;
        if resp.error.is_some() {
            return Err(format!("MCP initialize error: {:?}", resp.error));
        }

        // Step 3: send tools/list
        let list_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 2,
            method: "tools/list".to_string(),
            params: json!({}),
        };
        Self::send_jsonrpc(child, &list_req)
            .map_err(|e| format!("MCP tools/list send failed: {}", e))?;

        // Step 4: read tools/list response
        let line = match Self::read_response_line(child, Duration::from_secs(30)) {
            Ok(l) => l,
            Err(_) => return Ok(Vec::new()),
        };

        let mut tools = Vec::new();
        if let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(&line) {
            if let Some(result) = resp.result {
                if let Some(tools_arr) = result.get("tools").and_then(|t| t.as_array()) {
                    for tool_val in tools_arr {
                        if let (Some(name), Some(desc)) = (
                            tool_val.get("name").and_then(|n| n.as_str()),
                            tool_val.get("description").and_then(|d| d.as_str()),
                        ) {
                            tools.push(ToolDefinition {
                                name: name.to_string(),
                                description: desc.to_string(),
                            });
                        }
                    }
                }
            }
        }

        Ok(tools)
    }

    fn send_jsonrpc(child: &mut Child, req: &JsonRpcRequest) -> Result<(), String> {
        let stdin = child.stdin.as_mut().ok_or_else(|| {
            "child stdin not piped (process may have exited)".to_string()
        })?;
        let req_str = serde_json::to_string(req).map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", req_str).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    // Reads one newline-terminated line from the child's stdout. Polls in a
    // small loop so that the call doesn't hang forever if the child dies
    // between requests.
    fn read_response_line(child: &mut Child, timeout: Duration) -> Result<String, String> {
        let stdout = child.stdout.as_mut().ok_or_else(|| {
            "child stdout not piped (process may have exited)".to_string()
        })?;
        let mut reader = BufReader::new(stdout);
        let deadline = Instant::now() + timeout;
        let mut buf = String::new();
        loop {
            buf.clear();
            // BufReader::read_line blocks until \n or EOF. We can't easily
            // make this nonblocking on stable Rust without extra deps, so we
            // do the simplest thing: one blocking read. If EOF (0 bytes),
            // the child is gone — return that as an error.
            match reader.read_line(&mut buf) {
                Ok(0) => return Err("child closed stdout (process exited)".to_string()),
                Ok(_) => {
                    if buf.trim().is_empty() {
                        if Instant::now() >= deadline {
                            return Err("timed out waiting for MCP server response".to_string());
                        }
                        continue;
                    }
                    return Ok(buf);
                }
                Err(e) => return Err(format!("read error: {}", e)),
            }
        }
    }

    fn send_tool_request(
        child: &mut Child,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<String, String> {
        let stdin = child.stdin.as_mut().ok_or("Failed to access stdin")?;
        let stdout = child.stdout.as_mut().ok_or("Failed to access stdout")?;

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 3,
            method: "tools/call".to_string(),
            params: json!({
                "name": tool_name,
                "arguments": arguments
            }),
        };

        let req_str = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", req_str).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;

        let reader = BufReader::new(stdout);
        if let Some(Ok(line)) = reader.lines().next() {
            let resp: JsonRpcResponse = serde_json::from_str(&line)
                .map_err(|e| format!("Invalid JSON-RPC response: {}", e))?;

            if let Some(error) = resp.error {
                return Err(format!("Tool call error: {:?}", error));
            }

            if let Some(result) = resp.result {
                let content = result
                    .get("content")
                    .and_then(|c| c.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|c| c.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
                return Ok(content);
            }
        }

        Err("No response from MCP server".to_string())
    }
}

impl Default for McpServerManager {
    fn default() -> Self {
        Self::new()
    }
}
