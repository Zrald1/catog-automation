# Windows AI Agent - Quick Start Guide

## Installation

1. **Dependencies are already configured** in `Cargo.toml`
2. **Module is already registered** in `lib.rs`
3. **Ready to use** - just import and start automating!

## Quick Examples

### 1. Simple Window Control (5 lines)

```typescript
import WindowsAgent from './windows-agent';

const notepad = await WindowsAgent.getWindowByTitle('Notepad');
await WindowsAgent.focusWindow(notepad.hwnd);
await WindowsAgent.resizeWindow(notepad.hwnd, 800, 600);
```

### 2. Natural Language Command (1 line)

```typescript
await WindowsAgent.executeCommand('open notepad and type hello world');
```

### 3. Mouse Automation (3 lines)

```typescript
await WindowsAgent.moveMouse(500, 300);
await WindowsAgent.clickMouse('left');
await WindowsAgent.typeText('Hello!');
```

### 4. Automation Sequence (Fluent API)

```typescript
await WindowsAgent.createSequence('Demo', 'Quick demo')
  .focusWindow('Notepad')
  .wait(500)
  .type('Automated text!')
  .pressCombo(['ctrl'], 's')
  .execute();
```

## Common Use Cases

### Open App and Type

```typescript
await WindowsAgent.launchApp('notepad.exe');
await new Promise(r => setTimeout(r, 1000));
await WindowsAgent.typeText('Your text here');
```

### Fill Form

```typescript
await WindowsAgent.clickAt(200, 150); // First field
await WindowsAgent.typeText('John Doe');
await WindowsAgent.pressKey('tab');
await WindowsAgent.typeText('john@example.com');
await WindowsAgent.pressKey('tab');
await WindowsAgent.typeText('555-1234');
```

### Save File

```typescript
await WindowsAgent.pressKeyCombo(['ctrl'], 's');
await new Promise(r => setTimeout(r, 500));
await WindowsAgent.typeText('filename.txt');
await WindowsAgent.pressKey('enter');
```

### Copy/Paste

```typescript
// Select all and copy
await WindowsAgent.pressKeyCombo(['ctrl'], 'a');
await WindowsAgent.pressKeyCombo(['ctrl'], 'c');

// Switch window and paste
await WindowsAgent.focusWindow(targetWindow.hwnd);
await WindowsAgent.pressKeyCombo(['ctrl'], 'v');
```

### Arrange Windows

```typescript
const windows = await WindowsAgent.getAllWindows();
await WindowsAgent.moveWindow(windows[0].hwnd, 0, 0);
await WindowsAgent.resizeWindow(windows[0].hwnd, 960, 1080);
await WindowsAgent.moveWindow(windows[1].hwnd, 960, 0);
await WindowsAgent.resizeWindow(windows[1].hwnd, 960, 1080);
```

## Key Shortcuts Reference

```typescript
// Common shortcuts
await WindowsAgent.pressKeyCombo(['ctrl'], 'c');      // Copy
await WindowsAgent.pressKeyCombo(['ctrl'], 'v');      // Paste
await WindowsAgent.pressKeyCombo(['ctrl'], 'x');      // Cut
await WindowsAgent.pressKeyCombo(['ctrl'], 'z');      // Undo
await WindowsAgent.pressKeyCombo(['ctrl'], 's');      // Save
await WindowsAgent.pressKeyCombo(['ctrl'], 'f');      // Find
await WindowsAgent.pressKeyCombo(['alt'], 'tab');     // Switch window
await WindowsAgent.pressKeyCombo(['alt'], 'f4');      // Close window
await WindowsAgent.pressKeyCombo(['win'], 'd');       // Show desktop
```

## Supported Keys

**Modifiers:** `ctrl`, `alt`, `shift`, `win`

**Special Keys:** `enter`, `tab`, `esc`, `space`, `backspace`, `delete`, `home`, `end`, `pageup`, `pagedown`

**Arrow Keys:** `up`, `down`, `left`, `right`

**Function Keys:** `f1`, `f2`, `f3`, ... `f12`

**Alphanumeric:** `a-z`, `0-9`

## Natural Language Commands

```typescript
// Launch applications
await WindowsAgent.executeCommand('open notepad');
await WindowsAgent.executeCommand('launch chrome');
await WindowsAgent.executeCommand('start calculator');

// Type text
await WindowsAgent.executeCommand('type hello world');
await WindowsAgent.executeCommand('write this is a test');

// Window control
await WindowsAgent.executeCommand('close notepad');
await WindowsAgent.executeCommand('minimize chrome');
await WindowsAgent.executeCommand('maximize calculator');
```

## Best Practices

### 1. Always Add Delays
```typescript
await WindowsAgent.clickAt(100, 100);
await new Promise(r => setTimeout(r, 500)); // Wait for UI to respond
await WindowsAgent.typeText('text');
```

### 2. Error Handling
```typescript
try {
  await WindowsAgent.getWindowByTitle('MyApp');
} catch (error) {
  console.error('Window not found:', error);
}
```

### 3. Verify Before Acting
```typescript
const windows = await WindowsAgent.getAllWindows();
const target = windows.find(w => w.title.includes('MyApp'));
if (target) {
  await WindowsAgent.focusWindow(target.hwnd);
}
```

### 4. Use Sequences for Complex Tasks
```typescript
const sequence = WindowsAgent.createSequence('name', 'desc')
  .focusWindow('App')
  .wait(500)
  .clickAt(100, 100)
  .type('text')
  .build();

await WindowsAgent.executeSequence(sequence);
```

## Troubleshooting

**Problem:** Commands not working
- **Solution:** Add delays between actions, verify window is focused

**Problem:** Mouse clicks missing
- **Solution:** Check coordinates, ensure window is visible and not minimized

**Problem:** Keyboard input ignored
- **Solution:** Focus the target window first, add small delays

**Problem:** Window not found
- **Solution:** Check exact title (case-sensitive), verify app is running

## Complete Example: Automate Notepad

```typescript
import WindowsAgent from './windows-agent';

async function automateNotepad() {
  try {
    // Launch Notepad
    console.log('Launching Notepad...');
    await WindowsAgent.launchApp('notepad.exe');
    await new Promise(r => setTimeout(r, 1000));
    
    // Find and focus window
    console.log('Finding window...');
    const window = await WindowsAgent.getWindowByTitle('Untitled - Notepad');
    await WindowsAgent.focusWindow(window.hwnd);
    
    // Resize and position
    console.log('Positioning window...');
    await WindowsAgent.resizeWindow(window.hwnd, 800, 600);
    await WindowsAgent.moveWindow(window.hwnd, 100, 100);
    
    // Type content
    console.log('Typing content...');
    await WindowsAgent.typeText('Hello from Windows Agent!\n\n');
    await WindowsAgent.typeText('This is automated content.\n');
    await WindowsAgent.typeText('Generated at: ' + new Date().toLocaleString());
    
    // Save file
    console.log('Saving file...');
    await WindowsAgent.pressKeyCombo(['ctrl'], 's');
    await new Promise(r => setTimeout(r, 500));
    await WindowsAgent.typeText('automated-demo.txt');
    await WindowsAgent.pressKey('enter');
    
    console.log('Automation complete!');
  } catch (error) {
    console.error('Automation failed:', error);
  }
}

// Run it
automateNotepad();
```

## Next Steps

1. Read the full documentation: `WINDOWS_AGENT_README.md`
2. Explore the TypeScript API: `src/windows-agent.ts`
3. Check the Rust implementation: `src-tauri/src/windows_agent.rs`
4. Build your own automation sequences!

## Support

For detailed API reference, advanced features, and troubleshooting, see `WINDOWS_AGENT_README.md`.