// ============================================================
// TikTok LIVE Countries Ranking Game — Server
// ============================================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { WebcastPushConnection } = require("tiktok-live-connector");

// ──────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || "juanjoclassic";
const ROUND_DURATION = 7 * 60; // 7 minutos en segundos
const BIG_GIFT_THRESHOLD = 1000; // coins mínimos para efecto especial

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

app.get("/", (_req, res) => {
  res.redirect("/overlay");
});

// ──────────────────────────────────────────────────────────────
// Países iniciales
// ──────────────────────────────────────────────────────────────
const DEFAULT_COUNTRIES = {
  // ── LATINOAMÉRICA & CARIBE ──
  AR: { score: 0, flag: "🇦🇷", name: "Argentina", avatars: [], donors: 0 },
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
};

// Inicializar países con avatars vacíos
function initCountries() {
  const c = JSON.parse(JSON.stringify(DEFAULT_COUNTRIES));
  for (const code in c) {
    if (!c[code].avatars) c[code].avatars = [];
    if (!c[code].donors) c[code].donors = 0;
  }
  return c;
}
let countries = initCountries();

// ──────────────────────────────────────────────────────────────
// Helper para banderas emoji desde código de país ISO
// ──────────────────────────────────────────────────────────────
function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return "🏳️";
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    ...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

// ──────────────────────────────────────────────────────────────
// Timer de ronda
// ──────────────────────────────────────────────────────────────
let timeRemaining = ROUND_DURATION;
let timerInterval = null;

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

// ──────────────────────────────────────────────────────────────
// Líder actual
// ──────────────────────────────────────────────────────────────
let currentLeader = null;

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
// Conexión a TikTok LIVE
// ──────────────────────────────────────────────────────────────
let tiktokLive = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

function connectToTikTok() {
  console.log(`🔌 Conectando a TikTok LIVE: @${TIKTOK_USERNAME}...`);

  tiktokLive = new WebcastPushConnection(TIKTOK_USERNAME, {
    processInitialData: true,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
  });

  tiktokLive
    .connect()
    .then((state) => {
      reconnectAttempts = 0;
      console.log(`✅ Conectado a TikTok LIVE de @${TIKTOK_USERNAME}`);
      console.log(`   Room ID: ${state.roomId}`);
      console.log(`   Espectadores: ${state.viewerCount}`);
      io.emit("status", { connected: true, username: TIKTOK_USERNAME });
    })
    .catch((err) => {
      console.error(`❌ Error al conectar: ${err.message}`);
      scheduleReconnect();
    });

  // ── Gift event ──
  tiktokLive.on("gift", (data) => {
    try {
      const countryCode = (
        data.uniqueId?.slice(-2) ||
        data.user?.countryCode ||
        data.countryCode ||
        ""
      ).toUpperCase();

      // Si no tiene código de país, intentar usar el de la biografía o ignorar
      if (!countryCode || countryCode.length !== 2) {
        console.log(`⚠️ Regalo sin país válido de @${data.uniqueId || "desconocido"}`);
        return;
      }

      // Calcular valor real del regalo
      const diamonds = data.diamondCount || data.giftValue || 1;
      const repeat = data.repeatCount || 1;
      const coins = diamonds * repeat;

      // Solo procesar si es un regalo finalizado o no es repetible
      if (data.giftType === 1 && data.repeatEnd === false) {
        // Es un regalo repetible que aún no terminó, esperar
        return;
      }

      // Crear país si no existe
      if (!countries[countryCode]) {
        countries[countryCode] = {
          score: 0,
          flag: countryCodeToFlag(countryCode),
          name: countryCode,
          avatars: [],
          donors: 0,
        };
      }

      countries[countryCode].score += coins;
      countries[countryCode].donors++;

      // Guardar avatar del donante (máximo 5 por país)
      const avatarUrl = data.profilePictureUrl || "";
      if (avatarUrl && countries[countryCode].avatars.length < 5) {
        if (!countries[countryCode].avatars.includes(avatarUrl)) {
          countries[countryCode].avatars.push(avatarUrl);
        }
      }

      console.log(
        `🎁 ${data.uniqueId || "?"} (${countryCode}) → ${data.giftName || "regalo"} x${repeat} = ${coins} 💎`
      );

      // Emitir actualización
      io.emit("rankingUpdate", countries);
      checkLeaderChange();

      // Efecto de regalo grande
      if (coins >= BIG_GIFT_THRESHOLD) {
        io.emit("bigGift", {
          country: countryCode,
          flag: countries[countryCode].flag,
          coins,
          giftName: data.giftName || "Regalo",
          username: data.uniqueId || "?",
          avatarUrl: data.profilePictureUrl || "",
        });
        console.log(`💥 ¡REGALO GRANDE! ${coins} 💎 de @${data.uniqueId}`);
      }
    } catch (err) {
      console.error("Error procesando regalo:", err.message);
    }
  });

  // ── Like event ──
  tiktokLive.on("like", (data) => {
    console.log(`❤️ @${data.uniqueId || "?"} dio ${data.likeCount || 1} likes`);
  });

  // ── Follow event ──
  tiktokLive.on("follow", (data) => {
    console.log(`➕ Nuevo seguidor: @${data.uniqueId || "?"}`);
  });

  // ── Member join event ──
  tiktokLive.on("member", (data) => {
    console.log(`👋 @${data.uniqueId || "?"} se unió al LIVE`);
  });

  // ── Disconnected ──
  tiktokLive.on("disconnected", () => {
    console.log("⚡ Desconectado de TikTok LIVE");
    io.emit("status", { connected: false });
    scheduleReconnect();
  });

  // ── Stream end ──
  tiktokLive.on("streamEnd", (actionId) => {
    console.log(`📴 Stream terminado (acción: ${actionId})`);
    io.emit("status", { connected: false, streamEnded: true });
    scheduleReconnect();
  });

  // ── Error ──
  tiktokLive.on("error", (err) => {
    console.error("❌ Error de TikTok:", err.message);
  });
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  console.log(`🔄 Reintentando conexión en ${delay / 1000}s (intento ${reconnectAttempts})...`);
  setTimeout(connectToTikTok, delay);
}

// ──────────────────────────────────────────────────────────────
// Socket.io — Clientes del overlay
// ──────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("🖥️  Overlay conectado");
  socket.emit("rankingUpdate", countries);
  socket.emit("timerUpdate", timeRemaining);

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
