# igloo-home

Desktop Tauri host for FROSTR.

`igloo-home` is the desktop-oriented Igloo application. It owns desktop packaging, the Tauri backend boundary, and the desktop operator and device-management workflows built on the shared browser/runtime stack.

## Status

- Beta.

## Owns

- desktop host packaging and Tauri integration
- desktop profile import, recovery, onboarding, and rotation flows
- desktop-native file and dialog interactions
- desktop test harnesses and desktop-specific validation

## Does Not Own

- shared browser/runtime adapters and package codecs
- shared UI primitives
- core signer, router, bridge, and cryptographic logic

## Build

```bash
npm install
npm run build
```

For local desktop development:

```bash
npm run dev
npm run tauri dev
```

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
npm --prefix ../../test run test:e2e:igloo-home
```

## Project Docs

- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
