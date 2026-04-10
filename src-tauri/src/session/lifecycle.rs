use anyhow::Result;
use tauri::{AppHandle, Emitter};

use crate::events::EVENT_SIGNER_LIFECYCLE;
use crate::models::SignerLifecycleEvent;

use super::AppState;

pub fn emit_lifecycle(app: &AppHandle, state: &AppState, reason: &str) -> Result<()> {
    let (active, share_id, share_name, runtime_dir, last_session) = {
        let guard = state.signer.lock().unwrap();
        let active = guard.active.as_ref();
        (
            active.is_some(),
            active.as_ref().map(|item| item.share_id.clone()),
            active.as_ref().map(|item| item.share_name.clone()),
            active
                .as_ref()
                .map(|item| item.runtime_dir.display().to_string()),
            guard.last_session.clone(),
        )
    };
    let _ = app.emit(
        EVENT_SIGNER_LIFECYCLE,
        SignerLifecycleEvent {
            active,
            reason: reason.to_string(),
            share_id,
            share_name,
            runtime_dir,
            last_session,
        },
    );
    Ok(())
}
