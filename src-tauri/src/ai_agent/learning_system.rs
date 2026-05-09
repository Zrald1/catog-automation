//! Learning and improvement system for automation

use crate::ai_agent::{
    AgentError, AgentResult, ApplicationProfile, AutomationAction, AutomationSequence,
    LearningSystem, UIElement,
};
use async_trait::async_trait;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

/// File-based learning system that stores application profiles
pub struct FileLearningSystem {
    profiles: Arc<RwLock<HashMap<String, ApplicationProfile>>>,
    storage_path: PathBuf,
}

impl FileLearningSystem {
    pub fn new(storage_path: PathBuf) -> Self {
        let system = Self {
            profiles: Arc::new(RwLock::new(HashMap::new())),
            storage_path,
        };
        
        // Load existing profiles
        if let Err(e) = system.load_profiles() {
            tracing::warn!("Failed to load profiles: {}", e);
        }
        
        system
    }

    fn load_profiles(&self) -> AgentResult<()> {
        if !self.storage_path.exists() {
            std::fs::create_dir_all(&self.storage_path)?;
            return Ok(());
        }

        for entry in std::fs::read_dir(&self.storage_path)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(profile) = serde_json::from_str::<ApplicationProfile>(&content) {
                        self.profiles.write().insert(profile.app_name.clone(), profile);
                    }
                }
            }
        }

        Ok(())
    }

    fn save_profile(&self, profile: &ApplicationProfile) -> AgentResult<()> {
        let filename = format!("{}.json", profile.app_name.replace(" ", "_"));
        let path = self.storage_path.join(filename);
        let content = serde_json::to_string_pretty(profile)?;
        std::fs::write(path, content)?;
        Ok(())
    }
}

#[async_trait]
impl LearningSystem for FileLearningSystem {
    async fn record_success(&self, app_name: &str, sequence: AutomationSequence) -> AgentResult<()> {
        let mut profiles = self.profiles.write();
        
        let profile = profiles.entry(app_name.to_string()).or_insert_with(|| {
            ApplicationProfile {
                app_name: app_name.to_string(),
                bundle_id: None,
                executable_path: None,
                ui_elements: Vec::new(),
                common_actions: Vec::new(),
                chatbox_patterns: Vec::new(),
                success_rate: 0.0,
                last_updated: chrono::Utc::now(),
            }
        });

        // Add to common actions if not already present
        if !profile.common_actions.iter().any(|s| s.name == sequence.name) {
            profile.common_actions.push(sequence);
        }

        // Update success rate
        profile.success_rate = (profile.success_rate * 0.9) + 0.1;
        profile.last_updated = chrono::Utc::now();

        self.save_profile(profile)?;
        Ok(())
    }

    async fn record_failure(&self, app_name: &str, _sequence: AutomationSequence, error: String) -> AgentResult<()> {
        let mut profiles = self.profiles.write();
        
        if let Some(profile) = profiles.get_mut(app_name) {
            profile.success_rate = profile.success_rate * 0.9;
            profile.last_updated = chrono::Utc::now();
            self.save_profile(profile)?;
        }

        tracing::warn!("Automation failed for {}: {}", app_name, error);
        Ok(())
    }

    async fn get_app_profile(&self, app_name: &str) -> AgentResult<ApplicationProfile> {
        self.profiles
            .read()
            .get(app_name)
            .cloned()
            .ok_or_else(|| AgentError::Unknown(format!("No profile found for {}", app_name)))
    }

    async fn update_app_profile(&self, profile: ApplicationProfile) -> AgentResult<()> {
        self.profiles.write().insert(profile.app_name.clone(), profile.clone());
        self.save_profile(&profile)?;
        Ok(())
    }

    async fn suggest_improvements(&self, sequence: AutomationSequence) -> AgentResult<Vec<AutomationAction>> {
        // Simple improvement suggestions
        let mut improved = sequence.actions.clone();
        
        // Add waits between actions if missing
        let mut i = 0;
        while i < improved.len() - 1 {
            if !matches!(improved[i + 1], AutomationAction::Wait { .. }) {
                improved.insert(i + 1, AutomationAction::Wait { milliseconds: 100 });
                i += 2;
            } else {
                i += 1;
            }
        }

        Ok(improved)
    }

    async fn detect_chatbox(&self, _window_id: &str) -> AgentResult<Option<UIElement>> {
        // Chatbox detection would analyze UI elements for common patterns
        Ok(None)
    }
}

// Made with Bob
