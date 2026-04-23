# TwitchBot

A local, privacy-respecting Twitch bot with a loyalty/EXP system, custom commands, and a live dashboard. Runs as an Electron app on your own machine — no servers, no third parties, no telemetry.

- Twitch OAuth sign-in (tokens encrypted at rest)
- `tmi.js` chat + EventSub websocket (follows, subs, cheers, raids, streams)
- Local SQLite storage (browseable / exportable)
- Custom commands with set-based permissions, cooldowns, and `{variable}` interpolation
- 5 built-in commands: `!rank`, `!leaderboard`, `!streak`, `!watchtime`, `!commands`
- EXP system with configurable values, level scaling, anti-abuse caps, and watch streaks
- Dashboard with a live event feed, top viewers, and pop-outable panels
- Settings, Commands, Loyalty, Analytics pages — all operate on your local data

## Quick start

1. **Register a Twitch app.** Visit [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → **Register Your Application**. Fill in:
   - **OAuth Redirect URL:** `http://localhost:42817/callback` (exact match, including port)
   - **Client Type:** `Confidential`
   - Save, then copy the **Client ID** and generate a **Client Secret**.

2. **Run the app.** Requires Node.js 20+.

   ```powershell
   git clone <repo>
   cd twitchbot
   npm install
   npm run dev
   ```

3. **Enter your credentials.** On first launch you'll see a credentials form. Paste your Client ID and Client Secret — they're encrypted with Electron's `safeStorage` and saved locally only.

4. **Connect to Twitch.** Click the button, authorize in the browser, come back to the app.

5. **Connect the bot** from the top bar. The live feed lights up with chat, follows, subs, cheers, raids.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite + Electron in watch mode |
| `npm run build` | Production build (renderer + main) |
| `npm run typecheck` | Strict typecheck of both projects |
| `npm test` | Vitest unit tests (~45 assertions) |
| `npm run test:ipc` | Integration tests against a disposable SQLite DB (~53 assertions) |

### Development utilities

```powershell
# Stop `npm run dev` first — these need exclusive DB access.
npx electron scripts/seed-db.cjs --size=small    # 120 users, 12 streams, ~2.5k events
npx electron scripts/seed-db.cjs --size=medium   # 600 users, 30 streams, ~12k events
npx electron scripts/seed-db.cjs --size=large    # 1800 users, 60 streams, ~35k events

npx electron scripts/inspect-db.cjs              # Read-only dump of current DB state
```

`seed-db.cjs` wipes generated tables (`users`, `events`, `sessions`, `viewer_sessions`, `commands`) but **preserves** your settings.

## Configuration

All settings are editable at runtime from the **Settings** page — EXP per event, level-up formula, cooldowns, announcement template, streak rules. Changes apply live without a restart.

For developers, credentials can also be provided via `.env` at the project root (useful for scripted dev setups). The UI takes precedence:

```env
TWITCH_CLIENT_ID=your_client_id_here
TWITCH_CLIENT_SECRET=your_client_secret_here
```

`.env` is git-ignored. **Never commit your Client Secret.**

## Project layout

```
electron/
  lib/        Pure logic (tested by Vitest)
  ipc/        IPC handlers — thin, { success, data, error } envelope
  services/   Stateful: DB, Twitch auth, chat, EventSub, EXP, streaks
  db/         Schema + migrations folder (reserved)
src/
  lib/        Renderer helpers + shared types
  stores/     Zustand store for ambient state
  components/ Presentation components
  pages/      One file per route
scripts/      Dev utilities (seed, inspect, test runners)
```

## Tech stack

Electron · React 18 · Vite · TypeScript · Tailwind CSS · `tmi.js` · Twitch EventSub · `better-sqlite3` · Zustand · Recharts · Vitest

## Contributing

PRs welcome. Before opening one, please run:

```powershell
npm run typecheck
npm test
npm run build
```

CI runs the same checks on every PR.

## License

[MIT](LICENSE)
