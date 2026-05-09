//! Cross-platform agent command bridge
//! Routes Tauri commands to appropriate platform implementations

use crate::ai_agent::{
    ApplicationController, AutomationSequence, InputSimulator, Key, KeyboardAction,
    MouseAction, MouseButton, Window, WindowManager,
};
use serde::{Deserialize, Serialize};

// Platform-specific imports
#[cfg(target_os = "windows")]
use crate::ai_agent::platform_windows::{
    WindowsApplicationController, WindowsInputSimulator, WindowsWindowManager,
};

#[cfg(target_os = "macos")]
use crate::ai_agent::platform_macos::{
    MacOSApplicationController, MacOSInputSimulator, MacOSWindowManager,
};

#[cfg(target_os = "linux")]
use crate::ai_agent::platform_linux::{
    LinuxApplicationController, LinuxInputSimulator, LinuxWindowManager,
};

// NLP Command structure for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NLPCommand {
    pub intent: String,
    pub target_app: Option<String>,
    pub text: Option<String>,
    pub confidence: f64,
}

// Helper function to get platform-specific window manager
fn get_window_manager() -> Box<dyn WindowManager> {
    #[cfg(target_os = "windows")]
    return Box::new(WindowsWindowManager::new());
    
    #[cfg(target_os = "macos")]
    return Box::new(MacOSWindowManager::new());
    
    #[cfg(target_os = "linux")]
    return Box::new(LinuxWindowManager::new());
}

// Helper function to get platform-specific input simulator
fn get_input_simulator() -> Box<dyn InputSimulator> {
    #[cfg(target_os = "windows")]
    return Box::new(WindowsInputSimulator::new());
    
    #[cfg(target_os = "macos")]
    return Box::new(MacOSInputSimulator::new());
    
    #[cfg(target_os = "linux")]
    return Box::new(LinuxInputSimulator::new());
}

// Helper function to get platform-specific app controller
fn get_app_controller() -> Box<dyn ApplicationController> {
    #[cfg(target_os = "windows")]
    return Box::new(WindowsApplicationController::new());
    
    #[cfg(target_os = "macos")]
    return Box::new(MacOSApplicationController::new());
    
    #[cfg(target_os = "linux")]
    return Box::new(LinuxApplicationController::new());
}

// Window Management Commands

#[tauri::command]
pub async fn agent_get_all_windows() -> Result<Vec<Window>, String> {
    let manager = get_window_manager();
    manager.get_all_windows().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_get_window_by_title(title: String) -> Result<Window, String> {
    let manager = get_window_manager();
    manager.get_window_by_title(&title).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_get_active_window() -> Result<Window, String> {
    let manager = get_window_manager();
    manager.get_active_window().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_resize_window(window_id: String, width: u32, height: u32) -> Result<(), String> {
    let manager = get_window_manager();
    manager.resize_window(&window_id, width, height).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_move_window(window_id: String, x: i32, y: i32) -> Result<(), String> {
    let manager = get_window_manager();
    manager.move_window(&window_id, x, y).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_minimize_window(window_id: String) -> Result<(), String> {
    let manager = get_window_manager();
    manager.minimize_window(&window_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_maximize_window(window_id: String) -> Result<(), String> {
    let manager = get_window_manager();
    manager.maximize_window(&window_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_restore_window(window_id: String) -> Result<(), String> {
    let manager = get_window_manager();
    manager.restore_window(&window_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_close_window(window_id: String) -> Result<(), String> {
    let manager = get_window_manager();
    manager.close_window(&window_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_focus_window(window_id: String) -> Result<(), String> {
    let manager = get_window_manager();
    manager.focus_window(&window_id).await.map_err(|e| e.to_string())
}

// Mouse Commands

#[tauri::command]
pub async fn agent_move_mouse(x: i32, y: i32) -> Result<(), String> {
    let simulator = get_input_simulator();
    simulator.execute_mouse_action(MouseAction::Move { x, y }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_click_mouse(button: String) -> Result<(), String> {
    let simulator = get_input_simulator();
    let mouse_button = match button.as_str() {
        "left" => MouseButton::Left,
        "right" => MouseButton::Right,
        "middle" => MouseButton::Middle,
        _ => return Err("Invalid mouse button".to_string()),
    };
    simulator.execute_mouse_action(MouseAction::Click { button: mouse_button }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_click_at(x: i32, y: i32, button: String) -> Result<(), String> {
    let simulator = get_input_simulator();
    simulator.execute_mouse_action(MouseAction::Move { x, y }).await.map_err(|e| e.to_string())?;
    
    let mouse_button = match button.as_str() {
        "left" => MouseButton::Left,
        "right" => MouseButton::Right,
        "middle" => MouseButton::Middle,
        _ => return Err("Invalid mouse button".to_string()),
    };
    
    simulator.execute_mouse_action(MouseAction::Click { button: mouse_button }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_double_click() -> Result<(), String> {
    let simulator = get_input_simulator();
    simulator.execute_mouse_action(MouseAction::DoubleClick { button: MouseButton::Left }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_drag_mouse(from_x: i32, from_y: i32, to_x: i32, to_y: i32) -> Result<(), String> {
    let simulator = get_input_simulator();
    simulator.execute_mouse_action(MouseAction::Drag { from_x, from_y, to_x, to_y }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_scroll(amount: i32) -> Result<(), String> {
    let simulator = get_input_simulator();
    simulator.execute_mouse_action(MouseAction::Scroll { amount }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_get_mouse_position() -> Result<(i32, i32), String> {
    let simulator = get_input_simulator();
    simulator.get_mouse_position().await.map_err(|e| e.to_string())
}

// Keyboard Commands

#[tauri::command]
pub async fn agent_type_text(text: String, delay_ms: Option<u64>) -> Result<(), String> {
    let simulator = get_input_simulator();
    if delay_ms.is_some() && delay_ms.unwrap() > 50 {
        simulator.type_text_human(&text).await.map_err(|e| e.to_string())
    } else {
        simulator.execute_keyboard_action(KeyboardAction::Type { text }).await.map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn agent_press_key(key: String) -> Result<(), String> {
    let simulator = get_input_simulator();
    let key_enum = string_to_key(&key)?;
    simulator.execute_keyboard_action(KeyboardAction::Press { key: key_enum }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_press_key_combo(modifiers: Vec<String>, key: String) -> Result<(), String> {
    let simulator = get_input_simulator();
    let modifier_keys: Result<Vec<Key>, String> = modifiers.iter().map(|m| string_to_key(m)).collect();
    let key_enum = string_to_key(&key)?;
    
    simulator.execute_keyboard_action(KeyboardAction::Combo {
        modifiers: modifier_keys?,
        key: key_enum,
    }).await.map_err(|e| e.to_string())
}

// Application Commands

#[tauri::command]
pub async fn agent_launch_app(path: String) -> Result<u32, String> {
    let controller = get_app_controller();
    controller.launch_app(&path, vec![]).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_execute_sequence(sequence: AutomationSequence) -> Result<String, String> {
    let controller = get_app_controller();
    controller.execute_sequence(sequence).await.map_err(|e| e.to_string())
}

// Screen Commands

#[tauri::command]
pub async fn agent_get_screen_size() -> Result<(u32, u32), String> {
    let simulator = get_input_simulator();
    simulator.get_screen_size().await.map_err(|e| e.to_string())
}

// NLP Commands

#[tauri::command]
pub fn agent_parse_command(command: String) -> Result<NLPCommand, String> {
    // Simple NLP parsing - can be enhanced with actual NLP library
    let command_lower = command.to_lowercase();
    
    let intent = if command_lower.contains("open") || command_lower.contains("launch") || command_lower.contains("start") {
        "launch_app"
    } else if command_lower.contains("type") || command_lower.contains("write") || command_lower.contains("enter") {
        "type_text"
    } else if command_lower.contains("click") {
        "click"
    } else if command_lower.contains("close") {
        "close_window"
    } else if command_lower.contains("minimize") {
        "minimize_window"
    } else if command_lower.contains("maximize") {
        "maximize_window"
    } else {
        "unknown"
    };
    
    // Extract app name or text
    let target_app = if intent == "launch_app" {
        command_lower.split_whitespace()
            .skip_while(|&w| w == "open" || w == "launch" || w == "start")
            .next()
            .map(|s| s.to_string())
    } else {
        None
    };
    
    let text = if intent == "type_text" {
        let words: Vec<&str> = command.split_whitespace().collect();
        if let Some(pos) = words.iter().position(|&w| w.to_lowercase() == "type" || w.to_lowercase() == "write") {
            Some(words[pos + 1..].join(" "))
        } else {
            None
        }
    } else {
        None
    };
    
    Ok(NLPCommand {
        intent: intent.to_string(),
        target_app,
        text,
        confidence: 0.8,
    })
}

#[tauri::command]
pub async fn agent_execute_nlp_command(nlp_command: NLPCommand) -> Result<String, String> {
    match nlp_command.intent.as_str() {
        "launch_app" => {
            if let Some(app) = nlp_command.target_app {
                agent_launch_app(app).await?;
                Ok("Application launched".to_string())
            } else {
                Err("No application specified".to_string())
            }
        }
        "type_text" => {
            if let Some(text) = nlp_command.text {
                agent_type_text(text, None).await?;
                Ok("Text typed".to_string())
            } else {
                Err("No text specified".to_string())
            }
        }
        "click" => {
            agent_click_mouse("left".to_string()).await?;
            Ok("Clicked".to_string())
        }
        "close_window" => {
            let window = agent_get_active_window().await?;
            agent_close_window(window.id).await?;
            Ok("Window closed".to_string())
        }
        "minimize_window" => {
            let window = agent_get_active_window().await?;
            agent_minimize_window(window.id).await?;
            Ok("Window minimized".to_string())
        }
        "maximize_window" => {
            let window = agent_get_active_window().await?;
            agent_maximize_window(window.id).await?;
            Ok("Window maximized".to_string())
        }
        _ => Err(format!("Unknown intent: {}", nlp_command.intent)),
    }
}

// Helper function to convert string to Key enum
fn string_to_key(key_str: &str) -> Result<Key, String> {
    match key_str.to_lowercase().as_str() {
        "enter" | "return" => Ok(Key::Enter),
        "tab" => Ok(Key::Tab),
        "escape" | "esc" => Ok(Key::Escape),
        "backspace" => Ok(Key::Backspace),
        "delete" | "del" => Ok(Key::Delete),
        "space" => Ok(Key::Space),
        "up" | "arrowup" => Ok(Key::ArrowUp),
        "down" | "arrowdown" => Ok(Key::ArrowDown),
        "left" | "arrowleft" => Ok(Key::ArrowLeft),
        "right" | "arrowright" => Ok(Key::ArrowRight),
        "home" => Ok(Key::Home),
        "end" => Ok(Key::End),
        "pageup" => Ok(Key::PageUp),
        "pagedown" => Ok(Key::PageDown),
        "ctrl" | "control" => Ok(Key::Control),
        "alt" => Ok(Key::Alt),
        "shift" => Ok(Key::Shift),
        "super" | "win" | "cmd" | "command" => Ok(Key::Super),
        s if s.starts_with('f') && s.len() <= 3 => {
            if let Ok(num) = s[1..].parse::<u8>() {
                if num >= 1 && num <= 24 {
                    return Ok(Key::Function(num));
                }
            }
            Err(format!("Invalid function key: {}", s))
        }
        s if s.len() == 1 => Ok(Key::Character(s.chars().next().unwrap())),
        _ => Err(format!("Unknown key: {}", key_str)),
    }
}

// Made with Bob