//! Cross-platform application controller wrapper

use crate::ai_agent::{AgentResult, ApplicationController, AutomationSequence};
use async_trait::async_trait;

#[cfg(target_os = "windows")]
use crate::ai_agent::platform_windows::WindowsApplicationController;

#[cfg(target_os = "macos")]
use crate::ai_agent::platform_macos::MacOSApplicationController;

#[cfg(target_os = "linux")]
use crate::ai_agent::platform_linux::LinuxApplicationController;

pub struct CrossPlatformApplicationController {
    #[cfg(target_os = "windows")]
    inner: WindowsApplicationController,
    
    #[cfg(target_os = "macos")]
    inner: MacOSApplicationController,
    
    #[cfg(target_os = "linux")]
    inner: LinuxApplicationController,
}

impl CrossPlatformApplicationController {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            inner: WindowsApplicationController::new(),
            
            #[cfg(target_os = "macos")]
            inner: MacOSApplicationController::new(),
            
            #[cfg(target_os = "linux")]
            inner: LinuxApplicationController::new(),
        }
    }
}

#[async_trait]
impl ApplicationController for CrossPlatformApplicationController {
    async fn launch_app(&self, path: &str, args: Vec<String>) -> AgentResult<u32> {
        self.inner.launch_app(path, args).await
    }

    async fn launch_app_by_name(&self, name: &str) -> AgentResult<u32> {
        self.inner.launch_app_by_name(name).await
    }

    async fn get_running_apps(&self) -> AgentResult<Vec<String>> {
        self.inner.get_running_apps().await
    }

    async fn get_installed_apps(&self) -> AgentResult<Vec<String>> {
        self.inner.get_installed_apps().await
    }

    async fn kill_app(&self, pid: u32) -> AgentResult<()> {
        self.inner.kill_app(pid).await
    }

    async fn execute_sequence(&self, sequence: AutomationSequence) -> AgentResult<String> {
        self.inner.execute_sequence(sequence).await
    }

    async fn navigate_menu(&self, window_id: &str, menu_path: Vec<String>) -> AgentResult<()> {
        self.inner.navigate_menu(window_id, menu_path).await
    }

    async fn handle_file_dialog(&self, dialog_type: &str, file_path: &str) -> AgentResult<()> {
        self.inner.handle_file_dialog(dialog_type, file_path).await
    }

    async fn handle_dialog(&self, window_id: &str, button_text: &str) -> AgentResult<()> {
        self.inner.handle_dialog(window_id, button_text).await
    }
}

// Made with Bob
