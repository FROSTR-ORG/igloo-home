# igloo-home

Desktop Tauri host for FROSTR.

`igloo-home` is the desktop-oriented Igloo application. It owns desktop packaging, the Tauri backend boundary, and the desktop operator workflows built on the shared browser/runtime stack and shared host shell.

## Status

- Beta.

## Owns

- desktop host packaging and Tauri integration
- desktop profile import, recovery, staged onboarding, and rotation flows
- desktop-native file and dialog interactions
- desktop test harnesses and desktop-specific validation

## Does Not Own

- shared browser/runtime adapters and package codecs
- shared flow-level UI shell and host-shell components
- core signer, router, bridge, and cryptographic logic

## Build

Workspace-owned entrypoints are the default for cross-repo flows:

```bash
make igloo-home-build
make igloo-home-dev
make igloo-home-test-e2e
```

For repo-local work inside `repos/igloo-home`, use the prep-first scripts:

```bash
npm install
npm run build
```

For local desktop development:

```bash
npm run dev
npm run tauri dev
```

## Desktop Flow Model

- landing page shows stored profiles directly; the old inventory-first desktop shell is retired
- create and load use the same shared host-shell framing as `igloo-pwa`
- onboarding is staged:
  - connect a `bfonboard`
  - review the resolved profile preview
  - save the device locally with a passphrase
- desktop-specific behavior stays local to this repo:
  - Tauri command wiring
  - native dialogs and save/open flows
  - desktop runtime/session orchestration
- the signer dashboard refresh action actively refreshes runtime peers and reports
  partial per-peer failures inline instead of silently reloading the last snapshot

## Test

Repo-local checks:

```bash
bunx tsc --noEmit
npm run test:unit
npm run test:desktop
npm run test:visual
```

Workspace E2E coverage:

```bash
make igloo-home-test-e2e
```

## Project Docs

- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
