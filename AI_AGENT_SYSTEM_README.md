# Comprehensive Cross-Platform AI Agent System

A complete programmatic control and interaction system for desktop applications on Windows, macOS, and Linux, built with Rust for Tauri applications.

## 🎯 Overview

This AI Agent system provides full cross-platform automation capabilities including:

- **Window Management**: Detect, enumerate, resize, move, minimize, maximize, and control windows
- **UI Element Detection**: Automatically detect and interact with UI elements using accessibility APIs
- **Input Simulation**: Simulate mouse movements, clicks, keyboard input with human-like behavior
- **Application Control**: Launch, manage, and interact with desktop applications
- **Natural Language Processing**: Parse natural language commands into automation sequences
- **Learning System**: Improve automation accuracy over time through machine learning
- **Security**: Permission management, whitelisting, and audit logging

## 📁 Project Structure

```
src-tauri/src/ai_agent/
├── mod.rs                    # Module exports and organization
├── types.rs                  # Core data structures (Window, UIElement, etc.)
├── errors.rs                 # Error types and AgentResult
├── traits.rs                 # Cross-platform trait definitions
├── config.rs                 # Configuration management
├── security.rs               # Security and permission management
├── nlp_parser.rs             # Natural language command parsing
├── learning_system.rs        # Machine learning and improvement
├── window_manager.rs         # Cross-platform window management wrapper
├── ui_detector.rs            # Cross-platform UI detection wrapper
├── input_simulator.rs        # Cross-platform input simulation wrapper
├── app_controller.rs         # Cross-platform application control wrapper
├── platform_windows.rs       # Windows-specific implementations
├── platform_macos.rs         # macOS-specific implementations
└── platform_linux.rs         # Linux-specific implementations
```

## 🚀 Features

### Cross-Platform Window Management

```rust
use ai_agent::window_manager::CrossPlatformWindowManager;

let manager = CrossPlatformWindowManager::new();

// Get all windows
let windows = manager.get_all_windows().await?;

// Find window by title
let window = manager.get_window_by_title("Notepad").await?;

// Resize window
manager.resize_window(&window.id, 800, 600).await?;

// Move window
manager.move_window(&window.id, 100, 100).await?;

// Minimize/Maximize/Restore
manager.minimize_window(&window.id).await?;
manager.maximize_window(&window.id).await?;
manager.restore_window(&window.id).await?;

// Multi-monitor support
let displays = manager.get_displays().await?;
manager.move_window_to_display(&window.id, 1).await?;
```

### UI Element Detection

```rust
use ai_agent::ui_detector::CrossPlatformUIDetector;

let detector = CrossPlatformUIDetector::new();

// Detect all UI elements in a window
let elements = detector.detect_elements(&window_id).await?;

// Find specific element
let button = detector.find_element_by_name(&window_id, "Submit").await?;

// Click element
detector.click_element(&button.id).await?;

// Get/Set element value
let value = detector.get_element_value(&element_id).await?;
detector.set_element_value(&element_id, "new value").await?;

// Wait for element to appear
let element = detector.wait_for_element(&window_id, "Loading", 5000).await?;

```

### Input Simulation

```rust
use ai_agent::input_simulator::CrossPlatformInputSimulator;
use ai_agent::{MouseAction, MouseButton, KeyboardAction};

let simulator = CrossPlatformInputSimulator::new();

// Mouse actions
simulator.execute_mouse_action(MouseAction::Move { x: 100, y: 200 }).await?;
simulator.execute_mouse_action(MouseAction::Click { button: MouseButton::Left }).await?;
simulator.execute_mouse_action(MouseAction::DoubleClick { button: MouseButton::Left }).await?;
simulator.execute_mouse_action(MouseAction::Drag { 
    from_x: 100, from_y: 100, 
    to_x: 200, to_y: 200 
}).await?;

// Smooth mouse movement with Bezier curves
simulator.move_mouse_smooth(500, 300, 1000).await?;

// Keyboard actions
simulator.execute_keyboard_action(KeyboardAction::Type { 
    text: "Hello World".to_string() 
}).await?;

// Human-like typing with random delays
simulator.type_text_human("Natural typing").await?;

// Screenshots
let screenshot = simulator.take_screenshot(None).await?;
```

### Application Control

```rust
use ai_agent::app_controller::CrossPlatformApplicationController;

let controller = CrossPlatformApplicationController::new();

// Launch application
let pid = controller.launch_app("/path/to/app", vec![]).await?;
let pid = controller.launch_app_by_name("notepad").await?;

// Get running/installed apps
let running = controller.get_running_apps().await?;
let installed = controller.get_installed_apps().await?;

// Execute automation sequence
let sequence = AutomationSequence {
    id: Uuid::new_v4(),
    name: "Open and type".to_string(),
    description: Some("Opens notepad and types text".to_string()),
    actions: vec![
        AutomationAction::LaunchApp { 
            path: "notepad".to_string(), 
            args: vec![] 
        },
        AutomationAction::Wait { milliseconds: 1000 },
        AutomationAction::Keyboard(KeyboardAction::Type { 
            text: "Hello!".to_string() 
        }),
    ],
    retry_count: 3,
    timeout_ms: 30000,
};

let result = controller.execute_sequence(sequence).await?;

// Navigate menus
controller.navigate_menu(&window_id, vec!["File".to_string(), "Save".to_string()]).await?;

// Handle dialogs
controller.handle_file_dialog("save", "/path/to/file.txt").await?;
controller.handle_dialog(&window_id, "OK").await?;
```

### Natural Language Processing

```rust
use ai_agent::nlp_parser::RegexNLPParser;
use ai_agent::NLPParser;

let parser = RegexNLPParser::new();

// Parse simple commands
let actions = parser.parse_command("open notepad")?;
let actions = parser.parse_command("click at 100, 200")?;
let actions = parser.parse_command("type 'hello world'")?;

// Parse complex multi-step commands
let actions = parser.parse_command(
    "open notepad and type 'hello' then wait 1000 and click at 500, 300"
)?;

// Extract intent and entities
let intent = parser.extract_intent("open notepad")?; // "launch_app"
let entities = parser.extract_entities("click at 100, 200")?; // {x: "100", y: "200"}
```

### Learning System

```rust
use ai_agent::learning_system::FileLearningSystem;
use ai_agent::LearningSystem;

let learning = FileLearningSystem::new(PathBuf::from("./profiles"));

// Record successful automation
learning.record_success("Notepad", sequence).await?;

// Record failure for improvement
learning.record_failure("Notepad", sequence, "Element not found".to_string()).await?;

// Get application profile
let profile = learning.get_app_profile("Notepad").await?;

// Suggest improvements
let improved_actions = learning.suggest_improvements(sequence).await?;

// Detect chatbox in application
let chatbox = learning.detect_chatbox(&window_id).await?;
```

### Configuration

```rust
use ai_agent::config::AgentConfig;

// Load configuration
let config = AgentConfig::load(&PathBuf::from("config.json"))?;

// Modify settings
let mut config = AgentConfig::default();
config.default_timeout_ms = 60000;
config.human_like_delays = true;
config.mouse_speed = 1500;
config.typing_speed = 15;

// Security settings
config.security.require_confirmation = true;
config.security.app_whitelist = vec!["notepad.exe".to_string()];
config.security.max_sequence_length = 50;

// Save configuration
config.save(&PathBuf::from("config.json"))?;
```

### Security

```rust
use ai_agent::security::SecurityManager;

let security = SecurityManager::new(true, 100);

// Whitelist/blacklist management
security.add_to_whitelist("notepad.exe".to_string());
security.add_to_blacklist("cmd.exe".to_string());

// Check if app is allowed
if security.is_app_allowed("notepad.exe") {
    // Proceed with automation
}

// Validate automation sequence
security.validate_sequence(&sequence)?;

// Audit logging
security.log_action(
    "launch_app".to_string(),
    Some("notepad.exe".to_string()),
    true,
    None
);

let audit_log = security.get_audit_log();
security.export_audit_log(&PathBuf::from("audit.json"))?;
```

## 🔧 Platform-Specific Implementation Details

### Windows
- Uses Win32 API for window management
- UI Automation COM interfaces for element detection
- SendInput for mouse/keyboard simulation
- Supports DPI awareness and multi-monitor setups

### macOS
- Uses Cocoa/AppKit for window management
- Accessibility API (AXUIElement) for element detection
- CGEvent for input simulation
- Supports Retina displays and Spaces

### Linux
- Uses X11/Wayland for window management
- AT-SPI for accessibility
- XTest/uinput for input simulation
- Supports multiple window managers and desktop environments

## 📦 Dependencies

```toml
[dependencies]
tauri = "2"
tokio = { version = "1", features = ["sync", "rt-multi-thread", "time", "process", "io-util"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
async-trait = "0.1"
thiserror = "1.0"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
parking_lot = "0.12"
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1.0", features = ["v4", "serde"] }
regex = "1.10"
rand = "0.8"
image = "0.24"
imageproc = "0.23"
rdev = "0.5"
enigo = "0.2"

[target.'cfg(windows)'.dependencies]
winapi = { version = "0.3", features = [...] }
windows = { version = "0.52", features = [...] }

[target.'cfg(target_os = "macos")'.dependencies]
cocoa = "0.25"
objc = "0.2"
core-foundation = "0.9"
core-graphics = "0.23"
accessibility = "0.2"

[target.'cfg(target_os = "linux")'.dependencies]
x11 = { version = "2.21", features = ["xlib", "xtest", "xrandr"] }
x11rb = { version = "0.13", features = ["all-extensions"] }
atspi = "0.19"
wayland-client = "0.31"
evdev = "0.12"
uinput = "0.1"
```

## 🎓 Usage Examples

### Example 1: Automated Form Filling

```rust
async fn fill_form() -> AgentResult<()> {
    let manager = CrossPlatformWindowManager::new();
    let detector = CrossPlatformUIDetector::new();
    let simulator = CrossPlatformInputSimulator::new();
    
    // Find application window
    let window = manager.get_window_by_title("Registration Form").await?;
    manager.focus_window(&window.id).await?;
    
    // Find and fill form fields
    let name_field = detector.find_element_by_name(&window.id, "Name").await?;
    detector.click_element(&name_field.id).await?;
    simulator.type_text_human("John Doe").await?;
    
    let email_field = detector.find_element_by_name(&window.id, "Email").await?;
    detector.click_element(&email_field.id).await?;
    simulator.type_text_human("john@example.com").await?;
    
    // Submit form
    let submit_button = detector.find_element_by_name(&window.id, "Submit").await?;
    detector.click_element(&submit_button.id).await?;
    
    Ok(())
}
```

### Example 2: Natural Language Automation

```rust
async fn execute_nlp_command(command: &str) -> AgentResult<()> {
    let parser = RegexNLPParser::new();
    let controller = CrossPlatformApplicationController::new();
    
    // Parse command
    let actions = parser.parse_command(command)?;
    
    // Create sequence
    let sequence = AutomationSequence {
        id: Uuid::new_v4(),
        name: "NLP Command".to_string(),
        description: Some(command.to_string()),
        actions,
        retry_count: 3,
        timeout_ms: 30000,
    };
    
    // Execute
    controller.execute_sequence(sequence).await?;
    
    Ok(())
}

// Usage:
execute_nlp_command("open notepad and type 'Hello World' then save as test.txt").await?;
```

### Example 3: Multi-Window Workflow

```rust
async fn multi_window_workflow() -> AgentResult<()> {
    let manager = CrossPlatformWindowManager::new();
    let simulator = CrossPlatformInputSimulator::new();
    
    // Get all windows
    let windows = manager.get_all_windows().await?;
    
    // Arrange windows side by side
    let displays = manager.get_displays().await?;
    let primary = &displays[0];
    
    let half_width = primary.work_area.width / 2;
    
    if windows.len() >= 2 {
        // Left window
        manager.set_window_bounds(&windows[0].id, WindowBounds {
            x: primary.work_area.x,
            y: primary.work_area.y,
            width: half_width,
            height: primary.work_area.height,
        }).await?;
        
        // Right window
        manager.set_window_bounds(&windows[1].id, WindowBounds {
            x: primary.work_area.x + half_width as i32,
            y: primary.work_area.y,
            width: half_width,
            height: primary.work_area.height,
        }).await?;
    }
    
    Ok(())
}
```

## 🔒 Security Considerations

1. **Permission Management**: Use whitelisting for production environments
2. **Audit Logging**: Enable audit logging for compliance
3. **User Confirmation**: Require confirmation for sensitive operations
4. **Sequence Validation**: Limit sequence length and validate actions
5. **Sandboxing**: Run automation in isolated environments when possible

## 🐛 Debugging

Enable detailed logging:

```rust
use tracing_subscriber;

tracing_subscriber::fmt()
    .with_env_filter("ai_agent=debug")
    .init();
```

## 📝 License

This AI Agent system is part of the Catog Automation project.

## 🤝 Contributing

Contributions are welcome! Areas for improvement:

- Complete macOS and Linux platform implementations
- Add more NLP patterns and intent recognition
- Add support for more UI frameworks
- Improve learning system with actual ML models
- Add browser automation integration
- Create visual automation recorder

## 📚 Additional Resources

- [Tauri Documentation](https://tauri.app/)
- [Windows UI Automation](https://docs.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32)
- [macOS Accessibility API](https://developer.apple.com/documentation/accessibility)
- [Linux AT-SPI](https://www.freedesktop.org/wiki/Accessibility/AT-SPI2/)
