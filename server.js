// ============================================================
// TikTok LIVE Countries Ranking Game — Server
// ============================================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { WebcastPushConnection } = require("tiktok-live-connector");
const fs = require("fs");

// ──────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || "juanjoclassic";
const ROUND_DURATION = 7 * 60; // 7 minutos en segundos
const BIG_GIFT_THRESHOLD = 1000; // coins mínimos para efecto especial
const LIKES_PER_POINT = 100; // cada 100 likes = 1 punto

// ──────────────────────────────────────────────────────────────
// Express + Socket.io
// ──────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname)));

app.get("/overlay", (_req, res) => {
  res.sendFile(path.join(__dirname, "overlay.html"));
});

// NUEVO: Ruta para el segundo juego (Arena)
app.get("/arena", (_req, res) => {
  res.sendFile(path.join(__dirname, "arena.html"));
});

// LOGICA TEMPORAL DE PRUEBA (TEST BOT)
app.get("/test-arena-bot", (_req, res) => {
  res.send("<h1>🤖 Bot Arena Iniciado</h1><p>Vuelve al overlay de la Arena, el bot lanzará regalos durante 15 segundos.</p>");

  const botNames = ["Morita 🥊", "Juanjo 🇦🇷", "Ninja", "Destroyer", "DarkKnight"];
  const gifts = ["Rose", "Donut", "Perfume", "Chili", "Lion"];

  // Spanw 5 bots
  botNames.forEach((name, i) => {
    initOrUpdateArenaPlayer({ uniqueId: `bot_${i}`, nickname: name, profilePictureUrl: "https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image" });
  });

  // Lanzar regalos y ataques aleatorios
  let ticks = 0;
  const t = setInterval(() => {
    ticks++;
    if (ticks > 30) { clearInterval(t); return; } // para en 15 segs

    const randomGiver = `bot_${Math.floor(Math.random() * botNames.length)}`;
    const randomGift = gifts[Math.floor(Math.random() * gifts.length)];
    const isLike = Math.random() > 0.8;

    if (isLike) {
      io.emit("arena:like", { userId: randomGiver, likeCount: 20 });
    } else {
      io.emit("arena:gift", {
        userId: randomGiver,
        giftName: randomGift,
        giftId: 100,
        count: Math.floor(Math.random() * 3) + 1,
        diamondCount: Math.floor(Math.random() * 20) + 1
      });
    }
  }, 500);
});

app.get("/", (_req, res) => {
  res.redirect("/overlay");
});

// ──────────────────────────────────────────────────────────────
// Helper para banderas emoji desde código de país ISO
// ──────────────────────────────────────────────────────────────
function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return "🌍";
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    ...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

// ──────────────────────────────────────────────────────────────
// Países iniciales
// ──────────────────────────────────────────────────────────────
const DEFAULT_COUNTRIES = {
  // ── LATINOAMÉRICA & CARIBE ──
  AR: { score: 0, flag: "🇦🇷", name: "Argentina" },
  MX: { score: 0, flag: "🇲🇽", name: "México" },
  BR: { score: 0, flag: "🇧🇷", name: "Brasil" },
  CO: { score: 0, flag: "🇨🇴", name: "Colombia" },
  VE: { score: 0, flag: "🇻🇪", name: "Venezuela" },
  PE: { score: 0, flag: "🇵🇪", name: "Perú" },
  CL: { score: 0, flag: "🇨🇱", name: "Chile" },
  EC: { score: 0, flag: "🇪🇨", name: "Ecuador" },
  BO: { score: 0, flag: "🇧🇴", name: "Bolivia" },
  PY: { score: 0, flag: "🇵🇾", name: "Paraguay" },
  UY: { score: 0, flag: "🇺🇾", name: "Uruguay" },
  GT: { score: 0, flag: "🇬🇹", name: "Guatemala" },
  HN: { score: 0, flag: "🇭🇳", name: "Honduras" },
  NI: { score: 0, flag: "🇳🇮", name: "Nicaragua" },
  CR: { score: 0, flag: "🇨🇷", name: "Costa Rica" },
  SV: { score: 0, flag: "🇸🇻", name: "El Salvador" },
  PA: { score: 0, flag: "🇵🇦", name: "Panamá" },
  CU: { score: 0, flag: "🇨🇺", name: "Cuba" },
  DO: { score: 0, flag: "🇩🇴", name: "Rep. Dominicana" },
  PR: { score: 0, flag: "🇵🇷", name: "Puerto Rico" },
  HT: { score: 0, flag: "🇭🇹", name: "Haití" },
  JM: { score: 0, flag: "🇯🇲", name: "Jamaica" },
  TT: { score: 0, flag: "🇹🇹", name: "Trinidad y Tobago" },
  BZ: { score: 0, flag: "🇧🇿", name: "Belice" },
  GY: { score: 0, flag: "🇬🇾", name: "Guyana" },
  SR: { score: 0, flag: "🇸🇷", name: "Surinam" },
  // ── NORTEAMÉRICA ──
  US: { score: 0, flag: "🇺🇸", name: "EE.UU." },
  CA: { score: 0, flag: "🇨🇦", name: "Canadá" },
  // ── EUROPA ──
  ES: { score: 0, flag: "🇪🇸", name: "España" },
  GB: { score: 0, flag: "🇬🇧", name: "Reino Unido" },
  DE: { score: 0, flag: "🇩🇪", name: "Alemania" },
  FR: { score: 0, flag: "🇫🇷", name: "Francia" },
  IT: { score: 0, flag: "🇮🇹", name: "Italia" },
  PT: { score: 0, flag: "🇵🇹", name: "Portugal" },
  NL: { score: 0, flag: "🇳🇱", name: "Países Bajos" },
  BE: { score: 0, flag: "🇧🇪", name: "Bélgica" },
  CH: { score: 0, flag: "🇨🇭", name: "Suiza" },
  AT: { score: 0, flag: "🇦🇹", name: "Austria" },
  SE: { score: 0, flag: "🇸🇪", name: "Suecia" },
  NO: { score: 0, flag: "🇳🇴", name: "Noruega" },
  DK: { score: 0, flag: "🇩🇰", name: "Dinamarca" },
  FI: { score: 0, flag: "🇫🇮", name: "Finlandia" },
  IE: { score: 0, flag: "🇮🇪", name: "Irlanda" },
  PL: { score: 0, flag: "🇵🇱", name: "Polonia" },
  CZ: { score: 0, flag: "🇨🇿", name: "Chequia" },
  RO: { score: 0, flag: "🇷🇴", name: "Rumania" },
  HU: { score: 0, flag: "🇭🇺", name: "Hungría" },
  GR: { score: 0, flag: "🇬🇷", name: "Grecia" },
  HR: { score: 0, flag: "🇭🇷", name: "Croacia" },
  BG: { score: 0, flag: "🇧🇬", name: "Bulgaria" },
  RS: { score: 0, flag: "🇷🇸", name: "Serbia" },
  SK: { score: 0, flag: "🇸🇰", name: "Eslovaquia" },
  SI: { score: 0, flag: "🇸🇮", name: "Eslovenia" },
  UA: { score: 0, flag: "🇺🇦", name: "Ucrania" },
  RU: { score: 0, flag: "🇷🇺", name: "Rusia" },
  TR: { score: 0, flag: "🇹🇷", name: "Turquía" },
  IS: { score: 0, flag: "🇮🇸", name: "Islandia" },
  LT: { score: 0, flag: "🇱🇹", name: "Lituania" },
  LV: { score: 0, flag: "🇱🇻", name: "Letonia" },
  EE: { score: 0, flag: "🇪🇪", name: "Estonia" },
  AL: { score: 0, flag: "🇦🇱", name: "Albania" },
  BA: { score: 0, flag: "🇧🇦", name: "Bosnia" },
  MK: { score: 0, flag: "🇲🇰", name: "Macedonia del Norte" },
  ME: { score: 0, flag: "🇲🇪", name: "Montenegro" },
  LU: { score: 0, flag: "🇱🇺", name: "Luxemburgo" },
  MT: { score: 0, flag: "🇲🇹", name: "Malta" },
  CY: { score: 0, flag: "🇨🇾", name: "Chipre" },
  MD: { score: 0, flag: "🇲🇩", name: "Moldavia" },
  BY: { score: 0, flag: "🇧🇾", name: "Bielorrusia" },
  // ── ASIA ──
  IL: { score: 0, flag: "🇮🇱", name: "Israel" },
  JP: { score: 0, flag: "🇯🇵", name: "Japón" },
  KR: { score: 0, flag: "🇰🇷", name: "Corea del Sur" },
  CN: { score: 0, flag: "🇨🇳", name: "China" },
  IN: { score: 0, flag: "🇮🇳", name: "India" },
  TH: { score: 0, flag: "🇹🇭", name: "Tailandia" },
  VN: { score: 0, flag: "🇻🇳", name: "Vietnam" },
  PH: { score: 0, flag: "🇵🇭", name: "Filipinas" },
  ID: { score: 0, flag: "🇮🇩", name: "Indonesia" },
  MY: { score: 0, flag: "🇲🇾", name: "Malasia" },
  SG: { score: 0, flag: "🇸🇬", name: "Singapur" },
  PK: { score: 0, flag: "🇵🇰", name: "Pakistán" },
  BD: { score: 0, flag: "🇧🇩", name: "Bangladesh" },
  LK: { score: 0, flag: "🇱🇰", name: "Sri Lanka" },
  NP: { score: 0, flag: "🇳🇵", name: "Nepal" },
  MM: { score: 0, flag: "🇲🇲", name: "Myanmar" },
  KH: { score: 0, flag: "🇰🇭", name: "Camboya" },
  LA: { score: 0, flag: "🇱🇦", name: "Laos" },
  TW: { score: 0, flag: "🇹🇼", name: "Taiwán" },
  HK: { score: 0, flag: "🇭🇰", name: "Hong Kong" },
  AE: { score: 0, flag: "🇦🇪", name: "Emiratos Árabes" },
  SA: { score: 0, flag: "🇸🇦", name: "Arabia Saudita" },
  QA: { score: 0, flag: "🇶🇦", name: "Catar" },
  KW: { score: 0, flag: "🇰🇼", name: "Kuwait" },
  IQ: { score: 0, flag: "🇮🇶", name: "Iraq" },
  IR: { score: 0, flag: "🇮🇷", name: "Irán" },
  JO: { score: 0, flag: "🇯🇴", name: "Jordania" },
  LB: { score: 0, flag: "🇱🇧", name: "Líbano" },
  GE: { score: 0, flag: "🇬🇪", name: "Georgia" },
  AM: { score: 0, flag: "🇦🇲", name: "Armenia" },
  AZ: { score: 0, flag: "🇦🇿", name: "Azerbaiyán" },
  UZ: { score: 0, flag: "🇺🇿", name: "Uzbekistán" },
  KZ: { score: 0, flag: "🇰🇿", name: "Kazajistán" },
  MN: { score: 0, flag: "🇲🇳", name: "Mongolia" },
  // ── GLOBAL ──
  GLOBAL: { score: 0, flag: "🌍", name: "Mundo" },
};

// Inicializar países asegurando que tengan la estructura completa para el overlay
function initCountries() {
  const c = JSON.parse(JSON.stringify(DEFAULT_COUNTRIES));
  for (const code in c) {
    if (!c[code].avatars) c[code].avatars = [];
    if (!c[code].donors) c[code].donors = 0;
    if (!c[code].likesAccumulated) c[code].likesAccumulated = 0;
  }
  return c;
}
let countries = initCountries();

// ──────────────────────────────────────────────────────────────
// Timer de ronda y Líder
// ──────────────────────────────────────────────────────────────
let timeRemaining = ROUND_DURATION;
let timerInterval = null;
let currentLeader = null;

function startTimer() {
  clearInterval(timerInterval);
  timeRemaining = ROUND_DURATION;
  io.emit("timerUpdate", timeRemaining);

  timerInterval = setInterval(() => {
    timeRemaining--;
    if (timeRemaining <= 0) {
      resetRound();
    } else {
      io.emit("timerUpdate", timeRemaining);
    }
  }, 1000);
}

function resetRound() {
  // Guardar ganador antes de reiniciar
  const sorted = Object.entries(countries)
    .filter(([, v]) => v.score > 0)
    .sort((a, b) => b[1].score - a[1].score);

  const winner = sorted.length > 0 ? { code: sorted[0][0], ...sorted[0][1] } : null;

  // Reiniciar scores
  countries = initCountries();
  currentLeader = null;
  io.emit("roundReset", { winner, countries });
  io.emit("rankingUpdate", countries);
  startTimer();
  console.log("🔄 Nueva ronda iniciada" + (winner ? ` — Ganador: ${winner.flag} ${winner.code}` : ""));
}

function checkLeaderChange() {
  const sorted = Object.entries(countries)
    .filter(([, v]) => v.score > 0)
    .sort((a, b) => b[1].score - a[1].score);

  if (sorted.length === 0) return;

  const topCode = sorted[0][0];
  if (topCode !== currentLeader && sorted[0][1].score > 0) {
    currentLeader = topCode;
    io.emit("leaderChanged", {
      code: topCode,
      flag: sorted[0][1].flag,
      name: sorted[0][1].name,
      score: sorted[0][1].score,
    });
    console.log(`👑 Nuevo líder: ${sorted[0][1].flag} ${topCode}`);
  }
}

// ──────────────────────────────────────────────────────────────
// Estado del Modo Arena (Segundo Juego)
// ──────────────────────────────────────────────────────────────
const arenaPlayers = {};

function initOrUpdateArenaPlayer(user) {
  if (!user || (!user.uniqueId && !user.userId)) return null;
  const id = user.uniqueId || user.userId;

  if (!arenaPlayers[id]) {
    // Si no existe, lo creamos y le damos spawn random en el cliente
    arenaPlayers[id] = {
      id: id,
      name: user.nickname || id,
      avatar: user.profilePictureUrl || "",
      hp: 500, // Vida máxima optimizada
      score: 0,
      x: Math.random() * 800 + 100, // Posición base inicial
      y: Math.random() * 400 + 100,
      lastActive: Date.now()
    };
    // Emitir que un nuevo gladiador entró
    io.emit("arena:join", arenaPlayers[id]);
  } else {
    // Actualizar nombre o avatar en caso cambien
    arenaPlayers[id].name = user.nickname || arenaPlayers[id].name;
    arenaPlayers[id].lastActive = Date.now(); // Renew TTL
    if (user.profilePictureUrl) arenaPlayers[id].avatar = user.profilePictureUrl;
  }
  return arenaPlayers[id];
}

// Función para sincronizar con THROTTLE (Evita saturar el canal)
let lastSyncTime = 0;
const SYNC_THROTTLE_MS = 200; // Máximo 5 veces por segundo

function broadcastArenaSync(force = false) {
  const now = Date.now();
  if (force || (now - lastSyncTime > SYNC_THROTTLE_MS)) {
    io.emit("arena:sync", arenaPlayers);
    lastSyncTime = now;
  }
}

// Limpiador automático de Jugadores AFK
setInterval(() => {
  const now = Date.now();
  let changed = false;
  const playerIds = Object.keys(arenaPlayers);
  const totalPlayers = playerIds.length;

  // Obtener IDs ordenadas por puntaje (para saber quiénes son los Top y quiénes los más bajos)
  const sortedByScore = playerIds.slice().sort((a, b) => arenaPlayers[b].score - arenaPlayers[a].score);
  const topHighscoreIds = sortedByScore.slice(0, 5); // El Top 5 siempre está protegido

  for (const id of playerIds) {
    const p = arenaPlayers[id];
    const idleTime = now - p.lastActive;

    // --- PROTECCIÓN VIP (DONADORES) ---
    // Si tienen buen score (Top 5 o > 1000 puntos), los consideramos "Legendarios"
    // No se borran por el tiempo estándar de 5 minutos.
    const isVIP = topHighscoreIds.includes(id) || p.score >= 1000;

    let shouldRemove = false;

    if (totalPlayers > 30) {
      // Si está lleno, borramos a los inactivos de 30s que NO sean VIPs.
      // Si todos son VIPs inactivos, se borrará al de menor puntaje de la lista total.
      if (!isVIP && idleTime > 30 * 1000) {
        shouldRemove = true;
      } else if (idleTime > 60 * 1000) {
        // Si incluso un VIP está AFK mucho tiempo en sala llena, 
        // solo lo borramos si es uno de los 5 con MENOR puntaje de la sala.
        const lowestScoreIds = sortedByScore.slice(-5);
        if (lowestScoreIds.includes(id)) {
          shouldRemove = true;
        }
      }
    } else {
      // Si hay espacio, los VIPs son inmortales. Los normales mueren a los 5 min.
      if (!isVIP && idleTime > 300 * 1000) {
        shouldRemove = true;
      }
    }

    if (shouldRemove) {
      delete arenaPlayers[id];
      changed = true;
      io.emit("arena:leave", { id });
      console.log(`🧹 ARENA SWEEP: Removido (${isVIP ? 'VIP' : 'Normal'}) inactivo ${id}`);
    }
  }
  if (changed) {
    broadcastArenaSync(true);
  }
}, 5000);

// ──────────────────────────────────────────────────────────────
// Sistema de Overrides (Forzar país manualmente)
// ──────────────────────────────────────────────────────────────
const userCountryOverrides = {};

// ──────────────────────────────────────────────────────────────
// Safe Country Resolver
// ──────────────────────────────────────────────────────────────
function resolveCountry(data) {
  try {
    const uniqueId = (data.uniqueId || "").toLowerCase();

    // 1. Detect country code typed in chat (manual override)
    if (uniqueId && userCountryOverrides[uniqueId]) {
      return userCountryOverrides[uniqueId];
    }

    // 2. Detect flag emoji inside username/nickname
    const name = (data.nickname || uniqueId || "").toUpperCase();
    const flags = {
      "🇦🇷": "AR", "🇲🇽": "MX", "🇧🇷": "BR", "🇨🇴": "CO", "🇺🇸": "US",
      "🇪🇸": "ES", "🇻🇪": "VE", "🇵🇪": "PE", "🇬🇹": "GT", "🇨🇦": "CA",
      "🇪🇨": "EC", "🇭🇳": "HN", "🇳🇮": "NI", "🇨🇷": "CR", "🇸🇻": "SV",
      "🇬🇧": "GB", "🇩🇪": "DE", "🇮🇱": "IL", "🇦🇱": "AL", "🇨🇺": "CU",
      "🇨🇱": "CL", "🇵🇭": "PH", "🇮🇹": "IT", "🇫🇷": "FR"
    };

    for (const flag in flags) {
      if (name.includes(flag)) return flags[flag];
    }

    // 3. Fallback to profile country location (lowest priority)
    let countryCode = (data.user?.countryCode || data.countryCode || "").toUpperCase();
    if (countryCode && countryCode.length === 2 && countryCode !== 'XX') {
      return countryCode; // Retornamos si ya lo tiene válido
    }
    let location = (data.user?.location || "").toUpperCase();
    if (location && location.length === 2) {
      return location;
    }

    // Si llega aquí, es "GLOBAL"
    return "GLOBAL";
  } catch (err) {
    console.error("❌ Error en resolveCountry:", err.message);
    return "GLOBAL";
  }
}

// ──────────────────────────────────────────────────────────────
// Conexión a TikTok LIVE (Usando la nueva API)
// ──────────────────────────────────────────────────────────────
let tiktokLive = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;
let reconnectTimer = null;

function connectToTikTok() {
  if (tiktokLive) {
    try {
      tiktokLive.disconnect();
    } catch (e) { }
  }

  console.log(`🔌 Conectando a TikTok LIVE: @${TIKTOK_USERNAME}...`);

  tiktokLive = new WebcastPushConnection(TIKTOK_USERNAME);

  tiktokLive
    .connect()
    .then((state) => {
      reconnectAttempts = 0;
      console.log(`✅ Conectado a TikTok LIVE de @${TIKTOK_USERNAME}`);
      console.log(`   Room ID: ${state.roomId}`);
      io.emit("status", { connected: true, username: TIKTOK_USERNAME });
    })
    .catch((err) => {
      console.error(`❌ Error al conectar: ${err.message}`);
      scheduleReconnect();
    });

  // ── Gift event ──
  tiktokLive.on("gift", (data) => {
    try {
      // 1. EXTRAER DIAMANTES Y CANTIDAD PRIMERO (Datos vitales)
      const repeatCount = Math.max(data.repeatCount || data.count || 1, 1);
      let diamondCount = 1;
      if (data.gift && typeof data.gift.diamond_count === "number") {
        diamondCount = data.gift.diamond_count;
      } else if (typeof data.diamondCount === "number") {
        diamondCount = data.diamondCount;
      }
      const coins = diamondCount * repeatCount;

      // ── LOGICA PARA RANKING DE PAISES ──
      let country = resolveCountry(data);

      if (!countries[country]) {
        countries[country] = {
          score: 0,
          flag: country === "GLOBAL" ? "🌍" : countryCodeToFlag(country),
          name: country,
          avatars: [],
          donors: 0,
          likesAccumulated: 0
        };
      }

      countries[country].score += coins;
      countries[country].donors++;

      // Guardar avatar
      const avatarUrl = data.profilePictureUrl || data.user?.profilePictureUrl || "";
      if (avatarUrl && countries[country].avatars.length < 5) {
        if (!countries[country].avatars.includes(avatarUrl)) {
          countries[country].avatars.push(avatarUrl);
        }
      }

      console.log(`✅ 🎁 @${data.uniqueId || "?"} (${country}) → ${data.giftName || "regalo"} x${repeatCount} = ${coins} 💎`);

      io.emit("rankingUpdate", countries);
      checkLeaderChange();

      // Efecto especial Ranking
      if (coins >= BIG_GIFT_THRESHOLD) {
        io.emit("bigGift", {
          country: country,
          flag: countries[country].flag,
          coins,
          giftName: data.giftName || "Regalo",
          username: data.uniqueId || "?",
          avatarUrl: avatarUrl,
        });
      }

      // ── LOGICA PARA MODO ARENA (AUTORIDAD DE HP) ──
      const arenaUserObj = data.user || {
        uniqueId: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        profilePictureUrl: data.profilePictureUrl || ""
      };

      const attacker = initOrUpdateArenaPlayer(arenaUserObj);

      // El servidor busca al objetivo más cercano para daño directo
      let targetId = null;
      let minDist = Infinity;
      if (attacker) {
        for (const id in arenaPlayers) {
          if (id === attacker.id || arenaPlayers[id].hp <= 0) continue;
          const dist = Math.sqrt((attacker.x - arenaPlayers[id].x) ** 2 + (attacker.y - arenaPlayers[id].y) ** 2);
          if (dist < minDist) { minDist = dist; targetId = id; }
        }
      }

      // Calcular daño (20x diamantes)
      const damage = diamondCount * repeatCount * 20;

      if (targetId && arenaPlayers[targetId]) {
        arenaPlayers[targetId].hp -= damage;
        if (arenaPlayers[targetId].hp < 0) arenaPlayers[targetId].hp = 0;
        if (attacker) attacker.score += damage;

        // Si el regalo es grande, daño inmediato masivo
        if (diamondCount >= 500) {
          arenaPlayers[targetId].hp -= (damage * 0.5);
        }

        // --- PERSISTENCIA BAJO ATAQUE ---
        // Si alguien es atacado, lo mantenemos activo para que no desaparezca (Neuromarketing)
        arenaPlayers[targetId].lastActive = Date.now();
      }

      console.log(`⚔️ [ARENA ATTACK] @${arenaUserObj.uniqueId} -> Target:${targetId || "NONE"} (Dmg:${damage})`);

      io.emit("arena:gift", {
        userId: arenaUserObj.uniqueId || arenaUserObj.userId || data.uniqueId,
        targetId: targetId,
        giftName: data.giftName || "Rosa",
        count: repeatCount,
        diamondCount: diamondCount,
        damage: damage
      });

      // Sincronizar con throttle para evitar lag en combos
      broadcastArenaSync();

    } catch (err) {
      console.error("❌ Crasheo evitado en evento gift:", err);
    }
  });

  // ── Like event ──
  tiktokLive.on("like", (data) => {
    try {
      // ── LOGICA PARA RANKING DE PAISES ──
      let country = resolveCountry(data);

      if (!countries[country]) {
        countries[country] = {
          score: 0,
          flag: country === "GLOBAL" ? "🌍" : countryCodeToFlag(country),
          name: country,
          avatars: [],
          donors: 0,
          likesAccumulated: 0
        };
      }

      if (countries[country].likesAccumulated === undefined) {
        countries[country].likesAccumulated = 0;
      }

      const likeCount = data.likeCount || 1;
      countries[country].likesAccumulated += likeCount;

      if (countries[country].likesAccumulated >= LIKES_PER_POINT) {
        const pointsToAdd = Math.floor(countries[country].likesAccumulated / LIKES_PER_POINT);
        countries[country].score += pointsToAdd;
        countries[country].likesAccumulated %= LIKES_PER_POINT;

        io.emit("rankingUpdate", countries);
        checkLeaderChange();
      }

      // ── LOGICA PARA MODO ARENA ──
      const arenaUserObj = data.user || {
        uniqueId: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        profilePictureUrl: data.profilePictureUrl || ""
      };

      const player = initOrUpdateArenaPlayer(arenaUserObj);
      if (player) {
        player.score += likeCount * 5; // Asegurarse de que el servidor mantenga el score correcto para el crecimiento
      }

      io.emit("arena:like", {
        userId: arenaUserObj.uniqueId || arenaUserObj.userId || data.uniqueId,
        likeCount: likeCount,
        totalLikeCount: data.totalLikeCount
      });

    } catch (err) {
      console.error("❌ Crasheo evitado en evento like:", err);
    }
  });

  // ── Chat event (Mandos manuales / Detección de país) ──
  tiktokLive.on("chat", (data) => {
    try {
      const text = (data.comment || "").trim().toUpperCase();
      const uniqueId = (data.uniqueId || "").toLowerCase();

      // 1. Detectar si el usuario escribe su país (Ejemplo: "AR", "MX", "CO")
      // Validamos si es la palabra exacta, ej: "AR"
      if (text.length === 2 && DEFAULT_COUNTRIES[text]) {
        userCountryOverrides[uniqueId] = text;
        console.log(`💬 CHAT DETECT (código exacto): @${uniqueId} es de ${text}`);
      } else {
        // 2. Si es una frase, buscar códigos seguros
        const safeCodes = ["AR", "MX", "CO", "CL", "PE", "VE", "EC", "BO", "PY", "UY", "US", "GT", "HN", "CR", "SV", "PR", "CU", "PA", "BR", "IT", "FR", "GB", "RU", "JP", "KR", "CN"];
        const words = text.split(/[\\s,.;!?]+/);
        let found = false;
        for (const word of words) {
          if (word.length === 2 && safeCodes.includes(word)) {
            userCountryOverrides[uniqueId] = word;
            console.log(`💬 CHAT DETECT (en frase): @${uniqueId} es de ${word}`);
            found = true;
            break; // Stop at first valid
          }
        }

        // 3. Buscar banderas en el chat
        if (!found) {
          const flags = {
            "🇦🇷": "AR", "🇲🇽": "MX", "🇧🇷": "BR", "🇨🇴": "CO", "🇺🇸": "US",
            "🇪🇸": "ES", "🇻🇪": "VE", "🇵🇪": "PE", "🇬🇹": "GT", "🇨🇦": "CA",
            "🇪🇨": "EC", "🇭🇳": "HN", "🇳🇮": "NI", "🇨🇷": "CR", "🇸🇻": "SV",
            "🇬🇧": "GB", "🇩🇪": "DE", "🇮🇱": "IL", "🇦🇱": "AL", "🇨🇺": "CU",
            "🇨🇱": "CL", "🇵🇭": "PH", "🇮🇹": "IT", "🇫🇷": "FR"
          };
          for (const flag in flags) {
            if (text.includes(flag)) {
              userCountryOverrides[uniqueId] = flags[flag];
              console.log(`💬 CHAT DETECT (Bandera): @${uniqueId} es de ${flags[flag]}`);
              break;
            }
          }
        }
      }

      // Mandos manuales (Moderadores/Admin)
      if (data.isModerator || (uniqueId && uniqueId === TIKTOK_USERNAME.toLowerCase())) {
        if (text.startsWith("!PAIS")) {
          const parts = text.split(" ");
          if (parts.length >= 3) {
            let targetUser = parts[1].replace("@", "").toLowerCase();
            const targetCountry = parts[2].toUpperCase();

            if (targetCountry.length === 2 || targetCountry === "GLOBAL") {
              userCountryOverrides[targetUser] = targetCountry;
              console.log(`🛠️ ADMIN OVERRIDE: @${targetUser} -> ${targetCountry}`);
            }
          }
        }
      }

      // ── LOGICA PARA MODO ARENA ──
      const arenaUserObj = data.user || {
        uniqueId: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        profilePictureUrl: data.profilePictureUrl || ""
      };
      initOrUpdateArenaPlayer(arenaUserObj);
    } catch (err) {
      console.error("❌ Crasheo evitado en evento chat:", err);
    }
  });

  // ── Manejo de errores ──
  tiktokLive.on("disconnected", () => {
    console.log("⚡ Desconectado de TikTok LIVE");
    io.emit("status", { connected: false });
    scheduleReconnect();
  });

  tiktokLive.on("streamEnd", (actionId) => {
    console.log(`📴 Stream finalizado`);
    io.emit("status", { connected: false, streamEnded: true });
    scheduleReconnect();
  });

  tiktokLive.on("error", (err) => {
    console.error("❌ Error de TikTok (ignorado para evitar crasheo):", err.message);
  });

  // ── Member event (Entrada al LIVE) ──
  tiktokLive.on("member", (data) => {
    try {
      const arenaUserObj = data.user || {
        uniqueId: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        profilePictureUrl: data.profilePictureUrl || ""
      };

      // Entrada automática apenas se unen al stream
      initOrUpdateArenaPlayer(arenaUserObj);
      console.log(`👤 AUTO-JOIN: @${arenaUserObj.uniqueId} entró a la arena.`);

      // Sincronizar suavemente
      broadcastArenaSync();
    } catch (err) {
      console.error("❌ Error en auto-join member:", err.message);
    }
  });

  // ── Receive death/score update from Arena Overlay (para consistencia simple) ──
  // Nota: Esto ocurre al lado de las conexiones de cliente en io.on('connection')
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  console.log(`🔄 Reintentando conexión en ${delay / 1000}s (intento ${reconnectAttempts})...`);
  reconnectTimer = setTimeout(connectToTikTok, delay);
}

// ──────────────────────────────────────────────────────────────
// Socket.io — Clientes del overlay
// ──────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("🖥️  Overlay conectado");
  // País State
  socket.emit("rankingUpdate", countries);
  socket.emit("timerUpdate", timeRemaining);
  // Arena State
  socket.emit("arena:sync", arenaPlayers);

  // Escuchar actualizaciones por lotes (Bote de posiciones)
  socket.on("arena:batchUpdate", (batch) => {
    // batch = { id1: {x, y}, id2: {x, y}... }
    for (const id in batch) {
      if (arenaPlayers[id]) {
        if (batch[id].x !== undefined) arenaPlayers[id].x = batch[id].x;
        if (batch[id].y !== undefined) arenaPlayers[id].y = batch[id].y;
        arenaPlayers[id].lastActive = Date.now();
      }
    }
  });

  socket.on("arena:updatePlayer", (data) => {
    if (data && data.id && arenaPlayers[data.id]) {
      // HP y Score ya son manejados mayormente por el servidor, pero aceptamos correcciones
      if (data.hp !== undefined) arenaPlayers[data.id].hp = data.hp;
      if (data.score !== undefined) arenaPlayers[data.id].score = data.score;
      arenaPlayers[data.id].lastActive = Date.now();
    }
  });

  socket.on("disconnect", () => {
    console.log("🖥️  Overlay desconectado");
  });
});

// ──────────────────────────────────────────────────────────────
// Iniciar servidor
// ──────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log("═══════════════════════════════════════════════");
  console.log("  🎮 TikTok LIVE Countries Ranking Game");
  console.log(`  🌐 Overlay: http://localhost:${PORT}/overlay`);
  console.log(`  👤 TikTok: @${TIKTOK_USERNAME}`);
  console.log("═══════════════════════════════════════════════");
  startTimer();
  connectToTikTok();
});
