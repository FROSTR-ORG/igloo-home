//! Small workspace-internal helpers.

use std::sync::{Mutex, MutexGuard};

use anyhow::Result;

/// Lock helpers that keep a single panicked task from cascading into a flood of
/// secondary panics.
///
/// A panic *while a [`Mutex`] guard is held* poisons the mutex, after which every
/// later `lock().unwrap()` on it panics too. Routing every production lock through
/// these two methods turns that cascade into a single clean failure (or a recovered
/// guard) instead.
pub trait LockExt<T> {
    /// Lock, mapping a poisoned mutex to an `anyhow` error so callers in
    /// `Result`-returning functions can propagate it with `?`.
    fn lock_safe(&self) -> Result<MutexGuard<'_, T>>;

    /// Lock, recovering the inner guard if the mutex is poisoned. For the handful
    /// of accessors that do not return a `Result` and have no meaningful error
    /// path; the data behind the guard is still consistent enough to use.
    fn lock_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
    fn lock_safe(&self) -> Result<MutexGuard<'_, T>> {
        self.lock().map_err(|_| anyhow::anyhow!("mutex poisoned"))
    }

    fn lock_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poison| poison.into_inner())
    }
}
