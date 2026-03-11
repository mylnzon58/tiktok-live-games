// ============================================================
// TikTok LIVE Countries Ranking Game — Modular Server
// ============================================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { WebcastPushConnection } = require("tiktok-live-connector");

// Custom Libraries
const { DEFAULT_COUNTRIES, NAME_TO_CODE, GIFT_DATA } = require("./lib/constants");
const { createStorage } = require("./lib/storage");
const { createRankingManager } = require("./lib/ranking-manager");
const { createArenaManager } = require("./lib/arena-manager");

// ──────────────────────────────────────────────────────────────
// Config & Services init
// ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || "juanjoclassic";
const ROUND_DURATION = 7 * 60;
const BIG_GIFT_THRESHOLD = 1000;
const LIKES_PER_POINT = 100;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Managers
const ranking = createRankingManager();
const arena = createArenaManager(io);

// Storage
const championsStorage = createStorage("arena_champions.json", []);
const rankingChampStorage = createStorage("ranking_champion.json", null);

let lastWinners = championsStorage.load();
ranking.setRankingChampion(rankingChampStorage.load());

// State
let isX2 = false;
let timeRemaining = ROUND_DURATION;
let timerInterval = null;
const userCountryOverrides = {};

// ──────────────────────────────────────────────────────────────
// Express Routes
// ──────────────────────────────────────────────────────────────
app.use(express.static(__dirname));
app.get("/overlay", (req, res) => res.sendFile(path.join(__dirname, "overlay.html")));
app.get("/arena", (req, res) => res.sendFile(path.join(__dirname, "arena.html")));
app.get("/", (req, res) => res.redirect("/overlay"));

// ──────────────────────────────────────────────────────────────
// Game Logic Helpers
// ──────────────────────────────────────────────────────────────
function broadcastChampions() {
  io.emit("arena:champions", lastWinners);
}

function broadcastHallOfFame() {
  io.emit("arena:hallOfFame", arena.getHOF());
}

function broadcastArenaSync() {
  io.emit("arena:sync", arena.getPlayers());
}

function startTimer() {
  clearInterval(timerInterval);
  timeRemaining = ROUND_DURATION;
  io.emit("timerUpdate", timeRemaining);

  timerInterval = setInterval(() => {
    timeRemaining--;
    io.emit("timerUpdate", timeRemaining);

    if (timeRemaining === 60) {
      io.emit("arena:suddenDeath", true);
      io.emit("arena:x2", true);
      isX2 = true;
    }

    if (timeRemaining <= 0) {
      resetRound();
    }
  }, 1000);
}

function resetRound() {
  const countryWinner = ranking.getWinner();
  const sortedArena = Object.values(arena.getPlayers())
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score);

  const arenaWinner = sortedArena.length > 0 ? {
    id: sortedArena[0].id,
    name: sortedArena[0].name,
    avatar: sortedArena[0].avatar,
    score: sortedArena[0].score
  } : null;

  arena.setLastWinnerId(arenaWinner ? arenaWinner.id : null);

  // Persistence Arena
  if (arenaWinner) {
    const player = arena.initOrUpdatePlayer({ uniqueId: arenaWinner.id, nickname: arenaWinner.name, profilePictureUrl: arenaWinner.avatar });
    if (player) {
      player.victories = (player.victories || 0) + 1;
      lastWinners.unshift({ name: player.name, victories: player.victories, time: new Date().toLocaleTimeString() });
      if (lastWinners.length > 10) lastWinners.pop();
      championsStorage.save(lastWinners);
      arena.updateHOF(player);
    }
  }

  // Ranking Champion logic
  if (countryWinner) {
    const now = Date.now();
    const currentChamp = ranking.getRankingChampion();
    if (!currentChamp || (now - currentChamp.timestamp > 12 * 3600000) || countryWinner.score > (currentChamp.score || 0)) {
      const newChamp = {
        name: "MVP " + countryWinner.name,
        country: countryWinner.name,
        flag: countryWinner.flag,
        avatar: countryWinner.avatars[0] || "",
        score: countryWinner.score,
        timestamp: now
      };
      ranking.setRankingChampion(newChamp);
      rankingChampStorage.save(newChamp);
      io.emit("ranking:championUpdate", newChamp);
    }
  }

  io.emit("roundReset", { winner: countryWinner, countries: ranking.getCountries() });
  io.emit("arena:roundEnd", { winner: arenaWinner });
  io.emit("arena:suddenDeath", false);
  io.emit("arena:x2", false);
  isX2 = false;

  ranking.reset();
  arena.resetScores();

  io.emit("rankingUpdate", ranking.getCountries());
  broadcastArenaSync(true);
  startTimer();
  broadcastChampions();
  broadcastHallOfFame();
}

function resolveCountry(data) {
  const uniqueId = (data.uniqueId || "").toLowerCase();
  if (userCountryOverrides[uniqueId]) return userCountryOverrides[uniqueId];

  const name = (data.nickname || uniqueId || "").toUpperCase();
  const flags = { "🇦🇷": "AR", "🇲🇽": "MX", "🇧🇷": "BR", "🇨🇴": "CO", "🇺🇸": "US", "🇪🇸": "ES", "🇻🇪": "VE", "🇵🇪": "PE" };
  for (const flag in flags) { if (name.includes(flag)) return flags[flag]; }

  let countryCode = (data.user?.countryCode || data.countryCode || "").toUpperCase();
  if (countryCode && countryCode.length === 2 && countryCode !== "XX") return countryCode;

  return "GLOBAL";
}

// ──────────────────────────────────────────────────────────────
// TikTok Live Connection
// ──────────────────────────────────────────────────────────────
const tiktokLive = new WebcastPushConnection(TIKTOK_USERNAME);

tiktokLive.connect().then(() => {
  console.log(`✅ Conectado a @${TIKTOK_USERNAME}`);
  io.emit("status", { connected: true, username: TIKTOK_USERNAME });
}).catch((err) => {
  console.error(`❌ Error TikTok: ${err.message}`);
  // Notificar al cliente sobre el error real
  io.emit("status", {
    connected: false,
    error: err.message,
    username: TIKTOK_USERNAME
  });
});

tiktokLive.on("gift", (data) => {
  try {
    const repeatCount = Math.max(data.repeatCount || data.count || 1, 1);
    const diamondCount = data.gift?.diamond_count || data.diamondCount || 1;
    const coins = diamondCount * repeatCount;
    const country = resolveCountry(data);

    // Ranking Logic (Honest Algorithm: 1 Coin = 100 Points)
    const basePointsPerCoin = 100;
    const hasBonus = coins >= 500;
    const bonusMultiplier = hasBonus ? 1.2 : 1.0;

    let points = Math.floor(coins * basePointsPerCoin * bonusMultiplier);

    // Sudden Death (Muerte Súbita) check
    if (isX2) points *= 2;

    ranking.addPoints(country, points);
    ranking.addAvatar(country, data.profilePictureUrl || data.user?.profilePictureUrl);
    io.emit("rankingUpdate", ranking.getCountries());

    if (coins >= BIG_GIFT_THRESHOLD) {
      io.emit("bigGift", { country, flag: ranking.getCountries()[country]?.flag, coins, giftName: data.giftName, username: data.uniqueId, avatarUrl: data.profilePictureUrl });
    }

    // Arena Logic
    const attacker = arena.initOrUpdatePlayer(data.user || data);
    if (attacker) {
      // Prioritize GIFT_DATA, fallback to api diamond count
      const giftValue = GIFT_DATA[data.giftName] || diamondCount;
      const totalGiftPoints = giftValue * repeatCount;

      let damage = totalGiftPoints * 100;
      if (isX2) damage *= 2;

      // Combo logic (Meritocratic: reward consistency)
      const now = Date.now();
      const COMBO_TIMEOUT = 5000; // 5 seconds
      if (now - attacker.lastGiftTime < COMBO_TIMEOUT) {
        attacker.comboCount = (attacker.comboCount || 0) + 1;
      } else {
        attacker.comboCount = 1;
      }
      attacker.lastGiftTime = now;

      let arenaMultiplier = 1.0;
      if (attacker.comboCount >= 10) arenaMultiplier = 1.5;
      else if (attacker.comboCount >= 5) arenaMultiplier = 1.2;
      else if (attacker.comboCount >= 3) arenaMultiplier = 1.1;

      damage *= arenaMultiplier;

      // Meritocracy: Multiplier is deterministic based on Combo
      if (arenaMultiplier > 1.0) {
        io.emit("arena:combo", { attackerId: attacker.id, multiplier: arenaMultiplier * (isX2 ? 2 : 1), combo: attacker.comboCount });
      }

      attacker.score += damage * 0.1;
      arena.updateHOF(attacker);

      io.emit("arena:gift", {
        attacker: { id: attacker.id, x: attacker.x, y: attacker.y },
        diamondCount: giftValue, repeatCount, giftName: data.giftName, multiplier: arenaMultiplier
      });
      broadcastArenaSync();
    }
  } catch (err) { console.error("Gift error:", err); }
});

tiktokLive.on("like", (data) => {
  const country = resolveCountry(data);
  if (ranking.addLikes(country, data.likeCount || 1, LIKES_PER_POINT)) {
    io.emit("rankingUpdate", ranking.getCountries());
  }
  const player = arena.initOrUpdatePlayer(data.user || data);
  if (player) {
    // Individual Merit: 10 points per 100 likes
    const likesValue = (data.likeCount || 1) * 0.1;
    player.score += likesValue;
    arena.updateHOF(player);
  }
  io.emit("arena:like", { userId: data.uniqueId, likeCount: data.likeCount });
});

tiktokLive.on("chat", (data) => {
  const text = (data.comment || "").toUpperCase();
  const uniqueId = (data.uniqueId || "").toLowerCase();

  let detected = null;
  const words = text.split(/\s+/);
  for (const w of words) {
    if (w.length === 2 && DEFAULT_COUNTRIES[w]) detected = w;
    else if (NAME_TO_CODE[w]) detected = NAME_TO_CODE[w];
    if (detected) break;
  }

  if (detected) {
    userCountryOverrides[uniqueId] = detected;
    io.emit("ranking:countryJoined", { userId: uniqueId, country: detected, flag: DEFAULT_COUNTRIES[detected].flag });
  }

  const player = arena.initOrUpdatePlayer(data.user || data);
  if (player && text.includes("PODER")) {
    io.emit("arena:chatPower", { userId: player.id, keyword: "PODER" });
  }
});

// ──────────────────────────────────────────────────────────────
// Socket.io Handlers
// ──────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  socket.emit("rankingUpdate", ranking.getCountries());
  socket.emit("timerUpdate", timeRemaining);
  socket.emit("arena:sync", arena.getPlayers());
  socket.emit("arena:champion", arena.getLastWinnerId());
  socket.emit("ranking:championUpdate", ranking.getRankingChampion());
  broadcastHallOfFame();
  broadcastChampions();

  socket.on("arena:batchUpdate", (batch) => {
    const players = arena.getPlayers();
    for (const id in batch) {
      if (players[id]) {
        players[id].x = batch[id].x ?? players[id].x;
        players[id].y = batch[id].y ?? players[id].y;
      }
    }
  });
});

setInterval(() => {
  if (arena.cleanup(12 * 3600000)) {
    broadcastArenaSync(true);
    broadcastHallOfFame();
  }
}, 5000);

server.listen(PORT, () => {
  console.log(`🚀 Server on http://localhost:${PORT}`);
  startTimer();
});
