// ==========================================
// SLOTS MANAGER — Tragamonedas Live (/slots)
// Los regalos jalan la palanca. Tres símbolos iguales = JACKPOT compartido.
// Estado autoritativo: servidor.
// ==========================================

const SLOTS_CONFIG = {
    roundDurationMs: 4 * 60 * 1000,
    resetDelayMs: 10000,
    spinCostDiamonds: 5,       // diamantes para girar la palanca
    symbols: ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"],
    jackpotMultiplier: 25,     // x25 del coste al acertar triple
    doubleMultiplier: 5,       // x5 por dos iguales
    maxPlayers: 40,
    phrases: [
        "¡La máquina está caliente! Manda regalos para jalar la palanca.",
        "¡TRIPLE SIETE! El jackpot está por caer. ¿Será tu turno?",
        "La suerte favorece a los valientes. ¡Una rosa y a girar!",
        "Los rodillos giran... este giro puede cambiar la historia."
    ]
};

function createSlotsManager(io) {
    let state = {
        active: true,
        phase: "idle", // idle | spinning | finished
        timeRemainingMs: SLOTS_CONFIG.roundDurationMs,
        reels: [null, null, null],
        lastResult: null,   // { symbols, jackpot, winner }
        spins: 0,
        jackpots: 0,
        totalWon: 0,
        players: {}         // id -> { name, avatar, won, spins }
    };

    let tickTimer = null;
    let endTimer = null;
    let spinTimer = null;
    let announceTimer = 0;

    function ensurePlayer(user) {
        const id = user?.id || user?.uniqueId;
        if (!id) return null;
        const existing = state.players[id];
        if (existing) {
            if (user?.nickname) existing.name = user.nickname;
            if (user?.profilePictureUrl) existing.avatar = user.profilePictureUrl;
            return existing;
        }
        const keys = Object.keys(state.players);
        if (keys.length >= SLOTS_CONFIG.maxPlayers) {
            delete state.players[keys[0]];
        }
        const p = { id, name: user?.nickname || user?.uniqueId || id, avatar: user?.profilePictureUrl || "", won: 0, spins: 0 };
        state.players[id] = p;
        return p;
    }

    function spinReels() {
        return [
            SLOTS_CONFIG.symbols[Math.floor(Math.random() * SLOTS_CONFIG.symbols.length)],
            SLOTS_CONFIG.symbols[Math.floor(Math.random() * SLOTS_CONFIG.symbols.length)],
            SLOTS_CONFIG.symbols[Math.floor(Math.random() * SLOTS_CONFIG.symbols.length)]
        ];
    }

    function resolveSpin(player) {
        if (!state.active) return;
        const symbols = spinReels();
        state.reels = symbols;
        state.spins += 1;
        player.spins += 1;

        const [a, b, c] = symbols;
        let multiplier = 0;
        let won = 0;
        const jackpot = a === b && b === c;
        const pair = a === b || b === c || a === c;

        if (jackpot) {
            multiplier = SLOTS_CONFIG.jackpotMultiplier;
            state.jackpots += 1;
        } else if (pair) {
            multiplier = SLOTS_CONFIG.doubleMultiplier;
        }

        if (multiplier > 0) {
            won = SLOTS_CONFIG.spinCostDiamonds * multiplier;
            player.won += won;
            state.totalWon += won;
        }

        state.lastResult = { symbols, jackpot, multiplier, won, playerId: player.id, playerName: player.name };
        io.emit("slots:result", state.lastResult);

        if (jackpot) {
            io.emit("slots:motivate", {
                phrase: `🎰 ¡JACKPOT! ${player.name} alineó ${a} ${b} ${c} y gana ${won} puntos. ¡La sala explota!`
            });
        } else if (pair) {
            io.emit("slots:motivate", {
                phrase: `¡${player.name} casi lo logra! ${a} ${b} ${c} = premio x${multiplier}.`
            });
        }
        emitSync();
    }

    function finishRound() {
        state.active = false;
        state.phase = "finished";
        const ranked = Object.values(state.players)
            .sort((x, y) => y.won - x.won)
            .slice(0, 10);

        io.emit("slots:roundEnd", {
            podium: ranked.slice(0, 3),
            totalSpins: state.spins,
            jackpots: state.jackpots,
            totalWon: state.totalWon
        });
        emitSync();

        clearInterval(tickTimer);
        clearTimeout(endTimer);
        clearTimeout(spinTimer);
        endTimer = setTimeout(startNewRound, SLOTS_CONFIG.resetDelayMs);
    }

    function startNewRound() {
        state = {
            active: true,
            phase: "idle",
            timeRemainingMs: SLOTS_CONFIG.roundDurationMs,
            reels: [null, null, null],
            lastResult: null,
            spins: 0,
            jackpots: 0,
            totalWon: 0,
            players: {}
        };
        announceTimer = 0;
        io.emit("slots:motivate", { phrase: "🎰 ¡NUEVA RONDA DE LA TRAGAMONEDAS! Manda regalos para jalar la palanca. Alinea tres símbolos y haz JACKPOT." });
        emitSync();
        startTick();
    }

    function emitSync() {
        io.emit("slots:sync", {
            active: state.active,
            phase: state.phase,
            timeRemainingMs: Math.max(0, state.timeRemainingMs),
            reels: state.reels,
            lastResult: state.lastResult,
            spins: state.spins,
            jackpots: state.jackpots,
            totalWon: state.totalWon,
            players: Object.values(state.players).sort((a, b) => b.won - a.won).slice(0, 10)
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
                io.emit("slots:motivate", {
                    phrase: SLOTS_CONFIG.phrases[Math.floor(Math.random() * SLOTS_CONFIG.phrases.length)]
                });
            }
            emitSync();
        }, 1000);
    }

    return {
        syncClient(socket) {
            socket.emit("slots:sync", {
                active: state.active,
                phase: state.phase,
                timeRemainingMs: Math.max(0, state.timeRemainingMs),
                reels: state.reels,
                lastResult: state.lastResult,
                spins: state.spins,
                jackpots: state.jackpots,
                totalWon: state.totalWon,
                players: Object.values(state.players).sort((a, b) => b.won - a.won).slice(0, 10)
            });
        },
        handleSlotsGift(event) {
            if (!state.active) return;
            const user = event.user || event;
            const player = ensurePlayer(user);
            if (!player) return;
            const diamonds = event.gift?.totalDiamonds || 1;

            if (diamonds < SLOTS_CONFIG.spinCostDiamonds) return;

            state.phase = "spinning";
            io.emit("slots:spin", { playerId: player.id, playerName: player.name, diamonds });
            clearTimeout(spinTimer);
            spinTimer = setTimeout(() => {
                state.phase = "idle";
                resolveSpin(player);
            }, 2500);
        },
        handleSlotsLike(_event) {
            // Los likes alimentan el ambiente: mínima probabilidad de giro gratis (solo visual)
            return;
        },
        handleSlotsChat(event) {
            const text = String(event.comment || "").toLowerCase();
            if (/(palanca|giro|spin|suerte|jackpot)/.test(text)) {
                const id = event.user?.id || event.uniqueId;
                if (id && state.players[id]) {
                    io.emit("slots:motivate", {
                        phrase: `¡${state.players[id].name} pide la palanca! Manda un regalo para girar.`
                    });
                }
            }
        },
        start() {
            emitSync();
            startTick();
        }
    };
}

module.exports = createSlotsManager;
