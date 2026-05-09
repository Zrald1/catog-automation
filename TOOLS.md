# Catog Automation Tools Documentation

This document provides comprehensive documentation for all integrated tools in the Catog Automation system, including Codex-inspired file operations and terminal execution tools.

## Table of Contents

- [File Operations](#file-operations)
- [Terminal Operations](#terminal-operations)
- [Usage Examples](#usage-examples)
- [Error Handling](#error-handling)
- [Cross-Platform Notes](#cross-platform-notes)

---

## File Operations

### read_file

Read file contents with optional line range support for efficient partial reads.

**Parameters:**
- `path` (string, required): Absolute or relative path to the file
- `start_line` (integer, optional): Starting line number (1-based, inclusive)
- `end_line` (integer, optional): Ending line number (1-based, inclusive)

**Returns:** String containing file contents

**Examples:**
```javascript
// Read entire file
await invoke('read_file', { path: '/path/to/file.txt' });

// Read lines 1-100
await invoke('read_file', { 
  path: '/path/to/file.txt',
  startLine: 1,
  endLine: 100
});

// Read from line 50 to end
await invoke('read_file', { 
  path: '/path/to/file.txt',
  startLine: 50
});
```

**Features:**
- Efficient line-range reading for large files
- Automatic encoding detection
- Binary file handling

---

### write_file

Write content to a file with atomic write support.

**Parameters:**
- `path` (string, required): Absolute or relative path to the file
- `content` (string, required): Content to write
- `atomic` (boolean, optional, default: true): Use atomic write (temp file + rename)

**Returns:** void

**Examples:**
```javascript
// Atomic write (default)
await invoke('write_file', { 
  path: '/path/to/file.txt',
  content: 'Hello, World!'
});

// Direct write (non-atomic)
await invoke('write_file', { 
  path: '/path/to/file.txt',
  content: 'Hello, World!',
  atomic: false
});
```

**Features:**
- Atomic writes by default (write to temp, then rename)
- Automatic parent directory creation
- Rollback on error

---

### list_files

List files and directories with optional recursive traversal and filtering.

**Parameters:**
- `path` (string, required): Directory path to list
- `recursive` (boolean, optional, default: false): Recursively list subdirectories
- `pattern` (string, optional): Filter pattern (substring match)

**Returns:** Array of DirEntry objects

**DirEntry Structure:**
```typescript
{
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;  // Unix timestamp
  created: number | null;   // Unix timestamp
  readonly: boolean;
}
```

**Examples:**
```javascript
// List directory (non-recursive)
await invoke('list_files', { path: '/path/to/dir' });

// List recursively
await invoke('list_files', { 
  path: '/path/to/dir',
  recursive: true
});

// Filter by pattern
await invoke('list_files', { 
  path: '/path/to/dir',
  recursive: true,
  pattern: '.rs'  // Only files containing '.rs'
});
```

---

### search_files

Search files for regex pattern (grep functionality).

**Parameters:**
- `directory` (string, required): Directory to search in
- `pattern` (string, required): Regex pattern to search for
- `filePattern` (string, optional): Regex pattern to filter files
- `recursive` (boolean, optional, default: true): Search recursively
- `maxResults` (integer, optional, default: 1000): Maximum number of results

**Returns:** Array of SearchMatch objects

**SearchMatch Structure:**
```typescript
{
  path: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}
```

**Examples:**
```javascript
// Search for pattern in all files
await invoke('search_files', { 
  directory: '/path/to/project',
  pattern: 'TODO'
});

// Search only in Rust files
await invoke('search_files', { 
  directory: '/path/to/project',
  pattern: 'fn\\s+\\w+',
  filePattern: '.*\\.rs$'
});

// Limit results
await invoke('search_files', { 
  directory: '/path/to/project',
  pattern: 'error',
  maxResults: 50
});
```

---

### create_directory

Create a directory with optional recursive creation.

**Parameters:**
- `path` (string, required): Directory path to create
- `recursive` (boolean, optional, default: true): Create parent directories

**Returns:** void

**Examples:**
```javascript
// Create with parents (default)
await invoke('create_directory', { 
  path: '/path/to/nested/dir'
});

// Create only if parent exists
await invoke('create_directory', { 
  path: '/path/to/dir',
  recursive: false
});
```

---

### delete_path

Delete a file or directory with safety checks.

**Parameters:**
- `path` (string, required): Path to delete
- `recursive` (boolean, optional, default: false): Delete directories recursively

**Returns:** void

**Examples:**
```javascript
// Delete file
await invoke('delete_path', { path: '/path/to/file.txt' });

// Delete empty directory
await invoke('delete_path', { path: '/path/to/dir' });

// Delete directory recursively
await invoke('delete_path', { 
  path: '/path/to/dir',
  recursive: true
});
```

**Safety Notes:**
- Non-recursive delete fails on non-empty directories
- Use `recursive: true` carefully

---

### move_path

Move or rename a file or directory with cross-device support.

**Parameters:**
- `source` (string, required): Source path
- `destination` (string, required): Destination path

**Returns:** void

**Examples:**
```javascript
// Rename file
await invoke('move_path', { 
  source: '/path/old.txt',
  destination: '/path/new.txt'
});

// Move to different directory
await invoke('move_path', { 
  source: '/path/file.txt',
  destination: '/other/path/file.txt'
});

// Cross-device move (automatic copy + delete)
await invoke('move_path', { 
  source: '/mnt/drive1/file.txt',
  destination: '/mnt/drive2/file.txt'
});
```

**Features:**
- Atomic rename when possible
- Automatic fallback to copy+delete for cross-device moves
- Automatic parent directory creation

---

### copy_path

Copy a file or directory recursively.

**Parameters:**
- `source` (string, required): Source path
- `destination` (string, required): Destination path

**Returns:** void

**Examples:**
```javascript
// Copy file
await invoke('copy_path', { 
  source: '/path/file.txt',
  destination: '/path/file_copy.txt'
});

// Copy directory recursively
await invoke('copy_path', { 
  source: '/path/dir',
  destination: '/path/dir_copy'
});
```

**Features:**
- Automatic recursive directory copying
- Preserves file metadata
- Automatic parent directory creation

---

### file_exists

Check if a file or directory exists and optionally get detailed metadata.

**Parameters:**
- `path` (string, required): Path to check
- `getMetadata` (boolean, optional, default: false): Return detailed metadata

**Returns:** FileMetadata object

**FileMetadata Structure:**
```typescript
{
  path: string;
  exists: boolean;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
  created: number | null;
  readonly: boolean;
}
```

**Examples:**
```javascript
// Simple existence check
const result = await invoke('file_exists', { 
  path: '/path/to/file.txt'
});
console.log(result.exists);  // true or false

// Get full metadata
const metadata = await invoke('file_exists', { 
  path: '/path/to/file.txt',
  getMetadata: true
});
console.log(metadata.size, metadata.modified);
```

---

## Terminal Operations

### execute_command

Execute a shell command and return the output (simple, non-streaming).

**Parameters:**
- `command` (string, required): Shell command to execute
- `cwd` (string, optional): Working directory
- `timeoutMs` (integer, optional, default: 30000): Timeout in milliseconds

**Returns:** CommandResult object

**CommandResult Structure:**
```typescript
{
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  durationMs: number;
}
```

**Examples:**
```javascript
// Simple command
const result = await invoke('execute_command', { 
  command: 'ls -la'
});
console.log(result.stdout);

// With working directory
const result = await invoke('execute_command', { 
  command: 'npm install',
  cwd: '/path/to/project'
});

// With timeout
const result = await invoke('execute_command', { 
  command: 'long-running-task',
  timeoutMs: 60000  // 60 seconds
});
```

**Platform-Specific Shells:**
- Windows: PowerShell
- macOS: zsh
- Linux: bash

---

### execute_command_streaming

Execute a shell command with real-time streaming output.

**Parameters:**
- `commandId` (string, required): Unique identifier for this command
- `command` (string, required): Shell command to execute
- `cwd` (string, optional): Working directory
- `env` (object, optional): Environment variables
- `timeoutMs` (integer, optional): Timeout in milliseconds

**Returns:** StreamingCommandResult object

**Events Emitted:**
- `command-output`: Real-time output (stdout/stderr)
- `command-status`: Status updates (running/completed/failed/timeout)

**Examples:**
```javascript
// Listen for output
await listen('command-output', (event) => {
  const { commandId, outputType, data } = event.payload;
  console.log(`[${outputType}] ${data}`);
});

// Listen for status
await listen('command-status', (event) => {
  const { commandId, status, exitCode } = event.payload;
  console.log(`Command ${commandId}: ${status}`);
});

// Execute streaming command
const result = await invoke('execute_command_streaming', {
  commandId: 'build-123',
  command: 'npm run build',
  cwd: '/path/to/project'
});

// With environment variables
const result = await invoke('execute_command_streaming', {
  commandId: 'test-456',
  command: 'npm test',
  env: {
    NODE_ENV: 'test',
    DEBUG: 'true'
  }
});
```

---

### cancel_command

Cancel a running streaming command.

**Parameters:**
- `commandId` (string, required): Command ID to cancel

**Returns:** void

**Example:**
```javascript
await invoke('cancel_command', { 
  commandId: 'build-123'
});
```

---

### list_running_commands

List all currently running streaming commands.

**Parameters:** None

**Returns:** Array of command IDs (strings)

**Example:**
```javascript
const running = await invoke('list_running_commands');
console.log('Running commands:', running);
```

---

## AI Agent Tool Discovery

### list_agent_tools

List all available tools for the AI agent.

**Parameters:**
- `category` (string, optional): Filter by category

**Returns:** Array of AgentToolDefinition objects

**Example:**
```javascript
// List all tools
const allTools = await invoke('list_agent_tools');

// List only file operations
const fileTools = await invoke('list_agent_tools', { 
  category: 'file_operations'
});

// List only terminal operations
const terminalTools = await invoke('list_agent_tools', { 
  category: 'terminal_operations'
});
```

---

### get_agent_tool

Get detailed information about a specific tool.

**Parameters:**
- `toolName` (string, required): Name of the tool

**Returns:** AgentToolDefinition object

**Example:**
```javascript
const toolDef = await invoke('get_agent_tool', { 
  toolName: 'read_file'
});
console.log(toolDef.description, toolDef.parameters);
```

---

### list_agent_tool_categories

List all available tool categories.

**Parameters:** None

**Returns:** Array of category names (strings)

**Example:**
```javascript
const categories = await invoke('list_agent_tool_categories');
// Returns: ['file_operations', 'terminal_operations']
```

---

## Error Handling

All tools return errors as strings with descriptive messages:

```javascript
try {
  await invoke('read_file', { path: '/nonexistent.txt' });
} catch (error) {
  console.error('Error:', error);
  // Error: File not found: /nonexistent.txt
}
```

**Common Error Types:**
- `File not found: <path>`
- `Path is a directory: <path>`
- `Path is a file: <path>`
- `Permission denied: <path>`
- `Invalid path: <path>`
- `IO error: <details>`
- `Invalid line range: <details>`
- `Regex error: <details>`
- `Command timed out after <ms>ms`
- `Failed to execute command: <details>`

---

## Cross-Platform Notes

### Path Handling
- Use forward slashes (`/`) or platform-specific separators
- Relative paths are resolved from the current working directory
- Automatic path normalization on all platforms

### Shell Commands
- **Windows**: Commands run in PowerShell
- **macOS**: Commands run in zsh (default since Catalina)
- **Linux**: Commands run in bash

### Line Endings
- Files are read/written with platform-appropriate line endings
- `\r\n` on Windows, `\n` on Unix-like systems

### Permissions
- File permission checks respect platform-specific permission models
- `readonly` flag works on all platforms

---

## Best Practices

### File Operations
1. **Use atomic writes** for critical files (default behavior)
2. **Check file existence** before operations when appropriate
3. **Use line ranges** for reading large files efficiently
4. **Set reasonable limits** for search operations (`maxResults`)
5. **Be careful with recursive deletes** - always double-check paths

### Terminal Operations
1. **Use streaming execution** for long-running commands
2. **Set appropriate timeouts** to prevent hanging
3. **Handle both stdout and stderr** in streaming mode
4. **Cancel commands** when no longer needed
5. **Use working directory** parameter instead of `cd` commands

### AI Agent Integration
1. **Query available tools** before use
2. **Validate parameters** against tool definitions
3. **Handle errors gracefully** with fallback strategies
4. **Use appropriate tool categories** for organization
5. **Monitor command status** in streaming mode

---

## Performance Tips

1. **Line Range Reading**: Use `start_line` and `end_line` for large files instead of reading entire file
2. **Search Limits**: Set `maxResults` to prevent excessive memory usage
3. **Recursive Operations**: Be cautious with recursive operations on large directory trees
4. **Streaming vs Simple**: Use streaming execution for commands that produce lots of output
5. **Atomic Writes**: Disable atomic writes (`atomic: false`) for very large files if performance is critical

---

## Security Considerations

1. **Path Validation**: All paths are validated and normalized
2. **Command Injection**: Commands are executed through proper shell interfaces
3. **Timeout Protection**: All operations have timeout support
4. **Error Disclosure**: Error messages are sanitized to prevent information leakage
5. **Permission Checks**: File operations respect system permissions

---

## Integration with AI Agent

All tools are designed to be used by the AI agent in the background. The agent can:

1. **Discover tools** using `list_agent_tools`
2. **Get tool schemas** using `get_agent_tool`
3. **Execute tools** with validated parameters
4. **Handle streaming output** for long-running operations
5. **Cancel operations** when needed

Example AI agent workflow:
```javascript
// 1. Discover available tools
const tools = await invoke('list_agent_tools', { 
  category: 'file_operations'
});

// 2. Get specific tool definition
const readFileTool = await invoke('get_agent_tool', { 
  toolName: 'read_file'
});

// 3. Execute tool with parameters
const content = await invoke('read_file', { 
  path: '/path/to/file.txt',
  startLine: 1,
  endLine: 100
});

// 4. Process result
console.log('File content:', content);
```

---

## Changelog

### Version 1.0.0 (Current)
- Initial release with Codex-inspired file operations
- Streaming terminal execution
- AI agent tool discovery system
- Cross-platform support (Windows, macOS, Linux)
- Comprehensive error handling
- Atomic file operations
- Regex-based file search

---

For more information or support, please refer to the main project documentation or open an issue on GitHub.