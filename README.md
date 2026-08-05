# 🎮 TikTok LIVE — Hub de Juegos

Proyecto de juegos interactivos para streamers de TikTok LIVE (para OBS/Streamlabs como Browser Source).

## 🕹️ Juegos disponibles

| Ruta | Juego | Descripción |
|------|-------|-------------|
| `/` | **Hub de juegos** | Landing page con acceso a todos los juegos y estado del LIVE |
| `/titan` | **Guerra de Titanes** | Gift battle por equipos: tira y afloja, caos y empuje final |
| `/arena` | **Plinko de Avatares** | El avatar cae como bola por la pirámide hasta el multiplicador x10 |
| `/arenagame` | **Tap Tap Arena** | Combate PvP clásico: HP, sierras, KO, zona rey, muerte súbita |
| `/overlay` | **Batalla de Países** | Ranking por países/equipos (secundario) |
| `/versus` | **Versus Político** | Milei vs Cristina: el chat vota con keywords |
| `/bomba` | **La Bomba** | Patata caliente: pásala con regalos, taps o escribiendo PASA |
| `/carrera` | **Carrera de Avatares** | Regalos impulsan tu avatar; el primero en meta gana |

Separación conceptual obligatoria:
- Los juegos comparten servidor y conexión LIVE, pero son productos distintos con su propio cliente.
- `arena-game/` contiene el cliente del Tap Tap Arena (combate PvP).
- `arena.html`/`arena.js`/`arena.css` (raíz) son el Plinko de Avatares.
- cualquier IA o desarrollador debe tratar cada flujo como dominio separado que solo comparte infraestructura.

La arquitectura está separada por responsabilidad (cada manager es dueño del estado de su juego):
- `server.js`: autoridad de la conexión LIVE, normalización y despacho de eventos a los managers
- `lib/arena-manager.js`: estado de la arena (HOF, ranking derivado)
- `lib/countries-manager.js`: ranking de países del overlay (Batalla de Países)
- `lib/game-config.js`: constantes de gameplay y timing
- `lib/gift-catalog.js`: catálogo extensible de regalos y resolución de tiers/FX
- `lib/live-event-adapter.js`: normalización de eventos de TikTok LIVE
- `lib/storage.js`: persistencia JSON de estado de runtime
- `titan/titan-manager.js` y `versus/versus-manager.js`: estado autoritativo de sus juegos
- `bomba/bomba-manager.js`, `carrera/carrera-manager.js`: estado autoritativo de los juegos nuevos
- Clientes (`arena-game/arena.js`, `arena.js`, `overlay.js`, `titan/public/game.js`, `versus/public/app.js`, `bomba/public/game.js`, `carrera/public/game.js`): render, UI y efectos — nunca deciden puntajes

Los JSON de runtime (`arena_champions.json`, `arena_hof.json`, `titan_hof.json`, `countries_champion.json`, `bomba_hof.json`) no se versionan. El catálogo `gift-catalog.json` sí es editable y versionable.

---

## 📋 Requisitos

- **Node.js** >= 18
- Una cuenta de TikTok que esté **EN VIVO**

---

## 🚀 Instalación

```bash
npm install
```

---

## ▶️ Iniciar servidor

```bash
npm start
```

El servidor arranca en `http://localhost:3000` y sirve el hub en `/`.

Para cambiar el puerto:

```bash
PORT=3003 npm start
```

Para cambiar el usuario de TikTok:

```bash
TIKTOK_USERNAME=otro_usuario npm start
```

Si necesitas sesión autenticada, usa variables de entorno en vez de hardcodear cookies:

```bash
TIKTOK_USERNAME=otro_usuario \
TIKTOK_SESSION_ID=tu_sessionid \
TIKTOK_TT_TARGET_IDC=tu_idc \
npm start
```

También puedes guardarlas en `.env`:

```env
TIKTOK_USERNAME=otro_usuario
TIKTOK_SESSION_ID=tu_sessionid
TIKTOK_TT_TARGET_IDC=tu_idc
```

---

## 🖥️ Usar los juegos en OBS

1. Inicia tu LIVE en TikTok con la cuenta configurada.
2. Abre `http://localhost:3000/` y elige el juego.
3. En OBS/Streamlabs: añade una fuente **Browser Source** con la URL del juego.
   - Resolución recomendada: **1080 × 1920**
   - Fondo transparente: ✅ (usar chroma o fondo oscuro)

---

## 🎁 Sistema de puntuación

Los regalos de TikTok tienen un valor en **diamantes**. El servidor usa el valor real del evento:

| Regalo   | Diamantes |
|----------|-----------|
| Rosa     | 1         |
| Perfume  | 20        |
| Donut    | 30        |
| Galaxy   | 1000      |
| Universo | 44999     |

**Fórmula general del arena:**

```
scoreGain = diamantes × repeatCount × 80 × multiplicadores
```

### Guerra de Titanes (`/titan`)

Gift battle por equipos, basado en los formatos más rentables del mercado:
- el espectador elige bando escribiendo **ROJO** o **AZUL** en el chat
- cada regalo empuja la cuerda hacia su titán: `push = diamantes × 2 × multiplicadores`
- los regalos de fuego/rayo (Fireworks, Dragon Flame, Galaxy, Planet) o 1000+ 💎 causan **CAOS**: empujan a tu equipo Y hacen retroceder al rival (el regalo del villano, el más rentable)
- el equipo perdedor recibe multiplicador ×1.3 (catch-up): mantiene la pelea pareja = más regalos
- combos: 3/5/10 regalos seguidos del mismo equipo → ×1.1/×1.25/×1.5
- likes cargan la barra de poder del equipo: al llegar a 200, dispara un impulso +80
- **EMPUIJE FINAL**: últimos 30 segundos valen el doble (×2) con overlay dorado
- victoria instantánea al llegar a 8000 pts, o por score al terminar los **5 minutos**
- MVP del equipo ganador (mayor donante) se persiste en `titan_hof.json`
- los likes se acumulan por lote (flush cada 100ms) para soportar audiencias grandes

### Tap Tap Arena (`/arenagame`)

Reglas fijas que no deben revertirse:
- Combate PvP: cada avatar tiene HP, se ataca con regalos, los likes (tap tap) curan y disparan
- `ganador de la ronda`: jugador individual con mayor `standingScore`
- `numero uno del arena` (REY): jugador con más `RONDAS` ganadas
- si empatan en `RONDAS`, desempata por score actual y luego `bestScore`
- regalos son mucho más fuertes que taps
- ataques, choques, rayos y sierra quitan puntos reales
- sierra VIP/aura, death match (muerte súbita), frenzy comunitario y golden minute
- chat: `PODER` (heal+score), `YO` (despertar), `ATAQUE @usuario` (fijar target), `APLAUSO/CLAP/BRAVO`
- el líder con victorias puede narrar hasta 5 mensajes por ventana (`arena:leaderChat`)
- jugadores inactivos no deben contaminar ranking vivo ni locuciones

### Plinko de Avatares (`/arena`)

- cada regalo hace caer bolas-avatar por la pirámide: Rosa → 1 bola, 99+ 💎 → 5, 1000+ → 10, Galaxia → 20, León → bola gigante
- buckets con multiplicadores x1/x3/x5/x10 (JACKPOT central)
- pegs bomba (−50/−100/−500/−1000) destruyen la bola y restan puntos
- 1 bola pequeña por cada 3 likes

### Versión PvP de combate y eventos

El `server.js` implementa la arena de combate completa (posiciones, HP autoritativo, estados, sierras, strikes, death match, frenzy, golden minute, powerups). El cliente Plinko solo renderiza una parte; el cliente del Tap Tap Arena (`/arenagame`) consume el flujo PvP completo.

---

## ⏱️ Rondas

- Cada ronda dura **5 minutos** (configurable en `lib/game-config.js` → `GAME_CONFIG.arena.roundDurationSeconds`).
- Muerte súbita a los **45 segundos** restantes.
- Al terminar la ronda: se muestra el ganador 🏆, se persiste en el Hall of Fame y se reinician los puntajes.
- Una nueva ronda comienza automáticamente.

---

## 🎆 Efectos especiales

| Efecto | Cuándo se activa |
|--------|-----------------|
| 💥 Big Gift | Regalo de 1000+ diamantes |
| 👑 Cambio de líder | Un jugador nuevo toma el #1 |
| 🏆 Fin de ronda | Termina el timer de 5 min |
| ✨ Reacciones flotantes | Constantemente durante el LIVE |
| 🔥 Frenzy | 3000 💎 acumulados en la ronda → 30s de frenesí |
| 🥇 Minuto de Oro | Aleatorio entre 30s y mitad de ronda, 60s de puntuación x2 |

---

## 🚀 Deploy

### Railway

1. Conecta tu repo de GitHub en [railway.app](https://railway.app)
2. Railway detecta Node.js automáticamente
3. Variables de entorno:
   - `PORT` = lo que Railway asigne (automático)
   - `TIKTOK_USERNAME` = tu usuario
4. URL del hub: `https://tu-app.railway.app/`

### Render

1. Crea un **Web Service** en [render.com](https://render.com)
2. Conecta tu repo de GitHub
3. Build command: `npm install`
4. Start command: `npm start`
5. Variables de entorno:
   - `TIKTOK_USERNAME` = tu usuario
6. URL del hub: `https://tu-app.onrender.com/`

---

## 📡 Eventos Socket.io

Los contratos completos por juego están en [docs/SOCKET-CONTRACTS.md](docs/SOCKET-CONTRACTS.md).

Eventos globales:

| Evento | Descripción |
|--------|-------------|
| `timerUpdate` | Countdown del server cada segundo |
| `status` | Estado de la conexión a TikTok |

Eventos `arena:*` (Tap Tap Arena `/arenagame` y Plinko `/arena`):

| Evento | Descripción |
|--------|-------------|
| `arena:sync` | Estado completo minificado de jugadores |
| `arena:join` / `arena:leave` | Entrada / salida (AFK/GC) de jugadores |
| `arena:currentRanking` | Ranking de la ronda actual |
| `arena:gift` | Impacto de regalo resuelto por servidor |
| `arena:likesBatch` | Lote de likes/taps agrupados (flush 16ms) |
| `arena:likeStrike` | Strike de likes contra un objetivo |
| `arena:roundEnd` / `arena:lastRoundWinner` | Fin de ronda y último ganador persistido |
| `arena:globalKing` | Rey global con más victorias |
| `arena:champions` / `arena:champion` | Campeones de sesión / último campeón |
| `arena:hallOfFameUpdate` | Top persistente de la arena |
| `arena:suddenDeath` / `arena:goldenMinute` | Muerte súbita / minuto de oro |
| `arena:frenzyUpdate` / `arena:frenzyGlobalInfo` | Progreso y activación del frenzy |
| `arena:sawHit` / `arena:ko` / `arena:respawn` | Impactos de juego |
| `arena:combo` / `arena:burst` / `arena:powerup` | Combos y powerups |
| `arena:extremeRecognition` / `arena:throneInDanger` | Eventos de prestigio |
| `arena:chatPower` / `arena:chatWake` / `arena:applause` / `arena:leaderChat` | Acciones del chat |

Eventos `titan:*` (Guerra de Titanes `/titan`):

| Evento | Descripción |
|--------|-------------|
| `titan:sync` | Estado completo (teams, cargas, timer, winTarget, hof) |
| `titan:push` | Empuje de la cuerda (regalo o lote de likes) |
| `titan:join` | Usuario se une a un bando (primer tap o gift) |
| `titan:roundEnd` | Fin de ronda con winner, MVP y podio de donantes |
| `titan:motivate` | Frases del locutor |

Eventos `versus:*` (Versus Político `/versus`):

| Evento | Descripción |
|--------|-------------|
| `versus:sync` | Estado completo del duelo |
| `versus:support` | Apoyo de un donante a su candidato |
| `versus:motivate` | Frases del locutor |
| `versus:end` | Fin del duelo con ganador |

Eventos del overlay (Batalla de Países `/overlay`):

| Evento | Descripción |
|--------|-------------|
| `rankingUpdate` | Estado completo del ranking de países |
| `ranking:gift` / `ranking:like` | Puntos por regalo / like por país |
| `ranking:countryJoined` | Un usuario se une a su país |
| `leaderChanged` | Cambio de líder del ranking |
| `bigGift` | Regalo de 1000+ 💎 |
| `roundReset` | Nueva ronda |
| `ranking:championUpdate` | Campeón del ranking persistido |

Eventos `bomba:*` (La Bomba `/bomba`):

| Evento | Descripción |
|--------|-------------|
| `bomba:sync` | Estado completo (fase, mecha, portador, jugadores, HOF) |
| `bomba:pass` | La bomba cambia de manos (regalo / likes / chat) |
| `bomba:boom` | Explosión: el portador pierde 300 pts |
| `bomba:motivate` | Frases del locutor |
| `bomba:roundEnd` | Fin de ronda con ganador, podio y HOF |

Eventos `carrera:*` (Carrera de Avatares `/carrera`):

| Evento | Descripción |
|--------|-------------|
| `carrera:sync` | Estado completo (avatares, progreso, timer) |
| `carrera:push` | Impulso de un avatar (regalo / like / chat) |
| `carrera:motivate` | Frases del locutor |
| `carrera:roundEnd` | Fin de carrera con ganador y podio |

Entradas cliente→servidor (debug interno, solo desarrollo):

| Evento | Descripción |
|--------|-------------|
| `arena:debug:gift` / `arena:debug:toggleSD` | Simular regalos / muerte súbita en el arena |
| `versus:debug:chat` / `versus:debug:gift` | Simular chat / regalos en versus |
| `titan:debug:push` | Simular push en titan |

---

## 📁 Estructura

```
mylnzon58GameRankPaisTik/
├── package.json
├── server.js             ← Servidor único + despacho a managers
├── index.html            ← Hub de juegos (raíz)
├── gift-catalog.json     ← Catálogo editable de regalos
├── arena.html            ← Plinko de Avatares (/arena)
├── arena.js
├── arena.css
├── arena-game/           ← Tap Tap Arena (/arenagame)
│   ├── arena.html
│   └── arena.js
├── overlay.html          ← Batalla de Países (/overlay)
├── overlay.js
├── style.css
├── titan/                ← Guerra de Titanes (/titan)
│   ├── titan-manager.js
│   └── public/
│       ├── index.html
│       ├── game.js
│       └── style.css
├── versus/               ← Versus Político (/versus)
│   ├── versus-manager.js
│   └── public/
│       ├── index.html
│       └── app.js
├── bomba/                ← La Bomba (/bomba)
│   ├── bomba-manager.js
│   └── public/ (index.html, game.js, style.css)
├── carrera/              ← Carrera de Avatares (/carrera)
│   ├── carrera-manager.js
│   └── public/ (index.html, game.js, style.css)
├── lib/
│   ├── arena-manager.js
│   ├── countries-manager.js
│   ├── env.js
│   ├── game-config.js
│   ├── gift-catalog.js
│   ├── live-event-adapter.js
│   ├── chrome-cookie-sync.js
│   └── storage.js
├── docs/
│   ├── ARCHITECTURE.md
│   └── SOCKET-CONTRACTS.md
├── skills/live-game-maintainer/
└── README.md
```

## 🛠️ Actualizar catálogo de regalos

El catálogo editable está en `gift-catalog.json`.

Cada entrada puede definir:
- `aliases`
- `tier`
- `category`
- `rarity`
- `scoreScale`
- `damageScale`
- `sizeScale`
- `knockback`
- `fx`
- `sfx`
- `label`

Si llega un regalo nuevo que no está en el catálogo:
- el sistema usa `diamondCount` real del evento
- asigna tier/FX por rango de valor
- no se rompe la partida

---

## ✅ Validación tras cambios

```bash
npm run lint    # eslint sobre server, lib, titan, arena-game y versus
npm run check   # node --check sobre todos los entry points
```

Siempre reiniciar el servidor después de editar: `npm start`.
La guía de mantenimiento está en `skills/live-game-maintainer/SKILL.md` (leer antes de tocar juegos).

---

**Hecho con ❤️ para TikTok LIVE**
