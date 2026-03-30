## Igloo Home Tests

- `frontend/`: app-local React/Vitest coverage
- `desktop/`: local desktop-process helpers and screenshot smoke harnesses
- `fixtures/`: shared app-local test utilities

### Desktop smoke

- Run with `IGLOO_HOME_RUN_DESKTOP_TESTS=1 npm run test:desktop`
- Requires a live desktop session (`DISPLAY` or `WAYLAND_DISPLAY`) plus `import`, `identify`, and `xwininfo`
- The harness starts `igloo-home` in Tauri test mode, seeds managed profiles through the built-in TCP test server, and captures screenshots for the landing flow and dashboard
- Artifacts are written to a temp directory by default and printed on success or failure

### Visual smoke

- Run with `npm run test:visual`
- Uses headless Chromium against the Vite app with deterministic visual preview scenarios
- Captures landing, seeded landing, create, load, onboard, and dashboard screenshots without requiring Tauri window capture
- This is the primary styling-observability path when desktop compositor screenshot capture is unavailable
