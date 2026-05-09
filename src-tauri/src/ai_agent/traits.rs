//! Trait definitions for cross-platform implementations

use crate::ai_agent::{
    AgentResult, AutomationAction, AutomationSequence, Display, MouseAction, 
    KeyboardAction, UIElement, Window, WindowBounds,
};
use async_trait::async_trait;

/// Window management operations
#[async_trait]
pub trait WindowManager: Send + Sync {
    /// Get all windows in the system
    async fn get_all_windows(&self) -> AgentResult<Vec<Window>>;

    /// Get window by title (supports partial matching)
    async fn get_window_by_title(&self, title: &str) -> AgentResult<Window>;

    /// Get currently focused window
    async fn get_active_window(&self) -> AgentResult<Window>;

    /// Get window by process ID
    async fn get_window_by_pid(&self, pid: u32) -> AgentResult<Vec<Window>>;

    /// Resize window to specific dimensions
    async fn resize_window(&self, window_id: &str, width: u32, height: u32) -> AgentResult<()>;

    /// Move window to specific position
    async fn move_window(&self, window_id: &str, x: i32, y: i32) -> AgentResult<()>;

    /// Set window bounds (position and size)
    async fn set_window_bounds(&self, window_id: &str, bounds: WindowBounds) -> AgentResult<()>;

    /// Minimize window
    async fn minimize_window(&self, window_id: &str) -> AgentResult<()>;

    /// Maximize window
    async fn maximize_window(&self, window_id: &str) -> AgentResult<()>;

    /// Restore window from minimized/maximized state
    async fn restore_window(&self, window_id: &str) -> AgentResult<()>;

    /// Close window
    async fn close_window(&self, window_id: &str) -> AgentResult<()>;

    /// Hide window
    async fn hide_window(&self, window_id: &str) -> AgentResult<()>;

    /// Show window
    async fn show_window(&self, window_id: &str) -> AgentResult<()>;

    /// Focus window (bring to front)
    async fn focus_window(&self, window_id: &str) -> AgentResult<()>;

    /// Set window always on top
    async fn set_always_on_top(&self, window_id: &str, always_on_top: bool) -> AgentResult<()>;

    /// Get all displays/monitors
    async fn get_displays(&self) -> AgentResult<Vec<Display>>;

    /// Move window to specific display
    async fn move_window_to_display(&self, window_id: &str, display_index: usize) -> AgentResult<()>;
}

/// UI element detection and analysis
#[async_trait]
pub trait UIDetector: Send + Sync {
    /// Detect all UI elements in a window
    async fn detect_elements(&self, window_id: &str) -> AgentResult<Vec<UIElement>>;

    /// Find element by name/label
    async fn find_element_by_name(&self, window_id: &str, name: &str) -> AgentResult<UIElement>;

    /// Find element by role
    async fn find_elements_by_role(&self, window_id: &str, role: &str) -> AgentResult<Vec<UIElement>>;

    /// Get element at specific coordinates
    async fn get_element_at_point(&self, x: i32, y: i32) -> AgentResult<UIElement>;

    /// Get element value (for inputs)
    async fn get_element_value(&self, element_id: &str) -> AgentResult<String>;

    /// Set element value (for inputs)
    async fn set_element_value(&self, element_id: &str, value: &str) -> AgentResult<()>;

    /// Click element
    async fn click_element(&self, element_id: &str) -> AgentResult<()>;

    /// Get element children
    async fn get_element_children(&self, element_id: &str) -> AgentResult<Vec<UIElement>>;

    /// Get element parent
    async fn get_element_parent(&self, element_id: &str) -> AgentResult<UIElement>;

    /// Check if element is visible
    async fn is_element_visible(&self, element_id: &str) -> AgentResult<bool>;

    /// Wait for element to appear
    async fn wait_for_element(&self, window_id: &str, name: &str, timeout_ms: u64) -> AgentResult<UIElement>;

}

/// Input simulation (mouse and keyboard)
#[async_trait]
pub trait InputSimulator: Send + Sync {
    /// Execute mouse action
    async fn execute_mouse_action(&self, action: MouseAction) -> AgentResult<()>;

    /// Execute keyboard action
    async fn execute_keyboard_action(&self, action: KeyboardAction) -> AgentResult<()>;

    /// Get current mouse position
    async fn get_mouse_position(&self) -> AgentResult<(i32, i32)>;

    /// Move mouse with smooth animation
    async fn move_mouse_smooth(&self, to_x: i32, to_y: i32, duration_ms: u64) -> AgentResult<()>;

    /// Type text with human-like delays
    async fn type_text_human(&self, text: &str) -> AgentResult<()>;

    /// Get screen size
    async fn get_screen_size(&self) -> AgentResult<(u32, u32)>;

    /// Take screenshot
    async fn take_screenshot(&self, region: Option<WindowBounds>) -> AgentResult<Vec<u8>>;
}

/// Application control and interaction
#[async_trait]
pub trait ApplicationController: Send + Sync {
    /// Launch application by path
    async fn launch_app(&self, path: &str, args: Vec<String>) -> AgentResult<u32>;

    /// Launch application by name
    async fn launch_app_by_name(&self, name: &str) -> AgentResult<u32>;

    /// Get running applications
    async fn get_running_apps(&self) -> AgentResult<Vec<String>>;

    /// Get installed applications
    async fn get_installed_apps(&self) -> AgentResult<Vec<String>>;

    /// Kill application by PID
    async fn kill_app(&self, pid: u32) -> AgentResult<()>;

    /// Execute automation sequence
    async fn execute_sequence(&self, sequence: AutomationSequence) -> AgentResult<String>;

    /// Navigate application menu
    async fn navigate_menu(&self, window_id: &str, menu_path: Vec<String>) -> AgentResult<()>;

    /// Handle file dialog
    async fn handle_file_dialog(&self, dialog_type: &str, file_path: &str) -> AgentResult<()>;

    /// Detect and respond to dialog
    async fn handle_dialog(&self, window_id: &str, button_text: &str) -> AgentResult<()>;
}

/// NLP command parsing
pub trait NLPParser: Send + Sync {
    /// Parse natural language command
    fn parse_command(&self, command: &str) -> AgentResult<Vec<AutomationAction>>;

    /// Extract intent from command
    fn extract_intent(&self, command: &str) -> AgentResult<String>;

    /// Extract entities from command
    fn extract_entities(&self, command: &str) -> AgentResult<std::collections::HashMap<String, String>>;
}

/// Learning and improvement system
#[async_trait]
pub trait LearningSystem: Send + Sync {
    /// Record successful automation
    async fn record_success(&self, app_name: &str, sequence: AutomationSequence) -> AgentResult<()>;

    /// Record failed automation
    async fn record_failure(&self, app_name: &str, sequence: AutomationSequence, error: String) -> AgentResult<()>;

    /// Get application profile
    async fn get_app_profile(&self, app_name: &str) -> AgentResult<crate::ai_agent::ApplicationProfile>;

    /// Update application profile
    async fn update_app_profile(&self, profile: crate::ai_agent::ApplicationProfile) -> AgentResult<()>;

    /// Suggest improvements for sequence
    async fn suggest_improvements(&self, sequence: AutomationSequence) -> AgentResult<Vec<AutomationAction>>;

    /// Detect chatbox in application
    async fn detect_chatbox(&self, window_id: &str) -> AgentResult<Option<UIElement>>;
}

// Made with Bob
