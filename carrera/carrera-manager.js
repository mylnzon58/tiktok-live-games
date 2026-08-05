// ==========================================
// CARRERA MANAGER — Carrera de Avatares (/carrera)
// Regalos impulsan a tu avatar por los carriles; el primero en meta gana.
// Likes dan mini-impulso. Estado autoritativo: servidor.
// ==========================================

const CARRERA_CONFIG = {
    roundDurationMs: 4 * 60 * 1000,
    resetDelayMs: 10000,
    lanes: 6,
    finishProgress: 100,          // % de la pista para ganar
    giftSpeedPerDiamond: 0.6,     // % de avance por diamante
    likeSpeed: 0.02,              // % por like (batch)
    maxPlayers: 40,
    phrases: [
        "¡La pista está encendida! Cada regalo hace volar a tu avatar hacia la meta.",
        "¡Ladran los motores! Manda una rosa para acelerar a tu favorito.",
        "TAP TAP en pantalla: cada like da un mini impulso. ¡No dejen que los alcancen!",
        "La meta se acerca... el próximo regalo puede ser el que cruce la línea.",
        "¡Última vuelta al sprint! Los regalos ahora valen el doble de velocidad."
    ]
};

function createCarreraManager(io) {
    let state = {
        active: true,
        phase: "running", // running | finished
        timeRemainingMs: CARRERA_CONFIG.roundDurationMs,
        racers: {},       // id -> { id, name, avatar, progress, speed, wins }
        order: []
    };

    let tickTimer = null;
    let endTimer = null;
    let announceTimer = 0;
    let likeQueue = {};   // id -> likes acumulados

    function ensureRacer(user) {
        const id = user?.id || user?.uniqueId;
        if (!id) return null;
        const existing = state.racers[id];
        if (existing) {
            if (user?.nickname) existing.name = user.nickname;
            if (user?.profilePictureUrl) existing.avatar = user.profilePictureUrl;
            return existing;
        }
        const keys = Object.keys(state.racers);
        if (keys.length >= CARRERA_CONFIG.maxPlayers) {
            // Reemplazar al último lugar si está lleno (solo en carrera)
            const last = state.order[state.order.length - 1];
            if (last && state.racers[last]) delete state.racers[last];
            const idx = state.order.indexOf(last);
            if (idx >= 0) state.order.splice(idx, 1);
        }
        const racer = {
            id,
            name: user.nickname || user.uniqueId || id,
            avatar: user.profilePictureUrl || "",
            progress: 0,
            speed: 0,
            wins: 0
        };
        state.racers[id] = racer;
        state.order.push(id);
        return racer;
    }

    function sortOrder() {
        state.order.sort((a, b) => {
            const ra = state.racers[a];
            const rb = state.racers[b];
            return (rb?.progress || 0) - (ra?.progress || 0);
        });
    }

    function checkFinish() {
        const first = state.order.map(id => state.racers[id]).find(r => r && r.progress >= CARRERA_CONFIG.finishProgress);
        if (first) {
            finishRound(first);
            return true;
        }
        return false;
    }

    function emitSync() {
        sortOrder();
        io.emit("carrera:sync", {
            active: state.active,
            phase: state.phase,
            timeRemainingMs: Math.max(0, state.timeRemainingMs),
            racers: state.order.map(id => state.racers[id]),
            finishProgress: CARRERA_CONFIG.finishProgress
        });
    }

    function advance(racerId, amount, reason, donor) {
        if (!state.active) return;
        const racer = state.racers[racerId];
        if (!racer) return;
        racer.speed = Math.min(racer.speed + amount * 0.3, 10);
        racer.progress = Math.min(CARRERA_CONFIG.finishProgress, racer.progress + amount);
        io.emit("carrera:push", {
            racerId,
            amount,
            progress: racer.progress,
            reason,
            donor: donor ? { id: donor.id, name: donor.name, avatar: donor.avatar || "" } : null
        });
        emitSync();
        if (reason === "gift") {
            // Punto de inflexión: cerca de la meta los regalos aceleran más
            if (racer.progress >= 75) {
                io.emit("carrera:motivate", {
                    phrase: `¡${racer.name} está a punto de cruzar la meta! ¿Alguien lo alcanza?`
                });
            }
        }
        checkFinish();
    }

    function finishRound(winner) {
        state.active = false;
        state.phase = "finished";
        winner.wins += 1;
        sortOrder();
        const podium = state.order.slice(0, 3).map(id => state.racers[id]);

        io.emit("carrera:roundEnd", {
            winnerId: winner.id,
            winnerName: winner.name,
            winnerAvatar: winner.avatar,
            podium,
            timeRemainingMs: Math.max(0, state.timeRemainingMs)
        });
        emitSync();

        clearInterval(tickTimer);
        clearTimeout(endTimer);
        endTimer = setTimeout(startNewRound, CARRERA_CONFIG.resetDelayMs);
    }

    function timeUp() {
        if (!state.active) return;
        const ranked = state.order.map(id => state.racers[id]).filter(Boolean).sort((a, b) => b.progress - a.progress);
        const leader = ranked[0];
        if (leader) {
            finishRound(leader);
        } else {
            // Nadie corrió: nueva ronda directa
            state.active = false;
            endTimer = setTimeout(startNewRound, CARRERA_CONFIG.resetDelayMs);
        }
    }

    function startNewRound() {
        state = {
            active: true,
            phase: "running",
            timeRemainingMs: CARRERA_CONFIG.roundDurationMs,
            racers: {},
            order: []
        };
        announceTimer = 0;
        likeQueue = {};
        io.emit("carrera:motivate", { phrase: "¡NUEVA CARRERA! Manda regalos para sacar tu avatar a la pista y llévalo hasta la meta. ¡El primero en llegar GANA!" });
        emitSync();
        startTick();
    }

    function startTick() {
        clearInterval(tickTimer);
        tickTimer = setInterval(() => {
            if (!state.active) return;
            state.timeRemainingMs = Math.max(0, state.timeRemainingMs - 1000);

            // Vaciar likes acumulados (mini impulsos)
            for (const [id, count] of Object.entries(likeQueue)) {
                if (count > 0) {
                    advance(id, count * CARRERA_CONFIG.likeSpeed, "like", null);
                    likeQueue[id] = 0;
                }
            }

            if (state.timeRemainingMs <= 0) {
                timeUp();
                return;
            }

            announceTimer += 1;
            if (announceTimer >= 40) {
                announceTimer = 0;
                io.emit("carrera:motivate", {
                    phrase: CARRERA_CONFIG.phrases[Math.floor(Math.random() * CARRERA_CONFIG.phrases.length)]
                });
            }

            emitSync();
        }, 1000);
    }

    return {
        syncClient(socket) {
            sortOrder();
            socket.emit("carrera:sync", {
                active: state.active,
                phase: state.phase,
                timeRemainingMs: Math.max(0, state.timeRemainingMs),
                racers: state.order.map(id => state.racers[id]),
                finishProgress: CARRERA_CONFIG.finishProgress
            });
        },
        handleCarreraGift(event) {
            if (!state.active) return;
            const user = event.user || event;
            const racer = ensureRacer(user);
            if (!racer) return;
            const diamonds = event.gift?.totalDiamonds || 1;
            const boost = Math.min(25, diamonds * CARRERA_CONFIG.giftSpeedPerDiamond);
            advance(racer.id, boost, "gift", {
                id: racer.id,
                name: racer.name,
                avatar: racer.avatar
            });
            if (diamonds >= 500) {
                io.emit("carrera:motivate", {
                    phrase: `¡${racer.name} acelera con ${diamonds} diamantes! ${event.gift?.name || "Regalo"} de pista total.`
                });
            }
        },
        handleCarreraLike(event) {
            if (!state.active) return;
            const id = event.user?.id || event.uniqueId;
            if (!id) return;
            if (!state.racers[id]) return; // Solo impulsan si ya están en la pista
            likeQueue[id] = (likeQueue[id] || 0) + (event.likeCount || 1);
        },
        handleCarreraChat(event) {
            // Acción rápida por chat: "GO", "VAMO", "ACELERA" impulsa al que ya corre
            if (!state.active) return;
            const text = String(event.comment || "").toLowerCase();
            const id = event.user?.id || event.uniqueId;
            if (!id) return;
            if (!state.racers[id]) return;
            if (/(go|vamo|dale|acelera|run|vamos)/.test(text)) {
                advance(id, 1.5, "chat", { id, name: state.racers[id].name, avatar: state.racers[id].avatar });
            }
        },
        start() {
            emitSync();
            startTick();
        }
    };
}

module.exports = createCarreraManager;
