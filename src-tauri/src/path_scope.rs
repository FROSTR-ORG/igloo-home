//! Path canonicalization and scope enforcement for Tauri command inputs.
//!
//! The renderer can hand the backend arbitrary path strings. We canonicalize
//! those paths (resolving `..`, symlinks, and relative components) and
//! require that the result lives inside one of a small set of allowed roots
//! (app data dir, user Documents dir, etc.). Anything that escapes the
//! allow-list is rejected with a typed [`PathScopeError`] before it can
//! touch the filesystem.

use std::fmt;
use std::path::{Path, PathBuf};

/// Error returned by [`canonicalize_under_scope`].
#[derive(Debug)]
pub enum PathScopeError {
    /// Filesystem IO error while canonicalizing the input or a root.
    Io(std::io::Error),
    /// Input path has no parent component (e.g. `""` or a bare root).
    NoParent,
    /// Input path has no final component (e.g. `/`).
    NoFileName,
    /// Canonical input path does not live inside any allowed root.
    OutsideAllowedRoots {
        /// Canonicalized input path.
        path: PathBuf,
        /// Allowed roots the caller supplied (not canonicalized here —
        /// they are the raw roots passed in for diagnostic purposes).
        roots: Vec<PathBuf>,
    },
}

impl fmt::Display for PathScopeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "path canonicalization failed: {error}"),
            Self::NoParent => write!(f, "path has no parent component"),
            Self::NoFileName => write!(f, "path has no file-name component"),
            Self::OutsideAllowedRoots { path, roots } => {
                let roots = roots
                    .iter()
                    .map(|root| root.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(
                    f,
                    "path {} is outside the allowed scope (roots: {roots})",
                    path.display()
                )
            }
        }
    }
}

impl std::error::Error for PathScopeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for PathScopeError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

/// Canonicalize `raw` and return the canonical path only if it lives
/// inside one of `allowed_roots`.
///
/// Algorithm:
/// 1. If the input path exists, call [`Path::canonicalize`] on it.
/// 2. If the input path does not exist, canonicalize its parent and
///    join the final component. This supports "export destination"
///    style inputs where the target file does not exist yet but its
///    parent directory must.
/// 3. Canonicalize each allowed root. If the canonical input
///    `starts_with` any canonical root, return the canonical input.
/// 4. Otherwise return [`PathScopeError::OutsideAllowedRoots`].
///
/// Symlinks are resolved by [`Path::canonicalize`], so a symlink inside
/// an allowed root that points outside the scope will canonicalize to
/// its real target and be rejected.
pub fn canonicalize_under_scope(
    raw: &str,
    allowed_roots: &[PathBuf],
) -> Result<PathBuf, PathScopeError> {
    let input = Path::new(raw);

    let canonical = if input.exists() {
        input.canonicalize()?
    } else {
        let parent = input.parent().ok_or(PathScopeError::NoParent)?;
        let file_name = input.file_name().ok_or(PathScopeError::NoFileName)?;
        // A parent of `""` is `Some("")` but does not exist on disk; treat
        // that as a missing parent so callers get a descriptive error
        // instead of a confusing IO error.
        if parent.as_os_str().is_empty() {
            return Err(PathScopeError::NoParent);
        }
        parent.canonicalize()?.join(file_name)
    };

    for root in allowed_roots {
        let canonical_root = root.canonicalize()?;
        if canonical.starts_with(&canonical_root) {
            return Ok(canonical);
        }
    }

    Err(PathScopeError::OutsideAllowedRoots {
        path: canonical,
        roots: allowed_roots.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    fn make_scope_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "igloo-home-path-scope-test-{label}-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create scope root");
        root
    }

    #[test]
    fn canonicalize_under_scope_accepts_child_of_allowed_root() {
        let root = make_scope_root("accepts-child");
        let child_path = root.join("nested").join("file.bfprofile");
        fs::create_dir_all(child_path.parent().unwrap()).expect("create nested dir");
        fs::write(&child_path, b"test").expect("write test file");

        let canonical = canonicalize_under_scope(
            child_path.to_str().expect("utf8 path"),
            std::slice::from_ref(&root),
        )
        .expect("child should be accepted");

        assert!(
            canonical.starts_with(root.canonicalize().expect("canonical root")),
            "canonical path {canonical:?} should live under root"
        );
    }

    #[test]
    fn canonicalize_under_scope_rejects_path_traversal() {
        let root = make_scope_root("traversal");

        // Craft a traversal path rooted inside the allowed dir; canonicalize
        // must resolve `..` and notice the result escapes the root.
        let traversal = root.join("..").join("..").join("etc").join("passwd");

        let result = canonicalize_under_scope(
            traversal.to_str().expect("utf8 path"),
            std::slice::from_ref(&root),
        );

        match result {
            Err(PathScopeError::OutsideAllowedRoots { path, .. }) => {
                assert!(
                    !path.starts_with(root.canonicalize().expect("canonical root")),
                    "resolved traversal path should escape the root"
                );
            }
            Err(PathScopeError::Io(_)) => {
                // `/etc/passwd` exists on this host but not every sandbox has
                // it. Treat "nonexistent + nonexistent parent" IO error the
                // same as the typed reject: the scope check never got to say
                // "accepted", which is the security property we care about.
            }
            other => panic!("expected OutsideAllowedRoots or Io, got {other:?}"),
        }
    }

    #[test]
    #[cfg(unix)]
    fn canonicalize_under_scope_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = make_scope_root("symlink-escape");
        let outside = make_scope_root("symlink-target");

        let link_path = root.join("escape");
        symlink(&outside, &link_path).expect("create symlink");

        let result = canonicalize_under_scope(
            link_path.to_str().expect("utf8 path"),
            std::slice::from_ref(&root),
        );

        match result {
            Err(PathScopeError::OutsideAllowedRoots { path, .. }) => {
                let canonical_outside = outside.canonicalize().expect("canonical outside");
                assert!(
                    path.starts_with(&canonical_outside),
                    "symlink should resolve to outside target: path={path:?} outside={canonical_outside:?}"
                );
            }
            other => panic!("expected OutsideAllowedRoots, got {other:?}"),
        }
    }

    #[test]
    fn canonicalize_under_scope_rejects_absolute_path_outside_roots() {
        let root = make_scope_root("absolute-outside");
        let other = make_scope_root("absolute-other");

        // `other` is a real directory outside `root`; request it directly.
        let result = canonicalize_under_scope(
            other.to_str().expect("utf8 path"),
            std::slice::from_ref(&root),
        );

        match result {
            Err(PathScopeError::OutsideAllowedRoots { path, .. }) => {
                assert_eq!(path, other.canonicalize().expect("canonical other"));
            }
            other => panic!("expected OutsideAllowedRoots, got {other:?}"),
        }
    }

    #[test]
    fn canonicalize_under_scope_handles_non_existent_paths() {
        let root = make_scope_root("nonexistent");

        // The target file does not yet exist (fresh export destination), but
        // the parent directory does.
        let dest = root.join("new-export.bfprofile");
        assert!(!dest.exists(), "precondition: dest must not exist");

        let canonical = canonicalize_under_scope(
            dest.to_str().expect("utf8 path"),
            std::slice::from_ref(&root),
        )
        .expect("nonexistent child with existing parent must be accepted");

        let canonical_root = root.canonicalize().expect("canonical root");
        assert!(
            canonical.starts_with(&canonical_root),
            "canonical {canonical:?} should live under {canonical_root:?}"
        );
        assert_eq!(
            canonical.file_name().and_then(|n| n.to_str()),
            Some("new-export.bfprofile")
        );
    }

    #[test]
    fn canonicalize_under_scope_rejects_nonexistent_parent() {
        let root = make_scope_root("missing-parent");
        let dest = root.join("does-not-exist").join("file.bfprofile");

        let result = canonicalize_under_scope(
            dest.to_str().expect("utf8 path"),
            std::slice::from_ref(&root),
        );

        match result {
            Err(PathScopeError::Io(_)) => {}
            other => panic!("expected Io (parent missing), got {other:?}"),
        }
    }

    #[test]
    fn canonicalize_under_scope_accepts_multiple_roots() {
        let root_a = make_scope_root("multi-a");
        let root_b = make_scope_root("multi-b");

        let dest = root_b.join("export.bfprofile");
        fs::write(&dest, b"data").expect("write dest");

        let canonical = canonicalize_under_scope(
            dest.to_str().expect("utf8 path"),
            &[root_a.clone(), root_b.clone()],
        )
        .expect("second root should accept child");

        assert!(canonical.starts_with(root_b.canonicalize().expect("canonical b")));
    }
}
