# Platform-Specific Test Scripts

This document provides ready-to-use test scripts for each platform to verify AI Agent tool functionality.

## Windows Test Scripts

### PowerShell Test Script

Save as `test-windows-agent.ps1`:

```powershell
# Windows AI Agent Test Script
Write-Host "=== Windows AI Agent Test Suite ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Launch Notepad
Write-Host "Test 1: Launching Notepad..." -ForegroundColor Yellow
Start-Process notepad.exe
Start-Sleep -Seconds 2

# Test 2: Get all windows
Write-Host "Test 2: Getting all windows..." -ForegroundColor Yellow
# This would be called via Tauri invoke in the actual app

# Test 3: Type text
Write-Host "Test 3: Typing text..." -ForegroundColor Yellow
# Simulated - actual test runs in Tauri app

# Test 4: Window operations
Write-Host "Test 4: Window operations..." -ForegroundColor Yellow
# Minimize, maximize, restore tests

Write-Host ""
Write-Host "=== Manual Testing Required ===" -ForegroundColor Green
Write-Host "1. Open the Catog Automation app"
Write-Host "2. Navigate to test-agent-tools.html"
Write-Host "3. Run the interactive tests"
Write-Host ""
Write-Host "Expected Results:" -ForegroundColor Cyan
Write-Host "✓ All window management functions should work"
Write-Host "✓ Mouse automation should be smooth"
Write-Host "✓ Keyboard input should be accurate"
Write-Host "✓ Applications should launch successfully"
```

### Batch Test Script

Save as `test-windows-agent.bat`:

```batch
@echo off
echo === Windows AI Agent Test Suite ===
echo.

echo Test 1: Launching Notepad...
start notepad.exe
timeout /t 2 /nobreak >nul

echo Test 2: Launching Calculator...
start calc.exe
timeout /t 2 /nobreak >nul

echo.
echo === Manual Testing Required ===
echo 1. Open the Catog Automation app
echo 2. Navigate to test-agent-tools.html
echo 3. Run the interactive tests
echo.
echo Expected Results:
echo [OK] All window management functions should work
echo [OK] Mouse automation should be smooth
echo [OK] Keyboard input should be accurate
echo [OK] Applications should launch successfully
echo.
pause
```

### Windows Test Checklist

```
Windows AI Agent Test Checklist
================================

Window Management:
[ ] Get all windows - Should list all visible windows
[ ] Find window by title - Should find specific window
[ ] Get active window - Should return focused window
[ ] Resize window - Should change window dimensions
[ ] Move window - Should change window position
[ ] Minimize window - Should minimize to taskbar
[ ] Maximize window - Should maximize to full screen
[ ] Restore window - Should restore to normal size
[ ] Close window - Should close the window
[ ] Focus window - Should bring window to front

Mouse Automation:
[ ] Get mouse position - Should return current coordinates
[ ] Move mouse - Should move to specified coordinates
[ ] Click mouse - Should perform left click
[ ] Double click - Should perform double click
[ ] Right click - Should perform right click
[ ] Drag operation - Should drag from point A to B
[ ] Scroll - Should scroll up/down

Keyboard Automation:
[ ] Type text - Should type specified text
[ ] Press key - Should press single key
[ ] Key combination - Should press Ctrl+C, Ctrl+V, etc.
[ ] Special keys - Should press Enter, Tab, Esc, etc.

Application Control:
[ ] Launch app - Should start application
[ ] Get installed apps - Should list installed applications
[ ] Get running programs - Should list running processes
[ ] Get screen size - Should return screen dimensions

Advanced Features:
[ ] Automation sequence - Should execute multi-step workflow
[ ] NLP parsing - Should parse natural language commands
[ ] NLP execution - Should execute parsed commands
```

## macOS Test Scripts

### Bash Test Script

Save as `test-macos-agent.sh`:

```bash
#!/bin/bash

echo "=== macOS AI Agent Test Suite ==="
echo ""

# Test 1: Launch TextEdit
echo "Test 1: Launching TextEdit..."
open -a TextEdit
sleep 2

# Test 2: Launch Safari
echo "Test 2: Launching Safari..."
open -a Safari
sleep 2

# Test 3: Get installed applications
echo "Test 3: Checking installed applications..."
ls /Applications/*.app | head -10

echo ""
echo "=== Cross-Platform Tools (Should Work) ==="
echo "✓ get_installed_applications"
echo "✓ get_running_programs"
echo "✓ launch_application"
echo "✓ get_screen_size"
echo "✓ get_active_window_bounds"
echo ""

echo "=== Platform-Specific Tools (Not Implemented) ==="
echo "✗ agent_get_all_windows - Returns PlatformNotSupported"
echo "✗ agent_move_mouse - Returns PlatformNotSupported"
echo "✗ agent_type_text - Returns PlatformNotSupported"
echo "✗ All other agent_* commands - Returns PlatformNotSupported"
echo ""

echo "=== Manual Testing Required ==="
echo "1. Open the Catog Automation app"
echo "2. Navigate to test-agent-tools.html"
echo "3. Test cross-platform functions"
echo "4. Verify platform-specific functions return appropriate errors"
echo ""

echo "Expected Results:"
echo "✓ Cross-platform tools should work"
echo "✗ Platform-specific tools should return 'PlatformNotSupported' errors"
```

Make executable:
```bash
chmod +x test-macos-agent.sh
./test-macos-agent.sh
```

### macOS Test Checklist

```
macOS AI Agent Test Checklist
==============================

Cross-Platform Tools (Should Work):
[ ] get_installed_applications - Should list apps from /Applications
[ ] get_running_programs - Should list running processes
[ ] launch_application - Should open applications
[ ] get_screen_size - Should return screen dimensions
[ ] get_active_window_bounds - Should return window bounds
[ ] window_control_action - Should perform basic window actions
[ ] click_at - Should perform click operations
[ ] type_text - Should type text
[ ] press_key_combo - Should press key combinations

Platform-Specific Tools (Not Implemented):
[ ] agent_get_all_windows - Should return PlatformNotSupported
[ ] agent_get_window_by_title - Should return PlatformNotSupported
[ ] agent_move_mouse - Should return PlatformNotSupported
[ ] agent_click_mouse - Should return PlatformNotSupported
[ ] agent_type_text - Should return PlatformNotSupported
[ ] All other agent_* commands - Should return PlatformNotSupported

Accessibility Permissions:
[ ] Grant accessibility permissions in System Preferences
[ ] Verify app can control other applications
[ ] Test with System Preferences > Security & Privacy > Privacy > Accessibility
```

### macOS Implementation Notes

```
Required APIs for Full Implementation:
- CGWindowListCopyWindowInfo (window enumeration)
- CGEventCreateMouseEvent (mouse control)
- CGEventCreateKeyboardEvent (keyboard control)
- AXUIElementCopyAttributeNames (UI detection)
- NSWorkspace.sharedWorkspace (app control)
- NSScreen.screens (display info)

Current Status:
- Framework structure in place
- All functions return PlatformNotSupported
- Requires Cocoa/AppKit bindings implementation
```

## Linux Test Scripts

### Bash Test Script

Save as `test-linux-agent.sh`:

```bash
#!/bin/bash

echo "=== Linux AI Agent Test Suite ==="
echo ""

# Check for required tools
echo "Checking for required tools..."
command -v xdotool >/dev/null 2>&1 || echo "⚠ xdotool not found (optional)"
command -v wmctrl >/dev/null 2>&1 || echo "⚠ wmctrl not found (optional)"
command -v at-spi2-core >/dev/null 2>&1 || echo "⚠ at-spi2-core not found (optional)"
echo ""

# Test 1: Launch gedit
echo "Test 1: Launching gedit..."
gedit &
sleep 2

# Test 2: Launch Firefox
echo "Test 2: Launching Firefox..."
firefox &
sleep 2

# Test 3: Get installed applications
echo "Test 3: Checking installed applications..."
ls /usr/share/applications/*.desktop | head -10

echo ""
echo "=== Cross-Platform Tools (Should Work) ==="
echo "✓ get_installed_applications"
echo "✓ get_running_programs"
echo "✓ launch_application"
echo "✓ get_screen_size"
echo "✓ get_active_window_bounds"
echo ""

echo "=== Platform-Specific Tools (Not Implemented) ==="
echo "✗ agent_get_all_windows - Returns PlatformNotSupported"
echo "✗ agent_move_mouse - Returns PlatformNotSupported"
echo "✗ agent_type_text - Returns PlatformNotSupported"
echo "✗ All other agent_* commands - Returns PlatformNotSupported"
echo ""

echo "=== Manual Testing Required ==="
echo "1. Open the Catog Automation app"
echo "2. Navigate to test-agent-tools.html"
echo "3. Test cross-platform functions"
echo "4. Verify platform-specific functions return appropriate errors"
echo ""

echo "Expected Results:"
echo "✓ Cross-platform tools should work"
echo "✗ Platform-specific tools should return 'PlatformNotSupported' errors"
echo ""

echo "=== Optional Dependencies ==="
echo "For future full implementation, install:"
echo "  Ubuntu/Debian: sudo apt-get install xdotool wmctrl at-spi2-core"
echo "  Fedora: sudo dnf install xdotool wmctrl at-spi2-core"
echo "  Arch: sudo pacman -S xdotool wmctrl at-spi2-core"
```

Make executable:
```bash
chmod +x test-linux-agent.sh
./test-linux-agent.sh
```

### Linux Test Checklist

```
Linux AI Agent Test Checklist
==============================

Cross-Platform Tools (Should Work):
[ ] get_installed_applications - Should list apps from /usr/share/applications
[ ] get_running_programs - Should list running processes
[ ] launch_application - Should open applications
[ ] get_screen_size - Should return screen dimensions
[ ] get_active_window_bounds - Should return window bounds
[ ] window_control_action - Should perform basic window actions
[ ] click_at - Should perform click operations
[ ] type_text - Should type text
[ ] press_key_combo - Should press key combinations

Platform-Specific Tools (Not Implemented):
[ ] agent_get_all_windows - Should return PlatformNotSupported
[ ] agent_get_window_by_title - Should return PlatformNotSupported
[ ] agent_move_mouse - Should return PlatformNotSupported
[ ] agent_click_mouse - Should return PlatformNotSupported
[ ] agent_type_text - Should return PlatformNotSupported
[ ] All other agent_* commands - Should return PlatformNotSupported

Display Server:
[ ] Verify X11 or Wayland is running
[ ] Check DISPLAY environment variable
[ ] Test with different desktop environments (GNOME, KDE, XFCE)

Dependencies:
[ ] xdotool installed (optional, for future implementation)
[ ] wmctrl installed (optional, for future implementation)
[ ] at-spi2-core installed (optional, for future implementation)
```

### Linux Implementation Notes

```
Required APIs for Full Implementation:
- X11 XQueryTree / Wayland protocols (window enumeration)
- XTest extension / uinput (input simulation)
- AT-SPI (UI detection)
- Desktop entry launching (app control)
- XRRGetScreenResources (display info)

Current Status:
- Framework structure in place
- All functions return PlatformNotSupported
- Requires X11/Wayland bindings implementation

Display Server Compatibility:
- X11: Full support possible with XTest
- Wayland: Limited support due to security model
- XWayland: Hybrid support possible
```

## Running the Tests

### Step 1: Start the Application

```bash
cd MainSoftware/catog-automation
npm run dev
```

### Step 2: Open Test Interface

Navigate to the test interface in your browser or within the Tauri app:
- File: `test-agent-tools.html`
- Or use the built-in test panel if integrated

### Step 3: Run Platform-Specific Tests

**Windows:**
```powershell
.\test-windows-agent.ps1
```

**macOS:**
```bash
./test-macos-agent.sh
```

**Linux:**
```bash
./test-linux-agent.sh
```

### Step 4: Verify Results

Check the test output and compare against expected results in the checklists above.

## Automated Test Results Format

```
Platform: Windows
=================
✓ Window Management: 10/10 tests passed
✓ Mouse Automation: 7/7 tests passed
✓ Keyboard Automation: 3/3 tests passed
✓ Application Control: 4/4 tests passed
✓ Screen & System: 2/2 tests passed
✓ NLP Commands: 2/2 tests passed

Total: 28/28 tests passed (100%)

Platform: macOS
===============
✓ Cross-Platform Tools: 9/9 tests passed
✗ Platform-Specific Tools: 0/19 tests passed (Expected - Not Implemented)

Total: 9/28 tests passed (32% - Expected for current implementation)

Platform: Linux
===============
✓ Cross-Platform Tools: 9/9 tests passed
✗ Platform-Specific Tools: 0/19 tests passed (Expected - Not Implemented)

Total: 9/28 tests passed (32% - Expected for current implementation)
```

## Troubleshooting

### Windows
- **Issue**: Commands not working
  - **Solution**: Run as administrator if needed
  - **Solution**: Check Windows Defender settings

### macOS
- **Issue**: Permission denied
  - **Solution**: Grant Accessibility permissions
  - **Solution**: System Preferences > Security & Privacy > Privacy > Accessibility

### Linux
- **Issue**: Display server not found
  - **Solution**: Ensure X11 or Wayland is running
  - **Solution**: Check `echo $DISPLAY` returns a value

## Next Steps

1. Run the appropriate test script for your platform
2. Review the test results
3. Report any unexpected failures
4. For macOS/Linux: Verify that PlatformNotSupported errors are returned as expected
5. For Windows: Verify all tests pass successfully

## Contributing Test Results

When reporting test results, please include:
- Platform and version (e.g., Windows 11, macOS 13.0, Ubuntu 22.04)
- Test script used
- Complete test output
- Any errors or unexpected behavior
- Screenshots if applicable