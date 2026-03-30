# Contributing

This file explains the local editing boundaries for `igloo-home`.

## Repo Shape

`igloo-home` is split between:

- `src/`
  - React desktop UI and host-shell orchestration
- `src-tauri/`
  - Tauri/native backend, commands, and desktop storage/runtime integration

Keep desktop UI concerns in `src/` and desktop-native behavior in `src-tauri/`.

## Ownership Rules

`igloo-home` owns:

- the desktop host surface
- Tauri command wiring
- desktop-specific storage, dialogs, and packaging behavior
- desktop integration tests and desktop validation flows
- desktop-specific staged onboarding orchestration

It does not own:

- shared React UI primitives or shared host-shell flow components
- shared browser/runtime adapter logic
- Rust signer/router/bridge core behavior
- onboarding finalization and persistence logic

## Editing Guidance

- Prefer reusing `igloo-ui` components rather than duplicating presentational UI.
- Prefer shared host-shell sections from `igloo-ui` for create/load/onboard/dashboard flow bodies.
- Keep package, onboarding, recovery, and rotation semantics aligned with the shared FROSTR docs and shared helpers.
- Treat the desktop host as a consumer of shared runtime/package logic, not as a parallel protocol spec.
- Keep staged onboarding split between UI flow state in `src/`, pending-session orchestration in `src-tauri/`, and reusable finalize/persist logic in `igloo-shell-core`.
- Update `README.md` and `TESTING.md` when desktop workflows or validation entrypoints change.
