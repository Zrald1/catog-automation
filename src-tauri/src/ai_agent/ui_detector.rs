//! Cross-platform UI detector wrapper

use crate::ai_agent::{AgentResult, UIDetector, UIElement};
use async_trait::async_trait;

#[cfg(target_os = "windows")]
use crate::ai_agent::platform_windows::WindowsUIDetector;

#[cfg(target_os = "macos")]
use crate::ai_agent::platform_macos::MacOSUIDetector;

#[cfg(target_os = "linux")]
use crate::ai_agent::platform_linux::LinuxUIDetector;

pub struct CrossPlatformUIDetector {
    #[cfg(target_os = "windows")]
    inner: WindowsUIDetector,
    
    #[cfg(target_os = "macos")]
    inner: MacOSUIDetector,
    
    #[cfg(target_os = "linux")]
    inner: LinuxUIDetector,
}

impl CrossPlatformUIDetector {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            inner: WindowsUIDetector::new(),
            
            #[cfg(target_os = "macos")]
            inner: MacOSUIDetector::new(),
            
            #[cfg(target_os = "linux")]
            inner: LinuxUIDetector::new(),
        }
    }
}

#[async_trait]
impl UIDetector for CrossPlatformUIDetector {
    async fn detect_elements(&self, window_id: &str) -> AgentResult<Vec<UIElement>> {
        self.inner.detect_elements(window_id).await
    }

    async fn find_element_by_name(&self, window_id: &str, name: &str) -> AgentResult<UIElement> {
        self.inner.find_element_by_name(window_id, name).await
    }

    async fn find_elements_by_role(&self, window_id: &str, role: &str) -> AgentResult<Vec<UIElement>> {
        self.inner.find_elements_by_role(window_id, role).await
    }

    async fn get_element_at_point(&self, x: i32, y: i32) -> AgentResult<UIElement> {
        self.inner.get_element_at_point(x, y).await
    }

    async fn get_element_value(&self, element_id: &str) -> AgentResult<String> {
        self.inner.get_element_value(element_id).await
    }

    async fn set_element_value(&self, element_id: &str, value: &str) -> AgentResult<()> {
        self.inner.set_element_value(element_id, value).await
    }

    async fn click_element(&self, element_id: &str) -> AgentResult<()> {
        self.inner.click_element(element_id).await
    }

    async fn get_element_children(&self, element_id: &str) -> AgentResult<Vec<UIElement>> {
        self.inner.get_element_children(element_id).await
    }

    async fn get_element_parent(&self, element_id: &str) -> AgentResult<UIElement> {
        self.inner.get_element_parent(element_id).await
    }

    async fn is_element_visible(&self, element_id: &str) -> AgentResult<bool> {
        self.inner.is_element_visible(element_id).await
    }

    async fn wait_for_element(&self, window_id: &str, name: &str, timeout_ms: u64) -> AgentResult<UIElement> {
        self.inner.wait_for_element(window_id, name, timeout_ms).await
    }

}

// Made with Bob
