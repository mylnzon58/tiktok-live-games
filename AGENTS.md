# Repository Instructions

## Available skills

### live-game-maintainer
- Description: Maintains the TikTok LIVE games in this repo (server.js, lib/, overlay, arena, titan, versus) with clear server/client responsibilities, no dead socket contracts, no hardcoded secrets, throttled high-frequency events, and required validation after edits.
- Path: `C:\Users\Juanj\Desktop\mylnzon58GameRankPaisTik\skills\live-game-maintainer\SKILL.md`

## Trigger rules

- Use `live-game-maintainer` whenever touching `server.js`, anything in `lib/`, `overlay.*`, `arena.*`, `titan/*`, `versus/*`, or gameplay JSON/state files.
- If the work changes socket events, scoring, timers, gifts, likes, chat handling, persistence, or UI/gameplay coupling, use the skill before editing.

## Commands

- `npm start` — run the server (port 3000).
- `npm run lint` — eslint on server and client code.
- `npm run check` — `node --check` syntax validation on all JS entry points.
