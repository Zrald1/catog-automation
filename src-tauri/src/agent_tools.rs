#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};

// ── Tool Definition Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: JsonValue,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCall {
    pub tool_name: String,
    pub parameters: JsonValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolResult {
    pub success: bool,
    pub result: Option<JsonValue>,
    pub error: Option<String>,
}

// ── Tool Definitions ──

pub fn get_file_operation_tools() -> Vec<AgentToolDefinition> {
    vec![
        AgentToolDefinition {
            name: "read_file".to_string(),
            description: "Read file contents with optional line range. Supports reading entire files or specific line ranges for efficient partial reads.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or relative path to the file"
                    },
                    "start_line": {
                        "type": "integer",
                        "description": "Optional starting line number (1-based, inclusive)",
                        "minimum": 1
                    },
                    "end_line": {
                        "type": "integer",
                        "description": "Optional ending line number (1-based, inclusive)",
                        "minimum": 1
                    }
                },
                "required": ["path"]
            }),
            category: "file_operations".to_string(),
        },
        AgentToolDefinition {
            name: "write_file".to_string(),
            description: "Write content to a file with atomic write support. Creates parent directories automatically. Uses atomic writes by default (write to temp file, then rename).".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or relative path to the file"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write to the file"
                    },
                    "atomic": {
                        "type": "boolean",
                        "description": "Use atomic write (default: true)",
                        "default": true
                    }
                },
                "required": ["path", "content"]
            }),
            category: "file_operations".to_string(),
        },
        AgentToolDefinition {
            name: "list_files".to_string(),
            description: "List files and directories with optional recursive traversal and pattern filtering. Returns detailed metadata including size, timestamps, and permissions.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to list"
                    },
                    "recursive": {
                        "type": "boolean",
                        "description": "Recursively list subdirectories (default: false)",
                        "default": false
                    },
                    "pattern": {
                        "type": "string",
                        "description": "Optional filter pattern (substring match)"
                    }
                },
                "required": ["path"]
            }),
            category: "file_operations".to_string(),
        },
        AgentToolDefinition {
            name: "search_files".to_string(),
            description: "Search files for regex pattern (grep functionality). Supports recursive search, file pattern filtering, and result limits.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Directory to search in"
                    },
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for"
                    },
                    "file_pattern": {
                        "type": "string",
                        "description": "Optional regex pattern to filter files (e.g., '.*\\.rs$' for Rust files)"
                    },
                    "recursive": {
                        "type": "boolean",
                        "description": "Search recursively (default: true)",
                        "default": true
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results (default: 1000)",
                        "default": 1000,
                        "minimum": 1
                    }
                },
                "required": ["directory", "pattern"]
            }),
            category: "file_operations".to_string(),
        },
        AgentToolDefinition {
            name: "create_directory".to_string(),
            description: "Create a directory with optional recursive creation. Creates parent directories automatically by default.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to create"
                    },
                    "recursive": {
                        "type": "boolean",
                        "description": "Create parent directories (default: true)",
                        "default": true
                    }
                },
                "required": ["path"]
            }),
            category: "file_operations".to_string(),
        },
        AgentToolDefinition {
            name: "delete_path".to_string(),
            description: "Delete a file or directory. Use recursive option to delete non-empty directories.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to delete"
                    },
                    "recursive": {
                        "type": "boolean",
                        "description": "Delete directories recursively (default: false)",
                        "default": false
                    }
                },
                "required": ["path"]
            }),
            category: "file_operations".to_string(),
        },
        AgentToolDefinition {
            name: "move_path".to_string(),
            description: "Move or rename a file or directory. Supports cross-device moves (copy + delete).".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "source": {
                        "type": "string",
                        "description": "Source path"
                    },
                    "destination": {
                        "type": "string",
                        "description": "Destination path"
                    }
                },
                "required": ["source", "destination"]
            }),
            category: "file_operations".to_string(),
        },
        AgentToolDefinition {
            name: "copy_path".to_string(),
            description: "Copy a file or directory. Automatically handles recursive directory copying.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "source": {
                        "type": "string",
                        "description": "Source path"
                    },
                    "destination": {
                        "type": "string",
                        "description": "Destination path"
                    }
                },
                "required": ["source", "destination"]
            }),
            category: "file_operations".to_string(),
        },
        AgentToolDefinition {
            name: "file_exists".to_string(),
            description: "Check if a file or directory exists and optionally get detailed metadata.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to check"
                    },
                    "get_metadata": {
                        "type": "boolean",
                        "description": "Return detailed metadata (default: false)",
                        "default": false
                    }
                },
                "required": ["path"]
            }),
            category: "file_operations".to_string(),
        },
    ]
}

pub fn get_terminal_operation_tools() -> Vec<AgentToolDefinition> {
    vec![
        AgentToolDefinition {
            name: "execute_command".to_string(),
            description: "Execute a shell command and return the output. Simple execution without streaming.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute"
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Working directory for the command"
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "description": "Timeout in milliseconds (default: 30000)",
                        "default": 30000,
                        "minimum": 1000
                    }
                },
                "required": ["command"]
            }),
            category: "terminal_operations".to_string(),
        },
        AgentToolDefinition {
            name: "execute_command_streaming".to_string(),
            description: "Execute a shell command with real-time streaming output. Emits 'command-output' and 'command-status' events. Supports cancellation and timeout.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command_id": {
                        "type": "string",
                        "description": "Unique identifier for this command execution"
                    },
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute"
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Working directory for the command"
                    },
                    "env": {
                        "type": "object",
                        "description": "Environment variables to set",
                        "additionalProperties": {
                            "type": "string"
                        }
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "description": "Timeout in milliseconds",
                        "minimum": 1000
                    }
                },
                "required": ["command_id", "command"]
            }),
            category: "terminal_operations".to_string(),
        },
        AgentToolDefinition {
            name: "cancel_command".to_string(),
            description: "Cancel a running streaming command by its command_id.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command_id": {
                        "type": "string",
                        "description": "Command ID to cancel"
                    }
                },
                "required": ["command_id"]
            }),
            category: "terminal_operations".to_string(),
        },
        AgentToolDefinition {
            name: "list_running_commands".to_string(),
            description: "List all currently running streaming commands.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
            category: "terminal_operations".to_string(),
        },
    ]
}

pub fn get_desktop_automation_tools() -> Vec<AgentToolDefinition> {
    vec![
        AgentToolDefinition {
            name: "click_at".to_string(),
            description: "Click at specific screen coordinates. Use for clicking buttons, links, or any UI element.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "x": {
                        "type": "integer",
                        "description": "X coordinate (pixels from left)"
                    },
                    "y": {
                        "type": "integer",
                        "description": "Y coordinate (pixels from top)"
                    }
                },
                "required": ["x", "y"]
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "type_text".to_string(),
            description: "Type text at the currently focused input field. End with \\n to press Enter.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Text to type. Use \\n to press Enter."
                    }
                },
                "required": ["text"]
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "press_key_combo".to_string(),
            description: "Press keyboard shortcuts or single keys. Examples: 'ctrl+c', 'cmd+l', 'enter', 'tab'.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "keys": {
                        "type": "string",
                        "description": "Key combination: 'ctrl+c', 'cmd+v', 'alt+f4', or single key: 'enter', 'tab', 'escape'"
                    }
                },
                "required": ["keys"]
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "long_press_at".to_string(),
            description: "Long press (hold click) at coordinates for specified duration. Useful for context menus or drag initiation.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "x": {
                        "type": "integer",
                        "description": "X coordinate"
                    },
                    "y": {
                        "type": "integer",
                        "description": "Y coordinate"
                    },
                    "duration_ms": {
                        "type": "integer",
                        "description": "Duration in milliseconds (default: 500)",
                        "default": 500
                    }
                },
                "required": ["x", "y"]
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "scroll_at".to_string(),
            description: "Scroll at specific coordinates in a given direction.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "x": {
                        "type": "integer",
                        "description": "X coordinate"
                    },
                    "y": {
                        "type": "integer",
                        "description": "Y coordinate"
                    },
                    "direction": {
                        "type": "string",
                        "description": "Scroll direction",
                        "enum": ["up", "down", "left", "right"]
                    },
                    "amount": {
                        "type": "integer",
                        "description": "Scroll amount (default: 3)",
                        "default": 3
                    }
                },
                "required": ["x", "y", "direction"]
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "drag".to_string(),
            description: "Drag from one coordinate to another. Useful for moving windows, resizing, or drag-and-drop.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "from_x": {
                        "type": "integer",
                        "description": "Starting X coordinate"
                    },
                    "from_y": {
                        "type": "integer",
                        "description": "Starting Y coordinate"
                    },
                    "to_x": {
                        "type": "integer",
                        "description": "Ending X coordinate"
                    },
                    "to_y": {
                        "type": "integer",
                        "description": "Ending Y coordinate"
                    },
                    "duration_ms": {
                        "type": "integer",
                        "description": "Drag duration in milliseconds (default: 300)",
                        "default": 300
                    }
                },
                "required": ["from_x", "from_y", "to_x", "to_y"]
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "window_control_action".to_string(),
            description: "Control the active window: maximize, minimize, close, or restore.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": "Window action to perform",
                        "enum": ["maximize_window", "minimize_window", "close_window", "restore_window"]
                    }
                },
                "required": ["action"]
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "get_screen_size".to_string(),
            description: "Get the screen resolution (width and height in pixels).".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "get_active_window_bounds".to_string(),
            description: "Get the bounds of the currently active window (x, y, width, height).".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "get_active_window_edges".to_string(),
            description: "Get the edge coordinates of the active window for precise drag-resize operations.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "launch_application".to_string(),
            description: "Launch an application by name. Works cross-platform.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Application name (e.g., 'Google Chrome', 'notepad', 'TextEdit')"
                    }
                },
                "required": ["name"]
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "activate_application".to_string(),
            description: "Bring an application to the foreground by name.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Application name to activate"
                    }
                },
                "required": ["name"]
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "get_running_programs".to_string(),
            description: "List all currently running programs with their PIDs and window titles.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "get_installed_applications".to_string(),
            description: "List all installed applications on the system.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
            category: "desktop_automation".to_string(),
        },
        AgentToolDefinition {
            name: "save_file".to_string(),
            description: "Save content to a file on disk.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path"
                    },
                    "content": {
                        "type": "string",
                        "description": "File content"
                    }
                },
                "required": ["path", "content"]
            }),
            category: "desktop_automation".to_string(),
        },
    ]
}

pub fn get_all_agent_tools() -> Vec<AgentToolDefinition> {
    let mut tools = Vec::new();
    tools.extend(get_file_operation_tools());
    tools.extend(get_terminal_operation_tools());
    tools.extend(get_desktop_automation_tools());
    tools
}

// ── Tauri Commands ──

#[tauri::command]
pub fn list_agent_tools(category: Option<String>) -> Result<Vec<AgentToolDefinition>, String> {
    let all_tools = get_all_agent_tools();

    if let Some(cat) = category {
        Ok(all_tools
            .into_iter()
            .filter(|t| t.category == cat)
            .collect())
    } else {
        Ok(all_tools)
    }
}

#[tauri::command]
pub fn get_agent_tool(tool_name: String) -> Result<AgentToolDefinition, String> {
    get_all_agent_tools()
        .into_iter()
        .find(|t| t.name == tool_name)
        .ok_or_else(|| format!("Tool not found: {}", tool_name))
}

#[tauri::command]
pub fn list_agent_tool_categories() -> Result<Vec<String>, String> {
    let categories: Vec<String> = get_all_agent_tools()
        .into_iter()
        .map(|t| t.category)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    Ok(categories)
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_all_tools() {
        let tools = get_all_agent_tools();
        assert!(tools.len() > 0);

        // Check that we have both categories
        let categories: std::collections::HashSet<String> =
            tools.iter().map(|t| t.category.clone()).collect();
        assert!(categories.contains("file_operations"));
        assert!(categories.contains("terminal_operations"));
    }

    #[test]
    fn test_file_operation_tools() {
        let tools = get_file_operation_tools();
        assert_eq!(tools.len(), 9);

        let tool_names: Vec<String> = tools.iter().map(|t| t.name.clone()).collect();
        assert!(tool_names.contains(&"read_file".to_string()));
        assert!(tool_names.contains(&"write_file".to_string()));
        assert!(tool_names.contains(&"search_files".to_string()));
    }

    #[test]
    fn test_terminal_operation_tools() {
        let tools = get_terminal_operation_tools();
        assert_eq!(tools.len(), 4);

        let tool_names: Vec<String> = tools.iter().map(|t| t.name.clone()).collect();
        assert!(tool_names.contains(&"execute_command".to_string()));
        assert!(tool_names.contains(&"execute_command_streaming".to_string()));
    }

    #[test]
    fn test_tool_parameters_structure() {
        let tools = get_all_agent_tools();

        for tool in tools {
            // Each tool should have parameters object
            assert!(tool.parameters.is_object());

            let params = tool.parameters.as_object().unwrap();
            assert_eq!(params.get("type").and_then(|v| v.as_str()), Some("object"));
            assert!(params.contains_key("properties"));
        }
    }
}

// Made with Bob
