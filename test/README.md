## Igloo Home Tests

- `frontend/`: app-local React/Vitest coverage
- `desktop/`: local desktop-process helpers and screenshot smoke harnesses
- `fixtures/`: shared app-local test utilities

### Desktop smoke

- Run manually with `IGLOO_HOME_RUN_DESKTOP_TESTS=1 npm run test:desktop`
- Preferred local non-popup path on Linux: `npm run test:desktop:xvfb`
- Requires a live desktop session (`DISPLAY` or `WAYLAND_DISPLAY`) plus `import`, `identify`, and `xwininfo` unless run through the `xvfb` wrapper
- The harness starts `igloo-home` in Tauri test mode, seeds one managed profile through the built-in TCP test server, and captures only a landing shot plus one post-seed dashboard shot as minimal desktop smoke
- Artifacts are written to a temp directory by default and printed on success or failure
- Desktop smoke explicitly opts back into showing the main Tauri window; other automated `igloo-home` test-mode launches keep it hidden by default

### Visual smoke

- Run with `npm run test:visual`
- Uses headless Chromium against the Vite app with deterministic visual preview scenarios
- Captures landing, seeded landing, create, load, onboard, and dashboard screenshots without requiring Tauri window capture
- This is the primary local UI-observability path and the recommended default instead of popup-heavy desktop smoke

### Shared E2E

- `npm --prefix ../../test run test:e2e:igloo-home` now launches `igloo-home` with the test TCP bridge enabled and the main window hidden by default
- That shared E2E path now runs directly when `DISPLAY` or `WAYLAND_DISPLAY` is available, and otherwise auto-falls back to `xvfb-run` when present
- Visible desktop windows are no longer part of the normal shared E2E path; explicit desktop smoke is the only window-showing test mode
