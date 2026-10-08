# Changelog: java/reminders

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Reminder service on 127.0.0.1:47801: `POST /reminders`, `GET /reminders`,
  `POST /due`; TSV persistence with atomic writes; 19 dependency-free checks.

### Security
- Every request needs the shared `TETO_TOKEN` (stops web pages from forging
  reminders with a plain form POST) and a localhost `Host` header (DNS rebinding).
- Bodies over 8 KB → 413; reminder text over 500 characters → 400.
- Refuses to start without a token.
