# Testing

`igloo-home` owns the desktop-host validation surface for the FROSTR desktop app.

## Fast Baseline

```bash
bunx tsc --noEmit
npm run test:unit
```

## Desktop-Specific Checks

```bash
npm run test:desktop
npm run test:visual
```

These cover the Tauri-backed desktop shell and desktop-only rendering behavior.

## Workspace E2E

Use the shared browser/desktop harness for release validation:

```bash
npm --prefix ../../test run test:e2e:igloo-home
```

That suite is the primary end-to-end coverage for:

- onboarding
- import and recovery
- logged-out rotation generation/distribution
- logged-in `Rotate Key`

## Expected Validation Split

- repo-local tests:
  - TypeScript, unit, desktop, and visual checks
- workspace test harness:
  - full end-to-end desktop flows
