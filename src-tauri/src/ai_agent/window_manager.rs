//! Cross-platform window manager wrapper

use crate::ai_agent::{AgentResult, Display, Window, WindowBounds, WindowManager};
use async_trait::async_trait;

#[cfg(target_os = "windows")]
use crate::ai_agent::platform_windows::WindowsWindowManager;

#[cfg(target_os = "macos")]
use crate::ai_agent::platform_macos::MacOSWindowManager;

#[cfg(target_os = "linux")]
use crate::ai_agent::platform_linux::LinuxWindowManager;

/// Cross-platform window manager
pub struct CrossPlatformWindowManager {
    #[cfg(target_os = "windows")]
    inner: WindowsWindowManager,
    
    #[cfg(target_os = "macos")]
    inner: MacOSWindowManager,
    
    #[cfg(target_os = "linux")]
    inner: LinuxWindowManager,
}

impl CrossPlatformWindowManager {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            inner: WindowsWindowManager::new(),
            
            #[cfg(target_os = "macos")]
            inner: MacOSWindowManager::new(),
            
            #[cfg(target_os = "linux")]
            inner: LinuxWindowManager::new(),
        }
    }
}

#[async_trait]
impl WindowManager for CrossPlatformWindowManager {
    async fn get_all_windows(&self) -> AgentResult<Vec<Window>> {
        self.inner.get_all_windows().await
    }

    async fn get_window_by_title(&self, title: &str) -> AgentResult<Window> {
        self.inner.get_window_by_title(title).await
    }

    async fn get_active_window(&self) -> AgentResult<Window> {
        self.inner.get_active_window().await
    }

    async fn get_window_by_pid(&self, pid: u32) -> AgentResult<Vec<Window>> {
        self.inner.get_window_by_pid(pid).await
    }

    async fn resize_window(&self, window_id: &str, width: u32, height: u32) -> AgentResult<()> {
        self.inner.resize_window(window_id, width, height).await
    }

    async fn move_window(&self, window_id: &str, x: i32, y: i32) -> AgentResult<()> {
        self.inner.move_window(window_id, x, y).await
    }

    async fn set_window_bounds(&self, window_id: &str, bounds: WindowBounds) -> AgentResult<()> {
        self.inner.set_window_bounds(window_id, bounds).await
    }

    async fn minimize_window(&self, window_id: &str) -> AgentResult<()> {
        self.inner.minimize_window(window_id).await
    }

    async fn maximize_window(&self, window_id: &str) -> AgentResult<()> {
        self.inner.maximize_window(window_id).await
    }

    async fn restore_window(&self, window_id: &str) -> AgentResult<()> {
        self.inner.restore_window(window_id).await
    }

    async fn close_window(&self, window_id: &str) -> AgentResult<()> {
        self.inner.close_window(window_id).await
    }

    async fn hide_window(&self, window_id: &str) -> AgentResult<()> {
        self.inner.hide_window(window_id).await
    }

    async fn show_window(&self, window_id: &str) -> AgentResult<()> {
        self.inner.show_window(window_id).await
    }

    async fn focus_window(&self, window_id: &str) -> AgentResult<()> {
        self.inner.focus_window(window_id).await
    }

    async fn set_always_on_top(&self, window_id: &str, always_on_top: bool) -> AgentResult<()> {
        self.inner.set_always_on_top(window_id, always_on_top).await
    }

    async fn get_displays(&self) -> AgentResult<Vec<Display>> {
        self.inner.get_displays().await
    }

    async fn move_window_to_display(&self, window_id: &str, display_index: usize) -> AgentResult<()> {
        self.inner.move_window_to_display(window_id, display_index).await
    }
}

// Made with Bob
