const { createStorage } = require("../lib/storage");

const TITAN_CONFIG = {
    roundDurationMs: 5 * 60 * 1000,
    resetDelayMs: 12000,
    suddenDeathMs: 30000,
    winTarget: 8000,
    giftPowerPerDiamond: 2,
    likeChargeThreshold: 200,
    likeChargePush: 80,
    comboWindowMs: 4000,
    comboMultipliers: [
        { gifts: 10, multiplier: 1.5 },
        { gifts: 5, multiplier: 1.25 },
        { gifts: 3, multiplier: 1.1 }
    ],
    catchUpMultiplier: 1.3,
    finalPushMultiplier: 2,
    sabotageCategories: ["fire", "lightning"],
    chatJoinScore: 5,
    maxDonorsPerTeam: 3,
    phrases: [
        "¡La cuerda está en juego! Cada rosa decide el destino de tu titán.",
        "El titán va perdiendo terreno. ¡Un regalo puede revertir todo ahora mismo!",
        "¡Rafaga de regalos! Los dioses miran esta batalla desde el cielo.",
        "Tap tap en pantalla para cargar el poder de tu equipo. ¡No dejes que te empujen!",
        "¡ULTIMA LLAMADA! Los ultimos regalos son los que hacen historia.",
        "La arena tiembla... ¡dos titanes, un solo destino!",
        "¡Tu regalo puede ser el que rompa la cuerda! Elige tu bando."
    ]
};

const TEAMS = {
    red: { id: "red", name: "TITÁN ROJO", short: "ROJO", color: "#ef4444", glow: "rgba(239,68,68,0.6)", emoji: "🔥" },
    blue: { id: "blue", name: "TITÁN AZUL", short: "AZUL", color: "#3b82f6", glow: "rgba(59,130,246,0.6)", emoji: "🌊" }
};

function createTitanManager(io) {
    const hofStorage = createStorage("titan_hof.json", { red: 0, blue: 0, mvps: [] });
    const persistedHOF = hofStorage.load() || { red: 0, blue: 0, mvps: [] };

    let state = {
        active: true,
        phase: "normal", // normal | suddenDeath | finished
        timeRemainingMs: TITAN_CONFIG.roundDurationMs,
        teams: {
            red: { ...TEAMS.red, score: 0, wins: persistedHOF.red || 0, donors: {}, members: {} },
            blue: { ...TEAMS.blue, score: 0, wins: persistedHOF.blue || 0, donors: {}, members: {} }
        },
        charges: { red: 0, blue: 0 },
        bar: 0.5 // 0 = rojo ganando, 1 = azul ganando
    };

    let allegiance = {}; // userId -> teamId
    let comboState = { team: null, gifts: 0, until: 0 };
    let announceTimer = 0;
    let tickTimer = null;
    let endTimer = null;
    let flushTimer = null;
    let syncQueued = false;
    let likeBuffer = { red: { count: 0, donors: [] }, blue: { count: 0, donors: [] } };
    const LIKE_FLUSH_MS = 100;

    function opponent(teamId) {
        return teamId === "red" ? "blue" : "red";
    }

    function emitSync() {
        const payload = {
            active: state.active,
            phase: state.phase,
            timeRemainingMs: Math.max(0, state.timeRemainingMs),
            teams: {
                red: { ...state.teams.red, donors: topDonors("red"), members: teamMembers("red") },
                blue: { ...state.teams.blue, donors: topDonors("blue"), members: teamMembers("blue") }
            },
            charges: state.charges,
            bar: state.bar,
            winTarget: TITAN_CONFIG.winTarget
        };
        io.emit("titan:sync", payload);
    }

    // Throttle de sync: los estados de alta frecuencia (likes) no emiten sync
    // inmediato; se acumula la petición y se vacía en el flush de 100ms.
    function queueSync() {
        syncQueued = true;
    }

    function topDonors(teamId) {
        return Object.values(state.teams[teamId].donors)
            .sort((a, b) => b.total - a.total)
            .slice(0, TITAN_CONFIG.maxDonorsPerTeam);
    }

    function teamMembers(teamId) {
        return Object.values(state.teams[teamId].members).slice(0, 10);
    }

    function registerMember(teamId, user) {
        if (!user?.id) return;
        const members = state.teams[teamId].members;
        members[user.id] = {
            id: user.id,
            name: user.name || user.nickname || user.id,
            avatar: user.avatar || user.profilePictureUrl || ""
        };
        const keys = Object.keys(members);
        if (keys.length > 30) {
            delete members[keys[0]];
        }
    }

    function updateBar() {
        const r = state.teams.red.score;
        const b = state.teams.blue.score;
        const total = r + b || 1;
        state.bar = Math.max(0.02, Math.min(0.98, b / total));
    }

    function checkInstantWin() {
        const r = state.teams.red.score;
        const b = state.teams.blue.score;
        if (r >= TITAN_CONFIG.winTarget) {
            finishRound("red", "winTarget");
            return true;
        }
        if (b >= TITAN_CONFIG.winTarget) {
            finishRound("blue", "winTarget");
            return true;
        }
        return false;
    }

    function addPower(teamId, power, meta = {}) {
        if (!state.active) return;
        const team = state.teams[teamId];
        team.score = Math.max(0, Math.round(team.score + power));
        updateBar();

        if (meta.donor?.id) {
            const donorId = meta.donor.id;
            const donor = team.donors[donorId] || {
                id: donorId,
                name: meta.donor.name || donorId,
                avatar: meta.donor.avatar || "",
                total: 0,
                gifts: 0
            };
            donor.total += meta.value || Math.max(power, 0);
            donor.gifts += 1;
            donor.name = meta.donor.name || donor.name;
            donor.avatar = meta.donor.avatar || donor.avatar;
            team.donors[donorId] = donor;
        }

        io.emit("titan:push", {
            teamId,
            power,
            meta: {
                type: meta.type || "gift",
                donor: meta.donor || null,
                giftName: meta.giftName || "",
                diamonds: meta.diamonds || 0,
                sabotage: Boolean(meta.sabotage),
                multiplier: meta.multiplier || 1
            }
        });
        emitSync();

        if (!checkInstantWin()) {
            scheduleEnd();
        }
    }

    function getMultipliers(teamId) {
        let multiplier = 1;
        if (comboState.team === teamId) {
            for (const c of TITAN_CONFIG.comboMultipliers) {
                if (comboState.gifts >= c.gifts) multiplier = c.multiplier;
            }
        }
        const my = state.teams[teamId].score;
        const opp = state.teams[opponent(teamId)].score;
        if (my > 0 && opp > my * 1.5) {
            multiplier *= TITAN_CONFIG.catchUpMultiplier;
        }
        if (state.phase === "suddenDeath") {
            multiplier *= TITAN_CONFIG.finalPushMultiplier;
        }
        return multiplier;
    }

    function trackCombo(teamId) {
        const now = Date.now();
        if (comboState.team !== teamId || now > comboState.until) {
            comboState = { team: teamId, gifts: 1, until: now + TITAN_CONFIG.comboWindowMs };
        } else {
            comboState.gifts += 1;
            comboState.until = now + TITAN_CONFIG.comboWindowMs;
        }
    }

    function pickTeam(uid, event) {
        if (allegiance[uid]) return allegiance[uid];

        // Sabotaje/chaos: los regalos de fuego/rayo van al equipo PERDEDOR para provocar caos
        const gift = event.gift || {};
        const isChaos = TITAN_CONFIG.sabotageCategories.includes(gift.category) || (gift.totalDiamonds || 0) >= 1000;
        if (isChaos) {
            const losing = state.teams.red.score <= state.teams.blue.score ? "red" : "blue";
            allegiance[uid] = losing;
            registerMember(losing, event.user);
            io.emit("titan:join", { teamId: losing, user: event.user });
            return losing;
        }
        const random = Math.random() < 0.5 ? "red" : "blue";
        allegiance[uid] = random;
        registerMember(random, event.user);
        io.emit("titan:join", { teamId: random, user: event.user });
        return random;
    }

    function finishRound(winnerId, reason) {
        state.active = false;
        state.phase = "finished";
        const winner = state.teams[winnerId];
        winner.wins += 1;

        const winnerDonors = Object.values(winner.donors).sort((a, b) => b.total - a.total);
        const mvp = winnerDonors[0] || null;
        if (mvp) {
            persistedHOF.mvps.unshift({
                name: mvp.name,
                avatar: mvp.avatar,
                teamId: winnerId,
                diamonds: mvp.total,
                ts: Date.now()
            });
            persistedHOF.mvps = persistedHOF.mvps.slice(0, 20);
        }
        persistedHOF.red = state.teams.red.wins;
        persistedHOF.blue = state.teams.blue.wins;
        hofStorage.save(persistedHOF);

        io.emit("titan:roundEnd", {
            winnerId,
            winnerName: winner.name,
            reason,
            mvp,
            podium: winnerDonors.slice(0, 3),
            red: { score: state.teams.red.score, wins: state.teams.red.wins },
            blue: { score: state.teams.blue.score, wins: state.teams.blue.wins },
            hof: { ...persistedHOF, mvps: persistedHOF.mvps.slice(0, 10) }
        });
        emitSync();

        clearInterval(tickTimer);
        clearTimeout(endTimer);
        clearInterval(flushTimer);
        endTimer = setTimeout(startNewRound, TITAN_CONFIG.resetDelayMs);
    }

    function startNewRound() {
        state = {
            active: true,
            phase: "normal",
            timeRemainingMs: TITAN_CONFIG.roundDurationMs,
            teams: {
                red: { ...TEAMS.red, score: 0, wins: persistedHOF.red || 0, donors: {}, members: {} },
                blue: { ...TEAMS.blue, score: 0, wins: persistedHOF.blue || 0, donors: {}, members: {} }
            },
            charges: { red: 0, blue: 0 },
            bar: 0.5
        };
        allegiance = {};
        comboState = { team: null, gifts: 0, until: 0 };
        announceTimer = 0;
        likeBuffer = { red: { count: 0, donors: [] }, blue: { count: 0, donors: [] } };
        syncQueued = false;
        io.emit("titan:motivate", { phrase: "¡NUEVA BATALLA DE TITANES! Elige bando: escribe ROJO o AZUL en el chat." });
        emitSync();
        startTick();
        startFlush();
    }

    function scheduleEnd() {
        clearTimeout(endTimer);
        endTimer = setTimeout(timeUp, Math.max(state.timeRemainingMs, 0));
    }

    function timeUp() {
        if (!state.active) return;
        clearInterval(tickTimer);
        clearTimeout(endTimer);
        const r = state.teams.red.score;
        const b = state.teams.blue.score;
        if (r === b) {
            state.active = false;
            state.phase = "finished";
            io.emit("titan:motivate", { phrase: "¡EMPATE ÉPICO! Nadie cede. Nueva ronda en segundos." });
            endTimer = setTimeout(startNewRound, TITAN_CONFIG.resetDelayMs);
            return;
        }
        finishRound(r > b ? "red" : "blue", "time");
    }

    function startTick() {
        clearInterval(tickTimer);
        tickTimer = setInterval(() => {
            if (!state.active) return;
            state.timeRemainingMs = Math.max(0, state.timeRemainingMs - 1000);

            if (state.timeRemainingMs <= TITAN_CONFIG.suddenDeathMs && state.phase === "normal") {
                state.phase = "suddenDeath";
                io.emit("titan:motivate", { phrase: "¡EMPUIJE FINAL! Los ultimos 30 segundos valen el DOBLE. ¡Tu regalo decide el destino!" });
            }

            if (state.timeRemainingMs <= 0) {
                timeUp();
                return;
            }

            announceTimer += 1;
            if (announceTimer >= 40) {
                announceTimer = 0;
                const phrase = TITAN_CONFIG.phrases[Math.floor(Math.random() * TITAN_CONFIG.phrases.length)];
                io.emit("titan:motivate", { phrase });
            }

            emitSync();
        }, 1000);
    }

    function startFlush() {
        clearInterval(flushTimer);
        flushTimer = setInterval(() => {
            for (const teamId of ["red", "blue"]) {
                const buf = likeBuffer[teamId];
                if (buf.count > 0) {
                    io.emit("titan:push", {
                        teamId,
                        power: 0,
                        meta: {
                            type: "like",
                            donor: buf.donors[0] || null,
                            likeCount: buf.count
                        }
                    });
                    buf.count = 0;
                    buf.donors = [];
                }
                if (state.charges[teamId] >= TITAN_CONFIG.likeChargeThreshold) {
                    state.charges[teamId] = 0;
                    addPower(teamId, TITAN_CONFIG.likeChargePush, {
                        type: "burst",
                        donor: null,
                        value: 0
                    });
                    io.emit("titan:motivate", {
                        phrase: `¡${state.teams[teamId].short} LIBERA SU CARGA! Los tap tap colectivos empujan la cuerda con furia.`
                    });
                }
            }
            if (syncQueued) {
                syncQueued = false;
                emitSync();
            }
        }, LIKE_FLUSH_MS);
    }

    function start() {
        emitSync();
        startTick();
        scheduleEnd();
        startFlush();
    }

    return {
        syncClient(socket) {
            socket.emit("titan:sync", {
                ...state,
                teams: {
                    red: { ...state.teams.red, donors: topDonors("red"), members: teamMembers("red") },
                    blue: { ...state.teams.blue, donors: topDonors("blue"), members: teamMembers("blue") }
                },
                winTarget: TITAN_CONFIG.winTarget,
                hof: { ...persistedHOF, mvps: persistedHOF.mvps.slice(0, 10) }
            });
        },
        handleTitanGift(event) {
            if (!state.active) return;
            const uid = event.user?.id;
            if (!uid) return;
            const teamId = pickTeam(uid, event);
            const gift = event.gift || {};
            const diamonds = gift.totalDiamonds || 1;
            const donor = {
                id: uid,
                name: event.nickname || event.user?.nickname || uid,
                avatar: event.profilePictureUrl || event.user?.profilePictureUrl || ""
            };
            const multiplier = getMultipliers(teamId);
            trackCombo(teamId);
            const power = Math.max(1, Math.round(diamonds * TITAN_CONFIG.giftPowerPerDiamond * multiplier));
            const isSabotage = TITAN_CONFIG.sabotageCategories.includes(gift.category) || diamonds >= 1000;

            addPower(teamId, power, {
                type: "gift",
                donor,
                giftName: gift.name || "",
                diamonds,
                sabotage: isSabotage,
                multiplier,
                value: diamonds
            });

            if (isSabotage) {
                const backPower = Math.max(1, Math.round(power * 0.4));
                addPower(opponent(teamId), -backPower, {
                    type: "sabotage",
                    donor: null,
                    sabotage: true,
                    multiplier,
                    value: 0
                });
                io.emit("titan:motivate", {
                    phrase: `¡CAOS! ${donor.name} libera la furia de ${gift.name} y empuja al ${state.teams[opponent(teamId)].short} hacia atrás.`
                });
            } else if (diamonds >= 500) {
                io.emit("titan:motivate", {
                    phrase: `¡PODER TOTAL! ${donor.name} dona ${diamonds} diamantes al ${state.teams[teamId].short}. ¡El ${state.teams[teamId].name} avanza con furia!`
                });
            }
        },
        handleTitanLike(event) {
            if (!state.active) return;
            const uid = event.user?.id;
            if (!uid) return;
            let teamId = allegiance[uid];
            if (!teamId) {
                // El primer tap tap también une al bando (sorteo 50/50) para dar pertenencia
                teamId = Math.random() < 0.5 ? "red" : "blue";
                allegiance[uid] = teamId;
                registerMember(teamId, event.user);
                io.emit("titan:join", {
                    teamId,
                    user: {
                        id: uid,
                        name: event.nickname || event.user?.nickname || uid,
                        avatar: event.profilePictureUrl || event.user?.profilePictureUrl || ""
                    }
                });
            }

            // Alta frecuencia: acumular en buffer, el flush de 100ms emite el push consolidado
            const likeCount = event.likeCount || 1;
            const teamBuffer = likeBuffer[teamId];
            teamBuffer.count += likeCount;
            if (teamBuffer.donors.length < 3) {
                teamBuffer.donors.push({
                    id: uid,
                    name: event.nickname || event.user?.nickname || uid,
                    avatar: event.profilePictureUrl || event.user?.profilePictureUrl || ""
                });
            }
            state.charges[teamId] += likeCount;
            queueSync();
        },
        handleTitanChat(event) {
            const text = String(event.comment || "").toLowerCase();
            const uid = event.user?.id;
            if (!uid) return;
            let teamId = null;
            if (text.includes("rojo") || text.includes("red") || text.includes("fuego")) teamId = "red";
            else if (text.includes("azul") || text.includes("blue") || text.includes("agua")) teamId = "blue";
            if (!teamId) return;

            allegiance[uid] = teamId;
            registerMember(teamId, {
                id: uid,
                name: event.nickname || event.user?.nickname || uid,
                avatar: event.profilePictureUrl || event.user?.profilePictureUrl || ""
            });
            io.emit("titan:join", {
                teamId,
                user: {
                    id: uid,
                    name: event.nickname || event.user?.nickname || uid,
                    avatar: event.profilePictureUrl || event.user?.profilePictureUrl || ""
                }
            });
            if (state.active) {
                addPower(teamId, TITAN_CONFIG.chatJoinScore, {
                    type: "chat",
                    donor: null,
                    value: TITAN_CONFIG.chatJoinScore
                });
                io.emit("titan:motivate", {
                    phrase: `${event.nickname || uid} se une al ${state.teams[teamId].name}. ¡La batalla se intensifica!`
                });
            }
        },
        start
    };
}

module.exports = createTitanManager;
