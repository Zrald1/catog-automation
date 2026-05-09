//! Cross-platform input simulator wrapper

use crate::ai_agent::{AgentResult, InputSimulator, KeyboardAction, MouseAction, WindowBounds};
use async_trait::async_trait;

#[cfg(target_os = "windows")]
use crate::ai_agent::platform_windows::WindowsInputSimulator;

#[cfg(target_os = "macos")]
use crate::ai_agent::platform_macos::MacOSInputSimulator;

#[cfg(target_os = "linux")]
use crate::ai_agent::platform_linux::LinuxInputSimulator;

pub struct CrossPlatformInputSimulator {
    #[cfg(target_os = "windows")]
    inner: WindowsInputSimulator,
    
    #[cfg(target_os = "macos")]
    inner: MacOSInputSimulator,
    
    #[cfg(target_os = "linux")]
    inner: LinuxInputSimulator,
}

impl CrossPlatformInputSimulator {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            inner: WindowsInputSimulator::new(),
            
            #[cfg(target_os = "macos")]
            inner: MacOSInputSimulator::new(),
            
            #[cfg(target_os = "linux")]
            inner: LinuxInputSimulator::new(),
        }
    }
}

#[async_trait]
impl InputSimulator for CrossPlatformInputSimulator {
    async fn execute_mouse_action(&self, action: MouseAction) -> AgentResult<()> {
        self.inner.execute_mouse_action(action).await
    }

    async fn execute_keyboard_action(&self, action: KeyboardAction) -> AgentResult<()> {
        self.inner.execute_keyboard_action(action).await
    }

    async fn get_mouse_position(&self) -> AgentResult<(i32, i32)> {
        self.inner.get_mouse_position().await
    }

    async fn move_mouse_smooth(&self, to_x: i32, to_y: i32, duration_ms: u64) -> AgentResult<()> {
        self.inner.move_mouse_smooth(to_x, to_y, duration_ms).await
    }

    async fn type_text_human(&self, text: &str) -> AgentResult<()> {
        self.inner.type_text_human(text).await
    }

    async fn get_screen_size(&self) -> AgentResult<(u32, u32)> {
        self.inner.get_screen_size().await
    }

    async fn take_screenshot(&self, region: Option<WindowBounds>) -> AgentResult<Vec<u8>> {
        self.inner.take_screenshot(region).await
    }
}

// Made with Bob
