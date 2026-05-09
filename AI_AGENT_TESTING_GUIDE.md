# AI Agent Tools Testing Guide

## Overview

This guide provides comprehensive testing procedures for the Catog Automation AI Agent tools across macOS, Linux, and Windows platforms.

## Current Implementation Status

### ✅ Windows (Fully Implemented)
- Window Management (get, resize, move, minimize, maximize, close, focus)
- Mouse Automation (move, click, double-click, drag, scroll)
- Keyboard Automation (type text, press keys, key combinations)
- Screen Operations (get size, get mouse position)
- Application Control (launch apps)
- NLP Command Parsing

### ⚠️ macOS (Stub Implementation)
- All functions return `PlatformNotSupported` errors
- Framework structure in place using Cocoa/AppKit APIs
- Requires implementation of NSAppleScript and AXUI bindings

### ⚠️ Linux (Stub Implementation)
- All functions return `PlatformNotSupported` errors
- Framework structure in place using X11/Wayland and AT-SPI
- Requires implementation of X11/Wayland protocols

## Available Tools by Category

### 1. Window Management Tools
| Tool | Windows | macOS | Linux | Description |
|------|---------|-------|-------|-------------|
| `agent_get_all_windows` | ✅ | ❌ | ❌ | Get all visible windows |
| `agent_get_window_by_title` | ✅ | ❌ | ❌ | Find window by title |
| `agent_get_active_window` | ✅ | ❌ | ❌ | Get currently focused window |
| `agent_resize_window` | ✅ | ❌ | ❌ | Resize window to dimensions |
| `agent_move_window` | ✅ | ❌ | ❌ | Move window to position |
| `agent_minimize_window` | ✅ | ❌ | ❌ | Minimize window |
| `agent_maximize_window` | ✅ | ❌ | ❌ | Maximize window |
| `agent_restore_window` | ✅ | ❌ | ❌ | Restore window |
| `agent_close_window` | ✅ | ❌ | ❌ | Close window |
| `agent_focus_window` | ✅ | ❌ | ❌ | Bring window to front |

### 2. Mouse Automation Tools
| Tool | Windows | macOS | Linux | Description |
|------|---------|-------|-------|-------------|
| `agent_move_mouse` | ✅ | ❌ | ❌ | Move mouse to coordinates |
| `agent_click_mouse` | ✅ | ❌ | ❌ | Click at current position |
| `agent_click_at` | ✅ | ❌ | ❌ | Click at specific coordinates |
| `agent_double_click` | ✅ | ❌ | ❌ | Double-click at position |
| `agent_drag_mouse` | ✅ | ❌ | ❌ | Drag from point A to B |
| `agent_scroll` | ✅ | ❌ | ❌ | Scroll mouse wheel |
| `agent_get_mouse_position` | ✅ | ❌ | ❌ | Get current mouse position |

### 3. Keyboard Automation Tools
| Tool | Windows | macOS | Linux | Description |
|------|---------|-------|-------|-------------|
| `agent_type_text` | ✅ | ❌ | ❌ | Type text with delays |
| `agent_press_key` | ✅ | ❌ | ❌ | Press single key |
| `agent_press_key_combo` | ✅ | ❌ | ❌ | Press key combination |

### 4. Application Control Tools
| Tool | Windows | macOS | Linux | Description |
|------|---------|-------|-------|-------------|
| `agent_launch_app` | ✅ | ❌ | ❌ | Launch application by path |
| `get_installed_applications` | ✅ | ✅ | ✅ | List installed apps |
| `get_running_programs` | ✅ | ✅ | ✅ | List running programs |
| `launch_application` | ✅ | ✅ | ✅ | Launch app (cross-platform) |

### 5. Screen & System Tools
| Tool | Windows | macOS | Linux | Description |
|------|---------|-------|-------|-------------|
| `agent_get_screen_size` | ✅ | ❌ | ❌ | Get screen dimensions |
| `get_screen_size` | ✅ | ✅ | ✅ | Get screen size (cross-platform) |
| `get_active_window_bounds` | ✅ | ✅ | ✅ | Get active window bounds |
| `get_active_window_edges` | ✅ | ✅ | ✅ | Get window edge coordinates |

### 6. Advanced Automation Tools
| Tool | Windows | macOS | Linux | Description |
|------|---------|-------|-------|-------------|
| `agent_execute_sequence` | ✅ | ❌ | ❌ | Execute automation sequence |
| `agent_parse_command` | ✅ | ✅ | ✅ | Parse natural language command |
| `agent_execute_nlp_command` | ✅ | ✅ | ✅ | Execute NLP command |
| `window_control_action` | ✅ | ✅ | ✅ | Window control actions |
| `click_at` | ✅ | ✅ | ✅ | Click at coordinates |
| `type_text` | ✅ | ✅ | ✅ | Type text |
| `press_key_combo` | ✅ | ✅ | ✅ | Press key combination |
| `long_press_at` | ✅ | ✅ | ✅ | Long press at position |
| `scroll_at` | ✅ | ✅ | ✅ | Scroll at position |
| `drag` | ✅ | ✅ | ✅ | Drag operation |
| `save_file` | ✅ | ✅ | ✅ | Save file to disk |

## Testing Procedures

### Windows Testing (Full Functionality)

#### Test 1: Window Management
```typescript
// Get all windows
const windows = await invoke('agent_get_all_windows');
console.log('All windows:', windows);

// Find Notepad window
const notepad = await invoke('agent_get_window_by_title', { title: 'Notepad' });
console.log('Notepad window:', notepad);

// Get active window
const active = await invoke('agent_get_active_window');
console.log('Active window:', active);

// Resize window
await invoke('agent_resize_window', { 
  windowId: notepad.id, 
  width: 800, 
  height: 600 
});

// Move window
await invoke('agent_move_window', { 
  windowId: notepad.id, 
  x: 100, 
  y: 100 
});

// Minimize, maximize, restore
await invoke('agent_minimize_window', { windowId: notepad.id });
await new Promise(r => setTimeout(r, 1000));
await invoke('agent_restore_window', { windowId: notepad.id });
await invoke('agent_maximize_window', { windowId: notepad.id });

// Focus window
await invoke('agent_focus_window', { windowId: notepad.id });
```

#### Test 2: Mouse Automation
```typescript
// Get current mouse position
const pos = await invoke('agent_get_mouse_position');
console.log('Mouse position:', pos);

// Move mouse
await invoke('agent_move_mouse', { x: 500, y: 300 });

// Click at position
await invoke('agent_click_at', { x: 500, y: 300, button: 'left' });

// Double click
await invoke('agent_double_click');

// Drag operation
await invoke('agent_drag_mouse', { 
  fromX: 100, 
  fromY: 100, 
  toX: 500, 
  toY: 500 
});

// Scroll
await invoke('agent_scroll', { amount: 5 }); // Scroll up
await invoke('agent_scroll', { amount: -5 }); // Scroll down
```

#### Test 3: Keyboard Automation
```typescript
// Type text
await invoke('agent_type_text', { 
  text: 'Hello World!', 
  delayMs: 50 
});

// Press single key
await invoke('agent_press_key', { key: 'enter' });

// Press key combination
await invoke('agent_press_key_combo', { 
  modifiers: ['ctrl'], 
  key: 'c' 
}); // Ctrl+C

await invoke('agent_press_key_combo', { 
  modifiers: ['ctrl', 'shift'], 
  key: 's' 
}); // Ctrl+Shift+S
```

#### Test 4: Application Control
```typescript
// Launch application
const pid = await invoke('agent_launch_app', { 
  path: 'notepad.exe' 
});
console.log('Launched app with PID:', pid);

// Get screen size
const screenSize = await invoke('agent_get_screen_size');
console.log('Screen size:', screenSize);
```

#### Test 5: Automation Sequence
```typescript
// Create and execute automation sequence
const sequence = {
  name: 'Test Sequence',
  description: 'Test automation sequence',
  steps: [
    { stepType: 'window', windowAction: { action: 'focus', title: 'Notepad' } },
    { stepType: 'wait', waitMs: 500 },
    { stepType: 'keyboard', keyboardAction: { action: 'type', text: 'Test' } },
    { stepType: 'keyboard', keyboardAction: { action: 'pressCombo', modifiers: ['ctrl'], key: 's' } }
  ]
};

const result = await invoke('agent_execute_sequence', { sequence });
console.log('Sequence result:', result);
```

#### Test 6: NLP Commands
```typescript
// Parse natural language command
const nlpCommand = await invoke('agent_parse_command', { 
  command: 'open notepad and type hello world' 
});
console.log('Parsed command:', nlpCommand);

// Execute NLP command
const result = await invoke('agent_execute_nlp_command', { 
  nlpCommand 
});
console.log('Execution result:', result);
```

### macOS Testing (Limited Functionality)

#### Test 1: Cross-Platform Tools (Working)
```typescript
// Get installed applications
const apps = await invoke('get_installed_applications');
console.log('Installed apps:', apps);

// Get running programs
const running = await invoke('get_running_programs');
console.log('Running programs:', running);

// Launch application
await invoke('launch_application', { name: 'TextEdit' });

// Get screen size
const screenSize = await invoke('get_screen_size');
console.log('Screen size:', screenSize);

// Get active window bounds
const bounds = await invoke('get_active_window_bounds');
console.log('Window bounds:', bounds);

// Window control actions
await invoke('window_control_action', { 
  action: 'minimize' 
});
```

#### Test 2: Platform-Specific Tools (Not Implemented)
```typescript
// These will return "PlatformNotSupported" errors
try {
  await invoke('agent_get_all_windows');
} catch (error) {
  console.log('Expected error:', error);
  // Error: "macOS window enumeration not fully implemented"
}

try {
  await invoke('agent_move_mouse', { x: 100, y: 100 });
} catch (error) {
  console.log('Expected error:', error);
  // Error: "macOS mouse action not fully implemented"
}
```

### Linux Testing (Limited Functionality)

#### Test 1: Cross-Platform Tools (Working)
```typescript
// Same as macOS cross-platform tools
const apps = await invoke('get_installed_applications');
const running = await invoke('get_running_programs');
await invoke('launch_application', { name: 'gedit' });
const screenSize = await invoke('get_screen_size');
```

#### Test 2: Platform-Specific Tools (Not Implemented)
```typescript
// These will return "PlatformNotSupported" errors
try {
  await invoke('agent_get_all_windows');
} catch (error) {
  console.log('Expected error:', error);
  // Error: "Linux window enumeration not fully implemented"
}
```

## Expected Results

### Windows
- ✅ All window management operations should work
- ✅ Mouse movements should be smooth and accurate
- ✅ Keyboard input should be properly simulated
- ✅ Applications should launch successfully
- ✅ NLP commands should parse and execute correctly

### macOS
- ✅ Cross-platform tools (get_installed_applications, etc.) should work
- ❌ Platform-specific tools should return "PlatformNotSupported" errors
- ⚠️ Error messages should indicate which API needs implementation

### Linux
- ✅ Cross-platform tools should work
- ❌ Platform-specific tools should return "PlatformNotSupported" errors
- ⚠️ Error messages should indicate which API needs implementation

## Running the Tests

### Prerequisites
```bash
cd MainSoftware/catog-automation
npm install
```

### Development Mode
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

### Platform-Specific Notes

#### Windows
- Requires Windows 10 or later
- Some operations may require administrator privileges
- DPI scaling may affect coordinate calculations

#### macOS
- Requires macOS 10.15 or later
- Accessibility permissions required for automation
- Grant permissions in System Preferences > Security & Privacy > Privacy > Accessibility

#### Linux
- Requires X11 or Wayland display server
- May need additional packages: `xdotool`, `wmctrl`, `at-spi2-core`
- Install on Ubuntu/Debian: `sudo apt-get install xdotool wmctrl at-spi2-core`

## Implementation Status Summary

### Fully Implemented (Windows Only)
1. Window Manager - Complete window control and enumeration
2. Input Simulator - Mouse and keyboard automation
3. Application Controller - App launching and control
4. NLP Parser - Natural language command parsing

### Partially Implemented (All Platforms)
1. Desktop Automation - Basic cross-platform operations
2. Screen Operations - Screen size and region reading
3. File Operations - Save file functionality

### Not Implemented (macOS & Linux)
1. Platform-specific window management
2. Platform-specific input simulation
3. Platform-specific UI detection
4. Platform-specific application control

## Next Steps for Full Platform Support

### macOS Implementation Needed
1. Implement CGWindowListCopyWindowInfo for window enumeration
2. Implement CGEvent APIs for mouse/keyboard simulation
3. Implement AXUIElement APIs for UI detection
4. Implement NSWorkspace APIs for app control

### Linux Implementation Needed
1. Implement X11/Wayland window management
2. Implement XTest extension for input simulation
3. Implement AT-SPI for UI detection
4. Implement desktop entry launching for app control

## Troubleshooting

### Windows Issues
- **Mouse clicks missing target**: Check DPI scaling settings
- **Keyboard input not working**: Ensure target window has focus
- **Window not found**: Verify exact window title (case-sensitive)

### macOS Issues
- **Permission denied**: Grant Accessibility permissions
- **Tools not working**: Most tools not yet implemented

### Linux Issues
- **Display server issues**: Ensure X11 or Wayland is running
- **Missing dependencies**: Install required packages
- **Tools not working**: Most tools not yet implemented

## Support

For issues or questions:
1. Check this testing guide
2. Review AUTOMATION_AGENT_README.md
3. Check platform-specific implementation files:
   - `src-tauri/src/ai_agent/platform_windows.rs`
   - `src-tauri/src/ai_agent/platform_macos.rs`
   - `src-tauri/src/ai_agent/platform_linux.rs`

## License

Part of the Catog Automation project.
