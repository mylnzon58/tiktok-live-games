# Arquitectura — Hub de Juegos TikTok LIVE

## Visión general

Un único servidor Node.js (Express + Socket.IO + tiktok-live-connector) recibe el LIVE de TikTok y despacha cada evento (gift, like, chat) a los managers de juego. Cada manager es **dueño autoritativo del estado de su juego**; los clientes solo renderizan.

```
tiktok-live-connector (LIVE real)
        │ eventos crudos (gift / like / chat)
        ▼
server.js ──── normaliza (lib/live-event-adapter) ──── despacha
   │                                                       │
   │  io.emit globales: status, timerUpdate                ▼
   │                                          ┌─────────────────────────────┐
   │  app.get/app.use (rutas HTTP)            │ arena-manager (lib/)         │
   │   /  /titan  /arena  /arenagame          │ countries-manager (lib/)     │
   │   /overlay  /versus  /bomba              │ titan-manager (titan/)        │
   │   /carrera                               │ versus-manager (versus/)      │
   │                                          │ bomba-manager (bomba/)        │
   │                                          │ carrera-manager (carrera/)    │
   │                                          └─────────────────────────────┘
   │                                                    │ io.emit
   │                                                    ▼
   │                              Clientes (render/UI, sin autoridad de puntaje)
   │                              arena.js · arena-game/arena.js · overlay.js
   │                              titan/public/game.js · versus/public/app.js
   │                              bomba/public/game.js · carrera/public/game.js
```

## Responsabilidades por capa

### server.js (punto de integración único)
- Crea Express, Socket.IO y el conector TikTok (credenciales desde `.env`, nunca hardcodeadas).
- Normaliza eventos crudos con `lib/live-event-adapter.js`.
- Despacha a los managers: `arenaManager.handleArenaGift(event)`, `titanManager.handleTitanGift(event)`, etc.
- Emite eventos globales (`status`, `timerUpdate`).
- Sirve las rutas de cada juego (los juegos `versus` y `titan` son estáticos; `arena`, `arenagame` y `overlay` se sirven por archivo con cache-busting).
- En `connection`: llama `syncClient(socket)` de cada manager (los clientes nuevos reciben el estado completo).
- Canales de debug (`arena:debug:*`, `versus:debug:*`, `titan:debug:push`) solo para desarrollo.

### Managers de juego (estado autoritativo)
- **lib/arena-manager.js** — ranking, HOF, estado derivado de la arena de combate.
- **lib/countries-manager.js** — ranking de países del overlay: rondas de 7 min, campeón persistido en `countries_champion.json`, banderas por regional indicators.
- **titan/titan-manager.js** — Guerra de Titanes: rondas de 5 min, win target 8000, cargas por likes (bacheadas cada 100 ms), empuje por regalos, combos, caos, catch-up ×1.3, empuje final ×2, HOF persistido en `titan_hof.json`.
- **versus/versus-manager.js** — Versus Político: duelo por chat/gifts, sincronización a nuevos clientes.
- **bomba/bomba-manager.js** — La Bomba: patata caliente, rondas de 3 min, mecha aleatoria 12–30 s, regalos/likes/chat pasan la bomba, explosión = −300 pts, HOF persistido en `bomba_hof.json` (top 20).
- **carrera/carrera-manager.js** — Carrera de Avatares: 6 carriles visuales, regalos impulsan (0.6 %/💎), likes en cola vaciada en el tick, chat `GO/VAMO/DALE` = +1.5 %, primero en meta gana.

### Clientes (solo presentación)
Renderizan el estado que reciben por socket. Nunca calculan puntajes ni deciden ganadores. La latencia de juegos se mitiga con batches del lado servidor (`arena:likesBatch` cada 16 ms, `titan:push` consolidado cada 100 ms).

## Escalabilidad (audiencias grandes)
- **Likes**: nunca se emiten 1:1. El arena acumula en `arenaLikeBatch` y vacía cada 16 ms; el titan acumula por bando y vacía cada 100 ms (`titan:push` consolidado + 1 sync por flush).
- **Syncs**: `queueSync()` + flush — un solo `emitSync()` por ventana de 100 ms aunque haya miles de eventos.
- **Persistence**: `lib/storage.js` escribe JSON de runtime; esos archivos están en `.gitignore`.

## Flujo de eventos de TikTok

1. `tiktok-live-connector` emite `gift`, `like`, `chat`, etc.
2. `server.js` normaliza con `live-event-adapter` (unifica `user`, `nickname`, `profilePictureUrl`, `gift.*`).
3. Cada manager recibe el evento normalizado y muta SOLO su estado.
4. El manager emite por Socket.IO a todos los clientes (o a un socket en `syncClient`).

## Reglas duras de mantenimiento

- No hardcodear credenciales. Todo desde `.env` (ver `lib/env.js`).
- No crear contratos socket sin consumidor (ni consumidores sin emisor).
- Los eventos de alta frecuencia SIEMPRE se bachean o se emiten consolidados.
- No versionar JSONs de runtime (`*.json` de estado en `.gitignore`).
- Tras cualquier cambio: `npm run lint` + `npm run check` + reiniciar y validar rutas y flujos (ver `skills/live-game-maintainer/SKILL.md`).
