# Changelog: csharp/

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Tray menu says what it is ("voice & notifications") and that turning it
  off leaves Teto running (it used to say "Quit companion", which looked
  like quitting Teto).

### Added
- Teto's voice: babble from her official UTAU voicebank (downloaded by the
  user, never bundled), kana spoken as syllables, crossfades, gentle pitch
  variation; tray menu Voice → Teto / Windows / Off. Defensive WAV and
  oto.ini parsing (lying chunk sizes, path traversal, Shift-JIS). 33 tests.
- `TetoCompanion.exe`: tray icon with Voice toggle and Quit, notifications
  (balloon tips = toasts on Windows 10/11), speech for replies (Markdown
  cleaned for speaking), single instance.
- Named-pipe listener restricted to the current user (`PipeOptions.CurrentUserOnly`)
  that refuses to join a pre-existing pipe (`FirstPipeInstance`);
  messages validated and size-limited.
- 13 xUnit tests.
