const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { WebcastPushConnection } = require("tiktok-live-connector");

const { loadEnvFile } = require("./lib/env");
const { syncTikTokEnvFromChrome } = require("./lib/chrome-cookie-sync");
const { resolveCountryCodeFromText } = require("./lib/constants");
const { createStorage } = require("./lib/storage");
const { createArenaManager } = require("./lib/arena-manager");
const { createCarreraManager } = require("./lib/carrera-manager");
const { createTeamArenaManager } = require("./lib/team-arena-manager");
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
const race = createCarreraManager();
const teamArena = createTeamArenaManager();
const giftCatalog = createGiftCatalog();

const championsStorage = createStorage("arena_champions.json", []);
const raceChampionsStorage = createStorage("carrera_champions.json", []);
const teamChampionsStorage = createStorage("team_arena_champions.json", []);

function normalizeChampionStandings(entries = [], options = {}) {
    const {
        preserveCountryMeta = false,
        memoryWindowMs = GAME_CONFIG.arena.championMemoryWindowMs
    } = options;
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

        if (preserveCountryMeta) {
            candidate.flag = entry.flag || previous?.flag || "";
            candidate.flagUrl = entry.flagUrl || previous?.flagUrl || "";
            candidate.countryCode = entry.countryCode || previous?.countryCode || entry.id || null;
        }

        if (!previous || candidate.victories > previous.victories) {
            map.set(key, candidate);
        }
    }

    return Array.from(map.values())
        .sort((a, b) => (b.victories - a.victories) || String(a.name).localeCompare(String(b.name)))
        .slice(0, 10);
}

let lastWinners = normalizeChampionStandings(championsStorage.load() || []);
let raceLastWinners = normalizeChampionStandings(raceChampionsStorage.load() || []);
let teamLastWinners = normalizeChampionStandings(teamChampionsStorage.load() || [], { preserveCountryMeta: true });
teamArena.seedChampionStandings(teamLastWinners);

if (lastWinners[0]?.id) {
    arena.setLastWinnerId(lastWinners[0].id);
}
if (raceLastWinners[0]?.id) {
    race.setLastWinnerId(raceLastWinners[0].id);
}
if (teamLastWinners[0]?.id) {
    teamArena.setLastWinnerId(teamLastWinners[0].id);
}

let isSuddenDeath = false;
let timeRemaining = GAME_CONFIG.arena.roundDurationSeconds;
let timerInterval = null;
let tiktokRetryTimer = null;
let chromeSyncTimer = null;
let arenaBroadcastTimer = null;
let raceBroadcastTimer = null;
let teamArenaBroadcastTimer = null;
let arenaSawTimer = null;
let raceLoopTimer = null;
let raceTimerInterval = null;
const userCountryOverrides = {};
let liveStatus = { connected: false, username: process.env.TIKTOK_USERNAME || DEFAULT_TIKTOK_USERNAME };
let tiktokLive = null;
let isConnectingToTikTok = false;
let arenaLeaderVoiceWindow = { leaderId: null, count: 0 };
let teamArenaLeaderVoiceWindow = { leaderId: null, count: 0 };
let lastCompletedRoundWinner = null;
let lastCompletedRaceWinner = null;
let lastCompletedTeamRoundWinner = null;
let raceTimeRemaining = GAME_CONFIG.carrera.roundDurationSeconds;
let lastRaceLeaderId = null;

app.use(express.static(__dirname));
app.use("/carrera", express.static(path.join(__dirname, "carrera")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "teamarena.html")));
app.get("/overlay", (req, res) => res.sendFile(path.join(__dirname, "teamarena.html")));
app.get("/arena", (req, res) => res.sendFile(path.join(__dirname, "arena.html")));
app.get("/carrera", (req, res) => res.sendFile(path.join(__dirname, "carrera", "index.html")));
app.get("/api/gifts", (req, res) => res.json(giftCatalog.getCatalogSnapshot()));

function emitArenaState() {
    io.emit("arena:sync", arena.getPlayers());
    io.emit("arena:currentRanking", arena.getCurrentRanking());
}

function emitRaceState() {
    io.emit("race:sync", race.getPlayers());
    io.emit("race:currentRanking", race.getCurrentRanking());
}

function emitTeamArenaState() {
    io.emit("teamArena:sync", teamArena.getPlayers());
    io.emit("teamArena:currentRanking", teamArena.getCurrentRanking());
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

function queueTeamArenaState(force = false) {
    if (force) {
        if (teamArenaBroadcastTimer) {
            clearTimeout(teamArenaBroadcastTimer);
            teamArenaBroadcastTimer = null;
        }
        emitTeamArenaState();
        return;
    }
    if (teamArenaBroadcastTimer) return;
    teamArenaBroadcastTimer = setTimeout(() => {
        teamArenaBroadcastTimer = null;
        emitTeamArenaState();
    }, GAME_CONFIG.arena.arenaBroadcastDelayMs);
}

function queueRaceState(force = false) {
    if (force) {
        if (raceBroadcastTimer) {
            clearTimeout(raceBroadcastTimer);
            raceBroadcastTimer = null;
        }
        emitRaceState();
        return;
    }
    if (raceBroadcastTimer) return;
    raceBroadcastTimer = setTimeout(() => {
        raceBroadcastTimer = null;
        emitRaceState();
    }, GAME_CONFIG.carrera.raceBroadcastDelayMs);
}

function broadcastChampions() {
    io.emit("arena:champions", lastWinners);
}

function broadcastRaceChampions() {
    io.emit("race:champions", raceLastWinners);
}

function broadcastTeamChampions() {
    io.emit("teamArena:champions", teamLastWinners);
}

function broadcastHallOfFame() {
    io.emit("arena:hallOfFameUpdate", arena.getHallOfFameList(10));
}

function broadcastRaceHallOfFame() {
    io.emit("race:hallOfFameUpdate", race.getHallOfFameList(10));
}

function broadcastTeamHallOfFame() {
    io.emit("teamArena:hallOfFameUpdate", teamArena.getHallOfFameList(10));
}

function emitArenaTelemetry(eventName, payload) {
    io.emit("arena:telemetry", {
        event: eventName,
        serverTs: Date.now(),
        ...payload
    });
}

function logArenaGift(event, result) {
    const attacker = result?.attacker;
    const target = result?.target;
    if (!attacker?.id || !target?.id) return;
    console.log(
        `[arena gift] ${attacker.name || attacker.id} -> ${target.name || target.id} | gift=${event.gift.name} x${event.gift.repeatCount} | diamonds=${event.gift.totalDiamonds} | fx=${event.gift.fx} | sfx=${event.gift.sfx} | fallback=${event.gift.tierFallbackUsed ? "yes" : "no"} | score+${result.scoreGain} | dmg=${result.damage} | loss=${result.scoreLoss} | ko=${result.ko ? "yes" : "no"}`
    );
}

function logArenaLike(event, player, support, strike) {
    if (!player?.id) return;
    const comboLikes = support?.likeCombo || event.likeCount;
    console.log(
        `[arena like] ${player.name || player.id} | likes=${event.likeCount} | total=${event.totalLikeCount || 0} | src=${event.countSource || "unknown"} | combo=${comboLikes} | heal=${support?.heal || 0} | score+${support?.scoreGain || 0} | strike=${strike ? "yes" : "no"} | ko=${strike?.ko ? "yes" : "no"}`
    );
}

function logRaceGift(event, result) {
    const attacker = result?.attacker;
    if (!attacker?.id) return;
    const primaryTarget = result.targets?.[0];
    console.log(
        `[race gift] ${attacker.name || attacker.id} | gift=${event.gift.name} x${event.gift.repeatCount} | diamonds=${event.gift.totalDiamonds} | power=${result.powerLabel} | boost=+${result.progressGain} | momentum=+${result.momentumGain} | target=${primaryTarget?.name || "none"} | loss=${primaryTarget?.progressLoss || 0}`
    );
}

function logRaceLike(event, player, support) {
    if (!player?.id) return;
    console.log(
        `[race like] ${player.name || player.id} | likes=${event.likeCount} | total=${event.totalLikeCount || 0} | src=${event.countSource || "unknown"} | boost=+${support?.progressGain || 0} | momentum=+${support?.momentumGain || 0} | combo=${support?.comboLikes || event.likeCount}`
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
        !playerId.startsWith("rose_burst_") &&
        !playerId.startsWith("donut_wave_") &&
        !playerId.startsWith("galaxy_stress_") &&
        !playerId.startsWith("universe_spike_") &&
        !playerId.startsWith("mixed_flood_") &&
        playerId !== "debug_user";
}

function extractCountryFromComment(comment) {
    const text = String(comment || "").trim();
    if (!text) return null;

    const directMatch = resolveCountryCodeFromText(text);
    if (directMatch) return directMatch;

    const tokens = text.split(/\s+/).filter(Boolean);
    for (let span = Math.min(3, tokens.length); span >= 1; span -= 1) {
        for (let i = 0; i <= tokens.length - span; i += 1) {
            const candidate = tokens.slice(i, i + span).join(" ");
            const code = resolveCountryCodeFromText(candidate);
            if (code) return code;
        }
    }

    return null;
}

function resolveTeamArenaCountry(rawData, user = null) {
    const uniqueId = String(user?.id || rawData?.user?.uniqueId || rawData?.uniqueId || "").toLowerCase();
    return uniqueId ? (userCountryOverrides[uniqueId] || null) : null;
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

function buildPersistedTeamWinner(entry) {
    if (!entry?.id) return null;
    return {
        id: entry.id,
        name: entry.name,
        avatar: entry.avatar,
        flag: entry.flag || "",
        flagUrl: entry.flagUrl || "",
        countryCode: entry.countryCode || entry.id,
        victories: entry.victories,
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now()
    };
}

function resetRound() {
    const arenaWinner = arena.getRoundWinner();
    const teamArenaWinner = teamArena.getRoundWinner();

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

    let finalTeamRoundWinner = teamArenaWinner;
    if (teamArenaWinner?.id) {
        const persistedTeamWinner = teamArena.markRoundWinner(teamArenaWinner.id);
        if (persistedTeamWinner) {
            teamLastWinners = normalizeChampionStandings([
                ...teamLastWinners,
                buildPersistedTeamWinner(persistedTeamWinner)
            ], { preserveCountryMeta: true });
            teamChampionsStorage.save(teamLastWinners);
            teamArena.seedChampionStandings(teamLastWinners);
            finalTeamRoundWinner = persistedTeamWinner;
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

    io.emit("teamArena:roundEnd", {
        roundWinner: finalTeamRoundWinner,
        winner: finalTeamRoundWinner
    });
    if (finalTeamRoundWinner?.id) {
        lastCompletedTeamRoundWinner = {
            id: finalTeamRoundWinner.id,
            name: finalTeamRoundWinner.name,
            avatar: finalTeamRoundWinner.avatar,
            score: finalTeamRoundWinner.score,
            standingScore: finalTeamRoundWinner.standingScore,
            hp: finalTeamRoundWinner.hp,
            deaths: finalTeamRoundWinner.deaths,
            victories: finalTeamRoundWinner.victories,
            memberCount: finalTeamRoundWinner.memberCount,
            activeCount: finalTeamRoundWinner.activeCount,
            flag: finalTeamRoundWinner.flag || "",
            flagUrl: finalTeamRoundWinner.flagUrl || "",
            countryCode: finalTeamRoundWinner.countryCode || finalTeamRoundWinner.id
        };
        io.emit("teamArena:lastRoundWinner", lastCompletedTeamRoundWinner);
    }

    isSuddenDeath = false;
    arenaLeaderVoiceWindow = { leaderId: null, count: 0 };
    teamArenaLeaderVoiceWindow = { leaderId: null, count: 0 };

    io.emit("arena:suddenDeath", false);
    io.emit("teamArena:suddenDeath", false);

    arena.resetRound();
    teamArena.resetRound();

    queueArenaState(true);
    queueTeamArenaState(true);
    broadcastChampions();
    broadcastTeamChampions();
    broadcastHallOfFame();
    broadcastTeamHallOfFame();
    startTimer();
}

function buildPersistedRaceWinner(entry) {
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

function resetRaceRound(reason = "timer") {
    const raceWinner = race.getRoundWinner();
    let finalRaceWinner = raceWinner;

    if (raceWinner?.id && isCompetitiveArenaPlayer(raceWinner.id)) {
        const persistedRaceWinner = race.markRoundWinner(raceWinner.id);
        if (persistedRaceWinner) {
            raceLastWinners = normalizeChampionStandings([
                ...raceLastWinners,
                buildPersistedRaceWinner(persistedRaceWinner)
            ], { memoryWindowMs: GAME_CONFIG.carrera.championMemoryWindowMs });
            raceChampionsStorage.save(raceLastWinners);
            finalRaceWinner = persistedRaceWinner;
        }
    }

    io.emit("race:roundEnd", {
        reason,
        winner: finalRaceWinner,
        roundWinner: finalRaceWinner
    });

    if (finalRaceWinner?.id) {
        lastCompletedRaceWinner = {
            id: finalRaceWinner.id,
            name: finalRaceWinner.name,
            avatar: finalRaceWinner.avatar,
            progress: finalRaceWinner.progress,
            progressPct: finalRaceWinner.progressPct,
            victories: finalRaceWinner.victories,
            finishMs: finalRaceWinner.finishMs || 0
        };
        io.emit("race:lastRoundWinner", lastCompletedRaceWinner);
    }

    lastRaceLeaderId = null;
    race.resetRound();
    queueRaceState(true);
    broadcastRaceChampions();
    broadcastRaceHallOfFame();
    startRaceTimer();
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
            io.emit("teamArena:suddenDeath", true);
        }

        if (timeRemaining <= 0) {
            resetRound();
        }
    }, 1000);
}

function startRaceTimer() {
    clearInterval(raceTimerInterval);
    raceTimeRemaining = GAME_CONFIG.carrera.roundDurationSeconds;
    io.emit("race:timerUpdate", raceTimeRemaining);

    raceTimerInterval = setInterval(() => {
        raceTimeRemaining -= 1;
        io.emit("race:timerUpdate", raceTimeRemaining);

        if (raceTimeRemaining <= 0) {
            resetRaceRound("timer");
        }
    }, 1000);
}

function startArenaSawLoop() {
    clearInterval(arenaSawTimer);
    arenaSawTimer = setInterval(() => {
        const now = Date.now();

        const arenaHits = arena.applySawAuraHits(isSuddenDeath, now);
        if (arenaHits.length) {
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
        }

        const teamHits = teamArena.applySawAuraHits(isSuddenDeath, now);
        if (!teamHits.length) return;

        teamHits.forEach((hit) => {
            const sawAttacker = teamArena.getCountryState(hit.attacker.countryCode) || hit.attacker;
            const sawTarget = teamArena.getCountryState(hit.target.countryCode) || hit.target;
            io.emit("teamArena:sawHit", {
                attacker: sawAttacker,
                target: sawTarget,
                damage: hit.damage,
                scoreLoss: hit.scoreLoss,
                ko: hit.ko
            });
            if (hit.ko) {
                io.emit("teamArena:ko", {
                    attackerId: sawAttacker.id,
                    targetId: sawTarget.id
                });
            }
        });

        queueTeamArenaState();
    }, GAME_CONFIG.arena.sawTickIntervalMs);
}

function startRaceLoop() {
    clearInterval(raceLoopTimer);
    raceLoopTimer = setInterval(() => {
        const tick = race.tick(Date.now());
        if (tick.changed) {
            const leader = race.getLeader();
            if (leader?.id && leader.id !== lastRaceLeaderId) {
                lastRaceLeaderId = leader.id;
                io.emit("race:leaderChanged", leader);
            }
            queueRaceState();
        }

        if (tick.finishedPlayer?.id) {
            resetRaceRound("finish");
        }
    }, GAME_CONFIG.carrera.tickIntervalMs);
}

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
        syncTikTokEnvFromChrome({ logger: console });
        const config = getTikTokConfig();

        if (tiktokLive?.removeAllListeners) {
            tiktokLive.removeAllListeners();
        }
        if (tiktokLive?.disconnect) {
            try {
                await tiktokLive.disconnect();
            } catch {
                // Ignore stale disconnect failures before rebuilding the client.
            }
        }

        tiktokLive = createTikTokConnection(config);
        bindTikTokListeners(tiktokLive);

        const isLive = await tiktokLive.fetchIsLive();
        if (!isLive) {
            liveStatus = { connected: false, username: config.username, error: "Esperando que el Live inicie..." };
            io.emit("status", liveStatus);
            tiktokRetryTimer = setTimeout(connectToTikTok, retryDelay);
            return;
        }

        const state = await tiktokLive.connect();
        console.log(`✅ TikTok LIVE conectado. Room ID: ${state.roomId}`);
        liveStatus = { connected: true, username: config.username };
        io.emit("status", liveStatus);
    } catch (error) {
        const errorMessage = error.message.includes("isn't online")
            ? "Esperando que el Live inicie..."
            : error.message;

        liveStatus = {
            connected: false,
            username: getTikTokConfig().username,
            error: errorMessage
        };
        io.emit("status", liveStatus);
        tiktokRetryTimer = setTimeout(connectToTikTok, retryDelay);
    } finally {
        isConnectingToTikTok = false;
    }
}

function handleArenaGift(event) {
    const attacker = arena.ensurePlayer(event.user, "gift");
    if (!attacker) return;

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

    const result = arena.applyGiftCombat(attacker.id, target.id, event.gift, isSuddenDeath);
    if (!result) return;
    logArenaGift(event, result);

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
        damage: result.damage,
        scoreGain: result.scoreGain,
        scoreLoss: result.scoreLoss
    });
    emitArenaTelemetry("gift", {
        userId: result.attacker.id,
        userName: result.attacker.name,
        targetId: result.target.id,
        targetName: result.target.name,
        giftName: event.gift.name,
        diamondCount: event.gift.diamondCount,
        repeatCount: event.gift.repeatCount,
        repeatCountSource: event.repeatCountSource || "unknown",
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

    if (event.gift.totalDiamonds >= GAME_CONFIG.countries.bigGiftThreshold) {
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
    queueArenaState();
}

function handleTeamArenaGift(event, rawData) {
    const attackerCountryCode = resolveTeamArenaCountry(rawData, event.user);
    if (!attackerCountryCode) return;
    const attacker = teamArena.ensurePlayer(event.user, "gift", { countryCode: attackerCountryCode });
    if (!attacker) return;

    if (attacker.state === "ELIMINATED" && Date.now() >= attacker.eliminatedUntil) {
        teamArena.applyChatActivity(attacker.id);
        io.emit("teamArena:respawn", { userId: attackerCountryCode, mode: "gift" });
    }

    const targetSelection = teamArena.pickTarget(attacker.id);
    if (!targetSelection) {
        queueTeamArenaState();
        return;
    }
    const target = targetSelection.target;

    const result = teamArena.applyGiftCombat(attacker.id, target.id, event.gift, isSuddenDeath);
    if (!result) return;

    const attackerCountry = teamArena.getCountryState(result.attacker.countryCode) || result.attacker;
    const targetCountry = teamArena.getCountryState(result.target.countryCode) || result.target;

    io.emit("teamArena:gift", {
        attacker: { id: attackerCountry.id, x: attackerCountry.x, y: attackerCountry.y },
        attackerState: attackerCountry,
        target: targetCountry,
        targetId: targetCountry.id,
        targetState: targetCountry.state,
        diamondCount: event.gift.diamondCount,
        repeatCount: event.gift.repeatCount,
        totalDiamonds: event.gift.totalDiamonds,
        giftName: event.gift.name,
        tier: event.gift.tier,
        category: event.gift.category,
        effectKey: event.gift.fx,
        label: event.gift.label,
        sfx: event.gift.sfx,
        multiplier: result.comboMultiplier,
        damage: result.damage,
        scoreGain: result.scoreGain,
        scoreLoss: result.scoreLoss
    });

    if (result.comboMultiplier > 1) {
        io.emit("teamArena:combo", {
            attackerId: attackerCountry.id,
            combo: result.attacker.comboCount,
            multiplier: result.comboMultiplier
        });
    }

    if (event.gift.totalDiamonds >= GAME_CONFIG.countries.bigGiftThreshold) {
        io.emit("teamArena:burst", {
            sourceId: attackerCountry.id,
            targetId: targetCountry.id,
            sourceX: attackerCountry.x,
            sourceY: attackerCountry.y,
            x: targetCountry.x,
            y: targetCountry.y,
            targetX: targetCountry.x,
            targetY: targetCountry.y,
            count: event.gift.totalDiamonds >= 20000 ? 8 : 4,
            color: event.gift.tier === "legendary" ? "#fff7d6" : "#fbbf24"
        });
    }

    if (event.gift.category === "mega" || event.gift.totalDiamonds >= 500) {
        io.emit("teamArena:powerup", {
            userId: attackerCountry.id,
            type: "buzzsaw",
            duration: 900
        });
    }

    if (result.ko) {
        io.emit("teamArena:ko", {
            attackerId: attackerCountry.id,
            targetId: targetCountry.id
        });
    }

    if (targetSelection.respawned) {
        io.emit("teamArena:respawn", { userId: targetCountry.id, mode: "basic" });
    }

    broadcastTeamHallOfFame();
    queueTeamArenaState();
}

function handleRaceGift(event) {
    const attacker = race.ensurePlayer(event.user, "gift");
    if (!attacker) return;

    const result = race.applyGiftPower(attacker.id, event.gift);
    if (!result) return;
    logRaceGift(event, result);

    io.emit("race:gift", {
        attacker: result.attacker,
        target: result.target,
        targets: result.targets,
        giftName: event.gift.name,
        diamondCount: event.gift.diamondCount,
        repeatCount: event.gift.repeatCount,
        totalDiamonds: event.gift.totalDiamonds,
        tier: event.gift.tier,
        category: event.gift.category,
        effectKey: event.gift.fx,
        label: event.gift.label,
        powerLabel: result.powerLabel,
        sfx: event.gift.sfx,
        progressGain: result.progressGain,
        momentumGain: result.momentumGain,
        shieldUntil: result.shieldUntil,
        turboUntil: result.turboUntil
    });

    broadcastRaceHallOfFame();
    queueRaceState();
}

function handleArenaLike(event) {
    const player = arena.ensurePlayer(event.user, "like");
    if (!player) return;

    const support = arena.applyLikeSupport(player.id, event.likeCount);
    const comboLikes = support?.likeCombo || event.likeCount;
    const strike = arena.applyLikeStrike(player.id, comboLikes, isSuddenDeath);
    logArenaLike(event, player, support, strike);

    io.emit("arena:like", {
        userId: player.id,
        player: support?.player || null,
        likeCount: event.likeCount,
        comboLikes,
        heal: support?.heal || 0,
        scoreGain: support?.scoreGain || 0,
        userName: player.name,
        respawned: Boolean(support?.respawned)
    });
    emitArenaTelemetry("like", {
        userId: player.id,
        userName: player.name,
        likeCount: event.likeCount,
        totalLikeCount: event.totalLikeCount || 0,
        countSource: event.countSource || "unknown",
        comboLikes,
        heal: support?.heal || 0,
        scoreGain: support?.scoreGain || 0,
        respawned: Boolean(support?.respawned),
        burstTriggered: Boolean(support?.player && comboLikes >= GAME_CONFIG.arena.likeBurstThreshold),
        powerupTriggered: Boolean(comboLikes >= GAME_CONFIG.arena.likeMiniPowerThreshold),
        strikeTriggered: Boolean(strike),
        ko: Boolean(strike?.ko)
    });

    if (support?.respawned) {
        io.emit("arena:respawn", { userId: player.id, mode: "basic" });
    }

    if (support?.player && comboLikes >= GAME_CONFIG.arena.likeBurstThreshold) {
        io.emit("arena:burst", {
            x: support.player.x,
            y: support.player.y,
            count: comboLikes >= GAME_CONFIG.arena.likeMegaPowerThreshold ? 6 : 3,
            color: comboLikes >= GAME_CONFIG.arena.likeMiniPowerThreshold ? "#7dd3fc" : "#bbf7d0"
        });
    }

    if (comboLikes >= GAME_CONFIG.arena.likeMiniPowerThreshold) {
        const duration = comboLikes >= GAME_CONFIG.arena.likeMegaPowerThreshold
            ? GAME_CONFIG.arena.likeMegaPowerDurationFrames
            : GAME_CONFIG.arena.likeMiniPowerDurationFrames;
        io.emit("arena:powerup", {
            userId: player.id,
            type: "buzzsaw",
            duration
        });
    }

    if (strike) {
        io.emit("arena:likeStrike", {
            attacker: strike.attacker,
            target: strike.target,
            damage: strike.damage,
            scoreLoss: strike.scoreLoss,
            ko: strike.ko,
            likeCount: event.likeCount,
            comboLikes
        });
        if (strike.ko) {
            io.emit("arena:ko", {
                attackerId: strike.attacker.id,
                targetId: strike.target.id
            });
        }
    }

    queueArenaState();
}

function handleTeamArenaLike(event, rawData) {
    const arenaCountryCode = resolveTeamArenaCountry(rawData, event.user);
    if (!arenaCountryCode) return;
    const player = teamArena.ensurePlayer(event.user, "like", { countryCode: arenaCountryCode });
    if (!player) return;

    const support = teamArena.applyLikeSupport(player.id, event.likeCount);
    const comboLikes = support?.likeCombo || event.likeCount;
    const strike = teamArena.applyLikeStrike(player.id, comboLikes, isSuddenDeath);
    const playerCountry = teamArena.getCountryState(player.countryCode) || support?.player || null;

    io.emit("teamArena:like", {
        userId: playerCountry?.id || player.id,
        player: playerCountry || null,
        likeCount: event.likeCount,
        comboLikes,
        heal: support?.heal || 0,
        scoreGain: support?.scoreGain || 0,
        respawned: Boolean(support?.respawned)
    });

    if (support?.respawned) {
        io.emit("teamArena:respawn", { userId: playerCountry?.id || player.id, mode: "basic" });
    }

    if (playerCountry && comboLikes >= GAME_CONFIG.arena.likeBurstThreshold) {
        io.emit("teamArena:burst", {
            x: playerCountry.x,
            y: playerCountry.y,
            count: comboLikes >= GAME_CONFIG.arena.likeMegaPowerThreshold ? 6 : 3,
            color: comboLikes >= GAME_CONFIG.arena.likeMiniPowerThreshold ? "#7dd3fc" : "#bbf7d0"
        });
    }

    if (comboLikes >= GAME_CONFIG.arena.likeMiniPowerThreshold) {
        const duration = comboLikes >= GAME_CONFIG.arena.likeMegaPowerThreshold
            ? GAME_CONFIG.arena.likeMegaPowerDurationFrames
            : GAME_CONFIG.arena.likeMiniPowerDurationFrames;
        io.emit("teamArena:powerup", {
            userId: playerCountry?.id || player.id,
            type: "buzzsaw",
            duration
        });
    }

    if (strike) {
        const strikeAttacker = teamArena.getCountryState(strike.attacker.countryCode) || strike.attacker;
        const strikeTarget = teamArena.getCountryState(strike.target.countryCode) || strike.target;
        io.emit("teamArena:likeStrike", {
            attacker: strikeAttacker,
            target: strikeTarget,
            damage: strike.damage,
            scoreLoss: strike.scoreLoss,
            ko: strike.ko,
            likeCount: event.likeCount,
            comboLikes
        });
        if (strike.ko) {
            io.emit("teamArena:ko", {
                attackerId: strikeAttacker.id,
                targetId: strikeTarget.id
            });
        }
    }

    queueTeamArenaState();
}

function handleRaceLike(event) {
    const player = race.ensurePlayer(event.user, "like");
    if (!player) return;

    const support = race.applyLikeBoost(player.id, event.likeCount);
    if (!support) return;
    logRaceLike(event, player, support);

    io.emit("race:like", {
        userId: player.id,
        player: support.player,
        likeCount: event.likeCount,
        comboLikes: support.comboLikes,
        progressGain: support.progressGain,
        momentumGain: support.momentumGain,
        shieldUntil: support.shieldUntil,
        turboUntil: support.turboUntil
    });

    broadcastRaceHallOfFame();
    queueRaceState();
}

function handleArenaChat(event) {
    const text = event.comment.toUpperCase();
    const player = arena.ensurePlayer(event.user, "chat");
    if (!player) return;

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

    if (text.includes(GAME_CONFIG.arena.chatWakeKeyword) || activity?.respawned) {
        queueArenaState();
    }
    if (activity?.respawned) {
        io.emit("arena:respawn", { userId: player.id, mode: "basic" });
    }

    if (
        topArenaLeader?.id &&
        topArenaLeader.id === player.id &&
        cleanComment &&
        cleanComment.length >= 3 &&
        !chatRequestedPower
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
}

function handleTeamArenaChat(event, rawData) {
    const text = event.comment.toUpperCase();
    const detectedCountry = extractCountryFromComment(event.comment);
    if (detectedCountry) {
        userCountryOverrides[event.user.id.toLowerCase()] = detectedCountry;
    }

    const arenaCountry = detectedCountry || resolveTeamArenaCountry(rawData, event.user);
    const player = teamArena.ensurePlayer(event.user, "chat", { countryCode: arenaCountry || null });
    if (!player) return;
    if (detectedCountry) {
        teamArena.setPlayerCountry(player.id, detectedCountry);
    }

    const activity = teamArena.applyChatActivity(player.id);
    const chatRequestedPower = text.includes(`+ ${GAME_CONFIG.arena.chatPowerKeyword}`) ||
        text.includes(`+${GAME_CONFIG.arena.chatPowerKeyword}`) ||
        text.includes(GAME_CONFIG.arena.chatPowerKeyword);
    const power = chatRequestedPower ? teamArena.applyChatPower(player.id) : null;
    const topArenaLeader = teamArena.getTopArenaLeader();
    const cleanComment = sanitizeLeaderChatMessage(event.comment);

    if (chatRequestedPower) {
        const powerCountry = teamArena.getCountryState((power?.player || player).countryCode) || power?.player || player;
        io.emit("teamArena:chatPower", {
            userId: powerCountry.id,
            keyword: GAME_CONFIG.arena.chatPowerKeyword,
            player: powerCountry || null,
            heal: power?.heal || 0,
            scoreGain: power?.scoreGain || 0
        });
        if (power?.duration) {
            io.emit("teamArena:powerup", {
                userId: powerCountry.id,
                type: "buzzsaw",
                duration: power.duration
            });
        }
    }

    if (text.includes(GAME_CONFIG.arena.chatWakeKeyword) || activity?.respawned) {
        queueTeamArenaState();
    }
    if (activity?.respawned) {
        io.emit("teamArena:respawn", { userId: arenaCountry || player.id, mode: "basic" });
    }

    if (
        topArenaLeader?.id &&
        arenaCountry &&
        topArenaLeader.id === arenaCountry &&
        cleanComment &&
        cleanComment.length >= 3 &&
        !chatRequestedPower
    ) {
        if (teamArenaLeaderVoiceWindow.leaderId !== topArenaLeader.id) {
            teamArenaLeaderVoiceWindow = { leaderId: topArenaLeader.id, count: 0 };
        }
        if (teamArenaLeaderVoiceWindow.count < 5) {
            teamArenaLeaderVoiceWindow.count += 1;
            io.emit("teamArena:leaderChat", {
                userId: arenaCountry,
                name: topArenaLeader.name || player.name,
                comment: cleanComment,
                remaining: Math.max(0, 5 - teamArenaLeaderVoiceWindow.count)
            });
        }
    }
}

function handleRaceChat(event) {
    const player = race.ensurePlayer(event.user, "chat");
    if (!player) return;

    const text = String(event.comment || "").toUpperCase();
    const shouldBoost = text.includes(GAME_CONFIG.carrera.chatWakeKeyword) || text.includes(GAME_CONFIG.carrera.chatBoostKeyword);
    if (!shouldBoost) {
        queueRaceState();
        return;
    }

    const boost = race.applyChatBoost(player.id, event.comment);
    if (!boost) return;

    io.emit("race:chatBoost", {
        userId: player.id,
        player: boost.player,
        keyword: boost.keyword,
        progressGain: boost.progressGain,
        momentumGain: boost.momentumGain,
        turboUntil: boost.turboUntil
    });

    broadcastRaceHallOfFame();
    queueRaceState();
}

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
            handleRaceGift(event);
            handleTeamArenaGift(event, rawData);
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
        handleRaceLike(event);
        handleTeamArenaLike(event, rawData);
    });

    connection.on("chat", (rawData) => {
        const event = normalizeChatEvent(rawData);
        if (!event?.user) {
            console.warn("[chat skipped] missing normalized event/user");
            return;
        }
        handleArenaChat(event);
        handleRaceChat(event);
        handleTeamArenaChat(event, rawData);
    });
}

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

io.on("connection", (socket) => {
    socket.emit("timerUpdate", timeRemaining);
    socket.emit("arena:sync", arena.getPlayers());
    socket.emit("arena:currentRanking", arena.getCurrentRanking());
    socket.emit("arena:champion", arena.getLastWinnerId());
    socket.emit("arena:lastRoundWinner", lastCompletedRoundWinner);
    socket.emit("race:timerUpdate", raceTimeRemaining);
    socket.emit("race:sync", race.getPlayers());
    socket.emit("race:currentRanking", race.getCurrentRanking());
    socket.emit("race:champion", race.getLastWinnerId());
    socket.emit("race:lastRoundWinner", lastCompletedRaceWinner);
    socket.emit("teamArena:sync", teamArena.getPlayers());
    socket.emit("teamArena:currentRanking", teamArena.getCurrentRanking());
    socket.emit("teamArena:champion", teamArena.getLastWinnerId());
    socket.emit("teamArena:lastRoundWinner", lastCompletedTeamRoundWinner);
    socket.emit("status", liveStatus);
    broadcastHallOfFame();
    broadcastRaceHallOfFame();
    broadcastTeamHallOfFame();
    broadcastChampions();
    broadcastRaceChampions();
    broadcastTeamChampions();

    socket.on("arena:batchUpdate", (batch) => {
        for (const [id, patch] of Object.entries(batch || {})) {
            arena.syncPosition(id, patch);
        }
    });

    socket.on("teamArena:batchUpdate", (batch) => {
        for (const [id, patch] of Object.entries(batch || {})) {
            teamArena.syncPosition(id, patch);
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

    socket.on("race:debug:gift", (data) => {
        if (!tiktokLive) return;
        const mockData = {
            uniqueId: data.uniqueId || "debug_user",
            nickname: "MODO DEBUG",
            giftId: 998,
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

    socket.on("teamArena:debug:gift", (data) => {
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
        io.emit("teamArena:suddenDeath", isSuddenDeath);
    });

    socket.on("teamArena:debug:toggleSD", () => {
        isSuddenDeath = !isSuddenDeath;
        io.emit("arena:suddenDeath", isSuddenDeath);
        io.emit("teamArena:suddenDeath", isSuddenDeath);
    });
});

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

    const raceCleanup = race.cleanup(now);
    if (raceCleanup.changed) {
        raceCleanup.removedIds.forEach((id) => {
            io.emit("race:leave", { id });
        });
        queueRaceState(true);
        broadcastRaceHallOfFame();
    }

    const teamCleanup = teamArena.cleanup(now);
    if (!teamCleanup.changed) return;

    teamCleanup.removedIds.forEach((id) => {
        io.emit("teamArena:leave", { id });
    });
    queueTeamArenaState(true);
    broadcastTeamHallOfFame();
}, 5000);

const initialDelay = Math.floor(Math.random() * 5000) + 2000;
setTimeout(connectToTikTok, initialDelay);

server.listen(PORT, () => {
    console.log(`🚀 Server on http://localhost:${PORT}`);
    startTimer();
    startRaceTimer();
    startChromeCookieSync();
    startArenaSawLoop();
    startRaceLoop();
});
