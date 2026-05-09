use crate::contracts::{AddMcpServerRequest, McpServerStatus, ToolCallRequest, ToolDefinition};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};

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
        let command = if cfg!(target_os = "windows") && config.command.eq_ignore_ascii_case("npx") {
            "npx.cmd"
        } else {
            &config.command
        };
        let mut cmd = Command::new(command);
        cmd.args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start MCP server '{}': {}", config.name, e))?;

        let tools = match Self::initialize_server(child.stdin.take(), child.stdout.take()) {
            Ok(t) => t,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Ok((
                    McpServerStatus {
                        name: config.name.clone(),
                        connected: false,
                        error: Some(e),
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

    fn initialize_server(
        stdin: Option<ChildStdin>,
        stdout: Option<ChildStdout>,
    ) -> Result<Vec<ToolDefinition>, String> {
        let mut stdin_write = stdin.ok_or("Failed to access stdin")?;
        let mut stdout_read = stdout.ok_or("Failed to access stdout")?;
        let reader = BufReader::new(&mut stdout_read);

        let req = JsonRpcRequest {
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

        let req_str = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        writeln!(stdin_write, "{}", req_str).map_err(|e| e.to_string())?;
        stdin_write.flush().map_err(|e| e.to_string())?;

        let mut lines = reader.lines();
        if let Some(Ok(line)) = lines.next() {
            let resp: JsonRpcResponse = serde_json::from_str(&line)
                .map_err(|e| format!("Invalid JSON-RPC response: {}", e))?;

            if resp.error.is_some() {
                return Err(format!("Initialize error: {:?}", resp.error));
            }
        }

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 2,
            method: "tools/list".to_string(),
            params: json!({}),
        };

        let req_str = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        writeln!(stdin_write, "{}", req_str).map_err(|e| e.to_string())?;
        stdin_write.flush().map_err(|e| e.to_string())?;

        let mut tools = Vec::new();
        if let Some(Ok(line)) = lines.next() {
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
        }

        Ok(tools)
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
