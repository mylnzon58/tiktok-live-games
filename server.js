const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { WebcastPushConnection } = require("tiktok-live-connector");

const { loadEnvFile } = require("./lib/env");
const { syncTikTokEnvFromChrome } = require("./lib/chrome-cookie-sync");
const { DEFAULT_COUNTRIES, NAME_TO_CODE } = require("./lib/constants");
const { createStorage } = require("./lib/storage");
const { createRankingManager } = require("./lib/ranking-manager");
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

const ranking = createRankingManager();
const arena = createArenaManager();
const giftCatalog = createGiftCatalog();

const championsStorage = createStorage("arena_champions.json", []);
const rankingChampStorage = createStorage("ranking_champion.json", null);

let lastWinners = championsStorage.load();
ranking.setRankingChampion(rankingChampStorage.load());

let currentLeaderCode = null;
let isSuddenDeath = false;
let timeRemaining = GAME_CONFIG.countries.roundDurationSeconds;
let timerInterval = null;
let tiktokRetryTimer = null;
let chromeSyncTimer = null;
let arenaBroadcastTimer = null;
let rankingBroadcastTimer = null;
const userCountryOverrides = {};
let liveStatus = { connected: false, username: process.env.TIKTOK_USERNAME || DEFAULT_TIKTOK_USERNAME };
let tiktokLive = null;
let isConnectingToTikTok = false;
let arenaLeaderVoiceWindow = { leaderId: null, count: 0 };
let lastCompletedRoundWinner = null;

app.use(express.static(__dirname));
app.get("/overlay", (req, res) => res.sendFile(path.join(__dirname, "overlay.html")));
app.get("/arena", (req, res) => res.sendFile(path.join(__dirname, "arena.html")));
app.get("/api/gifts", (req, res) => res.json(giftCatalog.getCatalogSnapshot()));
app.get("/", (req, res) => res.redirect("/overlay"));

function emitArenaState() {
    io.emit("arena:sync", arena.getPlayers());
    io.emit("arena:currentRanking", arena.getCurrentRanking());
}

function emitRankingState() {
    const countries = ranking.getCountries();
    io.emit("rankingUpdate", countries);

    const nextLeader = ranking.getWinner();
    const nextLeaderCode = nextLeader?.code || null;
    if (nextLeaderCode !== currentLeaderCode) {
        currentLeaderCode = nextLeaderCode;
        if (nextLeader) {
            io.emit("leaderChanged", nextLeader);
        }
    }
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

function queueRankingState(force = false) {
    if (force) {
        if (rankingBroadcastTimer) {
            clearTimeout(rankingBroadcastTimer);
            rankingBroadcastTimer = null;
        }
        emitRankingState();
        return;
    }
    if (rankingBroadcastTimer) return;
    rankingBroadcastTimer = setTimeout(() => {
        rankingBroadcastTimer = null;
        emitRankingState();
    }, GAME_CONFIG.arena.arenaBroadcastDelayMs);
}

function broadcastChampions() {
    io.emit("arena:champions", lastWinners);
}

function broadcastHallOfFame() {
    io.emit("arena:hallOfFameUpdate", arena.getHallOfFameList(10));
}

function sanitizeLeaderChatMessage(comment) {
    const normalized = String(comment || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 110);
    return normalized;
}

function resolveCountry(rawData) {
    const uniqueId = String(rawData.uniqueId || rawData.user?.uniqueId || "").toLowerCase();
    if (uniqueId && userCountryOverrides[uniqueId]) {
        return userCountryOverrides[uniqueId];
    }

    const normalizedName = String(rawData.nickname || rawData.user?.nickname || uniqueId || "").toUpperCase();
    const emojiMap = {
        "🇦🇷": "AR",
        "🇲🇽": "MX",
        "🇧🇷": "BR",
        "🇨🇴": "CO",
        "🇺🇸": "US",
        "🇪🇸": "ES",
        "🇻🇪": "VE",
        "🇵🇪": "PE"
    };

    for (const [emoji, code] of Object.entries(emojiMap)) {
        if (normalizedName.includes(emoji)) return code;
    }

    const explicitCountryCode = String(rawData.user?.countryCode || rawData.countryCode || "").toUpperCase();
    if (explicitCountryCode.length === 2 && explicitCountryCode !== "XX") {
        return explicitCountryCode;
    }

    for (const word of normalizedName.split(/\s+/)) {
        if (DEFAULT_COUNTRIES[word]) return word;
        if (NAME_TO_CODE[word]) return NAME_TO_CODE[word];
    }

    return "GLOBAL";
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

function updateRankingChampion(countryWinner) {
    if (!countryWinner) return;
    const now = Date.now();
    const currentChamp = ranking.getRankingChampion();
    const stale = !currentChamp || (now - currentChamp.timestamp > GAME_CONFIG.countries.rankingChampionWindowMs);
    const stronger = !currentChamp || countryWinner.score > (currentChamp.score || 0);
    if (!stale && !stronger) return;

    const newChampion = {
        name: `MVP ${countryWinner.name}`,
        country: countryWinner.name,
        flag: countryWinner.flag,
        avatar: countryWinner.avatars?.[0] || "",
        score: countryWinner.score,
        timestamp: now
    };
    ranking.setRankingChampion(newChampion);
    rankingChampStorage.save(newChampion);
    io.emit("ranking:championUpdate", newChampion);
}

function resetRound() {
    const countryWinner = ranking.getWinner();
    const arenaWinner = arena.getRoundWinner();

    let persistedArenaWinner = null;
    if (arenaWinner?.id && isCompetitiveArenaPlayer(arenaWinner.id)) {
        persistedArenaWinner = arena.markRoundWinner(arenaWinner.id);
        if (persistedArenaWinner) {
            lastWinners.unshift({
                name: persistedArenaWinner.name,
                victories: persistedArenaWinner.victories,
                time: new Date().toLocaleTimeString()
            });
            lastWinners = lastWinners.slice(0, 10);
            championsStorage.save(lastWinners);
        }
    }

    updateRankingChampion(countryWinner);

    io.emit("roundReset", { winner: countryWinner, countries: ranking.getCountries() });
    io.emit("arena:roundEnd", {
        roundWinner: arenaWinner,
        winner: arenaWinner
    });
    if (arenaWinner?.id) {
        lastCompletedRoundWinner = {
            id: arenaWinner.id,
            name: arenaWinner.name,
            avatar: arenaWinner.avatar,
            score: arenaWinner.score,
            standingScore: arenaWinner.standingScore,
            hp: arenaWinner.hp,
            deaths: arenaWinner.deaths,
            victories: arenaWinner.victories
        };
        io.emit("arena:lastRoundWinner", lastCompletedRoundWinner);
    }
    io.emit("arena:suddenDeath", false);

    currentLeaderCode = null;
    isSuddenDeath = false;
    ranking.reset();
    arena.resetRound();

    queueRankingState(true);
    queueArenaState(true);
    broadcastChampions();
    broadcastHallOfFame();
    startTimer();
}

function startTimer() {
    clearInterval(timerInterval);
    timeRemaining = GAME_CONFIG.countries.roundDurationSeconds;
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

    if (attacker.state === "ELIMINATED" && Date.now() >= attacker.eliminatedUntil) {
        arena.applyChatActivity(attacker.id);
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
        multiplier: result.comboMultiplier,
        damage: result.damage,
        scoreGain: result.scoreGain,
        scoreLoss: result.scoreLoss
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

function handleRankingGift(event, rawData) {
    const country = resolveCountry(rawData);
    const avatarUrl = event.user?.profilePictureUrl || "";
    let points = event.gift.totalDiamonds;
    if (isSuddenDeath) points *= 2;

    ranking.addPoints(country, points);
    ranking.addAvatar(country, avatarUrl);
    io.emit("ranking:gift", {
        country,
        avatarUrl,
        giftName: event.gift.name,
        coins: points,
        repeatCount: event.gift.repeatCount
    });

    if (points >= GAME_CONFIG.countries.bigGiftThreshold) {
        io.emit("bigGift", {
            country,
            flag: ranking.getCountries()[country]?.flag,
            coins: points,
            giftName: event.gift.name,
            username: event.user?.id,
            avatarUrl
        });
    }

    queueRankingState();
}

function bindTikTokListeners(connection) {
    connection.on("gift", (rawData) => {
        try {
            const event = normalizeGiftEvent(rawData, giftCatalog);
            if (!event.user) return;
            handleRankingGift(event, rawData);
            handleArenaGift(event);
        } catch (error) {
            console.error("Gift error:", error.message);
        }
    });

    connection.on("like", (rawData) => {
        const event = normalizeLikeEvent(rawData);
        if (!event.user) return;

        const country = resolveCountry(rawData);
        if (ranking.addLikes(country, event.likeCount, GAME_CONFIG.countries.likesPerPoint)) {
            queueRankingState();
        }

        const player = arena.ensurePlayer(event.user, "like");
        if (!player) return;

        const support = arena.applyLikeSupport(player.id, event.likeCount);
        const comboLikes = support?.likeCombo || event.likeCount;
        const strike = arena.applyLikeStrike(player.id, comboLikes);
        io.emit("arena:like", {
            userId: player.id,
            player: support?.player || null,
            likeCount: event.likeCount,
            comboLikes,
            heal: support?.heal || 0,
            scoreGain: support?.scoreGain || 0,
            respawned: Boolean(support?.respawned)
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
    });

    connection.on("chat", (rawData) => {
        const event = normalizeChatEvent(rawData);
        if (!event.user) return;

        const text = event.comment.toUpperCase();
        let detectedCountry = null;
        for (const word of text.split(/\s+/)) {
            if (word.length === 2 && DEFAULT_COUNTRIES[word]) {
                detectedCountry = word;
                break;
            }
            if (NAME_TO_CODE[word]) {
                detectedCountry = NAME_TO_CODE[word];
                break;
            }
        }

        if (detectedCountry) {
            userCountryOverrides[event.user.id.toLowerCase()] = detectedCountry;
            io.emit("ranking:countryJoined", {
                userId: event.user.id,
                country: detectedCountry,
                flag: DEFAULT_COUNTRIES[detectedCountry].flag
            });
        }

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
    socket.emit("rankingUpdate", ranking.getCountries());
    socket.emit("timerUpdate", timeRemaining);
    socket.emit("arena:sync", arena.getPlayers());
    socket.emit("arena:currentRanking", arena.getCurrentRanking());
    socket.emit("arena:champion", arena.getLastWinnerId());
    socket.emit("arena:lastRoundWinner", lastCompletedRoundWinner);
    socket.emit("ranking:championUpdate", ranking.getRankingChampion());
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
});

setInterval(() => {
    const cleanup = arena.cleanup(Date.now());
    if (!cleanup.changed) return;

    cleanup.removedIds.forEach((id) => {
        io.emit("arena:leave", { id });
    });
    queueArenaState(true);
    broadcastHallOfFame();
}, 5000);

const initialDelay = Math.floor(Math.random() * 5000) + 2000;
setTimeout(connectToTikTok, initialDelay);

server.listen(PORT, () => {
    console.log(`🚀 Server on http://localhost:${PORT}`);
    startTimer();
    startChromeCookieSync();
});
