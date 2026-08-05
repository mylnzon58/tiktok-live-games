// ==========================================
// BOMBA MANAGER — La Bomba (/bomba)
// Patata caliente: quien tenga la bomba cuando explote pierde.
// Regalos, likes y chat pasan la bomba. Estado autoritativo: servidor.
// ==========================================

const { createStorage } = require("../lib/storage");

const BOMBA_CONFIG = {
    roundDurationMs: 3 * 60 * 1000,
    resetDelayMs: 10000,
    fuseMinMs: 12000,
    fuseMaxMs: 30000,
    passCostPoints: 50,      // puntos que recibe quien pasa la bomba
    explosionPenalty: 300,   // puntos que pierde el que explota
    giftPassRequiredDiamonds: 1, // cualquier regalo pasa la bomba
    likePassThreshold: 3,    // likes acumulados de un jugador = pase automático
    maxPlayers: 40,
    phrases: [
        "La bomba está caliente... ¿quién la quiere? ¡Manda un regalo o escribe PASA!",
        "¡TIC TAC TIC TAC! El reloj avanza. Pasa la bomba antes de que explote.",
        "La mecha brilla... un regalo puede salvar tu puntaje ¡YA!",
        "¡Nadie la quiere! Pero si explota, el que la tenga pierde 300 puntos.",
        "Rafaga de regalos: cada uno pasa la bomba a otro jugador."
    ]
};

function createBombaManager(io) {
    const hofStorage = createStorage("bomba_hof.json", { winners: [] });
    const persistedHOF = hofStorage.load() || { winners: [] };

    let state = {
        active: true,
        phase: "playing", // playing | exploded | finished
        timeRemainingMs: BOMBA_CONFIG.roundDurationMs,
        fuseMs: BOMBA_CONFIG.fuseMinMs,
        holder: null,          // id del jugador que tiene la bomba
        players: {},           // id -> { id, name, avatar, score, wins }
        explosionCount: 0
    };

    let fuseTimer = null;
    let tickTimer = null;
    let endTimer = null;
    let announceTimer = 0;
    let likeBuffer = {};       // id -> likes acumulados en ventana
    const LIKE_WINDOW_MS = 5000;

    function playerKey(user) {
        return user?.id || user?.uniqueId || null;
    }

    function ensurePlayer(user) {
        const id = playerKey(user);
        if (!id) return null;
        const existing = state.players[id];
        if (existing) {
            if (user?.nickname || user?.profilePictureUrl) {
                existing.name = user.nickname || user.user?.nickname || existing.name;
                existing.avatar = user.profilePictureUrl || user.user?.profilePictureUrl || existing.avatar;
            }
            return existing;
        }
        const p = {
            id,
            name: user.nickname || user.user?.nickname || id,
            avatar: user.profilePictureUrl || user.user?.profilePictureUrl || "",
            score: 0,
            wins: 0
        };
        state.players[id] = p;
        const keys = Object.keys(state.players);
        if (keys.length > BOMBA_CONFIG.maxPlayers) {
            delete state.players[keys[0]];
        }
        return p;
    }

    function playerList() {
        return Object.values(state.players);
    }

    function randomOtherId(exceptId) {
        const others = playerList().filter(p => p.id !== exceptId);
        if (others.length === 0) return null;
        return others[Math.floor(Math.random() * others.length)].id;
    }

    function startFuse() {
        clearTimeout(fuseTimer);
        state.fuseMs = Math.floor(
            BOMBA_CONFIG.fuseMinMs + Math.random() * (BOMBA_CONFIG.fuseMaxMs - BOMBA_CONFIG.fuseMinMs)
        );
        fuseTimer = setTimeout(onExplosion, state.fuseMs);
    }

    function passBomb(toId, byPlayer, reason) {
        if (!state.active) return;
        if (!toId) {
            const first = playerList()[0];
            toId = first?.id || null;
            if (!toId) return;
        }
        state.holder = toId;
        const holder = state.players[toId];
        startFuse();
        io.emit("bomba:pass", {
            toId,
            toName: holder?.name || toId,
            toAvatar: holder?.avatar || "",
            byId: byPlayer?.id || null,
            byName: byPlayer?.name || "",
            reason,
            fuseMs: state.fuseMs
        });
        emitSync();
    }

    function onExplosion() {
        if (!state.active) return;
        const victim = state.players[state.holder];
        const victimId = state.holder;
        state.phase = "exploded";
        state.explosionCount += 1;

        if (victim) {
            victim.score = Math.max(0, victim.score - BOMBA_CONFIG.explosionPenalty);
        }

        io.emit("bomba:boom", {
            victimId,
            victimName: victim?.name || victimId,
            victimAvatar: victim?.avatar || "",
            penalty: BOMBA_CONFIG.explosionPenalty,
            newScore: Math.max(0, (victim?.score || 0))
        });

        // La bomba sigue: la recoge el que acaba de explotar y debe pasarla rápido
        setTimeout(() => {
            if (!state.active) return;
            state.phase = "playing";
            if (victim) {
                passBomb(victimId, null, "boom");
            } else {
                const first = playerList()[0];
                if (first) passBomb(first.id, null, "boom");
            }
            io.emit("bomba:motivate", { phrase: "¡BOOM! La bomba volvió a la misma mano... ¡pásala RÁPIDO antes de que reviente de nuevo!" });
        }, 2500);
    }

    function finishRound() {
        state.active = false;
        state.phase = "finished";
        const ranked = playerList().sort((a, b) => b.score - a.score);
        const winner = ranked[0] || null;
        if (winner) {
            winner.wins += 1;
            persistedHOF.winners.unshift({
                name: winner.name,
                avatar: winner.avatar,
                score: winner.score,
                ts: Date.now()
            });
            persistedHOF.winners = persistedHOF.winners.slice(0, 20);
            hofStorage.save(persistedHOF);
        }
        io.emit("bomba:roundEnd", {
            winnerId: winner?.id || null,
            winnerName: winner?.name || "Nadie",
            winnerAvatar: winner?.avatar || "",
            podium: ranked.slice(0, 3),
            hof: persistedHOF.winners.slice(0, 10)
        });
        emitSync();

        clearInterval(tickTimer);
        clearTimeout(fuseTimer);
        clearTimeout(endTimer);
        endTimer = setTimeout(startNewRound, BOMBA_CONFIG.resetDelayMs);
    }

    function startNewRound() {
        state = {
            active: true,
            phase: "playing",
            timeRemainingMs: BOMBA_CONFIG.roundDurationMs,
            fuseMs: BOMBA_CONFIG.fuseMinMs,
            holder: null,
            players: {},
            explosionCount: 0
        };
        announceTimer = 0;
        likeBuffer = {};
        const first = playerList()[0];
        if (first) {
            state.holder = first.id;
        }
        io.emit("bomba:motivate", { phrase: "¡NUEVA RONDA DE LA BOMBA! Quien tenga la bomba cuando explote pierde 300 puntos. ¡Pásala con regalos, taps o escribiendo PASA!" });
        emitSync();
        startTick();
        if (state.holder) startFuse();
    }

    function emitSync() {
        io.emit("bomba:sync", {
            active: state.active,
            phase: state.phase,
            timeRemainingMs: Math.max(0, state.timeRemainingMs),
            fuseMs: Math.max(0, state.fuseMs),
            holder: state.holder,
            players: playerList(),
            explosionCount: state.explosionCount
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
            if (announceTimer >= 35) {
                announceTimer = 0;
                io.emit("bomba:motivate", {
                    phrase: BOMBA_CONFIG.phrases[Math.floor(Math.random() * BOMBA_CONFIG.phrases.length)]
                });
            }
            emitSync();
        }, 1000);
    }

    return {
        syncClient(socket) {
            socket.emit("bomba:sync", {
                active: state.active,
                phase: state.phase,
                timeRemainingMs: Math.max(0, state.timeRemainingMs),
                fuseMs: Math.max(0, state.fuseMs),
                holder: state.holder,
                players: playerList(),
                explosionCount: state.explosionCount,
                hof: persistedHOF.winners.slice(0, 10)
            });
        },
        handleBombaGift(event) {
            if (!state.active) return;
            const sender = ensurePlayer(event.user || event);
            if (!sender) return;

            // El regalo da puntos al donante y pasa la bomba a otro jugador aleatorio
            const diamonds = event.gift?.totalDiamonds || 1;
            sender.score += diamonds;
            const targetId = randomOtherId(sender.id) || sender.id;
            passBomb(targetId, sender, "gift");
            io.emit("bomba:motivate", {
                phrase: `¡${sender.name} mandó ${event.gift?.name || "un regalo"} y le pasa la bomba a ${state.players[targetId]?.name || targetId}!`
            });
        },
        handleBombaLike(event) {
            if (!state.active) return;
            const liker = ensurePlayer(event.user || event);
            if (!liker) return;
            const id = liker.id;
            const now = Date.now();
            if (!likeBuffer[id] || now - likeBuffer[id].ts > LIKE_WINDOW_MS) {
                likeBuffer[id] = { count: 0, ts: now };
            }
            likeBuffer[id].count += event.likeCount || 1;
            likeBuffer[id].ts = now;

            // Cada N likes = pase automático de la bomba a quien más hace tap
            if (likeBuffer[id].count >= BOMBA_CONFIG.likePassThreshold && id !== state.holder) {
                likeBuffer[id].count = 0;
                passBomb(id, liker, "like");
            }
        },
        handleBombaChat(event) {
            if (!state.active) return;
            const text = String(event.comment || "").toLowerCase();
            const uid = playerKey(event.user || event);
            if (!uid) return;

            if (text.includes("pasa") || text.includes("pass") || text.includes("🧨")) {
                const sender = ensurePlayer(event.user || event);
                const targetId = randomOtherId(uid);
                if (!targetId) return;
                passBomb(targetId, sender || { id: uid }, "chat");
            }
        },
        start() {
            emitSync();
            startTick();
            if (state.holder) startFuse();
        }
    };
}

module.exports = createBombaManager;
