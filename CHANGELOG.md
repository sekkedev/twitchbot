# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-23

Initial release.

### Core
- Electron + React + TypeScript + Vite desktop app (Windows target).
- Local SQLite storage via `better-sqlite3` with WAL, foreign keys, idempotent schema.
- 5 dashboard pages: Dashboard, Commands, Loyalty, Analytics, Settings.

### Twitch integration
- OAuth2 sign-in flow (Authorization Code), tokens encrypted via Electron `safeStorage`.
- In-app Twitch application credentials form — no more `.env` hand-editing required.
- `tmi.js` chat connection with 1 msg/sec rate-limited outbound queue.
- EventSub websocket covering `channel.follow` v2, `channel.subscribe`, `channel.subscription.gift`, `channel.subscription.message`, `channel.cheer`, `channel.raid`, `stream.online`, `stream.offline`.
- Follower-status resolved via Helix with a 15-minute cache, warmed by `channel.follow` events.
- Helix `/streams` probe on bot connect reconciles local session state with Twitch across restarts.
- EventSub reconnect silently backfills missed followers.

### EXP + loyalty
- Configurable EXP sources (message, watch time, follow, subscribe, gift sub, cheer, raid, streak bonus, admin).
- Level formula `floor(base × level^exponent)` with live curve preview in Settings.
- Per-user 30-EXP/min chat cap with in-memory sliding window.
- Session + streak tracking: 60s watch ticks, streak-continuation detection, streak bonuses.
- Admin EXP adjustments with reason tracking, clamped to zero minimum.

### UI
- Dark Twitch-adjacent theme with status-dot live indicator, pulse animation, and consistent sizing tokens.
- Pop-outable Live feed and Top viewers panels (independent `BrowserWindow`s).
- Ring-buffered feed replay so new windows and reloads start populated.
- Themed multi-step confirm dialog (3-step type-to-confirm on dangerous actions).
- ErrorBoundary + crash recovery UI + main-process render-error logging.
- Loading skeletons for Commands and Loyalty tables.
- Database export via SQLite online backup API (safe while bot is live).

### Security
- Encrypted at rest: OAuth tokens and application credentials.
- Content Security Policy locked down for packaged builds.
- No telemetry. App talks only to `id.twitch.tv`, `api.twitch.tv`, and the two Twitch WebSockets.

### Testing
- 45 Vitest unit tests against pure logic (leveling, command-logic, settings-normalize).
- 53 integration tests exercising all IPC-backing services against a disposable SQLite DB.
- Clean TypeScript strict-mode typechecks (`noUnusedLocals`, `noUnusedParameters`).

### Scripts
- `scripts/seed-db.cjs` — generates small/medium/large synthetic channels for load testing.
- `scripts/inspect-db.cjs` — read-only DB dump.
- `scripts/test-ipc.cjs` — integration test suite runner.
