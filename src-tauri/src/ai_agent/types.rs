//! Core data structures for the AI Agent system

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Represents a window in the system
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    /// Unique window identifier (platform-specific handle)
    pub id: String,
    /// Window title
    pub title: String,
    /// Process ID owning the window
    pub pid: u32,
    /// Application name
    pub app_name: String,
    /// Window position and size
    pub bounds: WindowBounds,
    /// Current window state
    pub state: WindowState,
    /// Display/monitor index
    pub display_index: usize,
    /// DPI scale factor
    pub scale_factor: f64,
}

/// Window position and dimensions
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Window state flags
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub focused: bool,
    pub minimized: bool,
    pub maximized: bool,
    pub fullscreen: bool,
    pub hidden: bool,
    pub always_on_top: bool,
}

/// Display/monitor information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub index: usize,
    pub name: String,
    pub bounds: WindowBounds,
    pub work_area: WindowBounds,
    pub scale_factor: f64,
    pub is_primary: bool,
}

/// UI element detected in an application
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UIElement {
    /// Unique element identifier
    pub id: String,
    /// Element role/type (button, textbox, etc.)
    pub role: UIElementRole,
    /// Element name/label
    pub name: String,
    /// Element value (for inputs)
    pub value: Option<String>,
    /// Element description
    pub description: Option<String>,
    /// Bounding rectangle
    pub bounds: WindowBounds,
    /// Element state
    pub state: UIElementState,
    /// Parent element ID
    pub parent_id: Option<String>,
    /// Child element IDs
    pub children: Vec<String>,
    /// Keyboard shortcut
    pub shortcut: Option<String>,
    /// Additional properties
    pub properties: HashMap<String, String>,
}

/// UI element role/type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UIElementRole {
    Button,
    TextBox,
    TextArea,
    Dropdown,
    ComboBox,
    Menu,
    MenuItem,
    ContextMenu,
    Ribbon,
    Toolbar,
    StatusBar,
    TreeView,
    ListView,
    Table,
    Tab,
    TabPanel,
    Slider,
    Checkbox,
    RadioButton,
    Link,
    Image,
    Label,
    Window,
    Dialog,
    Custom(String),
}

/// UI element state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UIElementState {
    pub enabled: bool,
    pub visible: bool,
    pub focused: bool,
    pub selected: bool,
    pub checked: Option<bool>,
    pub expanded: Option<bool>,
}

/// Mouse button types
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

/// Mouse action types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MouseAction {
    Move { x: i32, y: i32 },
    Click { button: MouseButton },
    DoubleClick { button: MouseButton },
    TripleClick { button: MouseButton },
    Press { button: MouseButton },
    Release { button: MouseButton },
    Drag { from_x: i32, from_y: i32, to_x: i32, to_y: i32 },
    Scroll { amount: i32 },
}

/// Keyboard key representation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Key {
    Character(char),
    Enter,
    Tab,
    Escape,
    Backspace,
    Delete,
    Space,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Home,
    End,
    PageUp,
    PageDown,
    Function(u8), // F1-F24
    Control,
    Alt,
    Shift,
    Super, // Windows/Command key
    CapsLock,
    NumLock,
    ScrollLock,
}

/// Keyboard action
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyboardAction {
    Type { text: String },
    Press { key: Key },
    Release { key: Key },
    Combo { modifiers: Vec<Key>, key: Key },
}

/// Automation action
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutomationAction {
    Mouse(MouseAction),
    Keyboard(KeyboardAction),
    Wait { milliseconds: u64 },
    LaunchApp { path: String, args: Vec<String> },
    FocusWindow { window_id: String },
    CloseWindow { window_id: String },
    ResizeWindow { window_id: String, bounds: WindowBounds },
    MoveWindow { window_id: String, x: i32, y: i32 },
    MinimizeWindow { window_id: String },
    MaximizeWindow { window_id: String },
    RestoreWindow { window_id: String },
    ClickElement { element_id: String },
    TypeIntoElement { element_id: String, text: String },
    ReadElement { element_id: String },
    Screenshot { path: String, region: Option<WindowBounds> },
}

/// Automation sequence
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSequence {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub actions: Vec<AutomationAction>,
    pub retry_count: u32,
    pub timeout_ms: u64,
}

/// NLP command parsed from natural language
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NLPCommand {
    pub intent: String,
    pub target_app: Option<String>,
    pub actions: Vec<AutomationAction>,
    pub parameters: HashMap<String, String>,
    pub confidence: f64,
}

/// Application profile for learning system
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationProfile {
    pub app_name: String,
    pub bundle_id: Option<String>,
    pub executable_path: Option<String>,
    pub ui_elements: Vec<UIElement>,
    pub common_actions: Vec<AutomationSequence>,
    pub chatbox_patterns: Vec<String>,
    pub success_rate: f64,
    pub last_updated: chrono::DateTime<chrono::Utc>,
}

/// Automation execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationResult {
    pub success: bool,
    pub message: String,
    pub data: Option<serde_json::Value>,
    pub execution_time_ms: u64,
}

/// Bezier curve for smooth mouse movement
#[derive(Debug, Clone, Copy)]
pub struct BezierCurve {
    pub p0: (f64, f64),
    pub p1: (f64, f64),
    pub p2: (f64, f64),
    pub p3: (f64, f64),
}

impl BezierCurve {
    /// Calculate point on curve at t (0.0 to 1.0)
    pub fn point_at(&self, t: f64) -> (f64, f64) {
        let t2 = t * t;
        let t3 = t2 * t;
        let mt = 1.0 - t;
        let mt2 = mt * mt;
        let mt3 = mt2 * mt;

        let x = mt3 * self.p0.0 + 3.0 * mt2 * t * self.p1.0 + 3.0 * mt * t2 * self.p2.0 + t3 * self.p3.0;
        let y = mt3 * self.p0.1 + 3.0 * mt2 * t * self.p1.1 + 3.0 * mt * t2 * self.p2.1 + t3 * self.p3.1;

        (x, y)
    }
}

// Made with Bob
