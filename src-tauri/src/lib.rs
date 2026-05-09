mod contracts;
mod desktop_automation;
mod file_ops;
mod terminal_exec;
mod agent_tools;
mod mcp_servers;
mod orchestrator;
mod terminal;
mod ai_agent;
mod windows_agent;

use contracts::{AddMcpServerRequest, AppStatus, McpServerStatus, ToolCallRequest, ToolDefinition};
use desktop_automation::{
    activate_application, click_at, drag, get_installed_applications, get_running_programs,
    get_screen_size, get_active_window_bounds, get_active_window_edges, launch_application,
    long_press_at, press_key_combo, read_screen_region, save_file, scroll_at, type_text,
    select_file, select_folder, window_control_action,
};
use file_ops::{
    read_file, write_file, list_files, search_files, create_directory, delete_path,
    move_path, copy_path, file_exists, execute_command,
};
use terminal_exec::{
    execute_command_streaming, cancel_command, list_running_commands, CommandManager,
};
use agent_tools::{
    list_agent_tools, get_agent_tool, list_agent_tool_categories,
};
use windows_agent::{
    agent_get_window_by_title, agent_get_active_window, agent_get_all_windows,
    agent_resize_window, agent_move_window, agent_minimize_window, agent_maximize_window,
    agent_restore_window, agent_close_window, agent_focus_window, agent_move_mouse,
    agent_click_mouse, agent_click_at, agent_double_click, agent_drag_mouse,
    agent_type_text, agent_press_key, agent_press_key_combo, agent_launch_app,
    agent_execute_sequence, agent_parse_command, agent_execute_nlp_command,
    agent_get_screen_size, agent_get_mouse_position, agent_scroll,
};
use mcp_servers::McpServerManager;
use serde_json::json;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use terminal::TerminalPty;

#[tauri::command]
fn get_app_status() -> AppStatus {
    AppStatus::desktop_mvp()
}

#[tauri::command]
async fn telegram_send_message(
    bot_token: String,
    chat_id: String,
    message: String,
    parse_mode: Option<String>,
    disable_web_page_preview: Option<bool>,
) -> Result<String, String> {
    let token = bot_token.trim();
    let chat = chat_id.trim();
    let text = message.trim();

    if token.is_empty() {
        return Err("Telegram bot token is required".to_string());
    }
    if chat.is_empty() {
        return Err("Telegram chat id is required".to_string());
    }
    if text.is_empty() {
        return Err("Telegram message text is required".to_string());
    }

    let mut payload = json!({
        "chat_id": chat,
        "text": text,
    });

    if let Some(mode) = parse_mode.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        payload["parse_mode"] = json!(mode);
    }
    if let Some(disable_preview) = disable_web_page_preview {
        payload["disable_web_page_preview"] = json!(disable_preview);
    }

    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let response = reqwest::Client::new()
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to send Telegram message: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Telegram response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Telegram API error {}: {}", status, body));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Telegram returned invalid JSON: {}", e))?;
    if parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(format!("Telegram rejected message: {}", body));
    }

    let message_id = parsed
        .pointer("/result/message_id")
        .and_then(|v| v.as_i64())
        .map(|id| format!(" message_id={}", id))
        .unwrap_or_default();
    Ok(format!("Telegram message sent{}", message_id))
}

#[tauri::command]
async fn telegram_get_updates(
    bot_token: String,
    offset: Option<i64>,
    timeout: Option<u64>,
) -> Result<serde_json::Value, String> {
    let token = bot_token.trim();
    if token.is_empty() {
        return Err("Telegram bot token is required".to_string());
    }

    let mut payload = json!({
        "timeout": timeout.unwrap_or(0),
        "allowed_updates": ["message"],
    });
    if let Some(offset_value) = offset {
        payload["offset"] = json!(offset_value);
    }

    let url = format!("https://api.telegram.org/bot{}/getUpdates", token);
    let response = reqwest::Client::new()
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Telegram updates: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Telegram updates response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Telegram API error {}: {}", status, body));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Telegram returned invalid JSON: {}", e))?;
    if parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(format!("Telegram rejected getUpdates: {}", body));
    }
    Ok(parsed)
}

#[tauri::command]
fn terminal_input(input: String, terminal: tauri::State<Mutex<TerminalPty>>) -> Result<(), String> {
    let pty = terminal.lock().map_err(|e| e.to_string())?;
    pty.write_input(input)
}

#[tauri::command]
async fn add_mcp_server(
    request: AddMcpServerRequest,
    manager: tauri::State<'_, Arc<Mutex<McpServerManager>>>,
) -> Result<McpServerStatus, String> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        let mgr = manager.lock().map_err(|e| e.to_string())?;
        mgr.add_server(request)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn remove_mcp_server(
    name: String,
    manager: tauri::State<Arc<Mutex<McpServerManager>>>,
) -> Result<(), String> {
    let mgr = manager.lock().map_err(|e| e.to_string())?;
    mgr.remove_server(&name)
}

#[tauri::command]
fn list_mcp_servers(
    manager: tauri::State<Arc<Mutex<McpServerManager>>>,
) -> Result<Vec<McpServerStatus>, String> {
    let mgr = manager.lock().map_err(|e| e.to_string())?;
    mgr.list_servers()
}

#[tauri::command]
fn reconnect_mcp_server(
    name: String,
    manager: tauri::State<Arc<Mutex<McpServerManager>>>,
) -> Result<McpServerStatus, String> {
    let mgr = manager.lock().map_err(|e| e.to_string())?;
    mgr.reconnect_server(&name)
}

#[tauri::command]
fn list_mcp_tools(
    server_name: String,
    manager: tauri::State<Arc<Mutex<McpServerManager>>>,
) -> Result<Vec<ToolDefinition>, String> {
    let mgr = manager.lock().map_err(|e| e.to_string())?;
    mgr.list_tools(&server_name)
}

#[tauri::command]
fn call_mcp_tool(
    request: ToolCallRequest,
    manager: tauri::State<Arc<Mutex<McpServerManager>>>,
) -> Result<String, String> {
    let mgr = manager.lock().map_err(|e| e.to_string())?;
    mgr.call_tool(request)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(Mutex::new(McpServerManager::new())))
        .manage(Arc::new(tokio::sync::Mutex::new(CommandManager::new())))
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            telegram_send_message,
            telegram_get_updates,
            terminal_input,
            add_mcp_server,
            remove_mcp_server,
            list_mcp_servers,
            reconnect_mcp_server,
            list_mcp_tools,
            call_mcp_tool,
            get_installed_applications,
            get_running_programs,
            launch_application,
            click_at,
            type_text,
            press_key_combo,
            get_screen_size,
            read_screen_region,
            save_file,
            select_file,
            select_folder,
            long_press_at,
            scroll_at,
            drag,
            get_active_window_bounds,
            get_active_window_edges,
            window_control_action,
            activate_application,
            // Enhanced File Operation Commands
            read_file,
            write_file,
            list_files,
            search_files,
            create_directory,
            delete_path,
            move_path,
            copy_path,
            file_exists,
            execute_command,
            // Terminal Execution Commands
            execute_command_streaming,
            cancel_command,
            list_running_commands,
            // AI Agent Tool Commands
            list_agent_tools,
            get_agent_tool,
            list_agent_tool_categories,
            // Windows Agent Commands
            agent_get_window_by_title,
            agent_get_active_window,
            agent_get_all_windows,
            agent_resize_window,
            agent_move_window,
            agent_minimize_window,
            agent_maximize_window,
            agent_restore_window,
            agent_close_window,
            agent_focus_window,
            agent_move_mouse,
            agent_click_mouse,
            agent_click_at,
            agent_double_click,
            agent_drag_mouse,
            agent_type_text,
            agent_press_key,
            agent_press_key_combo,
            agent_launch_app,
            agent_execute_sequence,
            agent_parse_command,
            agent_execute_nlp_command,
            agent_get_screen_size,
            agent_get_mouse_position,
            agent_scroll
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let pty = TerminalPty::spawn(app_handle).map_err(|e| {
                eprintln!("Failed to spawn terminal PTY: {}", e);
                std::io::Error::new(std::io::ErrorKind::Other, e)
            })?;
            app.manage(Mutex::new(pty));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
