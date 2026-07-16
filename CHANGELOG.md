# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-07-16

First packaged release: Windows installer built and published via the Release
workflow (fixed an invalid `nsis` property in `electron-builder.yml` that
blocked packaging).

### Moderation Suite v2 ([#21](https://github.com/sekkedev/twitchbot/pull/21))
- Added blocked words rule (case-insensitive substring match against a JSON word list).
- Added first-message screening that auto-deletes the first chat from any user with `messages_sent = 0` (subscribers exempt).
- Added per-rule escalation override: `mod_<rule>_start_tier` (1–4) shifts the offence ladder so the first violation can land on any tier.
- Added moderation analytics — `mod:getStats` returns counts by timeframe (today / 7d / 30d), per-rule breakdown, top warned users (30d), and action distribution.
- Added paginated moderation log — `mod:getWarningsPage` with `{ page, pageSize, ruleFilter, sortOrder }` and a 25/page default.
- Added Discord webhook alerts for every mod action, dispatched via the seeded `moderation` embed template (editable in the Webhooks page).
- Rewrote `Moderation.tsx`: stats strip, blocked-words tag input, per-rule start-tier dropdowns, first-message toggle card, Discord alerts section, paginated warnings table with rule filter and Prev/Next.

### Discord Embed Builder ([#19](https://github.com/sekkedev/twitchbot/pull/19))
- Added Webhooks page with three sections: webhook URL manager, visual embed template editor, and a live Discord-style preview that renders as you type.
- Extended the `send_discord_webhook` automation action with an optional `embed` (title, description, color, author, thumbnail, fields, footer, timestamp). Plain-text webhooks unchanged.
- Added embed-template storage and IPC: `webhooks:getTemplates`, `webhooks:saveTemplate`, `webhooks:deleteTemplate`, `webhooks:testEmbed`.
- Extracted `electron/services/discord-webhooks.ts` consolidating webhook URL CRUD, template CRUD, and the payload builder that resolves template variables across every embed field.
- Enriched automation context variables from 6 to 16: raid (`raider`, `raid_size`, `from_channel`), subscription (`tier_label`, `months`, `is_gift`, `is_anonymous`, `sub_message`), cheer (`cheer_message`), and a global `timestamp`.
- New sidebar entry + `/webhooks` route + Alt+7 hotkey.

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
