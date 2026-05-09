//! Configuration management for the AI Agent system

use crate::ai_agent::{AgentError, AgentResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Agent system configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    /// Enable/disable automation features
    pub enabled: bool,
    
    /// Default timeout for automation actions (ms)
    pub default_timeout_ms: u64,
    
    /// Default retry count for failed actions
    pub default_retry_count: u32,
    
    /// Enable human-like delays
    pub human_like_delays: bool,
    
    /// Mouse movement speed (pixels per second)
    pub mouse_speed: u32,
    
    /// Typing speed (characters per second)
    pub typing_speed: u32,
    
    /// Learning system storage path
    pub learning_storage_path: PathBuf,
    
    /// Security settings
    pub security: SecurityConfig,
    
    /// Logging settings
    pub logging: LoggingConfig,
}

/// Security configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityConfig {
    /// Require user confirmation for sensitive operations
    pub require_confirmation: bool,
    
    /// Application whitelist (empty = all allowed)
    pub app_whitelist: Vec<String>,
    
    /// Application blacklist
    pub app_blacklist: Vec<String>,
    
    /// Maximum automation sequence length
    pub max_sequence_length: usize,
    
    /// Enable audit logging
    pub audit_logging: bool,
}

/// Logging configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggingConfig {
    /// Log level (trace, debug, info, warn, error)
    pub level: String,
    
    /// Log to file
    pub log_to_file: bool,
    
    /// Log file path
    pub log_file_path: Option<PathBuf>,
    
    /// Enable screenshot logging
    pub screenshot_logging: bool,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            default_timeout_ms: 30000,
            default_retry_count: 3,
            human_like_delays: true,
            mouse_speed: 1000,
            typing_speed: 10,
            learning_storage_path: PathBuf::from("./agent_profiles"),
            security: SecurityConfig::default(),
            logging: LoggingConfig::default(),
        }
    }
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            require_confirmation: false,
            app_whitelist: Vec::new(),
            app_blacklist: Vec::new(),
            max_sequence_length: 100,
            audit_logging: true,
        }
    }
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: "info".to_string(),
            log_to_file: true,
            log_file_path: Some(PathBuf::from("./agent.log")),
            screenshot_logging: false,
        }
    }
}

impl AgentConfig {
    /// Load configuration from file
    pub fn load(path: &PathBuf) -> AgentResult<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }

        let content = std::fs::read_to_string(path)?;
        let config: AgentConfig = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// Save configuration to file
    pub fn save(&self, path: &PathBuf) -> AgentResult<()> {
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    /// Validate configuration
    pub fn validate(&self) -> AgentResult<()> {
        if self.default_timeout_ms == 0 {
            return Err(AgentError::ConfigError("Timeout must be greater than 0".to_string()));
        }

        if self.mouse_speed == 0 {
            return Err(AgentError::ConfigError("Mouse speed must be greater than 0".to_string()));
        }

        if self.typing_speed == 0 {
            return Err(AgentError::ConfigError("Typing speed must be greater than 0".to_string()));
        }

        Ok(())
    }
}

// Made with Bob
