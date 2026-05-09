#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // Helper function to create a test directory
    fn setup_test_dir() -> TempDir {
        TempDir::new().expect("Failed to create temp dir")
    }

    // Helper function to create a test file with content
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
    fn test_read_file_not_found() {
        let result = read_file("/nonexistent/file.txt".to_string(), None, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File not found"));
    }

    #[test]
    fn test_read_file_invalid_range() {
        let dir = setup_test_dir();
        let path = create_test_file(&dir, "test.txt", "Line 1\nLine 2\n");

        let result = read_file(path, Some(5), Some(2));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid line range"));
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
    fn test_write_file_creates_parent_dirs() {
        let dir = setup_test_dir();
        let path = dir.path()
            .join("nested/deep/file.txt")
            .to_string_lossy()
            .to_string();
        let content = "Nested content";

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
        assert_eq!(entries.len(), 3); // 2 files + 1 dir
    }

    #[test]
    fn test_list_files_recursive() {
        let dir = setup_test_dir();
        create_test_file(&dir, "file1.txt", "content1");
        
        let subdir = dir.path().join("subdir");
        fs::create_dir(&subdir).unwrap();
        fs::write(subdir.join("file2.txt"), "content2").unwrap();

        let path = dir.path().to_string_lossy().to_string();
        let result = list_files(path, Some(true), None);
        
        assert!(result.is_ok());
        let entries = result.unwrap();
        assert!(entries.len() >= 3); // At least 2 files + 1 dir
    }

    #[test]
    fn test_list_files_with_pattern() {
        let dir = setup_test_dir();
        create_test_file(&dir, "test.txt", "content");
        create_test_file(&dir, "test.rs", "code");
        create_test_file(&dir, "readme.md", "docs");

        let path = dir.path().to_string_lossy().to_string();
        let result = list_files(path, Some(false), Some(".txt".to_string()));
        
        assert!(result.is_ok());
        let entries = result.unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].name.contains(".txt"));
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

    #[test]
    fn test_search_files_with_file_pattern() {
        let dir = setup_test_dir();
        create_test_file(&dir, "test.txt", "pattern");
        create_test_file(&dir, "test.rs", "pattern");

        let path = dir.path().to_string_lossy().to_string();
        let result = search_files(
            path,
            "pattern".to_string(),
            Some(".*\\.txt$".to_string()),
            Some(true),
            None,
        );
        
        assert!(result.is_ok());
        let matches = result.unwrap();
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn test_search_files_max_results() {
        let dir = setup_test_dir();
        let mut content = String::new();
        for i in 0..100 {
            content.push_str(&format!("match {}\n", i));
        }
        create_test_file(&dir, "many.txt", &content);

        let path = dir.path().to_string_lossy().to_string();
        let result = search_files(
            path,
            "match".to_string(),
            None,
            Some(true),
            Some(10),
        );
        
        assert!(result.is_ok());
        let matches = result.unwrap();
        assert_eq!(matches.len(), 10);
    }

    #[test]
    fn test_create_directory_recursive() {
        let dir = setup_test_dir();
        let path = dir.path()
            .join("a/b/c")
            .to_string_lossy()
            .to_string();

        let result = create_directory(path.clone(), Some(true));
        assert!(result.is_ok());
        assert!(std::path::Path::new(&path).exists());
    }

    #[test]
    fn test_create_directory_already_exists() {
        let dir = setup_test_dir();
        let path = dir.path().to_string_lossy().to_string();

        let result = create_directory(path, Some(true));
        assert!(result.is_ok()); // Should succeed (already exists)
    }

    #[test]
    fn test_delete_path_file() {
        let dir = setup_test_dir();
        let path = create_test_file(&dir, "delete_me.txt", "content");

        assert!(std::path::Path::new(&path).exists());
        let result = delete_path(path.clone(), Some(false));
        assert!(result.is_ok());
        assert!(!std::path::Path::new(&path).exists());
    }

    #[test]
    fn test_delete_path_directory_recursive() {
        let dir = setup_test_dir();
        let subdir = dir.path().join("delete_dir");
        fs::create_dir(&subdir).unwrap();
        fs::write(subdir.join("file.txt"), "content").unwrap();

        let path = subdir.to_string_lossy().to_string();
        let result = delete_path(path.clone(), Some(true));
        assert!(result.is_ok());
        assert!(!std::path::Path::new(&path).exists());
    }

    #[test]
    fn test_move_path_file() {
        let dir = setup_test_dir();
        let source = create_test_file(&dir, "source.txt", "content");
        let dest = dir.path().join("dest.txt").to_string_lossy().to_string();

        let result = move_path(source.clone(), dest.clone());
        assert!(result.is_ok());
        assert!(!std::path::Path::new(&source).exists());
        assert!(std::path::Path::new(&dest).exists());
    }

    #[test]
    fn test_move_path_creates_parent() {
        let dir = setup_test_dir();
        let source = create_test_file(&dir, "source.txt", "content");
        let dest = dir.path()
            .join("nested/dest.txt")
            .to_string_lossy()
            .to_string();

        let result = move_path(source.clone(), dest.clone());
        assert!(result.is_ok());
        assert!(!std::path::Path::new(&source).exists());
        assert!(std::path::Path::new(&dest).exists());
    }

    #[test]
    fn test_copy_path_file() {
        let dir = setup_test_dir();
        let source = create_test_file(&dir, "source.txt", "content");
        let dest = dir.path().join("dest.txt").to_string_lossy().to_string();

        let result = copy_path(source.clone(), dest.clone());
        assert!(result.is_ok());
        assert!(std::path::Path::new(&source).exists());
        assert!(std::path::Path::new(&dest).exists());

        let source_content = fs::read_to_string(&source).unwrap();
        let dest_content = fs::read_to_string(&dest).unwrap();
        assert_eq!(source_content, dest_content);
    }

    #[test]
    fn test_copy_path_directory() {
        let dir = setup_test_dir();
        let source_dir = dir.path().join("source");
        fs::create_dir(&source_dir).unwrap();
        fs::write(source_dir.join("file.txt"), "content").unwrap();

        let dest = dir.path().join("dest").to_string_lossy().to_string();
        let source = source_dir.to_string_lossy().to_string();

        let result = copy_path(source, dest.clone());
        assert!(result.is_ok());
        assert!(std::path::Path::new(&dest).join("file.txt").exists());
    }

    #[test]
    fn test_file_exists_true() {
        let dir = setup_test_dir();
        let path = create_test_file(&dir, "exists.txt", "content");

        let result = file_exists(path, Some(false));
        assert!(result.is_ok());
        assert!(result.unwrap().exists);
    }

    #[test]
    fn test_file_exists_false() {
        let result = file_exists("/nonexistent.txt".to_string(), Some(false));
        assert!(result.is_ok());
        assert!(!result.unwrap().exists);
    }

    #[test]
    fn test_file_exists_with_metadata() {
        let dir = setup_test_dir();
        let path = create_test_file(&dir, "meta.txt", "content");

        let result = file_exists(path, Some(true));
        assert!(result.is_ok());
        
        let metadata = result.unwrap();
        assert!(metadata.exists);
        assert!(metadata.is_file);
        assert!(!metadata.is_dir);
        assert_eq!(metadata.size, 7); // "content" = 7 bytes
    }

    #[tokio::test]
    async fn test_execute_command_success() {
        let command = if cfg!(target_os = "windows") {
            "echo test".to_string()
        } else {
            "echo test".to_string()
        };

        let result = execute_command(command, None, None).await;
        assert!(result.is_ok());
        
        let output = result.unwrap();
        assert!(output.success);
        assert_eq!(output.exit_code, 0);
        assert!(output.stdout.contains("test"));
    }

    #[tokio::test]
    async fn test_execute_command_with_cwd() {
        let dir = setup_test_dir();
        let cwd = dir.path().to_string_lossy().to_string();

        let command = if cfg!(target_os = "windows") {
            "cd".to_string()
        } else {
            "pwd".to_string()
        };

        let result = execute_command(command, Some(cwd.clone()), None).await;
        assert!(result.is_ok());
        
        let output = result.unwrap();
        assert!(output.success);
    }

    #[tokio::test]
    async fn test_execute_command_timeout() {
        let command = if cfg!(target_os = "windows") {
            "timeout /t 10".to_string()
        } else {
            "sleep 10".to_string()
        };

        let result = execute_command(command, None, Some(1000)).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("timed out"));
    }

    #[tokio::test]
    async fn test_execute_command_failure() {
        let command = "nonexistent_command_xyz".to_string();

        let result = execute_command(command, None, None).await;
        // Command should execute but fail
        if let Ok(output) = result {
            assert!(!output.success);
        }
    }
}

// Made with Bob
