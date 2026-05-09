//! Natural Language Processing for command parsing

use crate::ai_agent::{
    AgentError, AgentResult, AutomationAction, KeyboardAction, MouseAction, MouseButton, NLPParser,
};
use regex::Regex;
use std::collections::HashMap;

/// Simple regex-based NLP parser
pub struct RegexNLPParser {
    patterns: Vec<CommandPattern>,
}

struct CommandPattern {
    regex: Regex,
    intent: String,
    action_builder:
        Box<dyn Fn(&regex::Captures) -> AgentResult<Vec<AutomationAction>> + Send + Sync>,
}

impl RegexNLPParser {
    pub fn new() -> Self {
        let mut parser = Self {
            patterns: Vec::new(),
        };
        parser.register_default_patterns();
        parser
    }

    fn register_default_patterns(&mut self) {
        // Open/Launch application patterns
        self.add_pattern(
            r"(?i)(?:open|launch|start|run)\s+(.+?)(?:\s+and|\s+then|$)",
            "launch_app",
            |caps| {
                let app_name = caps.get(1).unwrap().as_str().trim();
                Ok(vec![AutomationAction::LaunchApp {
                    path: app_name.to_string(),
                    args: vec![],
                }])
            },
        );

        // Click patterns
        self.add_pattern(
            r"(?i)click\s+(?:at\s+)?(?:coordinates?\s+)?(?:\()?(\d+)\s*,\s*(\d+)(?:\))?",
            "click_at",
            |caps| {
                let x: i32 = caps.get(1).unwrap().as_str().parse().unwrap_or(0);
                let y: i32 = caps.get(2).unwrap().as_str().parse().unwrap_or(0);
                Ok(vec![
                    AutomationAction::Mouse(MouseAction::Move { x, y }),
                    AutomationAction::Mouse(MouseAction::Click {
                        button: MouseButton::Left,
                    }),
                ])
            },
        );

        // Type text patterns
        self.add_pattern(
            r#"(?i)(?:type|write|enter)\s+["'](.+?)["']"#,
            "type_text",
            |caps| {
                let text = caps.get(1).unwrap().as_str();
                Ok(vec![AutomationAction::Keyboard(KeyboardAction::Type {
                    text: text.to_string(),
                })])
            },
        );

        // Wait patterns
        self.add_pattern(
            r"(?i)wait\s+(?:for\s+)?(\d+)\s*(?:ms|milliseconds?|seconds?)?",
            "wait",
            |caps| {
                let duration: u64 = caps.get(1).unwrap().as_str().parse().unwrap_or(1000);
                Ok(vec![AutomationAction::Wait {
                    milliseconds: duration,
                }])
            },
        );

        // Window control patterns
        self.add_pattern(
            r"(?i)(?:minimize|maximise|maximize|close|focus)\s+(?:window\s+)?(.+)",
            "window_control",
            |caps| {
                let window_title = caps.get(1).unwrap().as_str().trim();
                // This would need window ID lookup in actual implementation
                Ok(vec![AutomationAction::FocusWindow {
                    window_id: window_title.to_string(),
                }])
            },
        );

        // Move mouse patterns
        self.add_pattern(
            r"(?i)move\s+(?:mouse\s+)?(?:to\s+)?(?:\()?(\d+)\s*,\s*(\d+)(?:\))?",
            "move_mouse",
            |caps| {
                let x: i32 = caps.get(1).unwrap().as_str().parse().unwrap_or(0);
                let y: i32 = caps.get(2).unwrap().as_str().parse().unwrap_or(0);
                Ok(vec![AutomationAction::Mouse(MouseAction::Move { x, y })])
            },
        );

        // Drag patterns
        self.add_pattern(
            r"(?i)drag\s+from\s+(?:\()?(\d+)\s*,\s*(\d+)(?:\))?\s+to\s+(?:\()?(\d+)\s*,\s*(\d+)(?:\))?",
            "drag",
            |caps| {
                let from_x: i32 = caps.get(1).unwrap().as_str().parse().unwrap_or(0);
                let from_y: i32 = caps.get(2).unwrap().as_str().parse().unwrap_or(0);
                let to_x: i32 = caps.get(3).unwrap().as_str().parse().unwrap_or(0);
                let to_y: i32 = caps.get(4).unwrap().as_str().parse().unwrap_or(0);
                Ok(vec![AutomationAction::Mouse(MouseAction::Drag {
                    from_x,
                    from_y,
                    to_x,
                    to_y,
                })])
            },
        );

        // Screenshot patterns
        self.add_pattern(
            r"(?i)(?:take\s+)?screenshot\s+(?:to\s+)?(.+)",
            "screenshot",
            |caps| {
                let path = caps.get(1).unwrap().as_str().trim();
                Ok(vec![AutomationAction::Screenshot {
                    path: path.to_string(),
                    region: None,
                }])
            },
        );
    }

    fn add_pattern<F>(&mut self, pattern: &str, intent: &str, action_builder: F)
    where
        F: Fn(&regex::Captures) -> AgentResult<Vec<AutomationAction>> + Send + Sync + 'static,
    {
        if let Ok(regex) = Regex::new(pattern) {
            self.patterns.push(CommandPattern {
                regex,
                intent: intent.to_string(),
                action_builder: Box::new(action_builder),
            });
        }
    }

    /// Parse complex multi-step commands
    fn parse_complex_command(&self, command: &str) -> AgentResult<Vec<AutomationAction>> {
        let mut actions = Vec::new();

        // Split by common separators
        let separators = [" and ", " then ", ", ", "; "];
        let mut parts = vec![command];

        for sep in &separators {
            let mut new_parts = Vec::new();
            for part in parts {
                new_parts.extend(part.split(sep).map(|s| s.trim()));
            }
            parts = new_parts;
        }

        // Parse each part
        for part in parts {
            if part.is_empty() {
                continue;
            }

            let part_actions = self.parse_command(part)?;
            actions.extend(part_actions);
        }

        Ok(actions)
    }
}

impl NLPParser for RegexNLPParser {
    fn parse_command(&self, command: &str) -> AgentResult<Vec<AutomationAction>> {
        // Try to match against patterns
        for pattern in &self.patterns {
            if let Some(caps) = pattern.regex.captures(command) {
                return (pattern.action_builder)(&caps);
            }
        }

        // If no pattern matches, try complex command parsing
        if command.contains(" and ") || command.contains(" then ") {
            return self.parse_complex_command(command);
        }

        Err(AgentError::NlpParsingError(format!(
            "Could not parse command: {}",
            command
        )))
    }

    fn extract_intent(&self, command: &str) -> AgentResult<String> {
        for pattern in &self.patterns {
            if pattern.regex.is_match(command) {
                return Ok(pattern.intent.clone());
            }
        }

        Err(AgentError::NlpParsingError(format!(
            "Could not extract intent from: {}",
            command
        )))
    }

    fn extract_entities(&self, command: &str) -> AgentResult<HashMap<String, String>> {
        let mut entities = HashMap::new();

        // Extract common entities
        // Application names
        if let Some(caps) = Regex::new(r"(?i)(?:open|launch|start)\s+(.+?)(?:\s+and|\s+then|$)")
            .unwrap()
            .captures(command)
        {
            entities.insert(
                "app_name".to_string(),
                caps.get(1).unwrap().as_str().to_string(),
            );
        }

        // Coordinates
        if let Some(caps) = Regex::new(r"(\d+)\s*,\s*(\d+)").unwrap().captures(command) {
            entities.insert("x".to_string(), caps.get(1).unwrap().as_str().to_string());
            entities.insert("y".to_string(), caps.get(2).unwrap().as_str().to_string());
        }

        // Text in quotes
        if let Some(caps) = Regex::new(r#"["'](.+?)["']"#).unwrap().captures(command) {
            entities.insert(
                "text".to_string(),
                caps.get(1).unwrap().as_str().to_string(),
            );
        }

        Ok(entities)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_launch_app() {
        let parser = RegexNLPParser::new();
        let actions = parser.parse_command("open notepad").unwrap();
        assert_eq!(actions.len(), 1);
    }

    #[test]
    fn test_parse_click() {
        let parser = RegexNLPParser::new();
        let actions = parser.parse_command("click at 100, 200").unwrap();
        assert_eq!(actions.len(), 2); // Move + Click
    }

    #[test]
    fn test_parse_type() {
        let parser = RegexNLPParser::new();
        let actions = parser.parse_command("type 'hello world'").unwrap();
        assert_eq!(actions.len(), 1);
    }

    #[test]
    fn test_parse_complex() {
        let parser = RegexNLPParser::new();
        let actions = parser
            .parse_command("open notepad and type 'hello' then wait 1000")
            .unwrap();
        assert!(actions.len() >= 3);
    }
}

// Made with Bob
