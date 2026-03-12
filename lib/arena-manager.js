const fs = require("fs");
const path = require("path");
const { GAME_CONFIG } = require("./game-config");

const PLAYER_STATE = {
    NEW: "NEW",
    ACTIVE: "ACTIVE",
    IDLE: "IDLE",
    ELIMINATED: "ELIMINATED",
    REMOVED: "REMOVED"
};

function createArenaManager() {
    let arenaPlayers = {};
    let arenaHallOfFame = {};
    let lastArenaWinnerId = null;

    const HOF_FILE = path.join(__dirname, "..", "arena_hof.json");
    const arenaConfig = GAME_CONFIG.arena;

    function isCompetitivePlayerId(id) {
        if (!id) return false;
        return !id.startsWith("bot_") &&
            !id.startsWith("debug_") &&
            !id.startsWith("stress_") &&
            !id.startsWith("rose_burst_") &&
            !id.startsWith("donut_wave_") &&
            !id.startsWith("galaxy_stress_") &&
            !id.startsWith("universe_spike_") &&
            !id.startsWith("mixed_flood_") &&
            id !== "debug_user";
    }

    function saveHOF() {
        try {
            fs.writeFileSync(HOF_FILE, JSON.stringify(arenaHallOfFame));
        } catch (error) {
            console.error("❌ Error saving HOF:", error.message);
        }
    }

    function loadHOF() {
        if (!fs.existsSync(HOF_FILE)) return;
        try {
            arenaHallOfFame = JSON.parse(fs.readFileSync(HOF_FILE, "utf8"));
            for (const id of Object.keys(arenaHallOfFame)) {
                if (!isCompetitivePlayerId(id)) {
                    delete arenaHallOfFame[id];
                }
            }
        } catch (error) {
            console.error("❌ Error loading HOF:", error.message);
            arenaHallOfFame = {};
        }
    }

    function getArenaSpawn() {
        return {
            x: Math.round(Math.random() * 800 + 100),
            y: Math.round(Math.random() * 400 + 100)
        };
    }

    function derivePrestige(record) {
        const wins = record.victories || 0;
        const bestScore = record.bestScore || 0;
        const recentGifts = record.totalGiftDiamonds || 0;
        return Math.round((wins * 5000) + (bestScore * 0.35) + (recentGifts * 0.08));
    }

    function sanitizePlayerForClient(player) {
        return {
            id: player.id,
            name: player.name,
            avatar: player.avatar,
            score: player.score,
            hp: player.hp,
            x: player.x,
            y: player.y,
            state: player.state,
            lastActive: player.lastActive,
            victories: player.victories || 0,
            bestScore: player.bestScore || 0,
            comboCount: player.comboCount || 0,
            sawActiveUntil: player.sawActiveUntil || 0,
            eliminatedUntil: player.eliminatedUntil || 0,
            invulnerableUntil: player.invulnerableUntil || 0,
            totalGiftDiamonds: player.totalGiftDiamonds || 0,
            totalLikes: player.totalLikes || 0
        };
    }

    function createArenaPlayer(userData, previousRecord = null) {
        const id = userData.uniqueId || userData.userId || userData.id;
        const now = Date.now();
        const spawn = getArenaSpawn();
        return {
            id,
            name: userData.nickname || previousRecord?.name || id,
            avatar: userData.profilePictureUrl || previousRecord?.avatar || "",
            hp: arenaConfig.maxHp,
            score: 0,
            x: spawn.x,
            y: spawn.y,
            state: PLAYER_STATE.NEW,
            lastActive: now,
            idleSince: 0,
            eliminatedUntil: 0,
            invulnerableUntil: 0,
            victories: previousRecord?.victories || 0,
            bestScore: previousRecord?.bestScore || previousRecord?.score || 0,
            prestige: previousRecord?.prestige || 0,
            totalGiftDiamonds: previousRecord?.totalGiftDiamonds || 0,
            totalLikes: previousRecord?.totalLikes || 0,
            comboCount: 0,
            lastGiftTime: 0,
            sawActiveUntil: 0,
            roundStats: {
                gifts: 0,
                likes: 0,
                respawns: 0,
                kos: 0,
                damageDealt: 0,
                damageTaken: 0
            }
        };
    }

    function ensurePlayer(userData, source = "system") {
        const id = userData?.uniqueId || userData?.userId || userData?.id;
        if (!id) return null;

        if (!arenaPlayers[id]) {
            const previousRecord = arenaHallOfFame[id] || null;
            arenaPlayers[id] = createArenaPlayer(userData, previousRecord);
        }

        const player = arenaPlayers[id];
        player.name = userData.nickname || player.name;
        if (userData.profilePictureUrl) {
            player.avatar = userData.profilePictureUrl;
        }
        touchPlayer(player, source);
        return player;
    }

    function touchPlayer(player, source = "interaction") {
        const now = Date.now();
        player.lastActive = now;
        player.state = player.state === PLAYER_STATE.ELIMINATED ? PLAYER_STATE.ELIMINATED : PLAYER_STATE.ACTIVE;
        if (player.state !== PLAYER_STATE.ELIMINATED) {
            player.idleSince = 0;
        }

        if (source === "gift") {
            player.state = PLAYER_STATE.ACTIVE;
        }
    }

    function canRespawn(player, now = Date.now()) {
        return player.state === PLAYER_STATE.ELIMINATED && now >= player.eliminatedUntil;
    }

    function respawnPlayer(player, mode = "basic", now = Date.now()) {
        const spawn = getArenaSpawn();
        player.x = spawn.x;
        player.y = spawn.y;
        player.hp = mode === "gift" ? Math.round(arenaConfig.maxHp * 0.7) : Math.round(arenaConfig.maxHp * 0.55);
        player.invulnerableUntil = now + arenaConfig.respawnShieldMs;
        player.eliminatedUntil = 0;
        player.state = PLAYER_STATE.ACTIVE;
        player.roundStats.respawns += 1;
        player.lastActive = now;
        return player;
    }

    function updateHOF(player) {
        if (!player || !player.id || !isCompetitivePlayerId(player.id)) return;

        const previous = arenaHallOfFame[player.id] || {};
        const merged = {
            id: player.id,
            name: player.name,
            avatar: player.avatar,
            score: Math.max(previous.score || 0, player.score || 0),
            bestScore: Math.max(previous.bestScore || 0, player.bestScore || player.score || 0),
            victories: Math.max(previous.victories || 0, player.victories || 0),
            totalGiftDiamonds: Math.max(previous.totalGiftDiamonds || 0, player.totalGiftDiamonds || 0),
            totalLikes: Math.max(previous.totalLikes || 0, player.totalLikes || 0),
            lastActive: Date.now()
        };
        merged.prestige = derivePrestige(merged);
        arenaHallOfFame[player.id] = merged;
        saveHOF();
    }

    function getPlayers() {
        return Object.fromEntries(
            Object.entries(arenaPlayers).map(([id, player]) => [id, sanitizePlayerForClient(player)])
        );
    }

    function getCurrentRanking(limit = 10) {
        return Object.values(arenaPlayers)
            .filter((player) => isCompetitivePlayerId(player.id))
            .filter((player) => player.state !== PLAYER_STATE.REMOVED)
            .sort((a, b) =>
                (b.score - a.score) ||
                ((b.roundStats?.damageDealt || 0) - (a.roundStats?.damageDealt || 0)) ||
                ((b.roundStats?.gifts || 0) - (a.roundStats?.gifts || 0))
            )
            .slice(0, limit)
            .map((player) => ({
                id: player.id,
                name: player.name,
                avatar: player.avatar,
                hp: player.hp,
                score: player.score,
                state: player.state,
                victories: player.victories || 0,
                damage: player.roundStats?.damageDealt || 0,
                gifts: player.roundStats?.gifts || 0
            }));
    }

    function getHallOfFameList(limit = 10) {
        return Object.values(arenaHallOfFame)
            .sort((a, b) =>
                (b.prestige - a.prestige) ||
                (b.victories - a.victories) ||
                ((b.bestScore || 0) - (a.bestScore || 0))
            )
            .slice(0, limit);
    }

    function pickTarget(attackerId) {
        const attacker = arenaPlayers[attackerId];
        if (!attacker) return null;

        let bestTarget = null;
        let bestDistance = Infinity;

        for (const player of Object.values(arenaPlayers)) {
            if (player.id === attackerId) continue;
            if (player.state === PLAYER_STATE.ELIMINATED || player.state === PLAYER_STATE.REMOVED) continue;
            if (player.hp <= 0) continue;

            const dx = attacker.x - player.x;
            const dy = attacker.y - player.y;
            const distance = Math.sqrt((dx * dx) + (dy * dy));
            if (distance < bestDistance) {
                bestTarget = player;
                bestDistance = distance;
            }
        }

        if (bestTarget) {
            return { target: bestTarget, respawned: false };
        }

        let fallbackTarget = null;
        for (const player of Object.values(arenaPlayers)) {
            if (player.id === attackerId) continue;
            if (player.state !== PLAYER_STATE.ELIMINATED) continue;
            if (!canRespawn(player)) continue;
            respawnPlayer(player, "basic");
            fallbackTarget = player;
            break;
        }

        if (!fallbackTarget) return null;
        return { target: fallbackTarget, respawned: true };
    }

    function computeComboMultiplier(player, now = Date.now()) {
        if (now - player.lastGiftTime <= arenaConfig.comboWindowMs) {
            player.comboCount += 1;
        } else {
            player.comboCount = 1;
        }
        player.lastGiftTime = now;

        const comboRule = arenaConfig.comboMultipliers.find((entry) => player.comboCount >= entry.hits);
        return comboRule ? comboRule.multiplier : 1;
    }

    function applyGiftCombat(attackerId, targetId, resolution, isSuddenDeath = false) {
        const now = Date.now();
        const attacker = arenaPlayers[attackerId];
        const target = arenaPlayers[targetId];
        if (!attacker || !target) return null;

        const comboMultiplier = computeComboMultiplier(attacker, now);
        const suddenMultiplier = isSuddenDeath ? 2 : 1;
        const scoreGain = Math.max(1, Math.round(resolution.totalDiamonds * resolution.scoreScale * comboMultiplier * suddenMultiplier));
        const damage = Math.max(8, Math.round(resolution.totalDiamonds * resolution.damageScale * comboMultiplier * suddenMultiplier));

        attacker.score += scoreGain;
        attacker.bestScore = Math.max(attacker.bestScore || 0, attacker.score);
        attacker.totalGiftDiamonds += resolution.totalDiamonds;
        attacker.roundStats.gifts += 1;
        attacker.roundStats.damageDealt += damage;
        attacker.sawActiveUntil = resolution.category === "mega" || resolution.totalDiamonds >= 500 ? now + 15000 : attacker.sawActiveUntil;

        let ko = false;
        if (now >= (target.invulnerableUntil || 0)) {
            target.hp = Math.max(0, target.hp - damage);
            target.roundStats.damageTaken += damage;
            if (target.hp <= 0) {
                target.hp = 0;
                target.state = PLAYER_STATE.ELIMINATED;
                target.eliminatedUntil = now + arenaConfig.respawnCooldownMs;
                target.invulnerableUntil = 0;
                attacker.roundStats.kos += 1;
                ko = true;
            }
        }

        touchPlayer(attacker, "gift");
        touchPlayer(target, "gift-target");
        updateHOF(attacker);

        return {
            attacker: sanitizePlayerForClient(attacker),
            target: sanitizePlayerForClient(target),
            scoreGain,
            damage,
            comboMultiplier,
            ko
        };
    }

    function applyLikeSupport(playerId, likeCount) {
        const player = arenaPlayers[playerId];
        if (!player) return null;
        const now = Date.now();
        touchPlayer(player, "like");

        const heal = likeCount * arenaConfig.likeHealPerTap;
        player.totalLikes += likeCount;
        player.roundStats.likes += likeCount;

        let respawned = false;
        if (canRespawn(player, now)) {
            respawnPlayer(player, "basic", now);
            respawned = true;
        }

        if (player.state !== PLAYER_STATE.ELIMINATED) {
            player.hp = Math.min(arenaConfig.maxHp, player.hp + heal);
        }

        return {
            player: sanitizePlayerForClient(player),
            heal,
            respawned
        };
    }

    function applyChatActivity(playerId) {
        const player = arenaPlayers[playerId];
        if (!player) return null;
        const now = Date.now();
        touchPlayer(player, "chat");

        let respawned = false;
        if (canRespawn(player, now)) {
            respawnPlayer(player, "basic", now);
            respawned = true;
        }

        return {
            player: sanitizePlayerForClient(player),
            respawned
        };
    }

    function syncPosition(id, patch) {
        const player = arenaPlayers[id];
        if (!player || !patch) return;
        if (typeof patch.x === "number") player.x = patch.x;
        if (typeof patch.y === "number") player.y = patch.y;
    }

    function getRoundWinner() {
        const ranking = getCurrentRanking(1);
        return ranking[0] || null;
    }

    function markRoundWinner(playerId) {
        const player = arenaPlayers[playerId];
        if (!player) return null;
        player.victories = (player.victories || 0) + 1;
        player.bestScore = Math.max(player.bestScore || 0, player.score || 0);
        updateHOF(player);
        lastArenaWinnerId = player.id;
        return sanitizePlayerForClient(player);
    }

    function resetRound() {
        for (const player of Object.values(arenaPlayers)) {
            player.score = 0;
            player.hp = arenaConfig.maxHp;
            player.comboCount = 0;
            player.state = PLAYER_STATE.ACTIVE;
            player.eliminatedUntil = 0;
            player.invulnerableUntil = 0;
            player.sawActiveUntil = 0;
            player.roundStats = {
                gifts: 0,
                likes: 0,
                respawns: 0,
                kos: 0,
                damageDealt: 0,
                damageTaken: 0
            };
        }
    }

    function cleanup(now = Date.now()) {
        let changed = false;
        const removedIds = [];

        for (const [id, record] of Object.entries(arenaHallOfFame)) {
            if (!isCompetitivePlayerId(id) || now - record.lastActive > arenaConfig.hallOfFameWindowMs) {
                delete arenaHallOfFame[id];
                changed = true;
            }
        }
        if (changed) saveHOF();

        for (const [id, player] of Object.entries(arenaPlayers)) {
            const idleFor = now - player.lastActive;
            const removeAfter = arenaHallOfFame[id] ? arenaConfig.removeChampionAfterMs : arenaConfig.removeInactiveAfterMs;

            if (player.state !== PLAYER_STATE.ELIMINATED && idleFor >= arenaConfig.idleVisualAfterMs) {
                player.state = PLAYER_STATE.IDLE;
                player.idleSince = player.idleSince || now;
            }

            if (idleFor >= removeAfter) {
                player.state = PLAYER_STATE.REMOVED;
                removedIds.push(id);
                delete arenaPlayers[id];
                changed = true;
            }
        }

        return {
            changed,
            removedIds
        };
    }

    function setLastWinnerId(id) {
        lastArenaWinnerId = id;
    }

    loadHOF();

    return {
        PLAYER_STATE,
        getPlayers,
        getHOF: () => arenaHallOfFame,
        getHallOfFameList,
        getLastWinnerId: () => lastArenaWinnerId,
        setLastWinnerId,
        ensurePlayer,
        applyGiftCombat,
        applyLikeSupport,
        applyChatActivity,
        pickTarget,
        syncPosition,
        updateHOF,
        getCurrentRanking,
        getRoundWinner,
        markRoundWinner,
        resetRound,
        cleanup
    };
}

module.exports = {
    createArenaManager,
    PLAYER_STATE
};
