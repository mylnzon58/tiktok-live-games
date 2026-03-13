# 🎮 TikTok LIVE — Team Arena + Arena

Proyecto de overlay dual para TikTok LIVE:
- `/` y `/overlay`: arena por países/equipos basada en regalos, taps y chat
- `/arena`: arena PvP clásica individual, con ranking de ronda y top persistente

Separación conceptual obligatoria:
- `overlay` y `arena` comparten servidor y conexión LIVE, pero son dos productos distintos.
- `overlay` es el modo por países/equipos.
- `arena` es el modo clásico individual.
- cualquier IA o desarrollador debe tratar ambos flujos como dominios separados que solo comparten infraestructura.

La arquitectura está separada por responsabilidad:
- `server.js`: autoridad de conexión, reglas, scoring, rondas y contratos Socket.IO
- `lib/arena-manager.js`: arena clásica individual
- `lib/team-arena-manager.js`: arena por países/equipos
- `lib/gift-catalog.js`: catálogo extensible de regalos y resolución de tiers/FX
- `lib/live-event-adapter.js`: normalización de eventos de TikTok LIVE
- `teamarena.js` y `arena.js`: render, UI y efectos no autoritativos

---

## 📋 Requisitos

- **Node.js** >= 18
- Una cuenta de TikTok que esté **EN VIVO**

---

## 🚀 Instalación

```bash
cd GameRankPaisTik
npm install
```

---

## ▶️ Iniciar servidor

```bash
npm start
```

El servidor arranca en `http://localhost:3000`.

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

## 🖥️ Abrir el overlay

1. Inicia tu LIVE en TikTok con la cuenta **@juanjoclassic**
2. Abre en el navegador:

```
http://localhost:3000/overlay
```

3. En OBS/Streamlabs: añade una fuente **Browser Source** con esa URL.
   - Resolución recomendada: **1080 × 1920**
   - Fondo transparente: ✅ (usar chroma o fondo oscuro)

---

## 🎁 Sistema de puntuación

Los regalos de TikTok tienen un valor en **diamantes**. El overlay usa el valor real:

| Regalo   | Diamantes |
|----------|-----------|
| Rosa     | 1         |
| Perfume  | 20        |
| Donut    | 30        |
| Galaxy   | 1000      |
| Universo | 44999     |

**Fórmula:**

```
puntos = diamantes × cantidad_repetida
```

Ejemplo: Un regalo Galaxy (1000 💎) × 3 repeticiones = **3000 puntos** para el país.

### Arena clásica (`/arena`)

Reglas fijas que no deben revertirse:
- HUD simple y entendible: mostrar solo `PTS`, `RONDAS` y `VP` (`vidas perdidas`)
- `HP` existe para combate y feedback visual, pero no debe dominar el HUD textual
- `ganador de la ronda`: jugador individual con mayor `standingScore`
- `numero uno del arena`: jugador con más `RONDAS` ganadas
- si empatan en `RONDAS`, desempata por score actual y luego `bestScore`
- regalos son mucho más fuertes que taps
- ataques, choques, rayos y sierra deben quitar puntos reales
- jugadores inactivos no deben contaminar ranking vivo ni locuciones

### Team arena (`/` y `/overlay`)

Reglas fijas que no deben revertirse:
- cada usuario entra a un país/equipo escribiendo su país o prefijo en el chat
- el equipo visible es el país, no el jugador individual
- cada globo representa un país:
  - bandera real al centro
  - mini avatares al costado
  - `PTS` del país dentro del globo
- si no se detecta un país real, ese usuario no entra al team arena visible
- el ganador de la ronda es el país con mayor `standingScore` agregado
- el podio superior guarda `RONDAS` ganadas por país
- nunca pegar entre miembros del mismo país

Nota para futuras IA o cambios automáticos:
- no volver a mezclar `/arena` clásico con el team arena de la raíz
- no reintroducir `overlay` viejo como producto principal
- no volver a usar listas históricas crudas para poblar podios sin filtro temporal
- no reintroducir HUD con `HP` textual dominante

---

## ⏱️ Rondas

- Cada ronda dura **7 minutos**.
- Al terminar la ronda: se muestra el ganador 🏆 y se reinician los puntajes.
- Una nueva ronda comienza automáticamente.

---

## 🌍 Países

El overlay incluye 18 países precargados (AR, MX, BR, US, CO, VE, ES, PE, GT, CA, EC, HN, NI, CR, SV, GB, DE, IL).

Si un espectador envía un regalo desde un país **no incluido**, se agrega automáticamente con su bandera correcta.

---

## 🎆 Efectos especiales

| Efecto | Cuándo se activa |
|--------|-----------------|
| 💥 Big Gift | Regalo de 1000+ diamantes |
| 👑 Cambio de líder | Un país nuevo toma el #1 |
| 🏆 Fin de ronda | Termina el timer de 7 min |
| ✨ Reacciones flotantes | Constantemente durante el LIVE |

---

## 🚀 Deploy

### Railway

1. Conecta tu repo de GitHub en [railway.app](https://railway.app)
2. Railway detecta Node.js automáticamente
3. Variables de entorno:
   - `PORT` = lo que Railway asigne (automático)
   - `TIKTOK_USERNAME` = `juanjoclassic`
4. URL del overlay: `https://tu-app.railway.app/overlay`

### Render

1. Crea un **Web Service** en [render.com](https://render.com)
2. Conecta tu repo de GitHub
3. Build command: `npm install`
4. Start command: `npm start`
5. Variables de entorno:
   - `TIKTOK_USERNAME` = `juanjoclassic`
6. URL del overlay: `https://tu-app.onrender.com/overlay`

---

## 📡 Eventos Socket.io

| Evento | Descripción |
|--------|-------------|
| `timerUpdate` | Actualización del countdown cada segundo |
| `status` | Estado de la conexión a TikTok |
| `arena:gift` | Impacto de regalo resuelto por servidor |
| `arena:like` | Curación/apoyo no autoritativo para FX |
| `arena:respawn` | Reentrada clara del jugador |
| `arena:hallOfFameUpdate` | Top persistente de la arena |
| `arena:currentRanking` | Ranking de la ronda actual |
| `teamArena:gift` | Impacto de regalo del team arena |
| `teamArena:like` | Curación/apoyo del team arena |
| `teamArena:respawn` | Reentrada clara del equipo/jugador |
| `teamArena:hallOfFameUpdate` | Top persistente del team arena |
| `teamArena:currentRanking` | Ranking actual del team arena |

---

## 📁 Estructura

```
GameRankPaisTik/
├── package.json
├── server.js
├── gift-catalog.json
├── lib/
│   ├── arena-manager.js
│   ├── env.js
│   ├── game-config.js
│   ├── gift-catalog.js
│   ├── live-event-adapter.js
│   ├── ranking-manager.js
│   └── storage.js
├── overlay.html
├── overlay.js
├── style.css
├── arena.html
├── arena.js
├── arena.css
├── teamarena.html
├── teamarena.js
├── teamarena.css
└── README.md
```

## 🛠️ Actualizar catálogo de regalos

El catálogo editable está en [`gift-catalog.json`](/Users/macos/Desktop/GameRankPaisTik/gift-catalog.json).

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

**Hecho con ❤️ para TikTok LIVE**
