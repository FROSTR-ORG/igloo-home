mod app;
mod events;
mod models;
mod paths;
mod profiles;
mod session;
mod session_log;
mod settings;
#[cfg(feature = "test-server")]
mod test_mode;

pub use app::run;
