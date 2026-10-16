# Changelog

All notable changes to GitHermes are documented in this file. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Repo guard test `test/repo_guard.test.js`: fails if `desktop/plugin.js` contains foreign repository identifiers (`claudiumio`, `claudioorjunior`, `Crome696/`); `sdk_compatibility` also asserts the new homepage/repository/bugs URLs and that no manifest contains `Crome696/githermes` (#32, 253655f, Closes #30).

### Removed
- **BREAKING:** Removed the generic `settings.plugins` contribution fallback for the Goal metrics settings page. GitHermes now registers it only via `ctx.registerSettingsPage(...)`; on Hermes Desktop hosts without that API the **GitHermes** settings page no longer appears (the **GitHub: Goal-Verbrauch** palette entry and pane remain available) (#29, c65aaea, Refs #28).

### Fixed
- `metricsOwner` is captured before the `save` callback is declared or called, so the original gateway/profile is kept if focus changes during session creation (#29, c65aaea, Refs #28).
- Empty or all-null usage snapshots no longer erase known token counters or cost (#29, c65aaea, Refs #28).
- The price-table textarea draft resyncs when the prices store changes externally (#29, c65aaea, Refs #28).

### Security
- The plugin update check and update source (`PLUGIN_REPO`) now point to `CromeSDK-Plugins/githermes` instead of the upstream repository `claudiumio/githermes`; `plugin.yaml` `homepage` (read by the update check) and `package.json` `homepage`/`repository` point there directly instead of relying on GitHub's redirect from `Crome696/githermes`, and `package.json` gains `bugs.url` (#32, 253655f, Closes #30).

[Unreleased]: https://github.com/CromeSDK-Plugins/githermes/compare/v0.5.0...HEAD
