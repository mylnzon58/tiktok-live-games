// ==========================================
// SUBASTA MANAGER — Subasta Real (/subasta)
// Cada ronda hay un premio en juego. Los regalos son las pujas.
// Cuando el tiempo termina, el mayor pujador gana. Estado autoritativo: servidor.
// ==========================================

const SUBASTA_CONFIG = {
    roundDurationMs: 3 * 60 * 1000,
    resetDelayMs: 12000,
    bidDiamondsPerPoint: 1,      // 1 diamante = 1 punto de puja
    minBidToEnter: 1,
    maxBidders: 40,
    prizes: [
        { name: "👑 Corazón de Oro", emoji: "👑", value: "VIP del stream" },
        { name: "🎤 Dedicatoria Premium", emoji: "🎤", value: "Saludo en directo" },
        { name: "🏆 Trofeo del Día", emoji: "🏆", value: "Shoutout + reto" },
        { name: "💎 Diamante VIP", emoji: "💎", value: "Pin superior" },
        { name: "🎮 Reto Doble", emoji: "🎮", value: "Reto personalizado" }
    ],
    phrases: [
        "¡Comienza la subasta! Manda regalos para pujar por este premio.",
        "La puja sube... cada rosa cuenta. ¿Quién quiere llevarse el premio?",
        "¡ÚLTIMOS SEGUNDOS! Tu regalo puede ser el que cierre la subasta.",
        "El premio espera al más generoso. ¡Las pujas grandes no se arrepienten!"
    ]
};

function createSubastaManager(io) {
    let state = {
        active: true,
        phase: "bidding", // bidding | ending | finished
        timeRemainingMs: SUBASTA_CONFIG.roundDurationMs,
        prize: SUBASTA_CONFIG.prizes[Math.floor(Math.random() * SUBASTA_CONFIG.prizes.length)],
        bids: {},        // userId -> { name, avatar, diamonds }
        order: [],
        winner: null,
        round: 1
    };

    let tickTimer = null;
    let endTimer = null;
    let announceTimer = 0;

    function ensureBidder(user) {
        const id = user?.id || user?.uniqueId;
        if (!id) return null;
        const existing = state.bids[id];
        if (existing) {
            if (user?.nickname) existing.name = user.nickname;
            if (user?.profilePictureUrl) existing.avatar = user.profilePictureUrl;
            return existing;
        }
        if (Object.keys(state.bids).length >= SUBASTA_CONFIG.maxBidders) {
            const lowest = state.order[state.order.length - 1];
            if (lowest && state.bids[lowest]) delete state.bids[lowest];
            const idx = state.order.indexOf(lowest);
            if (idx >= 0) state.order.splice(idx, 1);
        }
        const bid = {
            id,
            name: user?.nickname || user?.uniqueId || id,
            avatar: user?.profilePictureUrl || "",
            diamonds: 0
        };
        state.bids[id] = bid;
        state.order.push(id);
        return bid;
    }

    function sortOrder() {
        state.order.sort((a, b) => (state.bids[b]?.diamonds || 0) - (state.bids[a]?.diamonds || 0));
    }

    function emitSync() {
        sortOrder();
        io.emit("subasta:sync", {
            active: state.active,
            phase: state.phase,
            timeRemainingMs: Math.max(0, state.timeRemainingMs),
            prize: state.prize,
            round: state.round,
            bids: state.order.slice(0, 10).map(id => state.bids[id]),
            winner: state.winner
        });
    }

    function finishRound() {
        state.active = false;
        state.phase = "finished";
        sortOrder();
        const top = state.order[0] ? state.bids[state.order[0]] : null;
        state.winner = top ? { id: top.id, name: top.name, avatar: top.avatar, diamonds: top.diamonds } : null;

        io.emit("subasta:winner", {
            prize: state.prize,
            winner: state.winner,
            podium: state.order.slice(0, 3).map(id => state.bids[id])
        });
        emitSync();

        clearInterval(tickTimer);
        clearTimeout(endTimer);
        endTimer = setTimeout(startNewRound, SUBASTA_CONFIG.resetDelayMs);
    }

    function startNewRound() {
        state = {
            active: true,
            phase: "bidding",
            timeRemainingMs: SUBASTA_CONFIG.roundDurationMs,
            prize: SUBASTA_CONFIG.prizes[Math.floor(Math.random() * SUBASTA_CONFIG.prizes.length)],
            bids: {},
            order: [],
            winner: null,
            round: state.round + 1
        };
        announceTimer = 0;
        io.emit("subasta:motivate", { phrase: `¡NUEVA SUBASTA! El premio: ${state.prize.name} (${state.prize.value}). Manda regalos para pujar. El mayor pujador se lo lleva.` });
        emitSync();
        startTick();
    }

    function startTick() {
        clearInterval(tickTimer);
        tickTimer = setInterval(() => {
            if (!state.active) return;
            state.timeRemainingMs = Math.max(0, state.timeRemainingMs - 1000);

            if (state.timeRemainingMs <= 15000 && state.phase === "bidding") {
                state.phase = "ending";
                io.emit("subasta:motivate", { phrase: "⏰ ¡ÚLTIMOS 15 SEGUNDOS! La puja se cierra. ¡Tu regalo decide el ganador!" });
            }

            if (state.timeRemainingMs <= 0) {
                finishRound();
                return;
            }

            announceTimer += 1;
            if (announceTimer >= 35) {
                announceTimer = 0;
                io.emit("subasta:motivate", {
                    phrase: SUBASTA_CONFIG.phrases[Math.floor(Math.random() * SUBASTA_CONFIG.phrases.length)]
                });
            }

            // Emitir sync periódico para mantener líderes actualizados
            emitSync();
        }, 1000);
    }

    return {
        syncClient(socket) {
            sortOrder();
            socket.emit("subasta:sync", {
                active: state.active,
                phase: state.phase,
                timeRemainingMs: Math.max(0, state.timeRemainingMs),
                prize: state.prize,
                round: state.round,
                bids: state.order.slice(0, 10).map(id => state.bids[id]),
                winner: state.winner
            });
        },
        handleSubastaGift(event) {
            if (!state.active) return;
            const user = event.user || event;
            const bidder = ensureBidder(user);
            if (!bidder) return;
            const diamonds = event.gift?.totalDiamonds || 1;
            if (diamonds < SUBASTA_CONFIG.minBidToEnter) return;

            bidder.diamonds += diamonds;
            sortOrder();

            io.emit("subasta:bid", {
                bidder: { id: bidder.id, name: bidder.name, avatar: bidder.avatar },
                diamonds,
                total: bidder.diamonds,
                giftName: event.gift?.name || "Regalo"
            });

            // Detectar puja que toma el liderato
            if (state.order[0] === bidder.id) {
                io.emit("subasta:motivate", {
                    phrase: `¡${bidder.name} toma el liderato con ${bidder.diamonds} diamantes! ¿Alguien puede superar esta puja?`
                });
            }
            emitSync();
        },
        handleSubastaLike(_event) {
            // Los likes no pujan: solo ambiente
            return;
        },
        handleSubastaChat(event) {
            const text = String(event.comment || "").toLowerCase();
            const id = event.user?.id || event.uniqueId;
            if (!id || !state.bids[id]) return;
            if (/(puja|subo|sube|mio|precio)/.test(text)) {
                // El chat anuncia intención pero solo los regalos cuentan como puja
                io.emit("subasta:motivate", {
                    phrase: `¡${state.bids[id].name} dice que no piensa perder esta subasta!`
                });
            }
        },
        start() {
            emitSync();
            startTick();
        }
    };
}

module.exports = createSubastaManager;
