// ==========================================
// RULETA MANAGER — Ruleta de la Fortuna (/ruleta)
// Chat elige ROJO/NEGRO/VERDE, los regalos giran la ruleta y multiplican.
// Estado autoritativo: servidor.
// ==========================================

const RULETA_CONFIG = {
    roundDurationMs: 4 * 60 * 1000,
    resetDelayMs: 10000,
    minSpinDiamonds: 10,       // mínimo para girar
    spinCostPerDiamond: 1,     // diamantes consumidos por giro
    multipliers: [1, 2, 3, 5, 10],
    bigWinThreshold: 5,        // x5+
    maxPlayers: 40,
    phrases: [
        "¡La ruleta está girando! Elige ROJO, NEGRO o VERDE en el chat y manda un regalo para apostar.",
        "¡El verde paga 10x! Solo un regalo pequeño puede cambiarlo todo.",
        "Los jugadores concentran su suerte... la bola no perdona a nadie.",
        "¡GRAN GIRO en camino! Los regalos grandes hacen girar la ruleta con más fuerza."
    ]
};

const RULETA_COLORS = ["red", "black", "green", "red", "black", "red", "black", "red", "black", "green", "red", "black"];

function createRuletaManager(io) {
    let state = {
        active: true,
        phase: "idle", // idle | spinning | finished
        timeRemainingMs: RULETA_CONFIG.roundDurationMs,
        bets: { red: {}, black: {}, green: {} },  // color -> userId -> { name, diamonds }
        result: null,      // último color ganador
        lastMultiplier: 1,
        spinCount: 0,
        winners: {}        // id -> { name, won, diamonds }
    };

    let tickTimer = null;
    let endTimer = null;
    let spinTimer = null;
    let announceTimer = 0;

    function userBet(user) {
        return {
            id: user?.id || user?.uniqueId,
            name: user?.nickname || user?.uniqueId || "Jugador",
            avatar: user?.profilePictureUrl || ""
        };
    }

    function placeBet(color, user, diamonds) {
        if (!state.active || state.phase !== "idle") return;
        const bet = userBet(user);
        if (!bet.id) return;
        const bucket = state.bets[color];
        if (!bucket) return;
        if (!bucket[bet.id]) {
            bucket[bet.id] = { name: bet.name, avatar: bet.avatar, diamonds: 0, wins: 0 };
        }
        bucket[bet.id].diamonds += diamonds;
        emitSync();
    }

    function resolveSpin() {
        if (!state.active) return;
        const color = RULETA_COLORS[Math.floor(Math.random() * RULETA_COLORS.length)];
        let multiplier = 1;
        if (color === "green") {
            multiplier = 10;
        } else {
            multiplier = RULETA_CONFIG.multipliers[Math.floor(Math.random() * RULETA_CONFIG.multipliers.length)];
        }

        const bucket = state.bets[color] || {};
        const winners = Object.entries(bucket).filter(([, b]) => b.diamonds > 0);
        const totalWon = winners.reduce((acc, [, b]) => acc + b.diamonds * multiplier, 0);

        state.result = { color, multiplier, totalWon };
        state.lastMultiplier = multiplier;
        state.spinCount += 1;

        // Registrar ganadores
        for (const [id, b] of winners) {
            if (!state.winners[id]) state.winners[id] = { name: b.name, avatar: b.avatar, won: 0 };
            state.winners[id].won += b.diamonds * multiplier;
        }

        io.emit("ruleta:result", {
            color,
            multiplier,
            totalWon,
            winners: winners.map(([id, b]) => ({ id, name: b.name, avatar: b.avatar, amount: b.diamonds * multiplier }))
        });

        if (multiplier >= RULETA_CONFIG.bigWinThreshold || totalWon > 0) {
            io.emit("ruleta:motivate", {
                phrase: totalWon > 0
                    ? `¡La ruleta cayó en ${color.toUpperCase()}! Multiplicador x${multiplier}. ${winners.length} ganador(es) celebran.`
                    : `La ruleta cayó en ${color.toUpperCase()} x${multiplier}, pero nadie apostó a ese color. ¡Apunten mejor!`
            });
        }

        // Limpiar apuestas para la siguiente ronda
        state.bets = { red: {}, black: {}, green: {} };
        emitSync();
    }

    function finishRound() {
        state.active = false;
        state.phase = "finished";
        const ranked = Object.entries(state.winners)
            .map(([id, w]) => ({ id, ...w }))
            .sort((a, b) => b.won - a.won)
            .slice(0, 10);

        io.emit("ruleta:roundEnd", {
            podium: ranked.slice(0, 3),
            totalSpins: state.spinCount,
            result: state.result
        });
        emitSync();

        clearInterval(tickTimer);
        clearTimeout(endTimer);
        clearTimeout(spinTimer);
        endTimer = setTimeout(startNewRound, RULETA_CONFIG.resetDelayMs);
    }

    function startNewRound() {
        state = {
            active: true,
            phase: "idle",
            timeRemainingMs: RULETA_CONFIG.roundDurationMs,
            bets: { red: {}, black: {}, green: {} },
            result: null,
            lastMultiplier: 1,
            spinCount: 0,
            winners: {}
        };
        announceTimer = 0;
        io.emit("ruleta:motivate", { phrase: "¡NUEVA RONDA DE LA RULETA! Escribe ROJO, NEGRO o VERDE en el chat y manda regalos para apostar. ¡El verde paga x10!" });
        emitSync();
        startTick();
    }

    function emitSync() {
        io.emit("ruleta:sync", {
            active: state.active,
            phase: state.phase,
            timeRemainingMs: Math.max(0, state.timeRemainingMs),
            bets: state.bets,
            result: state.result,
            lastMultiplier: state.lastMultiplier,
            spinCount: state.spinCount,
            winners: Object.entries(state.winners)
                .map(([id, w]) => ({ id, ...w }))
                .sort((a, b) => b.won - a.won)
                .slice(0, 10)
        });
    }

    function startTick() {
        clearInterval(tickTimer);
        tickTimer = setInterval(() => {
            if (!state.active) return;
            state.timeRemainingMs = Math.max(0, state.timeRemainingMs - 1000);
            if (state.timeRemainingMs <= 0) {
                finishRound();
                return;
            }
            announceTimer += 1;
            if (announceTimer >= 40) {
                announceTimer = 0;
                io.emit("ruleta:motivate", {
                    phrase: RULETA_CONFIG.phrases[Math.floor(Math.random() * RULETA_CONFIG.phrases.length)]
                });
            }
            emitSync();
        }, 1000);
    }

    return {
        syncClient(socket) {
            socket.emit("ruleta:sync", {
                active: state.active,
                phase: state.phase,
                timeRemainingMs: Math.max(0, state.timeRemainingMs),
                bets: state.bets,
                result: state.result,
                lastMultiplier: state.lastMultiplier,
                spinCount: state.spinCount,
                winners: Object.entries(state.winners)
                    .map(([id, w]) => ({ id, ...w }))
                    .sort((a, b) => b.won - a.won)
                    .slice(0, 10)
            });
        },
        handleRuletaGift(event) {
            if (!state.active) return;
            const user = event.user || event;
            const diamonds = event.gift?.totalDiamonds || 1;
            const bet = userBet(user);
            if (!bet.id) return;

            // El chat decide el color; por defecto rojo
            const color = state.pendingColor || "red";
            placeBet(color, user, diamonds);

            if (diamonds >= RULETA_CONFIG.minSpinDiamonds) {
                state.phase = "spinning";
                io.emit("ruleta:spin", { byId: bet.id, byName: bet.name, diamonds, color });
                clearTimeout(spinTimer);
                spinTimer = setTimeout(() => {
                    state.phase = "idle";
                    resolveSpin();
                }, 3500);
            }
        },
        handleRuletaLike(_event) {
            // Los likes no cambian la ruleta: solo ambiente (sin estado autoritativo)
            return;
        },
        handleRuletaChat(event) {
            const text = String(event.comment || "").toLowerCase();
            if (/(rojo|red)/.test(text)) state.pendingColor = "red";
            else if (/(negro|black)/.test(text)) state.pendingColor = "black";
            else if (/(verde|green)/.test(text)) state.pendingColor = "green";
        },
        start() {
            emitSync();
            startTick();
        }
    };
}

module.exports = createRuletaManager;
