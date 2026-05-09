//! Security and permission management for automation

use crate::ai_agent::{AgentError, AgentResult, AutomationAction, AutomationSequence};
use parking_lot::RwLock;
use std::collections::HashSet;
use std::sync::Arc;

/// Security manager for automation operations
pub struct SecurityManager {
    whitelist: Arc<RwLock<HashSet<String>>>,
    blacklist: Arc<RwLock<HashSet<String>>>,
    require_confirmation: bool,
    max_sequence_length: usize,
    audit_log: Arc<RwLock<Vec<AuditEntry>>>,
}

/// Audit log entry
#[derive(Debug, Clone)]
pub struct AuditEntry {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub action: String,
    pub app_name: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

impl SecurityManager {
    pub fn new(require_confirmation: bool, max_sequence_length: usize) -> Self {
        Self {
            whitelist: Arc::new(RwLock::new(HashSet::new())),
            blacklist: Arc::new(RwLock::new(HashSet::new())),
            require_confirmation,
            max_sequence_length,
            audit_log: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Check if application is allowed
    pub fn is_app_allowed(&self, app_name: &str) -> bool {
        let whitelist = self.whitelist.read();
        let blacklist = self.blacklist.read();

        // If blacklisted, deny
        if blacklist.contains(app_name) {
            return false;
        }

        // If whitelist is empty, allow all (except blacklisted)
        if whitelist.is_empty() {
            return true;
        }

        // Otherwise, must be in whitelist
        whitelist.contains(app_name)
    }

    /// Add application to whitelist
    pub fn add_to_whitelist(&self, app_name: String) {
        self.whitelist.write().insert(app_name);
    }

    /// Add application to blacklist
    pub fn add_to_blacklist(&self, app_name: String) {
        self.blacklist.write().insert(app_name);
    }

    /// Remove application from whitelist
    pub fn remove_from_whitelist(&self, app_name: &str) {
        self.whitelist.write().remove(app_name);
    }

    /// Remove application from blacklist
    pub fn remove_from_blacklist(&self, app_name: &str) {
        self.blacklist.write().remove(app_name);
    }

    /// Validate automation sequence
    pub fn validate_sequence(&self, sequence: &AutomationSequence) -> AgentResult<()> {
        // Check sequence length
        if sequence.actions.len() > self.max_sequence_length {
            return Err(AgentError::SecurityViolation(format!(
                "Sequence length {} exceeds maximum {}",
                sequence.actions.len(),
                self.max_sequence_length
            )));
        }

        // Check for sensitive actions
        for action in &sequence.actions {
            self.validate_action(action)?;
        }

        Ok(())
    }

    /// Validate individual action
    pub fn validate_action(&self, action: &AutomationAction) -> AgentResult<()> {
        match action {
            AutomationAction::LaunchApp { path, .. } => {
                // Check if launching system-critical applications
                let critical_apps = ["cmd.exe", "powershell.exe", "bash", "sudo"];
                if critical_apps.iter().any(|&app| path.contains(app)) {
                    if self.require_confirmation {
                        return Err(AgentError::SecurityViolation(
                            "Launching system-critical application requires confirmation".to_string(),
                        ));
                    }
                }
            }
            _ => {}
        }

        Ok(())
    }

    /// Log automation action
    pub fn log_action(&self, action: String, app_name: Option<String>, success: bool, error: Option<String>) {
        let entry = AuditEntry {
            timestamp: chrono::Utc::now(),
            action,
            app_name,
            success,
            error,
        };

        self.audit_log.write().push(entry);
    }

    /// Get audit log
    pub fn get_audit_log(&self) -> Vec<AuditEntry> {
        self.audit_log.read().clone()
    }

    /// Clear audit log
    pub fn clear_audit_log(&self) {
        self.audit_log.write().clear();
    }

    /// Export audit log to file
    pub fn export_audit_log(&self, path: &std::path::Path) -> AgentResult<()> {
        let log = self.audit_log.read();
        let json = serde_json::to_string_pretty(&*log)?;
        std::fs::write(path, json)?;
        Ok(())
    }
}

impl serde::Serialize for AuditEntry {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AuditEntry", 5)?;
        state.serialize_field("timestamp", &self.timestamp.to_rfc3339())?;
        state.serialize_field("action", &self.action)?;
        state.serialize_field("app_name", &self.app_name)?;
        state.serialize_field("success", &self.success)?;
        state.serialize_field("error", &self.error)?;
        state.end()
    }
}

// Made with Bob
