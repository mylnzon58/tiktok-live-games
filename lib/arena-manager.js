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

    let hofDirty = false;
    let hofSaveTimer = null;
    const HOF_SAVE_INTERVAL_MS = 5000; // Guardar máximo cada 5 segundos

    function saveHOF() {
        hofDirty = true;
        if (hofSaveTimer) return; // Ya hay un timer pendiente
        hofSaveTimer = setTimeout(() => {
            hofSaveTimer = null;
            if (!hofDirty) return;
            hofDirty = false;
            try {
                fs.writeFile(HOF_FILE, JSON.stringify(arenaHallOfFame), (err) => {
                    if (err) console.error("❌ Error saving HOF:", err.message);
                });
            } catch (error) {
                console.error("❌ Error saving HOF:", error.message);
            }
        }, HOF_SAVE_INTERVAL_MS);
    }

    // Guardado inmediato para shutdown graceful
    function saveHOFSync() {
        try {
            fs.writeFileSync(HOF_FILE, JSON.stringify(arenaHallOfFame));
        } catch (error) {
            console.error("❌ Error saving HOF sync:", error.message);
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

    function getArenaBounds() {
        const width = 800 * 0.9;
        const height = 1350;
        const cx = 400;
        const cy = 675;
        return {
            left: cx - width / 2, // 400 - 360 = 40
            right: cx + width / 2, // 400 + 360 = 760
            top: 80,
            bottom: height - 85,
            panelEnd: 530,
            panelLeft: 645
        };
    }

    function clampPosition(x, y, radius = 38) {
        const b = getArenaBounds();
        let curRight = b.right - radius;
        // Si está en la zona del panel, el límite derecho es 645
        if (y < b.panelEnd) curRight = Math.min(curRight, b.panelLeft - radius);
        
        return {
            x: Math.max(b.left + radius, Math.min(curRight, x)),
            y: Math.max(b.top + radius, Math.min(b.bottom - radius, y))
        };
    }

    function getArenaSpawn() {
        const b = getArenaBounds();
        const r = (b.right - b.left) * 0.35;
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * r;
        return clampPosition(400 + Math.cos(a) * d, 675 + Math.sin(a) * d);
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
            likeComboCount: 0,
            lastLikeAt: 0,
            sawActiveUntil: 0,
            roundStats: {
                gifts: 0,
                likes: 0,
                respawns: 0,
                deaths: 0,
                kos: 0,
                damageDealt: 0,
                damageTaken: 0
            },
            resilienceUntil: now + (arenaConfig.initialResilienceDurationMs || 30000) // Gracia inicial configurable
        };
    }

    function computeRoundStandingScore(player) {
        return Math.max(0, Math.round(player.score || 0));
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

    function ensurePlayer(userData, source = "system") {
        const id = userData?.uniqueId || userData?.userId || userData?.id;
        if (!id) return null;
        const now = Date.now();
        const previousRecord = arenaHallOfFame[id] || null;
        const staleHistory = previousRecord && (now - (previousRecord.lastActive || 0) > arenaConfig.hallOfFameWindowMs);

        if (staleHistory) {
            delete arenaHallOfFame[id];
            saveHOF();
        }

        if (!arenaPlayers[id]) {
            arenaPlayers[id] = createArenaPlayer(userData, staleHistory ? null : previousRecord);
            arenaPlayers[id].isNewSession = true;
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
        player.hp = arenaConfig.maxHp; 
        player.invulnerableUntil = now + (arenaConfig.respawnShieldMs || 5000); 
        player.resilienceUntil = now + (arenaConfig.respawnResilienceMs || 15000); 
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
        // Enviar TODOS los jugadores no removidos para mantener la visibilidad completa
        const result = {};
        for (const [id, player] of Object.entries(arenaPlayers)) {
            if (player.state === PLAYER_STATE.REMOVED) continue;
            result[id] = sanitizePlayerForClient(player);
        }
        return result;
    }

    function getCurrentRanking(limit = 10) {
        return Object.values(arenaPlayers)
            .filter((player) => isCompetitivePlayerId(player.id))
            .filter((player) => player.state !== PLAYER_STATE.REMOVED)
            // Priorizar puntuación de la ronda (meritocracia real-time)
            .sort((a, b) =>
                (computeRoundStandingScore(b) - computeRoundStandingScore(a)) ||
                ((b.victories || 0) - (a.victories || 0)) ||
                ((a.roundStats?.deaths || 0) - (b.roundStats?.deaths || 0)) ||
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
                standingScore: computeRoundStandingScore(player),
                deaths: player.roundStats?.deaths || 0,
                state: player.state,
                victories: player.victories || 0,
                damage: player.roundStats?.damageDealt || 0,
                gifts: player.roundStats?.gifts || 0
            }));
    }

    function getHallOfFameList(limit = 10) {
        return Object.values(arenaHallOfFame)
            .sort((a, b) =>
                ((b.victories || 0) - (a.victories || 0)) ||
                ((b.prestige || 0) - (a.prestige || 0)) ||
                ((b.bestScore || 0) - (a.bestScore || 0))
            )
            .slice(0, limit);
    }

    function getTopArenaLeader() {
        return Object.values(arenaPlayers)
            .filter((player) => player?.id)
            .filter((player) => player.state !== PLAYER_STATE.REMOVED)
            // Lider histórico puede estar IDLE pero no REMOVED
            .filter((player) => (Date.now() - (player.lastActive || 0)) <= arenaConfig.hallOfFameWindowMs)
            .filter((player) => (player.victories || 0) > 0)
            .sort((a, b) =>
                ((b.victories || 0) - (a.victories || 0)) ||
                ((b.score || 0) - (a.score || 0)) ||
                ((b.bestScore || 0) - (a.bestScore || 0))
            )[0] || null;
    }

    function pickTarget(attackerId) {
        const attacker = arenaPlayers[attackerId];
        if (!attacker) return null;

        let bestTarget = null;
        let bestDistance = Infinity;

        // TARGET PREFERENCE (Neuromarketing)
        if (attacker.targetPreference) {
            const preferedName = attacker.targetPreference.toLowerCase();
            const preferredPlayer = Object.values(arenaPlayers).find(p => 
                p.id !== attackerId && 
                p.hp > 0 && 
                p.state !== PLAYER_STATE.ELIMINATED && 
                p.state !== PLAYER_STATE.REMOVED &&
                p.state !== PLAYER_STATE.IDLE &&
                p.name.toLowerCase().includes(preferedName)
            );
            if (preferredPlayer) {
                return { target: preferredPlayer, respawned: false };
            }
        }

        for (const player of Object.values(arenaPlayers)) {
            if (player.id === attackerId) continue;
            if (player.state === PLAYER_STATE.ELIMINATED || player.state === PLAYER_STATE.REMOVED || player.state === PLAYER_STATE.IDLE) continue;
            if (player.hp <= 0) continue;

            const dx = attacker.x - player.x;
            const dy = attacker.y - player.y;
            let distance = Math.sqrt((dx * dx) + (dy * dy));
            
            // SMART MATCHMAKING (Anti-Bullying Soft Restriction)
            const targetScore = player.score || 0;
            const attackerScore = attacker.score || 0;
            const isTargetUnderdog = targetScore < (arenaConfig.resilienceThresholdScore || 1500);
            const isMassiveBully = attackerScore > targetScore * (arenaConfig.bullySizeRatioThreshold || 5);
            
            // Penalización artificial en distancia para evitar focus excesivo a los nuevos
            if (isTargetUnderdog && isMassiveBully) {
                distance *= 3.0; 
            }

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

    function applyDamageConsequences(attacker, target, damage, now = Date.now(), isPaidGift = false, canKill = true) {
        let scoreLoss = 0;
        let ko = false;
        let finalDamage = damage;

        if (now >= (target.invulnerableUntil || 0)) {
            // SISTEMA DE RESILIENCIA (Anti-Bullying):
            // Si el jugador acaba de revivir (resilienceUntil) o es muy pequeño (< scoreThreshold), 
            // recibe daño reducido para que no lo borren de un golpe.
            const resilienceThreshold = arenaConfig.resilienceThresholdScore || 500;
            const damageRatio = arenaConfig.underdogDamageTakenRatio || 0.4;
            const isUnderdog = target.score < resilienceThreshold || now < (target.resilienceUntil || 0);

            if (isUnderdog) {
                finalDamage = Math.floor(finalDamage * damageRatio); // Daño reducido
                finalDamage = Math.min(finalDamage, arenaConfig.underdogMaxDamageCap || 250); // CAP MÁXIMO absoluto
            }

            // ESCUDO DE PRINCIPIANTE (Basado en Proporción): 
            const sizeRatio = attacker.score / Math.max(1, target.score);
            
            // Para ataques gratuitos (no regalos), si la diferencia de tamaño es abismal.
            if (!isPaidGift && sizeRatio > 3) {
                finalDamage = Math.max(5, Math.floor(finalDamage / Math.sqrt(sizeRatio)));
            }
            // Para ataques PAGOS de Bullying extremo
            else if (isPaidGift && sizeRatio >= (arenaConfig.bullySizeRatioThreshold || 5)) {
                // Suavizamos el daño que recibe el nuevo para que viva, pero el atacante aún causó un impacto "pesado" calculado.
                finalDamage = Math.max(10, Math.floor(finalDamage / Math.sqrt(sizeRatio)));
                finalDamage = Math.min(finalDamage, arenaConfig.underdogMaxDamageCap || 250); // Nunca lo borran de un golpe
            }
            
            // Daño mínimo asegurado para que no parezca inmune por completo (excepto si tiene escudo total)
            if (finalDamage < 1 && damage > 0) finalDamage = 1;

            target.hp = Math.max(0, target.hp - finalDamage);
            target.roundStats.damageTaken += finalDamage;
            attacker.roundStats.damageDealt += finalDamage;

            if (isUnderdog) {
                // EXTREME PROTECTION: Los novatos NO pierden puntos por daño pasivo/ataques. 
                // Esto es clave para que no queden en 0 puntos nunca mientras sean underdogs.
                scoreLoss = 0;
            } else {
                scoreLoss = Math.max(
                    arenaConfig.minimumDamageScoreLoss,
                    Math.round(finalDamage * arenaConfig.damageScoreLossRatio)
                );
            }
            target.score = Math.max(0, target.score - scoreLoss);


            if (target.hp <= 0) {
                if (!canKill) {
                    target.hp = 1; // Nunca muere por completo de factores pasivos
                } else {
                    target.hp = 0;
                    target.state = PLAYER_STATE.ELIMINATED;
                    target.eliminatedUntil = now + arenaConfig.respawnCooldownMs;
                    target.invulnerableUntil = 0;
                    target.roundStats.deaths = (target.roundStats.deaths || 0) + 1;
                    attacker.roundStats.kos += 1;
                    ko = true;

                    const scoreBeforeKoReset = target.score;
                    // Si es underdog, retiene casi todos sus puntos (90%) para no desmotivarse
                    const retainRatio = isUnderdog ? 0.90 : arenaConfig.koScoreRetainRatio; 
                    const retainedScore = Math.max(0, Math.floor(scoreBeforeKoReset * retainRatio));
                    
                    // Si es underdog, no le aplicamos el bonus de pérdida fijo
                    const penaltyBonus = isUnderdog ? 0 : arenaConfig.koScoreLossBonus;
                    
                    const koLossApplied = Math.max(
                        Math.min(penaltyBonus, scoreBeforeKoReset),
                        scoreBeforeKoReset - retainedScore
                    );
                    target.score = Math.max(0, scoreBeforeKoReset - koLossApplied);
                    scoreLoss += koLossApplied;
                }
            }
        }

        return {
            damage: finalDamage,
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
        
        let finalScoreScale = resolution.scoreScale;
        if (attacker.isNewSession && attacker.score < (arenaConfig.catchUpScoreThreshold || 250)) {
            finalScoreScale *= (arenaConfig.catchUpMultiplier || 1.8);
        }

        // Multiplicador masivo para que los regalos destrocen el crecimiento de los simples "taps"
        const GIFT_VALUE_BOOST = 80; // 1 sola Rosa dará ahora al menos 80 puntos base a comparación de los 3 de un tap
        
        // Critical Hits (Near-Miss Effect) (Neuromarketing)
        const isSmallGift = resolution.totalDiamonds < 500;
        const isCritical = isSmallGift && Math.random() < 0.05;
        const critMultiplier = isCritical ? 10 : 1;

        // David vs Goliath Mechanism (Neuromarketing)
        const isDavidVsGoliath = target.score > attacker.score * (arenaConfig.bullySizeRatioThreshold || 5) && attacker.score < (arenaConfig.resilienceThresholdScore || 1500) && resolution.totalDiamonds >= 1;
        let finalDamageMultiplier = damageMultiplier;
        if (isDavidVsGoliath) {
            finalDamageMultiplier *= (arenaConfig.davidVsGoliathMultiplier || 2.5);
            finalScoreScale *= (arenaConfig.davidVsGoliathScoreBonus || 2.0);
        }

        const scoreGain = Math.max(1, Math.round(resolution.totalDiamonds * GIFT_VALUE_BOOST * finalScoreScale * comboMultiplier * scoreMultiplier * critMultiplier));
        const damage = Math.max(8, Math.round(resolution.totalDiamonds * resolution.damageScale * comboMultiplier * finalDamageMultiplier * critMultiplier));

        attacker.score += scoreGain;
        if (attacker.score >= (arenaConfig.catchUpScoreThreshold || 250)) attacker.isNewSession = false;
        attacker.bestScore = Math.max(attacker.bestScore || 0, attacker.score);
        attacker.totalGiftDiamonds += resolution.totalDiamonds;
        // Cualquier donador obtiene sierra VIP asegurada por 30 segundos MÍNIMO. Grandes regalos = 60s.
        const premiumSawTime = resolution.totalDiamonds >= 500 || resolution.category === "mega" ? 60000 : 30000;
        attacker.sawActiveUntil = Math.max(attacker.sawActiveUntil || now, now + premiumSawTime);

        const outcome = applyDamageConsequences(attacker, target, damage, now, true); // true = isPaidGift

        // Fake Damage Dealt feedback for the attacker to maintain the "OP" feeling
        // Si pegaron a un novato (daño capeado), el servidor registra el daño ENORME en el rank para premiar su inversión
        if (damage > outcome.damage && !isTargetUnderdog(target, now)) {
             // Let the giant keep a portion of raw damage stats for ranking
             attacker.roundStats.damageDealt += Math.floor((damage - outcome.damage) * 0.4);
        }

        function isTargetUnderdog(t, tNow) {
            return t.score < (arenaConfig.resilienceThresholdScore || 1500) || tNow < (t.resilienceUntil || 0);
        }

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
            isCritical,
            isDavidVsGoliath,
            ko: outcome.ko
        };
    }

    function setPlayerTargetPreference(playerId, targetName) {
        const player = arenaPlayers[playerId];
        if (player) player.targetPreference = targetName;
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
        
        let scorePerTap = arenaConfig.likeScorePerTap || 1;
        // Bonificación de Catch-up: 5 puntos si es nuevo/respawned y tiene poca puntuación
        if (player.score < (arenaConfig.catchUpScoreThreshold || 250)) {
            scorePerTap = arenaConfig.beginnerLikeScorePerTap || 5;
        }
        
        const scoreGain = Math.max(1, Math.floor(likeCount * scorePerTap));
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
                if (target.state === PLAYER_STATE.ELIMINATED || target.state === PLAYER_STATE.REMOVED) continue;
                if (target.hp <= 0) continue;

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
            
            // Los daños pasivos de sierra NO PUEDEN matar al objetivo
            const outcome = applyDamageConsequences(attacker, closestTarget, damage, now, false, false);
            
            // ROBO DE PUNTOS (Vampire mode): El daño causado alimenta al atacante
            if (outcome.scoreLoss > 0) {
                // El atacante absorbe los puntos que el objetivo perdió
                attacker.score = (attacker.score || 0) + outcome.scoreLoss;
                attacker.bestScore = Math.max(attacker.bestScore || 0, attacker.score);
            }

            touchPlayer(attacker, "saw");
            touchPlayer(closestTarget, "saw-target");
            updateHOF(attacker);

            // Detectar CLASH (Punta contra punta)
            const targetHasSaw = (closestTarget.sawActiveUntil || 0) > now || getPassiveSawTier(closestTarget.score || 0) > 0;
            const targetRadius = estimateRadiusFromScore(closestTarget.score || 0);
            const isTipClash = targetHasSaw && (closestDistance > (attackerRadius + targetRadius + 5));

            hits.push({
                attacker: sanitizePlayerForClient(attacker),
                target: sanitizePlayerForClient(closestTarget),
                damage: outcome.damage,
                scoreLoss: outcome.scoreLoss,
                ko: outcome.ko,
                isTipClash
            });
        }

        return hits;
    }

    function syncPosition(id, patch) {
        const player = arenaPlayers[id];
        if (!player || !patch) return;
        
        const radius = estimateRadiusFromScore(player.score || 0);
        // Sincronización con clamping forzado del servidor para evitar que salgan de la arena
        const clamped = clampPosition(
            typeof patch.x === "number" ? patch.x : player.x,
            typeof patch.y === "number" ? patch.y : player.y,
            radius
        );
        player.x = clamped.x;
        player.y = clamped.y;
    }

    function getRoundWinner() {
        const ranking = Object.values(arenaPlayers)
            .filter((player) => isCompetitivePlayerId(player.id))
            .filter((player) => player.state !== PLAYER_STATE.REMOVED)
            .sort((a, b) =>
                (computeRoundStandingScore(b) - computeRoundStandingScore(a)) ||
                ((a.roundStats?.deaths || 0) - (b.roundStats?.deaths || 0)) ||
                ((b.roundStats?.damageDealt || 0) - (a.roundStats?.damageDealt || 0)) ||
                ((b.roundStats?.gifts || 0) - (a.roundStats?.gifts || 0))
            );
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

            // PROTECCIÓN DE LÍDERES: Los campeones o el Top 10 actual permanecen más tiempo (15 min)
            const isChampion = (player.victories || 0) > 0 || (player.bestScore || 0) > 2000;
            const effectiveTimeout = isChampion ? arenaConfig.removeChampionAfterMs : removeAfter;

            if (idleFor >= effectiveTimeout) {
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

    function seedVictories(winnersList = []) {
        for (const w of winnersList) {
            if (w?.id) {
                if (!arenaHallOfFame[w.id]) {
                    arenaHallOfFame[w.id] = { id: w.id, name: w.name, avatar: w.avatar, score: 0, lastActive: Date.now() };
                }
                arenaHallOfFame[w.id].victories = Math.max(arenaHallOfFame[w.id].victories || 0, w.victories || 0);
            }
        }
        saveHOF();
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
        seedVictories,
        ensurePlayer,
        setPlayerTargetPreference,
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
        cleanup,
        sanitizeForClient: sanitizePlayerForClient,
        saveHOFSync
    };
}

module.exports = {
    createArenaManager,
    PLAYER_STATE
};
