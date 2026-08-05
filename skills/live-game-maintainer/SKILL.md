---
name: live-game-maintainer
description: Use this skill when modifying the TikTok LIVE games in this repository, including server.js, lib modules, overlay, arena, titan, versus, scoring, socket events, persistence, or gameplay UX. It enforces clear server/client responsibilities, removes dead code and dead socket contracts, avoids hardcoded secrets, and requires validation after every edit.
---

# Live Game Maintainer

## Goals

- Keep `server.js` as the single integration point: TikTok connection lifecycle, event normalization, delegation to game managers, and socket contract wiring. Game rules live in their own managers.
- One manager per game: `lib/arena-manager.js` (Plinko/Avatares), `lib/countries-manager.js` (Batalla de Países), `titan/titan-manager.js` (Guerra de Titanes), `versus/versus-manager.js` (Versus Político).
- Frontend files are presentation layers only: `overlay.js`, `arena.js`, `arena-game/arena.js`, `titan/public/game.js`, `versus/public/app.js`. They may own local-only visual FX but never authoritative scoring.
- Every socket event has one emitter and at least one consumer. No dead events, no stale listeners.
- No hardcoded secrets. TikTok credentials come from environment variables (see `lib/env.js` and `.env.example`).
- Prefer small reusable helpers in `lib/` over monoliths in `server.js`.

## Game Manager Responsibilities

### lib/arena-manager.js — Plinko de Avatares (/arena)
- Owns arena state: players, positions, scores, HP, states, buckets, hall of fame, ranking derivation.
- Exposes: `ensurePlayer`, `applyBucketBonus`, `applyBombPenalty`, `syncPosition`, `getPlayers`, `getCurrentRanking`, `cleanup`, `seedVictories`, `setLastWinnerId`, `getLastWinnerId`, `getHallOfFameList`.
- Never touches `io` directly; emits nothing. server.js emits `arena:*` events from manager results.

### lib/countries-manager.js — Batalla de Países (/overlay)
- Owns countries ranking state: scores, donors, avatars, round timer, leader tracking, champion persistence.
- Handles gifts (score += diamonds*repeat, big-gift threshold, avatars), likes (visual only), chat (country join).
- Emits: `rankingUpdate`, `ranking:gift`, `ranking:like`, `ranking:countryJoined`, `leaderChanged`, `bigGift`, `roundReset`, `ranking:championUpdate`.
- Round cycle: 7 minutes, winner announced on `roundReset`, champion persisted via `createStorage("countries_champion.json", ...)`.

### titan/titan-manager.js — Guerra de Titanes (/titan)
- Owns titan state: team scores, bar, charges, combos, multipliers, sudden death, round lifecycle, HOF persistence.
- Handles gifts (pick team, chaos/sabotage, combo, catch-up, final push), likes (charge + burst + team join), chat (ROJO/AZUL join).
- Emits: `titan:sync`, `titan:push`, `titan:join`, `titan:motivate`, `titan:roundEnd`.
- Round cycle: 5 minutes (see `TITAN_CONFIG.roundDurationMs`), tie handled by `timeUp()` — emits EMPATE once, never in a loop.

### versus/versus-manager.js — Versus Político (/versus)
- Owns versus state: candidates, votes, rounds, winner selection.
- Handles gifts, likes, chat.
- Emits: `versus:sync`, `versus:support`, `versus:motivate`, `versus:end`.

## Hard Rules

- Never hardcode TikTok credentials, cookies, session IDs, or target IDC values. Read them from environment variables.
- Prefer loading `.env` locally for developer convenience, but keep `.env` ignored and ship only `.env.example`.
- If a socket event is emitted, verify at least one active consumer exists. If a client listens to an event, verify the server emits it. Check with the grep commands in Validation.
- Do not keep duplicate gameplay logic in both server and client. Scores and ranking live on the server.
- If the client keeps local-only combat state for visuals, do not let that leak into authoritative ranking.
- Do not leave debug-only code half-connected. Either wire it correctly or delete it.
- Avoid duplicate HTML ids and DOM queries for missing elements.
- Do not rely on a static TikTok gift catalog for score fairness. Prefer event payload values such as `diamond_count`, with local aliases only as fallback for debug or missing payloads.
- Preserve user changes already present in the worktree unless they directly conflict with the requested fix.
- Throttle/batch high-frequency events (likes). Batched syncs must be capped per second to support large live audiences.
- The historical countries-game logic was ported to `lib/countries-manager.js` and the old file is gone. Do not reintroduce gameplay logic directly in `server.js`; route it through the manager.
- The socket contract truth is `docs/SOCKET-CONTRACTS.md`. After changing any emitter or consumer, update that document so it stays accurate.

## Change Workflow

1. Read the emitter and consumer for every affected socket event.
2. Decide which side is authoritative before editing.
3. If state belongs to gameplay rules, move it to server or `lib/`.
4. Delete stale code paths instead of leaving compatibility ghosts.
5. Keep helpers named by responsibility, not by feature hype.

## Validation

After edits, run:

```bash
npm run lint
npm run check
```

Contract verification (emitters vs consumers):

```bash
# Server emissions
Select-String -Path "server.js","lib\*.js","titan\titan-manager.js","versus\versus-manager.js" -Pattern 'emit\("[a-zA-Z:]+' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $_.Value.Substring(6) } | Sort-Object -Unique
# Client listeners
Select-String -Path "arena.js","overlay.js","arena-game\arena.js","titan\public\game.js","versus\public\app.js" -Pattern 'socket\.on\("[a-zA-Z:]+' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $_.Value.Substring(11) } | Sort-Object -Unique
```

Every server emission must appear in at least one client's listener list, and vice versa.

## Repo Invariants

- `/` serves the game hub (landing).
- `/arena` serves Plinko de Avatares, `/arenagame` serves Tap Tap Arena, `/overlay` serves Batalla de Países, `/versus` serves Versus Político, `/titan` serves Guerra de Titanes.
- Countries game ranking must react consistently to gifts, likes, chat country selection, timer reset, and champion persistence.
- Arena ranking must update from server-authoritative score data and never depend on dead socket events.
- Arena HP/state/respawn must come from server state, even if the client adds immediate local FX.
- Hall of Fame data must represent a meaningful persistent metric, not transient reset state.
