const fs = require("fs");
const path = require("path");
const { GAME_CONFIG } = require("./game-config");
const { DEFAULT_COUNTRIES, getFlagImageUrl } = require("./constants");

const PLAYER_STATE = {
    NEW: "NEW",
    ACTIVE: "ACTIVE",
    IDLE: "IDLE",
    ELIMINATED: "ELIMINATED",
    REMOVED: "REMOVED"
};

function createTeamArenaManager() {
    let arenaPlayers = {};
    let arenaHallOfFame = {};
    let lastArenaWinnerId = null;
    let countryVictories = {};

    const HOF_FILE = path.join(__dirname, "..", "team_arena_hof.json");
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

    function normalizeCountryCode(code) {
        const normalized = String(code || "").trim().toUpperCase();
        if (!normalized || normalized === "GLOBAL") return null;
        return DEFAULT_COUNTRIES[normalized] ? normalized : null;
    }

    function getCountryMeta(code) {
        const normalized = normalizeCountryCode(code);
        if (!normalized) {
            return {
                code: null,
                name: "",
                flag: "",
                flagUrl: ""
            };
        }
        return {
            code: normalized,
            name: DEFAULT_COUNTRIES[normalized]?.name || "",
            flag: DEFAULT_COUNTRIES[normalized]?.flag || "",
            flagUrl: getFlagImageUrl(normalized)
        };
    }

    function derivePrestige(record) {
        const wins = record.victories || 0;
        const bestScore = record.bestScore || 0;
        const recentGifts = record.totalGiftDiamonds || 0;
        return Math.round((wins * 5000) + (bestScore * 0.35) + (recentGifts * 0.08));
    }

    function sanitizePlayerForClient(player) {
        const deaths = player.roundStats?.deaths || 0;
        const standingScore = computeRoundStandingScore(player);
        const country = getCountryMeta(player.countryCode);
        return {
            id: player.id,
            name: player.name,
            avatar: player.avatar,
            score: player.score,
            standingScore,
            deaths,
            hp: player.hp,
            x: player.x,
            y: player.y,
            state: player.state,
            lastActive: player.lastActive,
            victories: player.victories || 0,
            bestScore: player.bestScore || 0,
            comboCount: player.comboCount || 0,
            sawActiveUntil: Math.max(player.sawActiveUntil || 0, getPassiveSawTier(player.score || 0) > 0 ? (Date.now() + 1000) : 0),
            eliminatedUntil: player.eliminatedUntil || 0,
            invulnerableUntil: player.invulnerableUntil || 0,
            totalGiftDiamonds: player.totalGiftDiamonds || 0,
            totalLikes: player.totalLikes || 0,
            countryCode: country.code,
            countryName: country.name,
            countryFlag: country.flag,
            flag: country.flag,
            flagUrl: country.flagUrl
        };
    }

    function createArenaPlayer(userData, previousRecord = null, countryCode = null) {
        const id = userData.uniqueId || userData.userId || userData.id;
        const now = Date.now();
        const spawn = getArenaSpawn();
        const country = getCountryMeta(countryCode || previousRecord?.countryCode);
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
            victories: 0,
            bestScore: 0,
            prestige: 0,
            totalGiftDiamonds: previousRecord?.totalGiftDiamonds || 0,
            totalLikes: previousRecord?.totalLikes || 0,
            comboCount: 0,
            lastGiftTime: 0,
            likeComboCount: 0,
            lastLikeAt: 0,
            sawActiveUntil: 0,
            countryCode: country.code,
            countryName: country.name,
            countryFlag: country.flag,
            flagUrl: country.flagUrl,
            roundStats: {
                gifts: 0,
                likes: 0,
                respawns: 0,
                deaths: 0,
                kos: 0,
                damageDealt: 0,
                damageTaken: 0
            }
        };
    }

    function computeRoundStandingScore(player) {
        const deaths = player.roundStats?.deaths || 0;
        const rawStandingScore = Math.round(
            (player.score || 0) + ((player.hp || 0) * arenaConfig.roundHpWeight) - (deaths * arenaConfig.roundDeathPenalty)
        );
        const aliveSurvivalFloor = player.hp > 0 && player.state !== PLAYER_STATE.ELIMINATED
            ? Math.max(1, Math.round((player.hp || 0) * arenaConfig.aliveStandingFloorRatio))
            : 0;
        return Math.max(0, rawStandingScore, aliveSurvivalFloor);
    }

    function estimateRadiusFromScore(score = 0) {
        const safeScore = Math.max(score || 0, 0);
        const scoreScale = Math.min(
            (Math.sqrt(safeScore) * 1.45) + (Math.log2(safeScore + 1) * 3.5),
            118
        );
        return 50 + scoreScale;
    }

    function getPassiveSawTier(score = 0) {
        if (score >= arenaConfig.passiveSawLargeScore) return 3;
        if (score >= arenaConfig.passiveSawMediumScore) return 2;
        if (score >= arenaConfig.passiveSawSmallScore) return 1;
        return 0;
    }

    function ensurePlayer(userData, source = "system", options = {}) {
        const id = userData?.uniqueId || userData?.userId || userData?.id;
        if (!id) return null;
        const now = Date.now();
        const previousRecord = arenaHallOfFame[id] || null;
        const staleHistory = previousRecord && (now - (previousRecord.lastActive || 0) > arenaConfig.hallOfFameWindowMs);
        const requestedCountry = normalizeCountryCode(options.countryCode || previousRecord?.countryCode);

        if (staleHistory) {
            delete arenaHallOfFame[id];
            saveHOF();
        }

        if (!arenaPlayers[id]) {
            arenaPlayers[id] = createArenaPlayer(userData, staleHistory ? null : previousRecord, requestedCountry);
        }

        const player = arenaPlayers[id];
        if (now - (player.lastActive || 0) > arenaConfig.hallOfFameWindowMs) {
            player.score = 0;
            player.hp = arenaConfig.maxHp;
            player.victories = 0;
            player.bestScore = 0;
            player.comboCount = 0;
            player.likeComboCount = 0;
            player.sawActiveUntil = 0;
            player.roundStats = {
                gifts: 0,
                likes: 0,
                respawns: 0,
                deaths: 0,
                kos: 0,
                damageDealt: 0,
                damageTaken: 0
            };
        }
        player.name = userData.nickname || player.name;
        if (userData.profilePictureUrl) {
            player.avatar = userData.profilePictureUrl;
        }
        player.countryCode = requestedCountry;
        player.countryName = getCountryMeta(requestedCountry).name;
        player.countryFlag = getCountryMeta(requestedCountry).flag;
        player.flagUrl = getCountryMeta(requestedCountry).flagUrl;
        touchPlayer(player, source);
        return player;
    }

    function setPlayerCountry(playerId, countryCode) {
        const player = arenaPlayers[playerId];
        if (!player) return null;
        const country = getCountryMeta(countryCode);
        player.countryCode = country.code;
        player.countryName = country.name;
        player.countryFlag = country.flag;
        player.flagUrl = country.flagUrl;
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
            countryCode: player.countryCode || null,
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

    function buildCountryStates() {
        const grouped = {};

        for (const player of Object.values(arenaPlayers)) {
            if (!isCompetitivePlayerId(player.id)) continue;
            if (player.state === PLAYER_STATE.REMOVED) continue;

            const country = getCountryMeta(player.countryCode);
            if (!country.code) continue;
            if (!grouped[country.code]) {
                grouped[country.code] = {
                    id: country.code,
                    name: country.name,
                    avatar: player.avatar || "",
                    flag: country.flag,
                    flagUrl: country.flagUrl,
                    countryCode: country.code,
                    countryName: country.name,
                    countryFlag: country.flag,
                    score: 0,
                    standingScore: 0,
                    deaths: 0,
                    hp: 0,
                    x: 0,
                    y: 0,
                    state: PLAYER_STATE.IDLE,
                    lastActive: 0,
                    victories: countryVictories[country.code] || 0,
                    bestScore: 0,
                    totalGiftDiamonds: 0,
                    totalLikes: 0,
                    activeCount: 0,
                    memberCount: 0,
                    memberAvatars: [],
                    members: []
                };
            }

            const entry = grouped[country.code];
            entry.score += player.score || 0;
            entry.standingScore += computeRoundStandingScore(player);
            entry.deaths += player.roundStats?.deaths || 0;
            entry.hp += player.hp || 0;
            entry.x += player.x || 0;
            entry.y += player.y || 0;
            entry.lastActive = Math.max(entry.lastActive || 0, player.lastActive || 0);
            entry.bestScore = Math.max(entry.bestScore || 0, player.bestScore || player.score || 0);
            entry.totalGiftDiamonds += player.totalGiftDiamonds || 0;
            entry.totalLikes += player.totalLikes || 0;
            entry.memberCount += 1;
            entry.members.push({
                id: player.id,
                avatar: player.avatar || "",
                name: player.name || player.id,
                state: player.state
            });

            if (player.avatar && entry.memberAvatars.length < 4 && !entry.memberAvatars.includes(player.avatar)) {
                entry.memberAvatars.push(player.avatar);
            }

            if (player.state !== PLAYER_STATE.IDLE && player.state !== PLAYER_STATE.ELIMINATED) {
                entry.activeCount += 1;
            }

            if (player.state === PLAYER_STATE.ACTIVE || player.state === PLAYER_STATE.NEW) {
                entry.state = PLAYER_STATE.ACTIVE;
            } else if (entry.state !== PLAYER_STATE.ACTIVE && player.state === PLAYER_STATE.ELIMINATED) {
                entry.state = PLAYER_STATE.ELIMINATED;
            }
        }

        for (const entry of Object.values(grouped)) {
            const divisor = Math.max(1, entry.memberCount);
            entry.hp = Math.round(entry.hp / divisor);
            entry.x = Math.round(entry.x / divisor);
            entry.y = Math.round(entry.y / divisor);
            if (!entry.avatar && entry.memberAvatars[0]) {
                entry.avatar = entry.memberAvatars[0];
            }
        }

        return grouped;
    }

    function getCountryState(countryCode) {
        const states = buildCountryStates();
        return states[normalizeCountryCode(countryCode)] || null;
    }

    function getPlayers() {
        return buildCountryStates();
    }

    function getCurrentRanking(limit = 10) {
        return Object.values(buildCountryStates())
            .filter((country) => country.state !== PLAYER_STATE.REMOVED)
            .filter((country) => country.activeCount > 0)
            .sort((a, b) =>
                (b.standingScore - a.standingScore) ||
                (b.score - a.score) ||
                ((a.deaths || 0) - (b.deaths || 0)) ||
                ((b.activeCount || 0) - (a.activeCount || 0)) ||
                String(a.name).localeCompare(String(b.name))
            )
            .slice(0, limit)
            .map((country) => ({
                id: country.id,
                name: country.name,
                avatar: country.avatar,
                flag: country.flag,
                countryCode: country.countryCode,
                countryFlag: country.countryFlag,
                flagUrl: country.flagUrl,
                hp: country.hp,
                score: country.score,
                standingScore: country.standingScore,
                deaths: country.deaths,
                state: country.state,
                victories: country.victories || 0,
                activeCount: country.activeCount || 0,
                memberCount: country.memberCount || 0,
                memberAvatars: country.memberAvatars || []
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

    function getTopArenaLeader() {
        const leader = Object.values(buildCountryStates())
            .filter((country) => country?.id)
            .filter((country) => country.state !== PLAYER_STATE.REMOVED)
            .filter((country) => country.activeCount > 0)
            .filter((country) => (Date.now() - (country.lastActive || 0)) <= arenaConfig.idleVisualAfterMs)
            .filter((country) => (countryVictories[country.id] || 0) > 0)
            .sort((a, b) =>
                ((countryVictories[b.id] || 0) - (countryVictories[a.id] || 0)) ||
                ((b.score || 0) - (a.score || 0)) ||
                ((b.bestScore || 0) - (a.bestScore || 0))
            )[0] || null;
        return leader ? { ...leader, victories: countryVictories[leader.id] || 0 } : null;
    }

    function pickTarget(attackerId) {
        const attacker = arenaPlayers[attackerId];
        if (!attacker) return null;

        let bestTarget = null;
        let bestDistance = Infinity;

        for (const player of Object.values(arenaPlayers)) {
            if (player.id === attackerId) continue;
            if (player.state === PLAYER_STATE.ELIMINATED || player.state === PLAYER_STATE.REMOVED || player.state === PLAYER_STATE.IDLE) continue;
            if (player.hp <= 0) continue;
            if (normalizeCountryCode(player.countryCode) === normalizeCountryCode(attacker.countryCode)) continue;

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
            if (normalizeCountryCode(player.countryCode) === normalizeCountryCode(attacker.countryCode)) continue;
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

    function applyDamageConsequences(attacker, target, damage, now = Date.now()) {
        let scoreLoss = 0;
        let ko = false;

        if (now >= (target.invulnerableUntil || 0)) {
            target.hp = Math.max(0, target.hp - damage);
            target.roundStats.damageTaken += damage;
            attacker.roundStats.damageDealt += damage;

            scoreLoss = Math.max(
                arenaConfig.minimumDamageScoreLoss,
                Math.round(damage * arenaConfig.damageScoreLossRatio)
            );
            target.score = Math.max(0, target.score - scoreLoss);

            if (target.hp <= 0) {
                target.hp = 0;
                target.state = PLAYER_STATE.ELIMINATED;
                target.eliminatedUntil = now + arenaConfig.respawnCooldownMs;
                target.invulnerableUntil = 0;
                target.roundStats.deaths = (target.roundStats.deaths || 0) + 1;
                attacker.roundStats.kos += 1;
                ko = true;

                const koLossApplied = Math.min(arenaConfig.koScoreLossBonus, target.score);
                target.score -= koLossApplied;
                scoreLoss += koLossApplied;
            }
        }

        return {
            damage,
            scoreLoss,
            ko
        };
    }

    function applyGiftCombat(attackerId, targetId, resolution, isSuddenDeath = false) {
        const now = Date.now();
        const attacker = arenaPlayers[attackerId];
        const target = arenaPlayers[targetId];
        if (!attacker || !target) return null;

        const comboMultiplier = computeComboMultiplier(attacker, now);
        const scoreMultiplier = isSuddenDeath ? arenaConfig.suddenDeathScoreMultiplier : 1;
        const damageMultiplier = isSuddenDeath ? arenaConfig.suddenDeathDamageMultiplier : 1;
        const scoreGain = Math.max(1, Math.round(resolution.totalDiamonds * resolution.scoreScale * comboMultiplier * scoreMultiplier));
        const damage = Math.max(8, Math.round(resolution.totalDiamonds * resolution.damageScale * comboMultiplier * damageMultiplier));

        attacker.score += scoreGain;
        attacker.bestScore = Math.max(attacker.bestScore || 0, attacker.score);
        attacker.totalGiftDiamonds += resolution.totalDiamonds;
        attacker.roundStats.gifts += 1;
        attacker.sawActiveUntil = resolution.category === "mega" || resolution.totalDiamonds >= 500 ? now + 15000 : attacker.sawActiveUntil;

        const outcome = applyDamageConsequences(attacker, target, damage, now);

        touchPlayer(attacker, "gift");
        touchPlayer(target, "gift-target");
        updateHOF(attacker);

        return {
            attacker: sanitizePlayerForClient(attacker),
            target: sanitizePlayerForClient(target),
            scoreGain,
            damage: outcome.damage,
            scoreLoss: outcome.scoreLoss,
            comboMultiplier,
            ko: outcome.ko
        };
    }

    function applyLikeSupport(playerId, likeCount) {
        const player = arenaPlayers[playerId];
        if (!player) return null;
        const now = Date.now();
        touchPlayer(player, "like");

        if (now - (player.lastLikeAt || 0) <= arenaConfig.likeComboWindowMs) {
            player.likeComboCount = (player.likeComboCount || 0) + likeCount;
        } else {
            player.likeComboCount = likeCount;
        }
        player.lastLikeAt = now;

        const heal = likeCount * arenaConfig.likeHealPerTap;
        const scoreGain = Math.max(1, Math.floor(likeCount * (arenaConfig.likeScorePerTap || 1)));
        player.score += scoreGain;
        player.bestScore = Math.max(player.bestScore || 0, player.score);
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

        updateHOF(player);

        return {
            player: sanitizePlayerForClient(player),
            heal,
            scoreGain,
            likeCombo: player.likeComboCount,
            respawned
        };
    }

    function applyLikeStrike(playerId, comboLikes, isSuddenDeath = false) {
        const attacker = arenaPlayers[playerId];
        if (!attacker || comboLikes < arenaConfig.likeStrikeThreshold) return null;

        let target = null;
        let bestDistance = Infinity;
        for (const player of Object.values(arenaPlayers)) {
            if (player.id === playerId) continue;
            if (player.state === PLAYER_STATE.ELIMINATED || player.state === PLAYER_STATE.REMOVED || player.state === PLAYER_STATE.IDLE) continue;
            if (player.hp <= 0) continue;
            if (normalizeCountryCode(player.countryCode) === normalizeCountryCode(attacker.countryCode)) continue;

            const dx = attacker.x - player.x;
            const dy = attacker.y - player.y;
            const distance = Math.sqrt((dx * dx) + (dy * dy));
            if (distance < bestDistance) {
                bestDistance = distance;
                target = player;
            }
        }

        if (!target) return null;

        const baseDamage = Math.min(
            arenaConfig.likeStrikeMaxDamage,
            Math.max(8, comboLikes * arenaConfig.likeStrikeDamagePerTap)
        );
        const damage = Math.round(baseDamage * (isSuddenDeath ? arenaConfig.suddenDeathLikeStrikeMultiplier : 1));

        const now = Date.now();
        const outcome = applyDamageConsequences(attacker, target, damage, now);

        touchPlayer(attacker, "like");
        touchPlayer(target, "like-target");
        updateHOF(attacker);

        return {
            attacker: sanitizePlayerForClient(attacker),
            target: sanitizePlayerForClient(target),
            damage: outcome.damage,
            scoreLoss: outcome.scoreLoss,
            ko: outcome.ko
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

    function applyChatPower(playerId) {
        const player = arenaPlayers[playerId];
        if (!player) return null;

        touchPlayer(player, "chat-power");
        player.score += arenaConfig.chatPowerScoreBoost;
        player.bestScore = Math.max(player.bestScore || 0, player.score);
        if (player.state !== PLAYER_STATE.ELIMINATED) {
            player.hp = Math.min(arenaConfig.maxHp, player.hp + arenaConfig.chatPowerHeal);
        }
        updateHOF(player);

        return {
            player: sanitizePlayerForClient(player),
            heal: arenaConfig.chatPowerHeal,
            scoreGain: arenaConfig.chatPowerScoreBoost,
            duration: arenaConfig.chatPowerDurationFrames
        };
    }

    function applySawAuraHits(isSuddenDeath = false, now = Date.now()) {
        const hits = [];
        const attackers = Object.values(arenaPlayers).filter((player) =>
            player?.id &&
            player.state !== PLAYER_STATE.REMOVED &&
            player.state !== PLAYER_STATE.IDLE &&
            player.hp > 0 &&
            (((player.sawActiveUntil || 0) > now) || getPassiveSawTier(player.score || 0) > 0)
        );

        for (const attacker of attackers) {
            let closestTarget = null;
            let closestDistance = Infinity;
            const attackerRadius = estimateRadiusFromScore(attacker.score || 0);
            const passiveTier = getPassiveSawTier(attacker.score || 0);
            const auraRadius = attackerRadius + arenaConfig.sawAuraBonusRadius + (passiveTier * 10);

            for (const target of Object.values(arenaPlayers)) {
                if (target.id === attacker.id) continue;
                if (target.state === PLAYER_STATE.ELIMINATED || target.state === PLAYER_STATE.REMOVED || target.state === PLAYER_STATE.IDLE) continue;
                if (target.hp <= 0) continue;
                if (normalizeCountryCode(target.countryCode) === normalizeCountryCode(attacker.countryCode)) continue;

                const dx = (attacker.x || 0) - (target.x || 0);
                const dy = (attacker.y || 0) - (target.y || 0);
                const distance = Math.sqrt((dx * dx) + (dy * dy));
                const targetRadius = estimateRadiusFromScore(target.score || 0);

                if (distance <= auraRadius + targetRadius && distance < closestDistance) {
                    closestTarget = target;
                    closestDistance = distance;
                }
            }

            if (!closestTarget) continue;

            const damageBase = arenaConfig.sawDamagePerTick + (passiveTier * 4);
            const damage = Math.round(damageBase * (isSuddenDeath ? arenaConfig.suddenDeathDamageMultiplier : 1));
            const outcome = applyDamageConsequences(attacker, closestTarget, damage, now);
            touchPlayer(attacker, "saw");
            touchPlayer(closestTarget, "saw-target");
            updateHOF(attacker);

            hits.push({
                attacker: sanitizePlayerForClient(attacker),
                target: sanitizePlayerForClient(closestTarget),
                damage: outcome.damage,
                scoreLoss: outcome.scoreLoss,
                ko: outcome.ko
            });
        }

        return hits;
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
        const country = getCountryState(playerId);
        if (!country) return null;
        countryVictories[country.id] = (countryVictories[country.id] || 0) + 1;
        lastArenaWinnerId = country.id;
        return {
            ...country,
            victories: countryVictories[country.id]
        };
    }

    function resetRound() {
        const now = Date.now();
        for (const [id, player] of Object.entries(arenaPlayers)) {
            const idleFor = now - (player.lastActive || 0);
            if (idleFor >= arenaConfig.idleVisualAfterMs) {
                delete arenaPlayers[id];
                continue;
            }
            player.score = 0;
            player.hp = arenaConfig.maxHp;
            player.comboCount = 0;
            player.state = PLAYER_STATE.ACTIVE;
            player.idleSince = 0;
            player.eliminatedUntil = 0;
            player.invulnerableUntil = 0;
            player.sawActiveUntil = 0;
            player.roundStats = {
                gifts: 0,
                likes: 0,
                respawns: 0,
                deaths: 0,
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
            const removeAfter = arenaConfig.removeInactiveAfterMs;

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

    function seedChampionStandings(entries = []) {
        countryVictories = {};
        for (const entry of entries || []) {
            const code = normalizeCountryCode(entry?.id || entry?.countryCode || entry?.code);
            if (!code) continue;
            countryVictories[code] = Math.max(countryVictories[code] || 0, Math.max(0, Number(entry?.victories) || 0));
        }
    }

    loadHOF();

    return {
        PLAYER_STATE,
        getPlayers,
        getHOF: () => arenaHallOfFame,
        getHallOfFameList,
        getTopArenaLeader,
        getLastWinnerId: () => lastArenaWinnerId,
        setLastWinnerId,
        seedChampionStandings,
        setPlayerCountry,
        getCountryState,
        ensurePlayer,
        applyGiftCombat,
        applyLikeSupport,
        applyLikeStrike,
        applyChatActivity,
        applyChatPower,
        applySawAuraHits,
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
    createTeamArenaManager,
    createArenaManager: createTeamArenaManager,
    PLAYER_STATE
};
