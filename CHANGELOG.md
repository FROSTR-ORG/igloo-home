# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, adapted for this repository.

## [0.2.0] - 2026-03-27

### Added
- Root project documentation for usage, testing, and contribution flow.
- Explicit group-name input for new-group generation in the desktop create flow.

### Changed
- Generated profile flows now require and persist `groupPackage.groupName` as the canonical shared-group label.
- Local profile state no longer treats remote peer policy observations as durable profile data.

### Fixed
- Desktop generation, onboarding, and rotation live flows now match the current embedded group metadata schema.
