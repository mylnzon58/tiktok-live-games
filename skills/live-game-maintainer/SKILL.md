---
name: live-game-maintainer
description: Use this skill when modifying the TikTok LIVE games in this repository, including server.js, lib modules, overlay, arena, scoring, socket events, persistence, or gameplay UX. It enforces clean responsibilities, removes dead code/contracts, avoids hardcoded secrets, and requires validation after edits.
---

# Live Game Maintainer

## Goals

- Keep `server.js` as the source of truth for connection state, scoring, timers, persistence, and socket contracts.
- Keep `overlay.js` and `arena.js` as presentation layers. Frontend may own local-only visual FX, but not authoritative scoring rules.
- Treat `/overlay` and `/arena` as separate gameplay products that share infrastructure only. Do not mix UX rules, labels, or design assumptions between them.
- Remove dead events, duplicate DOM ids, unused branches, and stale listeners whenever they are discovered.
- Prefer small reusable helpers in `lib/` over growing monoliths in `server.js`.

## Hard Rules

- Never hardcode TikTok credentials, cookies, session IDs, or target IDC values. Read them from environment variables.
- Prefer loading `.env` locally for developer convenience, but keep `.env` ignored and ship only `.env.example`.
- If a socket event is emitted, verify at least one active consumer exists. If a client listens to an event, verify the server emits it.
- Do not keep duplicate gameplay logic in both server and client. Scores and ranking live on the server.
- If the client keeps local-only combat state for visuals, do not let that leak into authoritative ranking.
- Do not leave debug-only code half-connected. Either wire it correctly or delete it.
- Avoid duplicate HTML ids and DOM queries for missing elements.
- Do not rely on a static TikTok gift catalog for score fairness. Prefer event payload values such as `diamond_count`, with local aliases only as fallback for debug or missing payloads.
- Preserve user changes already present in the worktree unless they directly conflict with the requested fix.

## Responsibilities by File

- `server.js`: TikTok connection lifecycle, event normalization, scoring rules, timer flow, socket emission.
- `lib/arena-manager.js`: arena state, HOF persistence, ranking derivation, cleanup.
- `lib/game-config.js`: central gameplay constants and timing.
- `lib/gift-catalog.js`: extensible mapping of gift identity to score, power, FX, and SFX tiers.
- `lib/live-event-adapter.js`: normalize TikTok payloads before gameplay code touches them.
- `lib/ranking-manager.js`: country ranking state only.
- `overlay.js`: countries UI, connection status UI, ranking animations.
- `arena.js`: arena rendering, effects, non-authoritative local animation state.

## Change Workflow

1. Read the emitter and consumer for every affected socket event.
2. Decide which side is authoritative before editing.
3. If state belongs to gameplay rules, move it to server or `lib/`.
4. Delete stale code paths instead of leaving compatibility ghosts.
5. Keep helpers named by responsibility, not by feature hype.

## Validation

After edits, run:

```bash
npm exec eslint server.js lib/*.js overlay.js arena.js
node --check server.js
node --check lib/arena-manager.js
node --check lib/ranking-manager.js
node --check overlay.js
node --check arena.js
```

If a socket contract changed, also inspect both sides with ripgrep:

```bash
rg -n "leaderChanged|arena:currentRanking|arena:hallOfFameUpdate|ranking:championUpdate|arena:gift|arena:like|arena:chatPower" server.js arena.js overlay.js lib
```

## Repo Invariants

- `/` serves countries overlay.
- `/arena` serves arena mode.
- Countries game ranking must react consistently to gifts, likes, chat country selection, timer reset, and champion persistence.
- Arena ranking must update from server-authoritative score data and never depend on dead socket events.
- Arena HP/state/respawn must come from server state, even if the client adds immediate local FX.
- Hall of Fame data must represent a meaningful persistent metric, not transient reset state.
