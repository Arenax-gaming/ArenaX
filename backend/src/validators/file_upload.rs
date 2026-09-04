//! Centralized file upload validation: filename sanitization, extension /
//! MIME allowlisting, and size limits.
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileUploadError {
    EmptyFilename,
    PathTraversal,
    DisallowedExtension(String),
    DisallowedContentType(String),
    ExtensionContentTypeMismatch,
    TooLarge { size: usize, max: usize },
}

impl fmt::Display for FileUploadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyFilename => write!(f, "filename must not be empty"),
            Self::PathTraversal => write!(f, "filename contains path traversal characters"),
            Self::DisallowedExtension(ext) => write!(f, "file extension '{ext}' is not allowed"),
            Self::DisallowedContentType(ct) => write!(f, "content type '{ct}' is not allowed"),
            Self::ExtensionContentTypeMismatch => {
                write!(f, "file extension does not match declared content type")
            }
            Self::TooLarge { size, max } => {
                write!(f, "file size {size} bytes exceeds maximum of {max} bytes")
            }
        }
    }
}

impl std::error::Error for FileUploadError {}

/// Upload constraints for a given endpoint (avatar upload, match evidence,
/// etc). Construct with [`FileUploadRules::images`] for the common case, or
/// build directly for a custom allowlist.
pub struct FileUploadRules {
    pub allowed_extensions: &'static [&'static str],
    pub allowed_content_types: &'static [&'static str],
    pub max_size_bytes: usize,
}

impl FileUploadRules {
    /// Common image-upload policy: jpg/jpeg/png/webp, 5 MiB max.
    pub fn images() -> Self {
        Self {
            allowed_extensions: &["jpg", "jpeg", "png", "webp"],
            allowed_content_types: &["image/jpeg", "image/png", "image/webp"],
            max_size_bytes: 5 * 1024 * 1024,
        }
    }
}

/// Sanitize an untrusted filename: strip any directory components and
/// reject characters outside a conservative safe set, so the result is
/// always safe to use as a bare filename (never re-parented via `..`, never
/// containing null bytes or path separators).
pub fn sanitize_filename(input: &str) -> Result<String, FileUploadError> {
    if input.trim().is_empty() {
        return Err(FileUploadError::EmptyFilename);
    }

    // Take only the final path component, defeating `../../etc/passwd`
    // style traversal regardless of the separator style supplied.
    let base = input
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(input)
        .trim();

    if base.is_empty() || base == "." || base == ".." {
        return Err(FileUploadError::PathTraversal);
    }

    let sanitized: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.contains("..") {
        return Err(FileUploadError::PathTraversal);
    }

    Ok(sanitized)
}

fn extension_of(filename: &str) -> Option<String> {
    filename
        .rsplit('.')
        .next()
        .filter(|ext| *ext != filename)
        .map(|ext| ext.to_ascii_lowercase())
}

/// Validate an uploaded file's name, declared content type, and size
/// against `rules`. Returns the sanitized filename on success.
///
/// This checks metadata only (name/type/size) — callers handling files
/// where content spoofing is a serious concern (executables disguised with
/// an image extension) should additionally verify the file's magic bytes
/// server-side before persisting it.
pub fn validate_file_upload(
    filename: &str,
    content_type: &str,
    size_bytes: usize,
    rules: &FileUploadRules,
) -> Result<String, FileUploadError> {
    let sanitized = sanitize_filename(filename)?;

    if size_bytes > rules.max_size_bytes {
        return Err(FileUploadError::TooLarge {
            size: size_bytes,
            max: rules.max_size_bytes,
        });
    }

    let content_type_normalized = content_type.trim().to_ascii_lowercase();
    if !rules
        .allowed_content_types
        .iter()
        .any(|ct| *ct == content_type_normalized)
    {
        return Err(FileUploadError::DisallowedContentType(content_type_normalized));
    }

    let ext = extension_of(&sanitized).ok_or_else(|| {
        FileUploadError::DisallowedExtension("(none)".to_string())
    })?;
    if !rules.allowed_extensions.iter().any(|e| *e == ext) {
        return Err(FileUploadError::DisallowedExtension(ext));
    }

    // Reject the classic `evil.php.jpg` double-extension trick: every
    // dot-separated segment before the final extension must itself look
    // like a plausible extension-free filename, i.e. we simply require
    // there be exactly one dot, matching a single trusted extension.
    if sanitized.matches('.').count() > 1 {
        return Err(FileUploadError::ExtensionContentTypeMismatch);
    }

    Ok(sanitized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_path_traversal() {
        assert_eq!(
            sanitize_filename("../../etc/passwd").unwrap(),
            "passwd"
        );
    }

    #[test]
    fn accepts_valid_image_upload() {
        let rules = FileUploadRules::images();
        let result = validate_file_upload("avatar.png", "image/png", 1024, &rules);
        assert_eq!(result.unwrap(), "avatar.png");
    }

    #[test]
    fn rejects_double_extension() {
        let rules = FileUploadRules::images();
        let result = validate_file_upload("evil.php.png", "image/png", 1024, &rules);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_oversized_file() {
        let rules = FileUploadRules::images();
        let result = validate_file_upload("avatar.png", "image/png", 100 * 1024 * 1024, &rules);
        assert_eq!(
            result,
            Err(FileUploadError::TooLarge {
                size: 100 * 1024 * 1024,
                max: rules.max_size_bytes
            })
        );
    }
}
