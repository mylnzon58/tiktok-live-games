# Repository Instructions

## Available skills

### live-game-maintainer
- Description: Maintains the TikTok LIVE games in this repo with clear server/client responsibilities, no dead socket contracts, no hardcoded secrets, and required validation after edits.
- Path: `/Users/macos/Desktop/GameRankPaisTik/skills/live-game-maintainer/SKILL.md`

## Trigger rules

- Use `live-game-maintainer` whenever touching `server.js`, anything in `lib/`, `overlay.*`, `arena.*`, or gameplay JSON/state files.
- If the work changes socket events, scoring, timers, gifts, likes, chat handling, persistence, or UI/gameplay coupling, use the skill before editing.

