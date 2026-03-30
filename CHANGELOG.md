# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, adapted for this repository.

## [Unreleased]

### Changed
- The desktop host now uses the same landing, load, onboard, and dashboard shell structure as `igloo-pwa`.
- Stored profiles now live directly on the landing page instead of a separate inventory-first desktop view.
- The create and distribution flow now shares more of its task framing with the browser host through `igloo-ui`.

### Fixed
- Desktop onboarding now uses the same staged connect, review, and save flow shape as the browser host.
- Desktop test runs skip tray initialization in test mode to avoid noisy GTK and app-indicator warnings.

## [0.2.0] - 2026-03-27

### Added
- Root project documentation for usage, testing, and contribution flow.
- Explicit group-name input for new-group generation in the desktop create flow.

### Changed
- Generated profile flows now require and persist `groupPackage.groupName` as the canonical shared-group label.
- Local profile state no longer treats remote peer policy observations as durable profile data.

### Fixed
- Desktop generation, onboarding, and rotation live flows now match the current embedded group metadata schema.
