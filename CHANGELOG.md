# Changelog

All notable changes to GitHermes are documented in this file. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### ⚠️ BREAKING CHANGES
- Removed the generic `settings.plugins` contribution fallback for the Goal metrics settings page. GitHermes now registers it only via `ctx.registerSettingsPage(...)`; on Hermes Desktop hosts without that API the **GitHermes** settings page no longer appears (the **GitHub: Goal-Verbrauch** palette entry and pane remain available) (#29, c65aaea).

### Fixed
- `metricsOwner` is captured before the `save` callback is declared or called, so the original gateway/profile is kept if focus changes during session creation (#29, c65aaea).
- Empty or all-null usage snapshots no longer erase known token counters or cost (#29, c65aaea).
- The price-table textarea draft resyncs when the prices store changes externally (#29, c65aaea).
