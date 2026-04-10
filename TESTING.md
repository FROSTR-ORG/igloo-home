# Testing

`igloo-home` owns the desktop-host validation surface for the FROSTR desktop app.

## Fast Baseline

```bash
npm run typecheck
npm run test:unit
```

## Recommended Local Validation

```bash
npm run typecheck
npm run test:unit
npm run test:visual
```

This is the recommended local non-popup path:

- typecheck
- unit tests
- headless visual coverage

Use these as separate commands. They intentionally avoid popup-heavy real-window desktop smoke.

## Desktop-Specific Checks

```bash
npm run test:visual
IGLOO_HOME_RUN_DESKTOP_TESTS=1 npm run test:desktop
npm run test:desktop:xvfb
```

Use these when you specifically want desktop-shell validation:

- `test:visual` is the primary local UI-observability path
- `test:desktop` is opt-in minimal real-Tauri shell smoke
- `test:desktop:xvfb` is the preferred Linux path when you want desktop smoke without visible window popups
- shared `test:e2e:igloo-home` launches `igloo-home` in hidden-window test mode by default, so it should not steal focus on a normal desktop session

Visual coverage now includes:

- landing without profiles
- landing with stored profiles on the landing page
- staged onboarding:
  - connect
  - save
- dashboard parity with the shared host shell

## Workspace E2E

Use the shared browser/desktop harness for release validation:

```bash
npm --prefix ../../test run test:e2e:igloo-home
```

That suite is the primary end-to-end coverage for:

- onboarding
- staged onboarding connect/save parity
- import and recovery
- logged-out rotation generation/distribution
- logged-in `Rotate Key`

It now prefers a hidden-window launch and will auto-run under `xvfb` on Linux when no desktop display is available.

## Expected Validation Split

- repo-local tests:
  - typecheck and unit checks via `npm test`
  - visual checks via `npm run test:visual`
  - desktop smoke only when explicitly requested, and only for minimal Tauri shell validation
- workspace test harness:
  - full end-to-end desktop flows
