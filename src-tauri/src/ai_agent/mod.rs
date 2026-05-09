//! Comprehensive Cross-Platform AI Agent System
//! 
//! This module provides complete programmatic control and interaction with any desktop
//! application on Windows, macOS, and Linux.

#![allow(dead_code)]

pub mod types;
pub mod errors;
pub mod traits;
pub mod window_manager;
pub mod ui_detector;
pub mod input_simulator;
pub mod app_controller;
pub mod nlp_parser;
pub mod learning_system;
pub mod config;
pub mod security;

// Platform-specific implementations
#[cfg(target_os = "windows")]
pub mod platform_windows;

#[cfg(target_os = "macos")]
pub mod platform_macos;

#[cfg(target_os = "linux")]
pub mod platform_linux;

// Re-exports
pub use types::*;
pub use errors::*;
pub use traits::*;

// Made with Bob
