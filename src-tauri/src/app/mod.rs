pub mod bootstrap;
pub mod commands;
pub mod settings;
// Loopback test-dispatch surface — only compiled with the `test-server` feature
// (consumed by the equally gated `test_mode`). Keeping it ungated left the whole
// dispatch chain dead in operator builds.
#[cfg(feature = "test-server")]
pub mod test_api;
#[cfg(feature = "test-server")]
pub mod test_dispatch;
pub mod tray;
pub mod window;

pub use bootstrap::run;
