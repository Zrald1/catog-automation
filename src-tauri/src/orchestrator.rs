#![allow(dead_code)]

use crate::contracts::{AgentRequest, AgentResponse, ToolCall, ToolResult};
use serde_json::json;

pub struct AgentOrchestrator;

impl AgentOrchestrator {
    pub fn new() -> Self {
        Self
    }

    pub fn process(&self, request: AgentRequest) -> Result<AgentResponse, String> {
        if request.user_message.trim().is_empty() {
            return Err("User message is required".to_string());
        }

        let normalized = request.user_message.to_lowercase();
        let requires_terminal = normalized.contains("terminal")
            || normalized.contains("shell")
            || normalized.contains("command")
            || normalized.contains("execute")
            || normalized.contains("run")
            || normalized.contains("bash")
            || normalized.contains("powershell")
            || normalized.contains("cmd");

        let call = ToolCall {
            id: "call_1".to_string(),
            name: "system_message".to_string(),
            args: json!({ "message": request.user_message }),
        };
        let result = ToolResult {
            tool_call_id: call.id.clone(),
            success: true,
            output: request.user_message.clone(),
        };

        Ok(AgentResponse {
            session_id: request.session_id,
            assistant_message: format!(
                "I received your message. {}",
                if requires_terminal {
                    "Switching to terminal mode."
                } else {
                    "How can I help you?"
                }
            ),
            tool_calls: vec![call],
            tool_results: vec![result],
            requires_terminal,
        })
    }
}
