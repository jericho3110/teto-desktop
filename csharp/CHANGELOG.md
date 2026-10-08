# Changelog: csharp/

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `TetoCompanion.exe`: tray icon with Voice toggle and Quit, notifications
  (balloon tips = toasts on Windows 10/11), speech for replies (Markdown
  cleaned for speaking), single instance.
- Named-pipe listener restricted to the current user (`PipeOptions.CurrentUserOnly`)
  that refuses to join a pre-existing pipe (`FirstPipeInstance`);
  messages validated and size-limited.
- 13 xUnit tests.
