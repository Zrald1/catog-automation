_os = "windows")]
    return press_key(&key);
    
    #[cfg(not(target_os = "windows"))]
    Err("This feature is only available on Windows".to_string())
}

#[tauri::command]
pub fn agent_press_key_combo(modifiers: Vec<String>, key: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return press_key_combination(modifiers, key);
    
    #[cfg(not(target_os = "windows"))]
    Err("This feature is only available on Windows".to_string())
}

#[tauri::command]
pub fn agent_launch_app(path: String) -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    return launch_app(&path);
    
    #[cfg(not(target_os = "windows"))]
    Err("This feature is only available on Windows".to_string())
}

#[tauri::command]
pub fn agent_execute_sequence(sequence: AutomationSequence) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    return execute_automation_sequence(sequence);
    
    #[cfg(not(target_os = "windows"))]
    Err("This feature is only available on Windows".to_string())
}

#[tauri::command]
pub fn agent_parse_command(command: String) -> Result<NLPCommand, String> {
    parse_nlp_command(&command)
}

#[tauri::command]
pub fn agent_execute_nlp_command(nlp_command: NLPCommand) -> Result<String, String> {
    execute_nlp_command(nlp_command)
}

#[tauri::command]
pub fn agent_get_screen_size() -> Result<(u32, u32), String> {
    #[cfg(target_os = "windows")]
    return get_screen_dimensions();
    
    #[cfg(not(target_os = "windows"))]
    Err("This feature is only available on Windows".to_string())
}

#[tauri::command]
pub fn agent_get_mouse_position() -> Result<(i32, i32), String> {
    #[cfg(target_os = "windows")]
    return get_mouse_position();
    
    #[cfg(not(target_os = "windows"))]
    Err("This feature is only available on Windows".to_string())
}

#[tauri::command]
pub fn agent_scroll(amount: i32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return scroll_mouse(amount);
    
    #[cfg(not(target_os = "windows"))]
    Err("This feature is only available on Windows".to_string())
}