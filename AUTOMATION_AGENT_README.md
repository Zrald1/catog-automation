# Windows AI Agent System Documentation

## Overview

The Windows AI Agent System is a comprehensive Rust-based automation framework for Tauri applications that provides complete programmatic control and interaction with any Windows application. This system enables AI agents to interact with Windows applications through natural language commands or programmatic APIs.

## Features

### 1. Window Management
- **Retrieve Window Information**: Get exact measurements, position, and state of any window
- **Window Control**: Minimize, maximize, restore, close, focus windows
- **Window Manipulation**: Resize and move windows to specific dimensions and positions
- **Multi-Monitor Support**: Handle window positioning across multiple displays
- **Window State Detection**: Detect if windows are focused, minimized, maximized, or fullscreen

### 2. Mouse Automation
- **Precise Mouse Control**: Move mouse to any coordinate with pixel-perfect accuracy
- **Click Operations**: Left, right, middle, and double clicks
- **Drag and Drop**: Smooth drag operations between coordinates
- **Scroll Control**: Programmatic mouse wheel scrolling
- **Position Tracking**: Get current mouse position

### 3. Keyboard Automation
- **Text Input**: Type text with configurable delays for human-like behavior
- **Key Presses**: Simulate any keyboard key press
- **Key Combinations**: Execute complex key combinations (Ctrl+C, Alt+Tab, etc.)
- **Special Keys**: Support for function keys, arrow keys, and modifier keys

### 4. Application Interaction
- **Launch Applications**: Start applications by executable path
- **Window Focus**: Bring applications to foreground
- **Automation Sequences**: Execute multi-step automation workflows
- **Error Handling**: Robust error handling for failed operations

### 5. Natural Language Processing
- **Command Parsing**: Parse natural language commands into actionable intents
- **Entity Extraction**: Extract application names, text, and parameters from commands
- **Intent Recognition**: Identify user intentions (launch, type, click, close, etc.)
- **Direct Execution**: Execute commands from natural language input

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (TypeScript)                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │         WindowsAgent API (windows-agent.ts)            │ │
│  │  - Type-safe interfaces                                │ │
│  │  - High-level helper methods                           │ │
│  │  - Automation sequence builder                         │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↕ Tauri IPC
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Rust)                            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │      Windows Agent Module (windows_agent.rs)           │ │
│  │  - Windows API bindings                                │ │
│  │  - Window management functions                         │ │
│  │  - Mouse/keyboard automation                           │ │
│  │  - NLP command processing                              │ │
│  │  - Tauri command handlers                              │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    Windows API Layer                         │
│  - user32.dll (Window management, input simulation)         │
│  - UI Automation API (Element detection)                    │
│  - Win32 API (Process control)                              │
└─────────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites
- Windows 10 or later
- Rust 1.70+
- Node.js 18+
- Tauri CLI

### Setup

1. **Add Dependencies** (already configured in `Cargo.toml`):
```toml
[target.'cfg(windows)'.dependencies]
winapi = { version = "0.3", features = ["winuser", "processthreadsapi", "handleapi", "synchapi"] }
```

2. **Import the Module** in your Rust code:
```rust
mod windows_agent;
use windows_agent::*;
```

3. **Register Tauri Commands** (already done in `lib.rs`):
```rust
.invoke_handler(tauri::generate_handler![
    agent_get_window_by_title,
    agent_get_active_window,
    // ... all other commands
])
```

4. **Import TypeScript Module** in your frontend:
```typescript
import WindowsAgent from './windows-agent';
```

## Usage Examples

### Example 1: Basic Window Management

```typescript
import WindowsAgent from './windows-agent';

// Get all windows
const windows = await WindowsAgent.getAllWindows();
console.log('All windows:', windows);

// Find and focus Notepad
const notepad = await WindowsAgent.getWindowByTitle('Notepad');
await WindowsAgent.focusWindow(notepad.hwnd);

// Resize and position
await WindowsAgent.resizeWindow(notepad.hwnd, 800, 600);
await WindowsAgent.moveWindow(notepad.hwnd, 100, 100);

// Maximize
await WindowsAgent.maximizeWindow(notepad.hwnd);
```

### Example 2: Mouse Automation

```typescript
// Move mouse to coordinates
await WindowsAgent.moveMouse(500, 300);

// Click at specific position
await WindowsAgent.clickAt(500, 300, 'left');

// Double click
await WindowsAgent.doubleClick();

// Drag and drop
await WindowsAgent.dragMouse(100, 100, 500, 500);

// Scroll
await WindowsAgent.scroll(5); // Scroll up
await WindowsAgent.scroll(-5); // Scroll down
```

### Example 3: Keyboard Automation

```typescript
// Type text with delay
await WindowsAgent.typeText('Hello World!', 30);

// Press single key
await WindowsAgent.pressKey('enter');

// Press key combination
await WindowsAgent.pressKeyCombo(['ctrl'], 'c'); // Ctrl+C
await WindowsAgent.pressKeyCombo(['ctrl', 'shift'], 's'); // Ctrl+Shift+S
```

### Example 4: Natural Language Commands

```typescript
// Parse and execute natural language command
await WindowsAgent.executeCommand('open notepad and type hello world');

// Parse command to see intent
const nlpCommand = await WindowsAgent.parseCommand('close notepad');
console.log('Intent:', nlpCommand.intent);
console.log('Entities:', nlpCommand.entities);

// Execute parsed command
await WindowsAgent.executeNLPCommand(nlpCommand);
```

### Example 5: Automation Sequences

```typescript
// Create a complex automation sequence
const sequence = WindowsAgent.createSequence(
  'Fill Form',
  'Fills out a form in an application'
)
  .focusWindow('Form Application')
  .wait(500)
  .clickAt(200, 150) // Click first field
  .type('John Doe')
  .pressKey('tab')
  .type('john@example.com')
  .pressKey('tab')
  .type('555-1234')
  .wait(200)
  .clickAt(300, 400) // Click submit button
  .build();

// Execute the sequence
const result = await WindowsAgent.executeSequence(sequence);
console.log('Result:', result);

// Or use the builder's execute method
await WindowsAgent.createSequence('Quick Test', 'Test sequence')
  .focusWindow('Notepad')
  .type('Test message')
  .pressCombo(['ctrl'], 's')
  .execute();
```

### Example 6: Application Workflow

```typescript
// Launch application and interact
async function automateNotepad() {
  // Launch Notepad
  const pid = await WindowsAgent.launchApp('notepad.exe');
  
  // Wait for it to open
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Find the window
  const window = await WindowsAgent.getWindowByTitle('Untitled - Notepad');
  
  // Focus it
  await WindowsAgent.focusWindow(window.hwnd);
  
  // Type content
  await WindowsAgent.typeText('This is automated content!\n\nGenerated by Windows Agent.');
  
  // Save file (Ctrl+S)
  await WindowsAgent.pressKeyCombo(['ctrl'], 's');
  
  // Wait for save dialog
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Type filename
  await WindowsAgent.typeText('automated-file.txt');
  
  // Press Enter to save
  await WindowsAgent.pressKey('enter');
}
```

### Example 7: Multi-Window Management

```typescript
// Arrange multiple windows in a grid
async function arrangeWindows() {
  const windows = await WindowsAgent.getAllWindows();
  const screenSize = await WindowsAgent.getScreenSize();
  
  const [screenWidth, screenHeight] = screenSize;
  const windowWidth = Math.floor(screenWidth / 2);
  const windowHeight = Math.floor(screenHeight / 2);
  
  // Arrange first 4 windows in a 2x2 grid
  for (let i = 0; i < Math.min(4, windows.length); i++) {
    const row = Math.floor(i / 2);
    const col = i % 2;
    
    await WindowsAgent.resizeWindow(
      windows[i].hwnd,
      windowWidth,
      windowHeight
    );
    
    await WindowsAgent.moveWindow(
      windows[i].hwnd,
      col * windowWidth,
      row * windowHeight
    );
  }
}
```

## API Reference

### Window Management

#### `getWindowByTitle(title: string): Promise<WindowInfo>`
Get window information by title.

#### `getActiveWindow(): Promise<WindowInfo>`
Get the currently active window.

#### `getAllWindows(): Promise<WindowInfo[]>`
Get all visible windows.

#### `resizeWindow(hwnd: number, width: number, height: number): Promise<void>`
Resize a window to specific dimensions.

#### `moveWindow(hwnd: number, x: number, y: number): Promise<void>`
Move a window to specific coordinates.

#### `minimizeWindow(hwnd: number): Promise<void>`
Minimize a window.

#### `maximizeWindow(hwnd: number): Promise<void>`
Maximize a window.

#### `restoreWindow(hwnd: number): Promise<void>`
Restore a window to normal state.

#### `closeWindow(hwnd: number): Promise<void>`
Close a window.

#### `focusWindow(hwnd: number): Promise<void>`
Bring a window to foreground and set focus.

### Mouse Automation

#### `moveMouse(x: number, y: number): Promise<void>`
Move mouse to specific coordinates.

#### `getMousePosition(): Promise<[number, number]>`
Get current mouse position.

#### `clickMouse(button: 'left' | 'right' | 'middle'): Promise<void>`
Click mouse button at current position.

#### `clickAt(x: number, y: number, button: 'left' | 'right' | 'middle'): Promise<void>`
Click at specific coordinates.

#### `doubleClick(): Promise<void>`
Double click at current position.

#### `dragMouse(fromX: number, fromY: number, toX: number, toY: number): Promise<void>`
Drag mouse from one position to another.

#### `scroll(amount: number): Promise<void>`
Scroll mouse wheel (positive = up, negative = down).

### Keyboard Automation

#### `typeText(text: string, delayMs?: number): Promise<void>`
Type text with optional delay between characters.

#### `pressKey(key: string): Promise<void>`
Press a single key.

#### `pressKeyCombo(modifiers: string[], key: string): Promise<void>`
Press a key combination.

**Supported Keys:**
- Modifiers: `ctrl`, `alt`, `shift`, `win`
- Special: `enter`, `tab`, `esc`, `space`, `backspace`, `delete`
- Navigation: `home`, `end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right`
- Function: `f1` through `f12`
- Alphanumeric: `a-z`, `0-9`

### Application Interaction

#### `launchApp(path: string): Promise<number>`
Launch an application by path. Returns process ID.

#### `executeSequence(sequence: AutomationSequence): Promise<string>`
Execute an automation sequence.

### Natural Language Processing

#### `parseCommand(command: string): Promise<NLPCommand>`
Parse a natural language command.

#### `executeNLPCommand(nlpCommand: NLPCommand): Promise<string>`
Execute a parsed NLP command.

#### `executeCommand(command: string): Promise<string>`
Parse and execute a natural language command in one step.

**Supported Intents:**
- `launch_app`: Open/launch/start an application
- `type_text`: Type/write/enter text
- `click`: Click on elements
- `close_window`: Close windows
- `minimize_window`: Minimize windows
- `maximize_window`: Maximize windows

## Data Structures

### WindowInfo
```typescript
interface WindowInfo {
  hwnd: number;           // Window handle
  title: string;          // Window title
  pid: number;            // Process ID
  x: number;              // X position
  y: number;              // Y position
  width: number;          // Window width
  height: number;         // Window height
  isVisible: boolean;     // Visibility state
  isMinimized: boolean;   // Minimized state
  isMaximized: boolean;   // Maximized state
  monitorIndex: number;   // Monitor index
}
```

### AutomationSequence
```typescript
interface AutomationSequence {
  name: string;
  description: string;
  steps: AutomationStep[];
}

interface AutomationStep {
  stepType: 'mouse' | 'keyboard' | 'window' | 'wait' | 'condition';
  mouseAction?: MouseAction;
  keyboardAction?: KeyboardAction;
  windowAction?: WindowAction;
  waitMs?: number;
  condition?: string;
}
```

## Best Practices

### 1. Error Handling
Always wrap automation calls in try-catch blocks:

```typescript
try {
  await WindowsAgent.clickAt(100, 100);
} catch (error) {
  console.error('Automation failed:', error);
}
```

### 2. Timing and Delays
Add appropriate delays between actions:

```typescript
await WindowsAgent.clickAt(100, 100);
await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
await WindowsAgent.typeText('Hello');
```

### 3. Window Verification
Verify window exists before interacting:

```typescript
try {
  const window = await WindowsAgent.getWindowByTitle('MyApp');
  await WindowsAgent.focusWindow(window.hwnd);
} catch (error) {
  console.error('Window not found');
}
```

### 4. Sequence Building
Use the sequence builder for complex workflows:

```typescript
const sequence = WindowsAgent.createSequence('name', 'description')
  .focusWindow('App')
  .wait(500)
  .clickAt(100, 100)
  .wait(200)
  .type('text')
  .build();
```

### 5. Natural Language
Keep NLP commands simple and clear:

```typescript
// Good
await WindowsAgent.executeCommand('open notepad');
await WindowsAgent.executeCommand('type hello world');

// Less reliable
await WindowsAgent.executeCommand('could you please open notepad if possible');
```

## Limitations

1. **Windows Only**: This system only works on Windows operating systems
2. **Elevated Permissions**: Some applications may require elevated permissions
3. **DPI Awareness**: Coordinate calculations may need adjustment for high-DPI displays
4. **UI Automation**: Full UI element detection requires additional Windows UI Automation API integration
5. **Application-Specific**: Some applications may have custom controls that require special handling

## Security Considerations

1. **Input Validation**: Always validate user input before executing automation
2. **Permission Checks**: Verify user has permission to automate target applications
3. **Sandboxing**: Consider sandboxing automation execution
4. **Audit Logging**: Log all automation actions for security auditing
5. **Rate Limiting**: Implement rate limiting to prevent abuse

## Troubleshooting

### Issue: Commands not working
- Ensure application is running on Windows
- Check if target window exists
- Verify window is not minimized or hidden
- Add delays between actions

### Issue: Mouse clicks missing target
- Verify coordinates are correct
- Check DPI scaling settings
- Ensure window is focused
- Add small delay before clicking

### Issue: Keyboard input not working
- Verify target window has focus
- Check if application accepts keyboard input
- Try adding delays between keystrokes
- Ensure correct key names are used

### Issue: Window not found
- Check exact window title (case-sensitive)
- Verify application is running
- Try using partial title match
- Check if window is on different monitor

## Future Enhancements

1. **Full UI Automation API Integration**: Complete element detection and interaction
2. **Image Recognition**: Find UI elements by image matching
3. **Recording Mode**: Record user actions and generate automation scripts
4. **Advanced NLP**: More sophisticated natural language understanding
5. **Accessibility API**: Better support for accessible applications
6. **Multi-Application Workflows**: Coordinate actions across multiple applications
8. **Conditional Logic**: Add if/else logic to automation sequences
9. **Loop Support**: Repeat actions with loop constructs
10. **Error Recovery**: Automatic retry and recovery mechanisms

## Contributing

When contributing to the Windows Agent system:

1. Follow Rust coding standards
2. Add comprehensive error handling
3. Include TypeScript type definitions
4. Write documentation for new features
5. Add usage examples
6. Test on multiple Windows versions
7. Consider DPI scaling and multi-monitor setups

## License

This system is part of the Catog Automation project.

## Support

For issues, questions, or contributions, please refer to the main project repository.
