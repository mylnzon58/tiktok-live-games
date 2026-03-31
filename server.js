const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { WebcastPushConnection } = require("tiktok-live-connector");

const { loadEnvFile } = require("./lib/env");
const { syncTikTokEnvFromChrome } = require("./lib/chrome-cookie-sync");
const { createStorage } = require("./lib/storage");
const { createArenaManager } = require("./lib/arena-manager");
const { createGiftCatalog } = require("./lib/gift-catalog");
const { normalizeGiftEvent, normalizeLikeEvent, normalizeChatEvent } = require("./lib/live-event-adapter");
const { GAME_CONFIG } = require("./lib/game-config");

loadEnvFile();

const PORT = process.env.PORT || 3000;
const DEFAULT_TIKTOK_USERNAME = "juanjoclassic";
const CHROME_SYNC_INTERVAL_MS = 60000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const arena = createArenaManager();
const versusManager = require("./versus/versus-manager")(io);
const giftCatalog = createGiftCatalog();

const championsStorage = createStorage("arena_champions.json", []);

function normalizeChampionStandings(entries = [], options = {}) {
    const { memoryWindowMs = GAME_CONFIG.arena.championMemoryWindowMs } = options;
    const map = new Map();
    const now = Date.now();

    for (const entry of entries || []) {
        if (!entry?.name && !entry?.id) continue;
        const timestamp = Number(entry.timestamp) || 0;
        if (!timestamp || (now - timestamp) > memoryWindowMs) continue;

        const key = String(entry.id || entry.name);
        const previous = map.get(key);
        const candidate = {
            id: entry.id || null,
            name: entry.name || previous?.name || "ESPERANDO...",
            avatar: entry.avatar || previous?.avatar || "",
            victories: Math.max(0, Number(entry.victories) || 0),
            time: entry.time || previous?.time || "",
            timestamp
        };

        if (!previous || candidate.victories > previous.victories) {
            map.set(key, candidate);
        }
    }

    return Array.from(map.values())
        .sort((a, b) => (b.victories - a.victories) || String(a.name).localeCompare(String(b.name)))
        .slice(0, 10);
}

let lastWinners = normalizeChampionStandings(championsStorage.load() || []);
arena.seedVictories(lastWinners); // <--- NUEVO: Salva el historial en la arena tras reiniciar

if (lastWinners[0]?.id) {
    arena.setLastWinnerId(lastWinners[0].id);
}

let isSuddenDeath = false;
let roundFrenzyDiamonds = 0;
let isFrenzyActive = false;
let frenzyTimer = null;
let goldenMinuteActive = false;
let goldenMinuteTimer = null;
let goldenMinuteTimeout = null;

let timeRemaining = GAME_CONFIG.arena.roundDurationSeconds;
let timerInterval = null;
let tiktokRetryTimer = null;
let chromeSyncTimer = null;
let arenaBroadcastTimer = null;
let arenaLikeBatch = {}; // Para agrupar likes por usuario y reducir emisiones socket
let arenaSawTimer = null;
let liveStatus = { connected: false, username: process.env.TIKTOK_USERNAME || DEFAULT_TIKTOK_USERNAME };
let tiktokLive = null;
let isConnectingToTikTok = false;
let arenaLeaderVoiceWindow = { leaderId: null, count: 0 };
let lastCompletedRoundWinner = null;

// --- CSP MIDDLEWARE ---
// Permissive Content-Security-Policy to prevent proxies/tunnels from blocking eval
app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://fonts.gstatic.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob: https: http:",
            "connect-src 'self' ws: wss: http: https:",
            "media-src 'self' data: blob:"
        ].join("; ")
    );
    next();
});

// --- ROUTES ---
// Juego principal: Arena en raíz y en /arena
app.use(express.static(__dirname));
function sendArena(req, res) {
    const fs = require("fs");
    let html = fs.readFileSync(path.join(__dirname, "arena.html"), "utf8");
    html = html.replace(/\?v=\d+/g, `?v=${Date.now()}`);
    res.send(html);
}
app.get("/", sendArena);
app.get("/arena", sendArena);
// Versus Politico Game
app.use("/versus", express.static(path.join(__dirname, "versus/public")));
// Overlay de países (secundario)
app.get("/overlay", (req, res) => res.sendFile(path.join(__dirname, "overlay.html")));
app.get("/api/gifts", (req, res) => res.json(giftCatalog.getCatalogSnapshot()));

// --- ARENA STATE BROADCAST ---
// Minificar un jugador para envío eficiente
function minifyPlayer(p) {
    return {
        i: p.id,
        n: p.name,
        a: p.avatar,
        s: p.score,
        ss: p.standingScore,
        h: p.hp,
        x: Math.round(p.x),
        y: Math.round(p.y),
        st: p.state,
        saw: p.sawActiveUntil,
        inv: p.invulnerableUntil,
        v: p.victories
    };
}

// INSTANT JOIN: Emitir jugador nuevo inmediatamente (0ms latencia)
function emitInstantJoin(player) {
    if (!player) return;
    const sanitized = arena.sanitizeForClient(player);
    if (!sanitized) return;
    io.emit("arena:join", minifyPlayer(sanitized));
}

function emitArenaState() {
    const players = arena.getPlayers();
    const minified = {};
    for (const [id, p] of Object.entries(players)) {
        minified[id] = minifyPlayer(p);
    }
    io.emit("arena:sync", minified);
    io.emit("arena:currentRanking", arena.getCurrentRanking());
}

function queueArenaState(force = false) {
    if (force) {
        if (arenaBroadcastTimer) {
            clearTimeout(arenaBroadcastTimer);
            arenaBroadcastTimer = null;
        }
        emitArenaState();
        return;
    }
    if (arenaBroadcastTimer) return;
    arenaBroadcastTimer = setTimeout(() => {
        arenaBroadcastTimer = null;
        emitArenaState();
    }, GAME_CONFIG.arena.arenaBroadcastDelayMs);
}

function broadcastChampions() {
    io.emit("arena:champions", lastWinners);
}

function broadcastHallOfFame() {
    io.emit("arena:hallOfFameUpdate", arena.getHallOfFameList(10));
}

function emitArenaTelemetry(eventName, payload) {
    io.emit("arena:telemetry", {
        event: eventName,
        serverTs: Date.now(),
        ...payload
    });
}

// --- LOGGING ---
function logArenaGift(event, result) {
    const attacker = result?.attacker;
    const target = result?.target;
    if (!attacker?.id || !target?.id) return;
    console.log(
        `[arena gift] ${attacker.name || attacker.id} -> ${target.name || target.id} | gift=${event.gift.name} x${event.gift.repeatCount} | diamonds=${event.gift.totalDiamonds} | fx=${event.gift.fx} | sfx=${event.gift.sfx} | score+${result.scoreGain} | dmg=${result.damage} | loss=${result.scoreLoss} | ko=${result.ko ? "yes" : "no"}`
    );
}

function logArenaLike(event, player, support, strike) {
    if (!player?.id) return;
    const comboLikes = support?.likeCombo || event.likeCount;
    console.log(
        `[arena like] ${player.name || player.id} | likes=${event.likeCount} | total=${event.totalLikeCount || 0} | combo=${comboLikes} | heal=${support?.heal || 0} | score+${support?.scoreGain || 0} | strike=${strike ? "yes" : "no"} | ko=${strike?.ko ? "yes" : "no"}`
    );
}

function sanitizeLeaderChatMessage(comment) {
    return String(comment || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 110);
}

function isCompetitiveArenaPlayer(playerId) {
    return Boolean(playerId) &&
        !playerId.startsWith("bot_") &&
        !playerId.startsWith("debug_") &&
        !playerId.startsWith("stress_") &&
        playerId !== "debug_user";
}

function buildPersistedClassicWinner(entry) {
    if (!entry?.id) return null;
    return {
        id: entry.id,
        name: entry.name,
        avatar: entry.avatar,
        victories: entry.victories,
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now()
    };
}

// --- ROUND MANAGEMENT ---
function resetRound() {
    const arenaWinner = arena.getRoundWinner();
    let finalArenaRoundWinner = arenaWinner;

    if (arenaWinner?.id && isCompetitiveArenaPlayer(arenaWinner.id)) {
        const persistedArenaWinner = arena.markRoundWinner(arenaWinner.id);
        if (persistedArenaWinner) {
            lastWinners = normalizeChampionStandings([
                ...lastWinners,
                buildPersistedClassicWinner(persistedArenaWinner)
            ]);
            championsStorage.save(lastWinners);
            finalArenaRoundWinner = persistedArenaWinner;
        }
    }

    io.emit("arena:roundEnd", {
        roundWinner: finalArenaRoundWinner,
        winner: finalArenaRoundWinner
    });

    if (finalArenaRoundWinner?.id) {
        lastCompletedRoundWinner = {
            id: finalArenaRoundWinner.id,
            name: finalArenaRoundWinner.name,
            avatar: finalArenaRoundWinner.avatar,
            score: finalArenaRoundWinner.score,
            standingScore: finalArenaRoundWinner.standingScore,
            hp: finalArenaRoundWinner.hp,
            deaths: finalArenaRoundWinner.deaths,
            victories: finalArenaRoundWinner.victories
        };
        io.emit("arena:lastRoundWinner", lastCompletedRoundWinner);
    }

    isSuddenDeath = false;
    arenaLeaderVoiceWindow = { leaderId: null, count: 0 };
    io.emit("arena:suddenDeath", false);
    
    // Neuromarketing resets
    roundFrenzyDiamonds = 0;
    isFrenzyActive = false;
    if(frenzyTimer) clearTimeout(frenzyTimer);
    io.emit("arena:frenzyUpdate", { total: 0, active: false });

    goldenMinuteActive = false;
    if(goldenMinuteTimer) clearTimeout(goldenMinuteTimer);
    if(goldenMinuteTimeout) clearTimeout(goldenMinuteTimeout);
    io.emit("arena:goldenMinute", false);

    // Randomize Golden Minute logic
    goldenMinuteTimer = setTimeout(() => {
        goldenMinuteActive = true;
        io.emit("arena:goldenMinute", true);
        goldenMinuteTimeout = setTimeout(() => {
            goldenMinuteActive = false;
            io.emit("arena:goldenMinute", false);
        }, 60000);
    }, Math.floor(Math.random() * (GAME_CONFIG.arena.roundDurationSeconds / 2 * 1000)) + 30000);

    arena.resetRound();
    queueArenaState(true);
    broadcastChampions();
    broadcastHallOfFame();
    startTimer();
}

function startTimer() {
    clearInterval(timerInterval);
    timeRemaining = GAME_CONFIG.arena.roundDurationSeconds;
    io.emit("timerUpdate", timeRemaining);

    timerInterval = setInterval(() => {
        timeRemaining -= 1;
        io.emit("timerUpdate", timeRemaining);

        if (timeRemaining === GAME_CONFIG.arena.suddenDeathStartsAtSeconds) {
            isSuddenDeath = true;
            io.emit("arena:suddenDeath", true);
        }

        if (timeRemaining <= 0) {
            resetRound();
        }
    }, 1000);
}

function startArenaSawLoop() {
    clearInterval(arenaSawTimer);
    arenaSawTimer = setInterval(() => {
        const now = Date.now();
        const arenaHits = arena.applySawAuraHits(isSuddenDeath, now);
        if (!arenaHits.length) return;

        arenaHits.forEach((hit) => {
            io.emit("arena:sawHit", hit);
            if (hit.ko) {
                io.emit("arena:ko", {
                    attackerId: hit.attacker.id,
                    targetId: hit.target.id
                });
            }
        });
        queueArenaState();
    }, GAME_CONFIG.arena.sawTickIntervalMs);
}

// --- TIKTOK CONNECTION ---
function getTikTokConfig() {
    return {
        username: process.env.TIKTOK_USERNAME || DEFAULT_TIKTOK_USERNAME,
        sessionId: process.env.TIKTOK_SESSION_ID || "",
        ttTargetIdc: process.env.TIKTOK_TT_TARGET_IDC || ""
    };
}

function createTikTokConnection(config) {
    const tiktokOptions = {
        ...(config.sessionId ? { sessionId: config.sessionId } : {}),
        ...(config.ttTargetIdc ? { ttTargetIdc: config.ttTargetIdc } : {}),
        requestOptions: { timeout: 10000 }
    };
    return new WebcastPushConnection(config.username, tiktokOptions);
}

async function connectToTikTok() {
    if (isConnectingToTikTok) return;
    isConnectingToTikTok = true;
    clearTimeout(tiktokRetryTimer);

    const minRetry = 30000;
    const maxRetry = 60000;
    const retryDelay = Math.floor(Math.random() * (maxRetry - minRetry + 1)) + minRetry;

    try {
        console.log("🔍 Sincronizando cookies de Chrome...");
        syncTikTokEnvFromChrome({ logger: console });

        const config = getTikTokConfig();
        console.log(`🤖 Iniciando conexión para el usuario: ${config.username}`);

        if (tiktokLive?.removeAllListeners) {
            tiktokLive.removeAllListeners();
        }
        if (tiktokLive?.disconnect) {
            try { await tiktokLive.disconnect(); } catch { /* ignore */ }
        }

        tiktokLive = createTikTokConnection(config);
        bindTikTokListeners(tiktokLive);

        console.log("📡 Verificando estado del Live...");
        const isLive = await tiktokLive.fetchIsLive();
        if (!isLive) {
            console.log(`⏳ El usuario ${config.username} no está en Live. Reintentando en breve...`);
            liveStatus = { connected: false, username: config.username, step: "waiting", error: "Esperando que el Live inicie..." };
            io.emit("status", liveStatus);
            tiktokRetryTimer = setTimeout(connectToTikTok, retryDelay);
            return;
        }

        console.log("🔗 Conectando a la sala de TikTok...");
        const state = await tiktokLive.connect();
        console.log(`✅ TikTok LIVE conectado exitosamente. Room ID: ${state.roomId}`);

        liveStatus = { connected: true, username: config.username, step: "connected", message: "✅ ¡CONECTADO Y LISTO!" };
        io.emit("status", liveStatus);
    } catch (error) {
        const rawMessage = error?.message || String(error) || "Error desconocido";
        const errorMessage = rawMessage.includes("isn't online")
            ? "Esperando que el Live inicie..."
            : rawMessage;

        // Fallback for error 200 (expired session)
        if (rawMessage.includes("response: 200") && (process.env.TIKTOK_SESSION_ID || process.env.TIKTOK_TT_TARGET_IDC)) {
            console.warn("⚠️ Detectado 'response: 200'. Intentando conexión sin credenciales...");
            const originalSession = process.env.TIKTOK_SESSION_ID;
            const originalIdc = process.env.TIKTOK_TT_TARGET_IDC;
            process.env.TIKTOK_SESSION_ID = "";
            process.env.TIKTOK_TT_TARGET_IDC = "";
            isConnectingToTikTok = false;
            setTimeout(connectToTikTok, 2000);
            setTimeout(() => {
                process.env.TIKTOK_SESSION_ID = originalSession;
                process.env.TIKTOK_TT_TARGET_IDC = originalIdc;
            }, 5000);
            return;
        }

        liveStatus = {
            connected: false,
            username: getTikTokConfig().username,
            step: "error",
            error: errorMessage
        };
        io.emit("status", liveStatus);
        console.error(`❌ Error de conexión: ${errorMessage}`);
        tiktokRetryTimer = setTimeout(connectToTikTok, retryDelay);
    } finally {
        isConnectingToTikTok = false;
    }
}

// --- ARENA EVENT HANDLERS ---
function handleArenaGift(event) {
    const attacker = arena.ensurePlayer(event.user, "gift");
    if (!attacker) return;
    if (attacker.isNewSession) { emitInstantJoin(attacker); attacker.isNewSession = false; }

    if (attacker.state === "ELIMINATED") {
        arena.respawnPlayer(attacker, "gift");
        io.emit("arena:respawn", { userId: attacker.id, mode: "gift" });
    }

    const targetSelection = arena.pickTarget(attacker.id);
    if (!targetSelection) {
        queueArenaState();
        return;
    }
    const target = targetSelection.target;

    const isSpecialMultiplier = isSuddenDeath || isFrenzyActive || goldenMinuteActive;
    const result = arena.applyGiftCombat(attacker.id, target.id, event.gift, isSpecialMultiplier);
    if (!result) return;
    logArenaGift(event, result);

    // Frenzy Check (Neuromarketing)
    roundFrenzyDiamonds += event.gift.totalDiamonds;
    if (roundFrenzyDiamonds >= 3000 && !isFrenzyActive) {
        isFrenzyActive = true;
        io.emit("arena:frenzyUpdate", { total: roundFrenzyDiamonds, active: true });
        io.emit("arena:frenzyGlobalInfo");
        frenzyTimer = setTimeout(() => {
            isFrenzyActive = false;
            roundFrenzyDiamonds = 0;
            io.emit("arena:frenzyUpdate", { total: 0, active: false });
        }, 30000); // 30s frenzy
    } else if (!isFrenzyActive) {
        io.emit("arena:frenzyUpdate", { total: roundFrenzyDiamonds, active: false });
    }

    // Throne In Danger (Loss Aversion Neuromarketing)
    const ranking = arena.getCurrentRanking(2);
    if (ranking.length >= 2 && ranking[0].id === result.target.id && ranking[1].id === result.attacker.id && result.damage > 0) {
        io.emit("arena:throneInDanger", {
            targetName: result.target.name,
            attackerName: result.attacker.name
        });
    }

    io.emit("arena:gift", {
        attacker: { id: result.attacker.id, x: result.attacker.x, y: result.attacker.y },
        attackerState: result.attacker,
        target: result.target,
        targetId: result.target.id,
        targetState: result.target.state,
        diamondCount: event.gift.diamondCount,
        repeatCount: event.gift.repeatCount,
        totalDiamonds: event.gift.totalDiamonds,
        giftName: event.gift.name,
        tier: event.gift.tier,
        category: event.gift.category,
        effectKey: event.gift.fx,
        label: event.gift.label,
        sfx: event.gift.sfx,
        sizeScale: event.gift.sizeScale,
        multiplier: result.comboMultiplier,
        isCritical: result.isCritical,
        isDavidVsGoliath: result.isDavidVsGoliath,
        damage: result.damage,
        scoreGain: result.scoreGain,
        scoreLoss: result.scoreLoss,
        knockback: event.gift.knockback || 0
    });
    emitArenaTelemetry("gift", {
        userId: result.attacker.id,
        userName: result.attacker.name,
        targetId: result.target.id,
        targetName: result.target.name,
        giftName: event.gift.name,
        diamondCount: event.gift.diamondCount,
        repeatCount: event.gift.repeatCount,
        totalDiamonds: event.gift.totalDiamonds,
        effectKey: event.gift.fx,
        category: event.gift.category,
        sfx: event.gift.sfx,
        multiplier: result.comboMultiplier,
        damage: result.damage,
        scoreGain: result.scoreGain,
        scoreLoss: result.scoreLoss,
        burstTriggered: event.gift.totalDiamonds >= GAME_CONFIG.countries.bigGiftThreshold,
        powerupTriggered: event.gift.category === "mega" || event.gift.totalDiamonds >= 500,
        ko: Boolean(result.ko)
    });

    if (result.comboMultiplier > 1) {
        io.emit("arena:combo", {
            attackerId: result.attacker.id,
            combo: result.attacker.comboCount,
            multiplier: result.comboMultiplier
        });
    }

    // Extreme Recognition (Ego Boost Neuromarketing)
    if (event.gift.totalDiamonds >= GAME_CONFIG.countries.bigGiftThreshold) {
        io.emit("arena:extremeRecognition", {
            playerName: result.attacker.name,
            giftName: event.gift.name
        });
        
        io.emit("arena:burst", {
            sourceId: result.attacker.id,
            targetId: result.target.id,
            sourceX: result.attacker.x,
            sourceY: result.attacker.y,
            x: result.target.x,
            y: result.target.y,
            targetX: result.target.x,
            targetY: result.target.y,
            count: event.gift.totalDiamonds >= 20000 ? 8 : 4,
            color: event.gift.tier === "legendary" ? "#fff7d6" : "#fbbf24"
        });
    }

    if (event.gift.category === "mega" || event.gift.totalDiamonds >= 500) {
        io.emit("arena:powerup", {
            userId: result.attacker.id,
            type: "buzzsaw",
            duration: 900
        });
    }

    if (result.ko) {
        io.emit("arena:ko", {
            attackerId: result.attacker.id,
            targetId: result.target.id
        });
    }

    if (targetSelection.respawned) {
        io.emit("arena:respawn", { userId: result.target.id, mode: "basic" });
    }

    broadcastHallOfFame();
    queueArenaState(true); // FORZAR SINCRONIZACIÓN INMEDIATA POR REGALO
}

function handleArenaLike(event) {
    const player = arena.ensurePlayer(event.user, "like");
    if (!player) return;
    if (player.isNewSession) { emitInstantJoin(player); player.isNewSession = false; }

    // Ejecutar lógica de juego inmediatamente para mantener consistencia en servidor
    const support = arena.applyLikeSupport(player.id, event.likeCount);
    const comboLikes = support?.likeCombo || event.likeCount;
    const strike = arena.applyLikeStrike(player.id, comboLikes, isSuddenDeath);
    logArenaLike(event, player, support, strike);

    // AGREGAR AL LOTE (Batch) en lugar de emitir cada segundo
    if (!arenaLikeBatch[player.id]) {
        arenaLikeBatch[player.id] = {
            userId: player.id,
            userName: player.name,
            likeCount: 0,
            comboLikes: 0,
            heal: 0,
            scoreGain: 0,
            respawned: false,
            strike: null
        };
    }

    const batch = arenaLikeBatch[player.id];
    batch.likeCount += event.likeCount;
    batch.comboLikes = comboLikes;
    batch.heal += (support?.heal || 0);
    batch.scoreGain += (support?.scoreGain || 0);
    if (support?.respawned) batch.respawned = true;
    
    // Powerup logic dentro del batch
    if (comboLikes >= GAME_CONFIG.arena.likeMiniPowerThreshold) {
        batch.powerup = {
            type: "buzzsaw",
            duration: comboLikes >= GAME_CONFIG.arena.likeMegaPowerThreshold 
                ? GAME_CONFIG.arena.likeMegaPowerDurationFrames 
                : GAME_CONFIG.arena.likeMiniPowerDurationFrames
        };
    }

    if (strike) {
        batch.strike = strike;
    }

    // Telemetría
    emitArenaTelemetry("like", {
        userId: player.id,
        userName: player.name,
        likeCount: event.likeCount,
        totalLikeCount: event.totalLikeCount || 0,
        comboLikes,
        heal: support?.heal || 0,
        scoreGain: support?.scoreGain || 0,
        respawned: Boolean(support?.respawned),
        burstTriggered: Boolean(support?.player && comboLikes >= GAME_CONFIG.arena.likeBurstThreshold),
        powerupTriggered: Boolean(comboLikes >= GAME_CONFIG.arena.likeMiniPowerThreshold),
        strikeTriggered: Boolean(strike),
        ko: Boolean(strike?.ko)
    });
}

/** 
 * Función para emitir el lote de likes a todos los clientes.
 * Se llama periódicamente mediante setInterval.
 */
function flushArenaLikeBatch() {
    const batchArray = Object.values(arenaLikeBatch);
    if (batchArray.length === 0) return;

    // Emitir el lote completo
    io.emit("arena:likesBatch", batchArray);

    // Procesar efectos visuales especiales que NO queremos que se pierdan (respawns, strikes, powerups)
    batchArray.forEach(b => {
        if (b.respawned) {
             io.emit("arena:respawn", { userId: b.userId, mode: "basic" });
        }
        if (b.powerup) {
            io.emit("arena:powerup", { userId: b.userId, type: b.powerup.type, duration: b.powerup.duration });
        }
        if (b.strike) {
             io.emit("arena:likeStrike", {
                attacker: b.strike.attacker,
                target: b.strike.target,
                damage: b.strike.damage,
                scoreLoss: b.strike.scoreLoss,
                ko: b.strike.ko,
                likeCount: b.likeCount
             });
             if (b.strike.ko) {
                 io.emit("arena:ko", { attackerId: b.userId, targetId: b.strike.target.id });
             }
        }
    });

    arenaLikeBatch = {}; // Limpiar lote
    queueArenaState(); // CRÍTICO: Sincronizar jugadores nuevos que entraron por likes/taps
}

// Configurar el flush del lote cada 16ms (60fps) para respuesta ultrasónica
setInterval(flushArenaLikeBatch, 16); 
// Fin de lógica de likes batching

function handleArenaChat(event) {
    const text = event.comment.toUpperCase();
    const player = arena.ensurePlayer(event.user, "chat");
    if (!player) return;
    if (player.isNewSession) { emitInstantJoin(player); player.isNewSession = false; }

    if (text.startsWith("ATAQUE @")) {
        const targetRaw = text.slice(8).trim();
        arena.setPlayerTargetPreference(player.id, targetRaw);
    }

    const activity = arena.applyChatActivity(player.id);
    const chatRequestedPower = text.includes(`+ ${GAME_CONFIG.arena.chatPowerKeyword}`) ||
        text.includes(`+${GAME_CONFIG.arena.chatPowerKeyword}`) ||
        text.includes(GAME_CONFIG.arena.chatPowerKeyword);
    const power = chatRequestedPower ? arena.applyChatPower(player.id) : null;
    const topArenaLeader = arena.getTopArenaLeader();
    const cleanComment = sanitizeLeaderChatMessage(event.comment);

    if (chatRequestedPower) {
        io.emit("arena:chatPower", {
            userId: player.id,
            keyword: GAME_CONFIG.arena.chatPowerKeyword,
            player: power?.player || null,
            heal: power?.heal || 0,
            scoreGain: power?.scoreGain || 0
        });
        if (power?.duration) {
            io.emit("arena:powerup", {
                userId: player.id,
                type: "buzzsaw",
                duration: power.duration
            });
        }
    }

    const isWake = text.includes(GAME_CONFIG.arena.chatWakeKeyword) || text === "YO";
    if (isWake || activity?.respawned) {
        if (isWake && activity && activity.player) {
            io.emit("arena:chatWake", {
                userId: player.id,
                name: player.name,
                player: activity.player
            });
        }
        queueArenaState(true); // FORZAR SINCRONIZACIÓN INMEDIATA POR ACTIVIDAD
    }
    if (activity?.respawned) {
        io.emit("arena:respawn", { userId: player.id, mode: "basic" });
    }

    // Detectar "APLAUSOS" en el chat y emitir evento de aplausos
    if (text.includes("APLAUSO") || text.includes("CLAP") || text.includes("BRAVO")) {
        io.emit("arena:applause", {
            userId: player.id,
            name: player.name
        });
    }

    const isVersusVote = /(milei|cristina|leon|kuka|lla|cfk|peluca|peron)/i.test(cleanComment);

    if (
        topArenaLeader?.id &&
        topArenaLeader.id === player.id &&
        cleanComment &&
        cleanComment.length >= 3 &&
        !chatRequestedPower &&
        !isVersusVote
    ) {
        if (arenaLeaderVoiceWindow.leaderId !== topArenaLeader.id) {
            arenaLeaderVoiceWindow = { leaderId: topArenaLeader.id, count: 0 };
        }
        if (arenaLeaderVoiceWindow.count < 5) {
            arenaLeaderVoiceWindow.count += 1;
            io.emit("arena:leaderChat", {
                userId: player.id,
                name: player.name,
                comment: cleanComment,
                remaining: Math.max(0, 5 - arenaLeaderVoiceWindow.count)
            });
        }
    }
    queueArenaState(); // Asegurar que jugadores nuevos por chat también se sincronicen
}

// --- TIKTOK EVENT BINDING (Arena only) ---
function bindTikTokListeners(connection) {
    connection.on("gift", (rawData) => {
        try {
            const event = normalizeGiftEvent(rawData, giftCatalog);
            if (!event?.user) {
                const rawName = rawData?.giftName || rawData?.gift?.gift_name || rawData?.gift?.name || "unknown";
                console.warn(`[gift skipped] missing normalized event/user | gift=${rawName}`);
                return;
            }
            handleArenaGift(event);
            versusManager.handleVersusGift(event);
        } catch (error) {
            console.error("Gift error:", error.message);
        }
    });

    connection.on("like", (rawData) => {
        const event = normalizeLikeEvent(rawData);
        if (!event?.user) {
            console.warn("[like skipped] missing normalized event/user");
            return;
        }
        handleArenaLike(event);
        versusManager.handleVersusLike(event);
    });

    connection.on("chat", (rawData) => {
        const event = normalizeChatEvent(rawData);
        if (!event?.user) {
            console.warn("[chat skipped] missing normalized event/user");
            return;
        }
        handleArenaChat(event);
        versusManager.handleVersusChat(event);
    });
}

// --- CHROME COOKIE SYNC ---
function startChromeCookieSync() {
    clearInterval(chromeSyncTimer);
    chromeSyncTimer = setInterval(() => {
        const syncResult = syncTikTokEnvFromChrome({ logger: console });
        if (syncResult.updatedKeys.length && !liveStatus.connected) {
            clearTimeout(tiktokRetryTimer);
            tiktokRetryTimer = setTimeout(connectToTikTok, 1000);
        }
    }, CHROME_SYNC_INTERVAL_MS);
}

// --- SOCKET.IO CONNECTION ---
io.on("connection", (socket) => {
    socket.emit("timerUpdate", timeRemaining);
    versusManager.syncClient(socket);

    socket.on("arena:tapAttack", (data) => {
        const targetId = data.targetId;
        const target = arena.ensurePlayer({ id: targetId }, "tap-target");
        if (!target || target.hp <= 0 || target.state === "ELIMINATED") return;
        const result = arena.applyDamageConsequences({ id: "admin", name: "Admin", score: 5000, roundStats: { damageDealt: 0, kos: 0 } }, target, 20, Date.now(), false);
        if (result.damage > 0) {
            io.emit("arena:likeStrike", {
                attacker: { id: "admin", name: "Admin", avatar: "" },
                target: { id: target.id, name: target.name },
                damage: result.damage, scoreLoss: result.scoreLoss, ko: result.ko, likeCount: 5
            });
            if (result.ko) io.emit("arena:ko", { attackerId: "admin", targetId: target.id });
            queueArenaState(true);
        }
    });
    
    // Sincronización inicial MINIFICADA
    const players = arena.getPlayers();
    const minified = {};
    for (const [id, p] of Object.entries(players)) {
        minified[id] = {
            i: p.id, n: p.name, a: p.avatar, s: p.score, ss: p.standingScore,
            h: p.hp, x: Math.round(p.x), y: Math.round(p.y), st: p.state,
            saw: p.sawActiveUntil, inv: p.invulnerableUntil, v: p.victories
        };
    }
    socket.emit("arena:sync", minified);

    socket.emit("arena:currentRanking", arena.getCurrentRanking());
    socket.emit("arena:champion", arena.getLastWinnerId());
    socket.emit("arena:lastRoundWinner", lastCompletedRoundWinner);
    socket.emit("status", liveStatus);
    broadcastHallOfFame();
    broadcastChampions();

    socket.on("arena:batchUpdate", (batch) => {
        for (const [id, patch] of Object.entries(batch || {})) {
            arena.syncPosition(id, patch);
        }
    });

    socket.on("arena:debug:gift", (data) => {
        if (!tiktokLive) return;
        const mockData = {
            uniqueId: data.uniqueId || "debug_user",
            nickname: "MODO DEBUG",
            giftId: 999,
            repeatCount: 1,
            diamondCount: data.diamondCount,
            giftName: data.giftName,
            gift: {
                diamond_count: data.diamondCount,
                gift_name: data.giftName
            },
            profilePictureUrl: "https://p16-amd-va.tiktokcdn.com/img/musically-maliva-obj/1610411516752901~c5_720x720.jpeg",
            user: {
                uniqueId: data.uniqueId || "debug_user",
                nickname: "MODO DEBUG",
                profilePictureUrl: "https://p16-amd-va.tiktokcdn.com/img/musically-maliva-obj/1610411516752901~c5_720x720.jpeg"
            }
        };
        tiktokLive.emit("gift", mockData);
    });

    socket.on("arena:debug:toggleSD", () => {
        isSuddenDeath = !isSuddenDeath;
        io.emit("arena:suddenDeath", isSuddenDeath);
    });

    socket.on("versus:debug:chat", (data) => {
        if (!versusManager) return;
        versusManager.handleVersusChat({
            comment: data.comment || "Milei",
            user: { name: data.userName || "DebugUser" }
        });
    });
    socket.on("versus:debug:gift", (data) => {
        if (!versusManager) return;
        versusManager.handleVersusGift({
            gift: { name: data.giftName || "Rose", totalDiamonds: data.diamonds || 1 },
            user: { name: data.userName || "DebugDonor" },
            comment: data.comment || ""
        });
    });
});

// --- CLEANUP INTERVAL (Arena only) ---
setInterval(() => {
    const now = Date.now();
    const arenaCleanup = arena.cleanup(now);
    if (arenaCleanup.changed) {
        arenaCleanup.removedIds.forEach((id) => {
            io.emit("arena:leave", { id });
        });
        queueArenaState(true);
        broadcastHallOfFame();
    }
}, 5000);

// --- SERVER START ---
const initialDelay = Math.floor(Math.random() * 5000) + 2000;
console.log(`🕒 Programando primer intento de conexión en ${(initialDelay / 1000).toFixed(1)} segundos...`);
setTimeout(connectToTikTok, initialDelay);

server.listen(PORT, () => {
    console.log(`🚀 Server on http://localhost:${PORT}`);
    startTimer();
    startChromeCookieSync();
    startArenaSawLoop();
});
