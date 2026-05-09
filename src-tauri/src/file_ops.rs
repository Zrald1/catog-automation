use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

// ── Error Types ──

#[derive(Debug, thiserror::Error)]
pub enum FileOpsError {
    #[error("File not found: {0}")]
    NotFound(String),
    #[error("Path is a directory: {0}")]
    IsDirectory(String),
    #[error("Path is a file: {0}")]
    IsFile(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Invalid line range: {0}")]
    InvalidLineRange(String),
    #[error("Regex error: {0}")]
    RegexError(String),
    #[error("Encoding error: {0}")]
    EncodingError(String),
}

impl From<FileOpsError> for String {
    fn from(err: FileOpsError) -> String {
        err.to_string()
    }
}

// ── Shared Types ──

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub created: Option<u64>,
    pub readonly: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub created: Option<u64>,
    pub readonly: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line_number: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
    pub duration_ms: u64,
}

// ── File Operation Commands ──

/// Read file with optional line range support
/// Examples:
/// - read_file("file.txt", None, None) - read entire file
/// - read_file("file.txt", Some(1), Some(100)) - read lines 1-100
#[tauri::command]
pub fn read_file(
    path: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> Result<String, String> {
    let p = Path::new(&path);
    
    if !p.exists() {
        return Err(FileOpsError::NotFound(path).into());
    }
    if p.is_dir() {
        return Err(FileOpsError::IsDirectory(path).into());
    }

    // If no line range specified, read entire file
    if start_line.is_none() && end_line.is_none() {
        return fs::read_to_string(p)
            .map_err(|e| FileOpsError::Io(e).to_string());
    }

    // Read with line range
    let file = fs::File::open(p)
        .map_err(|e| FileOpsError::Io(e).to_string())?;
    let reader = BufReader::new(file);
    
    let start = start_line.unwrap_or(1);
    let end = end_line.unwrap_or(usize::MAX);
    
    if start > end {
        return Err(FileOpsError::InvalidLineRange(
            format!("start_line ({}) must be <= end_line ({})", start, end)
        ).into());
    }

    let mut result = String::new();
    for (idx, line) in reader.lines().enumerate() {
        let line_num = idx + 1;
        if line_num < start {
            continue;
        }
        if line_num > end {
            break;
        }
        let line = line.map_err(|e| FileOpsError::Io(e).to_string())?;
        result.push_str(&line);
        result.push('\n');
    }

    Ok(result)
}

/// Write file with atomic write support (write to temp, then rename)
#[tauri::command]
pub fn write_file(
    path: String,
    content: String,
    atomic: Option<bool>,
) -> Result<(), String> {
    let p = Path::new(&path);
    
    // Create parent directories if they don't exist
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| FileOpsError::Io(e).to_string())?;
        }
    }

    // Use atomic write if requested (default: true)
    if atomic.unwrap_or(true) {
        // Write to temporary file first
        let temp_path = p.with_extension("tmp");
        fs::write(&temp_path, &content)
            .map_err(|e| FileOpsError::Io(e).to_string())?;
        
        // Rename temp file to target (atomic operation)
        fs::rename(&temp_path, p)
            .map_err(|e| {
                // Clean up temp file on error
                let _ = fs::remove_file(&temp_path);
                FileOpsError::Io(e).to_string()
            })?;
    } else {
        // Direct write
        fs::write(p, &content)
            .map_err(|e| FileOpsError::Io(e).to_string())?;
    }

    Ok(())
}

/// List directory with optional recursive traversal and filtering
#[tauri::command]
pub fn list_files(
    path: String,
    recursive: Option<bool>,
    pattern: Option<String>,
) -> Result<Vec<DirEntry>, String> {
    let p = Path::new(&path);
    
    if !p.exists() {
        return Err(FileOpsError::NotFound(path).into());
    }
    if !p.is_dir() {
        return Err(FileOpsError::IsFile(path).into());
    }

    let mut result = Vec::new();
    let is_recursive = recursive.unwrap_or(false);

    if is_recursive {
        collect_entries_recursive(p, &pattern, &mut result)?;
    } else {
        collect_entries_single(p, &pattern, &mut result)?;
    }

    // Sort: directories first, then alphabetical
    result.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

fn collect_entries_single(
    dir: &Path,
    pattern: &Option<String>,
    result: &mut Vec<DirEntry>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| FileOpsError::Io(e).to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| FileOpsError::Io(e).to_string())?;
        let path = entry.path();
        
        // Apply pattern filter if specified
        if let Some(ref pat) = pattern {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.contains(pat) {
                continue;
            }
        }

        if let Some(dir_entry) = path_to_dir_entry(&path)? {
            result.push(dir_entry);
        }
    }

    Ok(())
}

fn collect_entries_recursive(
    dir: &Path,
    pattern: &Option<String>,
    result: &mut Vec<DirEntry>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| FileOpsError::Io(e).to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| FileOpsError::Io(e).to_string())?;
        let path = entry.path();
        
        // Apply pattern filter if specified
        if let Some(ref pat) = pattern {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.contains(pat) {
                if let Some(dir_entry) = path_to_dir_entry(&path)? {
                    result.push(dir_entry);
                }
            }
        } else {
            if let Some(dir_entry) = path_to_dir_entry(&path)? {
                result.push(dir_entry);
            }
        }

        // Recurse into subdirectories
        if path.is_dir() {
            collect_entries_recursive(&path, pattern, result)?;
        }
    }

    Ok(())
}

fn path_to_dir_entry(path: &Path) -> Result<Option<DirEntry>, String> {
    let metadata = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(None), // Skip inaccessible files
    };

    let name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    
    let path_str = path.to_string_lossy().to_string();
    
    let modified = metadata.modified().ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    
    let created = metadata.created().ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(Some(DirEntry {
        name,
        path: path_str,
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        is_symlink: metadata.file_type().is_symlink(),
        size: metadata.len(),
        modified,
        created,
        readonly: metadata.permissions().readonly(),
    }))
}

/// Search files for regex pattern (grep functionality)
#[tauri::command]
pub fn search_files(
    directory: String,
    pattern: String,
    file_pattern: Option<String>,
    recursive: Option<bool>,
    max_results: Option<usize>,
) -> Result<Vec<SearchMatch>, String> {
    let dir = Path::new(&directory);
    
    if !dir.exists() {
        return Err(FileOpsError::NotFound(directory).into());
    }
    if !dir.is_dir() {
        return Err(FileOpsError::IsFile(directory).into());
    }

    let regex = regex::Regex::new(&pattern)
        .map_err(|e| FileOpsError::RegexError(e.to_string()).to_string())?;
    
    let file_regex = file_pattern.as_ref()
        .map(|p| regex::Regex::new(p))
        .transpose()
        .map_err(|e| FileOpsError::RegexError(e.to_string()).to_string())?;

    let mut results = Vec::new();
    let max = max_results.unwrap_or(1000);
    let is_recursive = recursive.unwrap_or(true);

    search_directory(dir, &regex, &file_regex, is_recursive, &mut results, max)?;

    Ok(results)
}

fn search_directory(
    dir: &Path,
    pattern: &regex::Regex,
    file_pattern: &Option<regex::Regex>,
    recursive: bool,
    results: &mut Vec<SearchMatch>,
    max_results: usize,
) -> Result<(), String> {
    if results.len() >= max_results {
        return Ok(());
    }

    let entries = fs::read_dir(dir)
        .map_err(|e| FileOpsError::Io(e).to_string())?;

    for entry in entries {
        if results.len() >= max_results {
            break;
        }

        let entry = entry.map_err(|e| FileOpsError::Io(e).to_string())?;
        let path = entry.path();

        if path.is_file() {
            // Check file pattern filter
            if let Some(ref file_regex) = file_pattern {
                let filename = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                if !file_regex.is_match(filename) {
                    continue;
                }
            }

            // Search file content
            if let Ok(file) = fs::File::open(&path) {
                let reader = BufReader::new(file);
                let path_str = path.to_string_lossy().to_string();

                for (line_num, line) in reader.lines().enumerate() {
                    if results.len() >= max_results {
                        break;
                    }

                    if let Ok(line_content) = line {
                        if let Some(mat) = pattern.find(&line_content) {
                            results.push(SearchMatch {
                                path: path_str.clone(),
                                line_number: line_num + 1,
                                line_content: line_content.clone(),
                                match_start: mat.start(),
                                match_end: mat.end(),
                            });
                        }
                    }
                }
            }
        } else if path.is_dir() && recursive {
            search_directory(&path, pattern, file_pattern, recursive, results, max_results)?;
        }
    }

    Ok(())
}

/// Create directory with recursive creation
#[tauri::command]
pub fn create_directory(path: String, recursive: Option<bool>) -> Result<(), String> {
    let p = Path::new(&path);
    
    if p.exists() {
        if p.is_dir() {
            return Ok(()); // Already exists
        }
        return Err(FileOpsError::IsFile(path).into());
    }

    if recursive.unwrap_or(true) {
        fs::create_dir_all(p)
            .map_err(|e| FileOpsError::Io(e).to_string())?;
    } else {
        fs::create_dir(p)
            .map_err(|e| FileOpsError::Io(e).to_string())?;
    }

    Ok(())
}

/// Delete file or directory with safety checks
#[tauri::command]
pub fn delete_path(path: String, recursive: Option<bool>) -> Result<(), String> {
    let p = Path::new(&path);
    
    if !p.exists() {
        return Err(FileOpsError::NotFound(path).into());
    }

    if p.is_dir() {
        if recursive.unwrap_or(false) {
            fs::remove_dir_all(p)
                .map_err(|e| FileOpsError::Io(e).to_string())?;
        } else {
            fs::remove_dir(p)
                .map_err(|e| FileOpsError::Io(e).to_string())?;
        }
    } else {
        fs::remove_file(p)
            .map_err(|e| FileOpsError::Io(e).to_string())?;
    }

    Ok(())
}

/// Move file or directory with cross-device support
#[tauri::command]
pub fn move_path(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    let dst = Path::new(&destination);
    
    if !src.exists() {
        return Err(FileOpsError::NotFound(source).into());
    }

    // Create destination parent dir if needed
    if let Some(parent) = dst.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| FileOpsError::Io(e).to_string())?;
        }
    }

    // Try rename first (fast, atomic)
    match fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::CrossesDevices => {
            // Cross-device move: copy then delete
            copy_path(source.clone(), destination)?;
            delete_path(source, Some(true))?;
            Ok(())
        }
        Err(e) => Err(FileOpsError::Io(e).to_string()),
    }
}

/// Copy file or directory recursively
#[tauri::command]
pub fn copy_path(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    let dst = Path::new(&destination);
    
    if !src.exists() {
        return Err(FileOpsError::NotFound(source).into());
    }

    // Create destination parent dir if needed
    if let Some(parent) = dst.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| FileOpsError::Io(e).to_string())?;
        }
    }

    if src.is_dir() {
        copy_dir_recursive(src, dst)
    } else {
        fs::copy(src, dst)
            .map_err(|e| FileOpsError::Io(e).to_string())?;
        Ok(())
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst)
        .map_err(|e| FileOpsError::Io(e).to_string())?;
    
    for entry in fs::read_dir(src).map_err(|e| FileOpsError::Io(e).to_string())? {
        let entry = entry.map_err(|e| FileOpsError::Io(e).to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| FileOpsError::Io(e).to_string())?;
        }
    }
    
    Ok(())
}

/// Check if file exists and get metadata
#[tauri::command]
pub fn file_exists(path: String, get_metadata: Option<bool>) -> Result<FileMetadata, String> {
    let p = Path::new(&path);
    let exists = p.exists();

    if !exists || !get_metadata.unwrap_or(false) {
        return Ok(FileMetadata {
            path,
            exists,
            is_dir: false,
            is_file: false,
            is_symlink: false,
            size: 0,
            modified: None,
            created: None,
            readonly: false,
        });
    }

    let metadata = fs::metadata(p)
        .map_err(|e| FileOpsError::Io(e).to_string())?;

    let modified = metadata.modified().ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    
    let created = metadata.created().ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(FileMetadata {
        path,
        exists,
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        is_symlink: metadata.file_type().is_symlink(),
        size: metadata.len(),
        modified,
        created,
        readonly: metadata.permissions().readonly(),
    })
}

/// Execute shell command (basic version, see terminal_exec.rs for streaming version)
#[tauri::command]
pub async fn execute_command(
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CommandResult, String> {
    let start = std::time::Instant::now();
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000));

    // Determine shell based on OS
    let (shell, shell_arg) = if cfg!(target_os = "windows") {
        ("powershell.exe", "-Command")
    } else {
        ("bash", "-c")
    };

    let mut cmd = tokio::process::Command::new(shell);
    cmd.arg(shell_arg)
        .arg(&command)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());

    if let Some(ref dir) = cwd {
        let p = PathBuf::from(dir);
        if p.exists() {
            cmd.current_dir(p);
        }
    }

    let output = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| format!("Command timed out after {}ms", timeout.as_millis()))?
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(CommandResult {
        stdout,
        stderr,
        exit_code,
        success: output.status.success(),
        duration_ms,
    })
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_test_dir() -> TempDir {
        TempDir::new().expect("Failed to create temp dir")
    }

    fn create_test_file(dir: &TempDir, name: &str, content: &str) -> String {
        let path = dir.path().join(name);
        fs::write(&path, content).expect("Failed to write test file");
        path.to_string_lossy().to_string()
    }

    #[test]
    fn test_read_file_entire() {
        let dir = setup_test_dir();
        let content = "Line 1\nLine 2\nLine 3\n";
        let path = create_test_file(&dir, "test.txt", content);

        let result = read_file(path, None, None);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), content);
    }

    #[test]
    fn test_read_file_line_range() {
        let dir = setup_test_dir();
        let content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n";
        let path = create_test_file(&dir, "test.txt", content);

        let result = read_file(path, Some(2), Some(4));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Line 2\nLine 3\nLine 4\n");
    }

    #[test]
    fn test_write_file_atomic() {
        let dir = setup_test_dir();
        let path = dir.path().join("new.txt").to_string_lossy().to_string();
        let content = "Test content";

        let result = write_file(path.clone(), content.to_string(), Some(true));
        assert!(result.is_ok());

        let read_result = fs::read_to_string(&path);
        assert!(read_result.is_ok());
        assert_eq!(read_result.unwrap(), content);
    }

    #[test]
    fn test_list_files_non_recursive() {
        let dir = setup_test_dir();
        create_test_file(&dir, "file1.txt", "content1");
        create_test_file(&dir, "file2.txt", "content2");
        fs::create_dir(dir.path().join("subdir")).unwrap();

        let path = dir.path().to_string_lossy().to_string();
        let result = list_files(path, Some(false), None);
        
        assert!(result.is_ok());
        let entries = result.unwrap();
        assert_eq!(entries.len(), 3);
    }

    #[test]
    fn test_search_files_basic() {
        let dir = setup_test_dir();
        create_test_file(&dir, "file1.txt", "Hello world\nTest line\n");
        create_test_file(&dir, "file2.txt", "Another test\nHello again\n");

        let path = dir.path().to_string_lossy().to_string();
        let result = search_files(path, "Hello".to_string(), None, Some(true), None);
        
        assert!(result.is_ok());
        let matches = result.unwrap();
        assert_eq!(matches.len(), 2);
    }

    #[tokio::test]
    async fn test_execute_command_success() {
        let command = "echo test".to_string();
        let result = execute_command(command, None, None).await;
        assert!(result.is_ok());
        
        let output = result.unwrap();
        assert!(output.success);
        assert_eq!(output.exit_code, 0);
    }
}

// Made with Bob
