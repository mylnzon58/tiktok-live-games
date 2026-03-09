# 🎮 TikTok LIVE — Ranking de Países

Overlay animado de ranking de países en tiempo real para TikTok LIVE.  
Los regalos de los espectadores suman puntos al país de origen. ¡El país con más diamantes gana la ronda!

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
| `rankingUpdate` | Ranking actualizado con nuevos puntajes |
| `leaderChanged` | Hay un nuevo país en el #1 |
| `roundReset` | La ronda terminó, scores reiniciados |
| `timerUpdate` | Actualización del countdown cada segundo |
| `bigGift` | Se recibió un regalo de alto valor |
| `status` | Estado de la conexión a TikTok |

---

## 📁 Estructura

```
GameRankPaisTik/
├── package.json
├── server.js
├── overlay.html
├── overlay.js
├── style.css
└── README.md
```

---

**Hecho con ❤️ para TikTok LIVE**
