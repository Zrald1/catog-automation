//! Error types for the AI Agent system

use thiserror::Error;

#[derive(Error, Debug)]
pub enum AgentError {
    #[error("Window not found: {0}")]
    WindowNotFound(String),

    #[error("UI element not found: {0}")]
    ElementNotFound(String),

    #[error("Application not found: {0}")]
    ApplicationNotFound(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Platform not supported: {0}")]
    PlatformNotSupported(String),

    #[error("Invalid coordinates: x={0}, y={1}")]
    InvalidCoordinates(i32, i32),

    #[error("Invalid window state: {0}")]
    InvalidWindowState(String),

    #[error("Automation timeout: {0}")]
    Timeout(String),

    #[error("Input simulation failed: {0}")]
    InputSimulationFailed(String),

    #[error("Accessibility API error: {0}")]
    AccessibilityError(String),

    #[error("NLP parsing error: {0}")]
    NlpParsingError(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Security violation: {0}")]
    SecurityViolation(String),

    #[error("Learning system error: {0}")]
    LearningError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

pub type AgentResult<T> = Result<T, AgentError>;

// Made with Bob
