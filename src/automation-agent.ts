/**
 * Windows AI Agent System - TypeScript Frontend Integration
 * Provides type-safe access to Windows automation capabilities
 */

import { invoke } from '@tauri-apps/api/core';

// ═══════════════════════════════════════════════════════════════════════════════
// Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export interface WindowInfo {
  hwnd: number;
  title: string;
  pid: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isVisible: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  monitorIndex: number;
}

export interface MonitorInfo {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  workX: number;
  workY: number;
  workWidth: number;
  workHeight: number;
  isPrimary: boolean;
}

export interface UIElement {
  elementId: string;
  elementType: string;
  name: string;
  className: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isEnabled: boolean;
  isVisible: boolean;
  isClickable: boolean;
  value?: string;
  children: UIElement[];
}

export interface MouseAction {
  actionType: 'move' | 'click' | 'double_click' | 'right_click' | 'middle_click' | 'drag';
  x: number;
  y: number;
  durationMs?: number;
  targetX?: number;
  targetY?: number;
}

export interface KeyboardAction {
  actionType: 'type' | 'press' | 'combo';
  text?: string;
  key?: string;
  modifiers?: string[];
  delayMs?: number;
}

export interface WindowAction {
  actionType: 'focus' | 'resize' | 'move' | 'minimize' | 'maximize' | 'restore' | 'close';
  windowTitle?: string;
  hwnd?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface AutomationStep {
  stepType: 'mouse' | 'keyboard' | 'window' | 'wait' | 'condition';
  mouseAction?: MouseAction;
  keyboardAction?: KeyboardAction;
  windowAction?: WindowAction;
  waitMs?: number;
  condition?: string;
}

export interface AutomationSequence {
  name: string;
  description: string;
  steps: AutomationStep[];
}

export interface NLPCommand {
  rawCommand: string;
  intent: string;
  entities: Record<string, string>;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Window Management API
// ═══════════════════════════════════════════════════════════════════════════════

export class WindowsAgent {
  /**
   * Get window information by title
   */
  static async getWindowByTitle(title: string): Promise<WindowInfo> {
    return await invoke<WindowInfo>('agent_get_window_by_title', { title });
  }

  /**
   * Get the currently active window
   */
  static async getActiveWindow(): Promise<WindowInfo> {
    return await invoke<WindowInfo>('agent_get_active_window');
  }

  /**
   * Get all visible windows
   */
  static async getAllWindows(): Promise<WindowInfo[]> {
    return await invoke<WindowInfo[]>('agent_get_all_windows');
  }

  /**
   * Resize a window to specific dimensions
   */
  static async resizeWindow(hwnd: number, width: number, height: number): Promise<void> {
    await invoke('agent_resize_window', { hwnd, width, height });
  }

  /**
   * Move a window to specific coordinates
   */
  static async moveWindow(hwnd: number, x: number, y: number): Promise<void> {
    await invoke('agent_move_window', { hwnd, x, y });
  }

  /**
   * Minimize a window
   */
  static async minimizeWindow(hwnd: number): Promise<void> {
    await invoke('agent_minimize_window', { hwnd });
  }

  /**
   * Maximize a window
   */
  static async maximizeWindow(hwnd: number): Promise<void> {
    await invoke('agent_maximize_window', { hwnd });
  }

  /**
   * Restore a window to normal state
   */
  static async restoreWindow(hwnd: number): Promise<void> {
    await invoke('agent_restore_window', { hwnd });
  }

  /**
   * Close a window
   */
  static async closeWindow(hwnd: number): Promise<void> {
    await invoke('agent_close_window', { hwnd });
  }

  /**
   * Bring a window to foreground and set focus
   */
  static async focusWindow(hwnd: number): Promise<void> {
    await invoke('agent_focus_window', { hwnd });
  }

  /**
   * Get screen dimensions
   */
  static async getScreenSize(): Promise<[number, number]> {
    return await invoke<[number, number]>('agent_get_screen_size');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Mouse Automation API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Move mouse to specific coordinates
   */
  static async moveMouse(x: number, y: number): Promise<void> {
    await invoke('agent_move_mouse', { x, y });
  }

  /**
   * Get current mouse position
   */
  static async getMousePosition(): Promise<[number, number]> {
    return await invoke<[number, number]>('agent_get_mouse_position');
  }

  /**
   * Click mouse button at current position
   */
  static async clickMouse(button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
    await invoke('agent_click_mouse', { button });
  }

  /**
   * Click at specific coordinates
   */
  static async clickAt(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
    await invoke('agent_click_at', { x, y, button });
  }

  /**
   * Double click at current position
   */
  static async doubleClick(): Promise<void> {
    await invoke('agent_double_click');
  }

  /**
   * Drag mouse from one position to another
   */
  static async dragMouse(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    await invoke('agent_drag_mouse', { fromX, fromY, toX, toY });
  }

  /**
   * Scroll mouse wheel
   */
  static async scroll(amount: number): Promise<void> {
    await invoke('agent_scroll', { amount });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Keyboard Automation API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Type text with optional delay between characters
   */
  static async typeText(text: string, delayMs: number = 30): Promise<void> {
    await invoke('agent_type_text', { text, delayMs });
  }

  /**
   * Press a single key
   */
  static async pressKey(key: string): Promise<void> {
    await invoke('agent_press_key', { key });
  }

  /**
   * Press a key combination (e.g., Ctrl+C)
   */
  static async pressKeyCombo(modifiers: string[], key: string): Promise<void> {
    await invoke('agent_press_key_combo', { modifiers, key });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Application Interaction API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Launch an application by path
   */
  static async launchApp(path: string): Promise<number> {
    return await invoke<number>('agent_launch_app', { path });
  }

  /**
   * Execute an automation sequence
   */
  static async executeSequence(sequence: AutomationSequence): Promise<string> {
    return await invoke<string>('agent_execute_sequence', { sequence });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Natural Language Processing API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Parse a natural language command
   */
  static async parseCommand(command: string): Promise<NLPCommand> {
    return await invoke<NLPCommand>('agent_parse_command', { command });
  }

  /**
   * Execute a parsed NLP command
   */
  static async executeNLPCommand(nlpCommand: NLPCommand): Promise<string> {
    return await invoke<string>('agent_execute_nlp_command', { nlpCommand });
  }

  /**
   * Parse and execute a natural language command in one step
   */
  static async executeCommand(command: string): Promise<string> {
    const nlpCommand = await this.parseCommand(command);
    return await this.executeNLPCommand(nlpCommand);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // High-Level Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Find and focus a window by title
   */
  static async findAndFocusWindow(title: string): Promise<WindowInfo> {
    const window = await this.getWindowByTitle(title);
    await this.focusWindow(window.hwnd);
    return window;
  }

  /**
   * Click on a UI element by searching for it
   */
  static async clickOnElement(windowTitle: string, elementName: string): Promise<void> {
    const window = await this.getWindowByTitle(windowTitle);
    await this.focusWindow(window.hwnd);
    // In a real implementation, you would search for the element and click it
    // This is a placeholder for the UI Automation API integration
    console.log(`Clicking on element: ${elementName} in window: ${windowTitle}`);
  }

  /**
   * Type text into a focused input field
   */
  static async typeIntoField(text: string, clearFirst: boolean = false): Promise<void> {
    if (clearFirst) {
      await this.pressKeyCombo(['ctrl'], 'a');
      await this.pressKey('delete');
    }
    await this.typeText(text);
  }

  /**
   * Create a simple automation sequence
   */
  static createSequence(name: string, description: string): AutomationSequenceBuilder {
    return new AutomationSequenceBuilder(name, description);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Automation Sequence Builder
// ═══════════════════════════════════════════════════════════════════════════════

export class AutomationSequenceBuilder {
  private sequence: AutomationSequence;

  constructor(name: string, description: string) {
    this.sequence = {
      name,
      description,
      steps: [],
    };
  }

  /**
   * Add a mouse action step
   */
  mouse(action: MouseAction): this {
    this.sequence.steps.push({
      stepType: 'mouse',
      mouseAction: action,
    });
    return this;
  }

  /**
   * Add a keyboard action step
   */
  keyboard(action: KeyboardAction): this {
    this.sequence.steps.push({
      stepType: 'keyboard',
      keyboardAction: action,
    });
    return this;
  }

  /**
   * Add a window action step
   */
  window(action: WindowAction): this {
    this.sequence.steps.push({
      stepType: 'window',
      windowAction: action,
    });
    return this;
  }

  /**
   * Add a wait step
   */
  wait(ms: number): this {
    this.sequence.steps.push({
      stepType: 'wait',
      waitMs: ms,
    });
    return this;
  }

  /**
   * Convenience method: Click at coordinates
   */
  clickAt(x: number, y: number): this {
    return this.mouse({
      actionType: 'click',
      x,
      y,
    });
  }

  /**
   * Convenience method: Type text
   */
  type(text: string, delayMs: number = 30): this {
    return this.keyboard({
      actionType: 'type',
      text,
      delayMs,
    });
  }

  /**
   * Convenience method: Press key combination
   */
  pressCombo(modifiers: string[], key: string): this {
    return this.keyboard({
      actionType: 'combo',
      key,
      modifiers,
    });
  }

  /**
   * Convenience method: Focus window
   */
  focusWindow(windowTitle: string): this {
    return this.window({
      actionType: 'focus',
      windowTitle,
    });
  }

  /**
   * Build and return the sequence
   */
  build(): AutomationSequence {
    return this.sequence;
  }

  /**
   * Build and execute the sequence
   */
  async execute(): Promise<string> {
    return await WindowsAgent.executeSequence(this.sequence);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Example Usage
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Example: Open Notepad and type "Hello World"
 */
export async function exampleOpenNotepadAndType(): Promise<void> {
  // Using natural language
  await WindowsAgent.executeCommand('open notepad and type hello world');

  // Or using the API directly
  await WindowsAgent.launchApp('notepad.exe');
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for app to open
  await WindowsAgent.typeText('Hello World');
}

/**
 * Example: Create and execute an automation sequence
 */
export async function exampleAutomationSequence(): Promise<void> {
  const result = await WindowsAgent.createSequence(
    'Notepad Hello World',
    'Opens Notepad and types Hello World'
  )
    .window({ actionType: 'focus', windowTitle: 'Notepad' })
    .wait(500)
    .type('Hello World!')
    .wait(500)
    .pressCombo(['ctrl'], 's')
    .execute();

  console.log('Sequence result:', result);
}

/**
 * Example: Window management
 */
export async function exampleWindowManagement(): Promise<void> {
  // Get all windows
  const windows = await WindowsAgent.getAllWindows();
  console.log('All windows:', windows);

  // Find a specific window
  const notepad = await WindowsAgent.getWindowByTitle('Notepad');
  
  // Resize and move it
  await WindowsAgent.resizeWindow(notepad.hwnd, 800, 600);
  await WindowsAgent.moveWindow(notepad.hwnd, 100, 100);
  
  // Maximize it
  await WindowsAgent.maximizeWindow(notepad.hwnd);
}

export default WindowsAgent;

// Made with Bob
