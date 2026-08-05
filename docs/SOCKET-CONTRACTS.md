# Contratos Socket.IO

Regla: **todo evento emitido debe tener consumidor y todo consumidor debe tener emisor**. Este documento es la fuente de verdad actualizada a la fecha de la última validación.

## Globales (server.js → todos los clientes)

| Evento | Emisor | Consumidores | Payload |
|--------|--------|--------------|---------|
| `status` | server.js | todos los clientes | `{ connected, username?, error?, message? }` |
| `timerUpdate` | server.js | todos los clientes | `number` (segundos restantes) |

## Arena (`/arenagame` y `/arena`)

| Evento | Emisor | Consumidor | Payload |
|--------|--------|------------|---------|
| `arena:sync` | server.js | arena.js, arena-game/arena.js | estado minificado de jugadores |
| `arena:join` | server.js | arena.js, arena-game/arena.js | jugador nuevo |
| `arena:leave` | server.js | arena.js, arena-game/arena.js | `{ id }` |
| `arena:currentRanking` | server.js | arena-game/arena.js | ranking de ronda |
| `arena:gift` | server.js | arena.js, arena-game/arena.js | impacto resuelto (attacker, target, scoreGain, damage…) |
| `arena:likesBatch` | server.js (flush 16ms) | arena.js, arena-game/arena.js | lote de likes acumulados |
| `arena:likeStrike` | server.js | arena.js, arena-game/arena.js | strike de likes |
| `arena:roundEnd` | server.js | arena.js, arena-game/arena.js | ganador de ronda |
| `arena:lastRoundWinner` | server.js | arena.js, arena-game/arena.js | último ganador persistido |
| `arena:globalKing` | server.js | arena.js, arena-game/arena.js | rey con más victorias |
| `arena:champions` | server.js | arena.js, arena-game/arena.js | campeones de sesión |
| `arena:champion` | server.js (por socket) | arena-game/arena.js | último campeón al conectar |
| `arena:hallOfFameUpdate` | server.js | arena.js, arena-game/arena.js | top 10 persistido |
| `arena:suddenDeath` | server.js | arena.js, arena-game/arena.js | activo/inactivo |
| `arena:goldenMinute` | server.js | arena.js, arena-game/arena.js | activo/inactivo |
| `arena:frenzyUpdate` | server.js | arena.js, arena-game/arena.js | progreso del frenzy |
| `arena:frenzyGlobalInfo` | server.js | arena.js, arena-game/arena.js | frenzy activado |
| `arena:sawHit` | server.js | arena.js, arena-game/arena.js | impacto de sierra |
| `arena:ko` | server.js | arena.js, arena-game/arena.js | knockout |
| `arena:respawn` | server.js | arena.js, arena-game/arena.js | reentrada |
| `arena:combo` | server.js | arena.js, arena-game/arena.js | combo activado |
| `arena:burst` | server.js | arena.js, arena-game/arena.js | explosión de regalo grande |
| `arena:powerup` | server.js | arena.js, arena-game/arena.js | powerup (sierra) |
| `arena:extremeRecognition` | server.js | arena.js, arena-game/arena.js | regalo extremo |
| `arena:throneInDanger` | server.js | arena.js, arena-game/arena.js | líder amenazado |
| `arena:chatPower` | server.js | arena.js, arena-game/arena.js | `PODER` en chat |
| `arena:chatWake` | server.js | arena.js, arena-game/arena.js | `YO` en chat |
| `arena:applause` | server.js | arena.js, arena-game/arena.js | aplausos en chat |
| `arena:leaderChat` | server.js | arena.js, arena-game/arena.js | narración del líder |

## Titan (`/titan`)

| Evento | Emisor | Consumidor | Payload |
|--------|--------|------------|---------|
| `titan:sync` | titan-manager.js | titan/public/game.js | `{ active, phase, timeRemainingMs, teams{red,blue}, charges, bar, winTarget, hof }` |
| `titan:push` | titan-manager.js | titan/public/game.js | `{ teamId, power, meta{ type, donor, likeCount } }` (likes consolidados por flush 100ms) |
| `titan:join` | titan-manager.js | titan/public/game.js | `{ teamId, user }` |
| `titan:roundEnd` | titan-manager.js | titan/public/game.js | `{ winnerId, winnerName, reason, mvp, podium, red, blue, hof }` |
| `titan:motivate` | titan-manager.js | titan/public/game.js | `{ phrase }` |

## Versus (`/versus`)

| Evento | Emisor | Consumidor | Payload |
|--------|--------|------------|---------|
| `versus:sync` | versus-manager.js | versus/public/app.js | estado del duelo |
| `versus:support` | versus-manager.js | versus/public/app.js | apoyo de donante |
| `versus:motivate` | versus-manager.js | versus/public/app.js | `{ phrase }` |
| `versus:end` | versus-manager.js | versus/public/app.js | ganador del duelo |

## Overlay / Batalla de Países (`/overlay`)

| Evento | Emisor | Consumidor | Payload |
|--------|--------|------------|---------|
| `rankingUpdate` | countries-manager.js | overlay.js | estado completo del ranking |
| `ranking:gift` | countries-manager.js | overlay.js | puntos por regalo a un país |
| `ranking:like` | countries-manager.js | overlay.js | puntos por like a un país |
| `ranking:countryJoined` | countries-manager.js | overlay.js | usuario unido a un país |
| `leaderChanged` | countries-manager.js | overlay.js | cambio de líder |
| `bigGift` | countries-manager.js | overlay.js | regalo ≥1000 💎 |
| `roundReset` | countries-manager.js | overlay.js | nueva ronda |
| `ranking:championUpdate` | countries-manager.js | overlay.js | campeón persistido |

## Cliente → servidor (debug / acciones)

| Evento | Consumidor | Uso |
|--------|------------|-----|
| `arena:tapAttack` | server.js | tap del cliente (plinko) |
| `arena:bombHit` | server.js | pegs bomba del plinko |
| `arena:batchUpdate` | server.js | actualización por lote del cliente |
| `arena:debug:gift` | server.js | simular regalo (dev) |
| `arena:debug:toggleSD` | server.js | simular muerte súbita (dev) |
| `versus:debug:chat` | server.js | simular chat (dev) |
| `versus:debug:gift` | server.js | simular regalo (dev) |
| `titan:debug:push` | server.js | simular push (dev) |
