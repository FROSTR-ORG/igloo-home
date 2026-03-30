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

## Expected Validation Split

- repo-local tests:
  - TypeScript, unit, desktop, and visual checks
- workspace test harness:
  - full end-to-end desktop flows
