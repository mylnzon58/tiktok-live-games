const fs = require("fs");
const path = require("path");
const { GAME_CONFIG } = require("./game-config");

const RACE_STATE = {
    NEW: "NEW",
    ACTIVE: "ACTIVE",
    IDLE: "IDLE",
    FINISHED: "FINISHED",
    REMOVED: "REMOVED"
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function createCarreraManager() {
    const raceConfig = GAME_CONFIG.carrera;
    const HOF_FILE = path.join(__dirname, "..", "carrera_hof.json");

    let players = {};
    let hallOfFame = {};
    let lastWinnerId = null;
    let lastTickAt = Date.now();
    let roundStartedAt = Date.now();

    function isCompetitivePlayerId(id) {
        if (!id) return false;
        return !id.startsWith("bot_") &&
            !id.startsWith("debug_") &&
            !id.startsWith("stress_") &&
            id !== "debug_user";
    }

    function saveHOF() {
        try {
            fs.writeFileSync(HOF_FILE, JSON.stringify(hallOfFame));
        } catch (error) {
            console.error("❌ Error saving race HOF:", error.message);
        }
    }

    function loadHOF() {
        if (!fs.existsSync(HOF_FILE)) return;
        try {
            hallOfFame = JSON.parse(fs.readFileSync(HOF_FILE, "utf8"));
            for (const id of Object.keys(hallOfFame)) {
                if (!isCompetitivePlayerId(id)) {
                    delete hallOfFame[id];
                }
            }
        } catch (error) {
            console.error("❌ Error loading race HOF:", error.message);
            hallOfFame = {};
        }
    }

    function derivePrestige(record) {
        return Math.round(
            ((record.victories || 0) * 3200) +
            ((record.bestProgress || 0) * 2.2) +
            ((record.totalGiftDiamonds || 0) * 0.45) +
            ((record.totalLikes || 0) * 4)
        );
    }

    function normalizeLane(value) {
        const lane = Number(value) || 1;
        return clamp(Math.round(lane), 1, raceConfig.laneCount);
    }

    function chooseLane(id) {
        const used = new Set(
            Object.values(players)
                .filter((player) => player?.id !== id)
                .filter((player) => player.state !== RACE_STATE.REMOVED)
                .map((player) => normalizeLane(player.lane))
        );

        for (let lane = 1; lane <= raceConfig.laneCount; lane += 1) {
            if (!used.has(lane)) return lane;
        }

        return ((Object.keys(players).length % raceConfig.laneCount) + 1);
    }

    function sanitizePlayerForClient(player) {
        return {
            id: player.id,
            name: player.name,
            avatar: player.avatar,
            lane: normalizeLane(player.lane),
            state: player.state,
            progress: Math.max(0, Math.round(player.progress || 0)),
            progressPct: clamp(((player.progress || 0) / raceConfig.trackLength) * 100, 0, 100),
            momentum: Number((player.momentum || 0).toFixed(2)),
            shieldUntil: player.shieldUntil || 0,
            turboUntil: player.turboUntil || 0,
            stunnedUntil: player.stunnedUntil || 0,
            burnUntil: player.burnUntil || 0,
            boostGlowUntil: player.boostGlowUntil || 0,
            lastEffectKey: player.lastEffectKey || "",
            lastEffectLabel: player.lastEffectLabel || "",
            totalGiftDiamonds: player.totalGiftDiamonds || 0,
            totalLikes: player.totalLikes || 0,
            gifts: player.roundStats?.gifts || 0,
            likes: player.roundStats?.likes || 0,
            victories: player.victories || 0,
            bestProgress: player.bestProgress || 0,
            finishedAt: player.finishedAt || 0,
            finishMs: player.finishMs || 0,
            lastActive: player.lastActive || 0
        };
    }

    function createPlayer(userData, previousRecord = null) {
        const id = userData.uniqueId || userData.userId || userData.id;
        const now = Date.now();
        return {
            id,
            name: userData.nickname || previousRecord?.name || id,
            avatar: userData.profilePictureUrl || previousRecord?.avatar || "",
            lane: chooseLane(id),
            state: RACE_STATE.NEW,
            progress: 0,
            momentum: 0,
            shieldUntil: 0,
            turboUntil: 0,
            stunnedUntil: 0,
            burnUntil: 0,
            boostGlowUntil: 0,
            lastEffectKey: "",
            lastEffectLabel: "",
            lastGiftTime: 0,
            lastLikeAt: 0,
            likeComboCount: 0,
            totalGiftDiamonds: previousRecord?.totalGiftDiamonds || 0,
            totalLikes: previousRecord?.totalLikes || 0,
            victories: previousRecord?.victories || 0,
            bestProgress: previousRecord?.bestProgress || 0,
            finishedAt: 0,
            finishMs: 0,
            lastActive: now,
            roundStats: {
                gifts: 0,
                likes: 0
            }
        };
    }

    function touchPlayer(player, source = "interaction") {
        const now = Date.now();
        player.lastActive = now;
        if (player.state !== RACE_STATE.FINISHED) {
            player.state = source === "idle" ? RACE_STATE.IDLE : RACE_STATE.ACTIVE;
        }
    }

    function updateHOF(player) {
        if (!player || !player.id || !isCompetitivePlayerId(player.id)) return;

        const previous = hallOfFame[player.id] || {};
        const merged = {
            id: player.id,
            name: player.name,
            avatar: player.avatar,
            victories: Math.max(previous.victories || 0, player.victories || 0),
            bestProgress: Math.max(previous.bestProgress || 0, player.bestProgress || 0, player.progress || 0),
            bestFinishMs: previous.bestFinishMs || 0,
            totalGiftDiamonds: Math.max(previous.totalGiftDiamonds || 0, player.totalGiftDiamonds || 0),
            totalLikes: Math.max(previous.totalLikes || 0, player.totalLikes || 0),
            lastActive: Date.now()
        };

        if (player.finishMs > 0) {
            merged.bestFinishMs = merged.bestFinishMs > 0
                ? Math.min(merged.bestFinishMs, player.finishMs)
                : player.finishMs;
        }

        merged.prestige = derivePrestige(merged);
        hallOfFame[player.id] = merged;
        saveHOF();
    }

    function ensurePlayer(userData, source = "system") {
        const id = userData?.uniqueId || userData?.userId || userData?.id;
        if (!id) return null;

        const now = Date.now();
        const previousRecord = hallOfFame[id] || null;
        const staleHistory = previousRecord && (now - (previousRecord.lastActive || 0) > raceConfig.hallOfFameWindowMs);

        if (staleHistory) {
            delete hallOfFame[id];
            saveHOF();
        }

        if (!players[id]) {
            players[id] = createPlayer(userData, staleHistory ? null : previousRecord);
        }

        const player = players[id];
        player.name = userData.nickname || player.name;
        if (userData.profilePictureUrl) {
            player.avatar = userData.profilePictureUrl;
        }
        if (!player.lane || player.lane > raceConfig.laneCount) {
            player.lane = chooseLane(id);
        }

        touchPlayer(player, source);
        return player;
    }

    function getPlayers() {
        return Object.fromEntries(
            Object.entries(players).map(([id, player]) => [id, sanitizePlayerForClient(player)])
        );
    }

    function getCurrentRanking(limit = 10) {
        return Object.values(players)
            .filter((player) => isCompetitivePlayerId(player.id))
            .filter((player) => player.state !== RACE_STATE.REMOVED)
            .filter((player) => player.state !== RACE_STATE.IDLE)
            .sort((a, b) =>
                (b.progress - a.progress) ||
                ((a.finishedAt || Infinity) - (b.finishedAt || Infinity)) ||
                (b.momentum - a.momentum) ||
                (b.totalGiftDiamonds - a.totalGiftDiamonds)
            )
            .slice(0, limit)
            .map((player) => ({
                id: player.id,
                name: player.name,
                avatar: player.avatar,
                lane: normalizeLane(player.lane),
                progress: Math.round(player.progress || 0),
                progressPct: clamp(((player.progress || 0) / raceConfig.trackLength) * 100, 0, 100),
                momentum: Number((player.momentum || 0).toFixed(2)),
                state: player.state,
                victories: player.victories || 0,
                totalGiftDiamonds: player.totalGiftDiamonds || 0,
                totalLikes: player.totalLikes || 0,
                finishedAt: player.finishedAt || 0,
                finishMs: player.finishMs || 0
            }));
    }

    function getHallOfFameList(limit = 10) {
        return Object.values(hallOfFame)
            .sort((a, b) =>
                (b.prestige - a.prestige) ||
                (b.victories - a.victories) ||
                ((b.bestProgress || 0) - (a.bestProgress || 0)) ||
                ((a.bestFinishMs || Infinity) - (b.bestFinishMs || Infinity))
            )
            .slice(0, limit);
    }

    function getRoundWinner() {
        return getCurrentRanking(1)[0] || null;
    }

    function getLeader() {
        return getRoundWinner();
    }

    function markRoundWinner(playerId) {
        const player = players[playerId];
        if (!player) return null;
        player.victories = (player.victories || 0) + 1;
        player.bestProgress = Math.max(player.bestProgress || 0, player.progress || 0);
        updateHOF(player);
        lastWinnerId = player.id;
        return sanitizePlayerForClient(player);
    }

    function buildPowerProfile(gift) {
        const categoryBase = {
            tap: { burst: 8, momentum: 4, hit: 0, stunMs: 0, burnMs: 0, shieldMs: 0, label: "Pulso" },
            projectile: { burst: 24, momentum: 8, hit: 12, stunMs: 450, burnMs: 0, shieldMs: 0, label: "Turbo misil" },
            shockwave: { burst: 54, momentum: 12, hit: 30, stunMs: 850, burnMs: 0, shieldMs: 0, label: "Onda de choque" },
            fire: { burst: 95, momentum: 18, hit: 48, stunMs: 900, burnMs: 3200, shieldMs: 0, label: "Zona de fuego" },
            lightning: { burst: 145, momentum: 24, hit: 92, stunMs: 1800, burnMs: 0, shieldMs: 900, label: "Rayo directo" },
            mega: { burst: 210, momentum: 30, hit: 150, stunMs: 2500, burnMs: 0, shieldMs: 2400, label: "Megaturbo" }
        };

        const base = categoryBase[gift.category] || categoryBase.tap;
        const strength = 1 + Math.log10((gift.totalDiamonds || 1) + 1);
        return {
            burst: Math.round(base.burst * strength),
            momentum: Math.round(base.momentum * strength * 10) / 10,
            hit: Math.round(base.hit * strength),
            stunMs: Math.round(base.stunMs * Math.min(strength, 3.2)),
            burnMs: Math.round(base.burnMs * Math.min(strength, 2.4)),
            shieldMs: Math.round(base.shieldMs * Math.min(strength, 2.2)),
            label: base.label
        };
    }

    function chooseTarget(attackerId) {
        const attacker = players[attackerId];
        if (!attacker) return null;

        const ranking = Object.values(players)
            .filter((player) => player.id !== attackerId)
            .filter((player) => player.state !== RACE_STATE.REMOVED)
            .sort((a, b) => (b.progress - a.progress) || ((a.finishedAt || Infinity) - (b.finishedAt || Infinity)));

        return ranking[0] || null;
    }

    function applyHit(target, amount, options = {}) {
        if (!target || !amount) {
            return {
                progressLoss: 0,
                shieldBlocked: false,
                stunnedUntil: target?.stunnedUntil || 0,
                burnUntil: target?.burnUntil || 0
            };
        }

        const now = Date.now();
        const shielded = now < (target.shieldUntil || 0);
        const appliedLoss = Math.max(0, Math.round(amount * (shielded ? raceConfig.shieldReductionRatio : 1)));
        target.progress = Math.max(0, target.progress - appliedLoss);
        if (options.stunMs && !shielded) {
            target.stunnedUntil = Math.max(target.stunnedUntil || 0, now + options.stunMs);
        }
        if (options.burnMs) {
            target.burnUntil = Math.max(target.burnUntil || 0, now + options.burnMs);
        }
        target.boostGlowUntil = now + 1200;
        return {
            progressLoss: appliedLoss,
            shieldBlocked: shielded,
            stunnedUntil: target.stunnedUntil || 0,
            burnUntil: target.burnUntil || 0
        };
    }

    function applyGiftPower(attackerId, gift) {
        const attacker = players[attackerId];
        if (!attacker) return null;

        const now = Date.now();
        const target = chooseTarget(attackerId);
        const profile = buildPowerProfile(gift);
        const directBurst = profile.burst;
        const momentumGain = profile.momentum;

        attacker.progress += directBurst;
        attacker.momentum = clamp(attacker.momentum + momentumGain, 0, raceConfig.maxMomentumPerSecond);
        attacker.shieldUntil = Math.max(attacker.shieldUntil || 0, profile.shieldMs ? (now + profile.shieldMs) : 0);
        attacker.turboUntil = Math.max(attacker.turboUntil || 0, now + (gift.category === "mega" ? 2500 : gift.category === "lightning" ? 1800 : 1200));
        attacker.boostGlowUntil = now + 1800;
        attacker.lastEffectKey = gift.fx || gift.category;
        attacker.lastEffectLabel = profile.label;
        attacker.totalGiftDiamonds += gift.totalDiamonds || 0;
        attacker.roundStats.gifts += 1;
        attacker.bestProgress = Math.max(attacker.bestProgress || 0, attacker.progress || 0);
        attacker.lastGiftTime = now;
        touchPlayer(attacker, "gift");

        const targets = [];
        if (target) {
            const hitResult = applyHit(target, profile.hit, {
                stunMs: profile.stunMs,
                burnMs: profile.burnMs
            });
            touchPlayer(target, "hit");
            targets.push({
                id: target.id,
                name: target.name,
                progressLoss: hitResult.progressLoss,
                shieldBlocked: hitResult.shieldBlocked,
                stunnedUntil: hitResult.stunnedUntil,
                burnUntil: hitResult.burnUntil
            });
        }

        if (gift.category === "fire" || gift.category === "shockwave") {
            const splashTargets = getCurrentRanking(3)
                .filter((entry) => entry.id !== attacker.id)
                .filter((entry) => !targets.find((item) => item.id === entry.id));

            splashTargets.forEach((entry) => {
                const splashTarget = players[entry.id];
                if (!splashTarget) return;
                const splash = applyHit(splashTarget, Math.round(profile.hit * 0.48), {
                    stunMs: Math.round(profile.stunMs * 0.45),
                    burnMs: gift.category === "fire" ? Math.round(profile.burnMs * 0.6) : 0
                });
                touchPlayer(splashTarget, "splash");
                targets.push({
                    id: splashTarget.id,
                    name: splashTarget.name,
                    progressLoss: splash.progressLoss,
                    shieldBlocked: splash.shieldBlocked,
                    stunnedUntil: splash.stunnedUntil,
                    burnUntil: splash.burnUntil
                });
            });
        }

        updateHOF(attacker);

        return {
            attacker: sanitizePlayerForClient(attacker),
            target: target ? sanitizePlayerForClient(target) : null,
            targets,
            progressGain: directBurst,
            momentumGain,
            shieldUntil: attacker.shieldUntil || 0,
            turboUntil: attacker.turboUntil || 0,
            powerLabel: profile.label
        };
    }

    function applyLikeBoost(playerId, likeCount) {
        const player = players[playerId];
        if (!player) return null;

        const now = Date.now();
        if (now - (player.lastLikeAt || 0) <= raceConfig.likeComboWindowMs) {
            player.likeComboCount = (player.likeComboCount || 0) + likeCount;
        } else {
            player.likeComboCount = likeCount;
        }
        player.lastLikeAt = now;

        const comboLikes = player.likeComboCount;
        const progressGain = Math.round(likeCount * raceConfig.likeBurstPerTap);
        const momentumGain = Math.round(likeCount * raceConfig.likeMomentumPerTap * 10) / 10;
        player.progress += progressGain;
        player.momentum = clamp(player.momentum + momentumGain, 0, raceConfig.maxMomentumPerSecond);
        player.totalLikes += likeCount;
        player.roundStats.likes += likeCount;
        player.bestProgress = Math.max(player.bestProgress || 0, player.progress || 0);
        player.boostGlowUntil = now + 1200;

        let shieldUntil = 0;
        let turboUntil = 0;
        if (comboLikes >= raceConfig.likeShieldThreshold) {
            player.shieldUntil = Math.max(player.shieldUntil || 0, now + raceConfig.likeShieldMs);
            shieldUntil = player.shieldUntil;
        }
        if (comboLikes >= raceConfig.likeTurboThreshold) {
            player.turboUntil = Math.max(player.turboUntil || 0, now + raceConfig.likeTurboMs);
            turboUntil = player.turboUntil;
        }

        touchPlayer(player, "like");
        updateHOF(player);

        return {
            player: sanitizePlayerForClient(player),
            progressGain,
            momentumGain,
            comboLikes,
            shieldUntil,
            turboUntil
        };
    }

    function applyChatBoost(playerId, comment = "") {
        const player = players[playerId];
        if (!player) return null;

        const now = Date.now();
        const upper = String(comment || "").toUpperCase();
        const requestedNitro = upper.includes(raceConfig.chatBoostKeyword);
        const progressGain = requestedNitro ? raceConfig.chatBurst : Math.round(raceConfig.chatBurst * 0.45);
        const momentumGain = requestedNitro ? raceConfig.chatMomentum : Math.round(raceConfig.chatMomentum * 0.45);

        player.progress += progressGain;
        player.momentum = clamp(player.momentum + momentumGain, 0, raceConfig.maxMomentumPerSecond);
        player.bestProgress = Math.max(player.bestProgress || 0, player.progress || 0);
        player.boostGlowUntil = now + 1000;

        let turboUntil = 0;
        if (requestedNitro) {
            player.turboUntil = Math.max(player.turboUntil || 0, now + raceConfig.chatTurboMs);
            turboUntil = player.turboUntil;
        }

        touchPlayer(player, "chat");
        updateHOF(player);

        return {
            player: sanitizePlayerForClient(player),
            progressGain,
            momentumGain,
            turboUntil,
            keyword: requestedNitro ? raceConfig.chatBoostKeyword : raceConfig.chatWakeKeyword
        };
    }

    function tick(now = Date.now()) {
        const deltaSeconds = clamp((now - lastTickAt) / 1000, 0.02, 0.25);
        lastTickAt = now;
        let changed = false;
        let finishedPlayer = null;

        Object.values(players).forEach((player) => {
            if (!player?.id) return;
            if (player.state === RACE_STATE.REMOVED || player.state === RACE_STATE.FINISHED) return;

            const idleFor = now - (player.lastActive || 0);
            if (idleFor >= raceConfig.idleVisualAfterMs) {
                player.state = RACE_STATE.IDLE;
                return;
            }

            const turboMultiplier = now < (player.turboUntil || 0) ? 1.7 : 1;
            const stunMultiplier = now < (player.stunnedUntil || 0) ? 0.22 : 1;
            const burnMultiplier = now < (player.burnUntil || 0) ? 0.78 : 1;
            const movement = (raceConfig.passiveSpeedPerSecond + (player.momentum || 0)) * turboMultiplier * stunMultiplier * burnMultiplier * deltaSeconds;

            if (movement > 0) {
                player.progress += movement;
                player.bestProgress = Math.max(player.bestProgress || 0, player.progress || 0);
                changed = true;
            }

            player.momentum = clamp(
                (player.momentum || 0) - (raceConfig.momentumDecayPerSecond * deltaSeconds),
                0,
                raceConfig.maxMomentumPerSecond
            );

            if (player.progress >= raceConfig.trackLength && !player.finishedAt) {
                player.progress = raceConfig.trackLength;
                player.finishedAt = now;
                player.finishMs = player.finishMs || Math.max(0, now - roundStartedAt);
                player.state = RACE_STATE.FINISHED;
                finishedPlayer = sanitizePlayerForClient(player);
                changed = true;
            }
        });

        return {
            changed,
            finishedPlayer
        };
    }

    function resetRound() {
        const now = Date.now();
        lastTickAt = now;
        roundStartedAt = now;

        for (const [id, player] of Object.entries(players)) {
            const idleFor = now - (player.lastActive || 0);
            if (idleFor >= raceConfig.idleVisualAfterMs) {
                delete players[id];
                continue;
            }

            player.progress = 0;
            player.momentum = 0;
            player.shieldUntil = 0;
            player.turboUntil = 0;
            player.stunnedUntil = 0;
            player.burnUntil = 0;
            player.boostGlowUntil = 0;
            player.lastEffectKey = "";
            player.lastEffectLabel = "";
            player.finishedAt = 0;
            player.finishMs = 0;
            player.likeComboCount = 0;
            player.state = RACE_STATE.ACTIVE;
            player.roundStats = {
                gifts: 0,
                likes: 0
            };
        }
    }

    function cleanup(now = Date.now()) {
        let changed = false;
        const removedIds = [];

        for (const [id, record] of Object.entries(hallOfFame)) {
            if (!isCompetitivePlayerId(id) || now - (record.lastActive || 0) > raceConfig.hallOfFameWindowMs) {
                delete hallOfFame[id];
                changed = true;
            }
        }
        if (changed) saveHOF();

        for (const [id, player] of Object.entries(players)) {
            const idleFor = now - (player.lastActive || 0);
            if (idleFor >= raceConfig.removeInactiveAfterMs) {
                player.state = RACE_STATE.REMOVED;
                delete players[id];
                removedIds.push(id);
                changed = true;
            }
        }

        return {
            changed,
            removedIds
        };
    }

    function setLastWinnerId(id) {
        lastWinnerId = id;
    }

    loadHOF();

    return {
        RACE_STATE,
        ensurePlayer,
        getPlayers,
        getCurrentRanking,
        getHallOfFameList,
        getRoundWinner,
        getLeader,
        getLastWinnerId: () => lastWinnerId,
        setLastWinnerId,
        markRoundWinner,
        applyGiftPower,
        applyLikeBoost,
        applyChatBoost,
        tick,
        resetRound,
        cleanup
    };
}

module.exports = {
    createCarreraManager,
    RACE_STATE
};
