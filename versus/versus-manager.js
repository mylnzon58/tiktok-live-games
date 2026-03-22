const VERSUS_CONFIG = {
    roundDurationMs: 3 * 60 * 1000,
    resetDelayMs: 10000,
    chatScore: 100,
    giftMultiplier: 1000,
    fighters: [
        {
            id: "milei",
            name: "JAVIER MILEI",
            keywords: ["milei", "leon", "libertad", "lla", "peluca", "viva la libertad", "vllc", "voto milei"],
            // Local 100% Reliable Image
            avatar: "/milei_face.png",
            color: "#6d28d9",
            score: 0,
            wins: 0
        },
        {
            id: "cristina",
            name: "CRISTINA K.",
            keywords: ["cristina", "cfk", "kirchner", "kuka", "jefa", "peron", "evita", "voto k", "voto cristina"],
            // Local 100% Reliable Image
            avatar: "/cristina_face.png",
            color: "#0ea5e9",
            score: 0,
            wins: 0
        }
    ]
};

const GIFT_EMOJIS = {
    "Rose": "🌹", "Doughnut": "🍩", "Lion": "🦁", "Universe": "🌌",
    "TikTok": "🎶", "Finger Heart": "🫰", "Money Gun": "🔫", "Interstellar": "🚀",
    "defaults": "🎁"
};

function createVersusManager(io) {
    let state = {
        active: true,
        endTime: Date.now() + VERSUS_CONFIG.roundDurationMs,
        fighters: JSON.parse(JSON.stringify(VERSUS_CONFIG.fighters))
    };

    function startNewRound() {
        state.fighters.forEach(f => f.score = 0);
        state.endTime = Date.now() + VERSUS_CONFIG.roundDurationMs;
        state.active = true;
        io.emit("versus:sync", state);
    }

    setInterval(() => {
        if (!state.active) return;
        if (Date.now() >= state.endTime) {
            state.active = false;
            const f1 = state.fighters[0];
            const f2 = state.fighters[1];
            let winnerIds = [];
            if (f1.score > f2.score) { winnerIds = [f1.id]; f1.wins++; }
            else if (f2.score > f1.score) { winnerIds = [f2.id]; f2.wins++; }
            else { winnerIds = [f1.id, f2.id]; }

            io.emit("versus:end", { winnerIds, state });
            setTimeout(startNewRound, VERSUS_CONFIG.resetDelayMs);
        }
    }, 1000);

    function addScore(fighterId, amount, supporter) {
        if (!state.active) return;
        const f = state.fighters.find(x => x.id === fighterId);
        if (f) {
            f.score += amount;
            io.emit("versus:sync", state);
            io.emit("versus:support", { ...supporter, fighterId });
        }
    }

    return {
        syncClient(socket) {
            socket.emit("versus:sync", state);
        },
        handleVersusChat(event) {
            const text = (event.comment || "").toLowerCase();
            for (const f of state.fighters) {
                for (const kw of f.keywords) {
                    if (text.includes(kw)) {
                        addScore(f.id, VERSUS_CONFIG.chatScore, { username: event.user?.name || "Fan", avatar: event.user?.avatar, emoji: "💬" });
                        return;
                    }
                }
            }
        },
        handleVersusLike(event) {
            const losingFighter = state.fighters[0].score < state.fighters[1].score ? state.fighters[0] : state.fighters[1];
            addScore(losingFighter.id, 10, { username: event.user?.name || "Fan", avatar: event.user?.avatar, emoji: "❤️" });
        },
        handleVersusGift(event) {
            const giftName = event.gift?.name || "Gift";
            const diamonds = event.gift?.totalDiamonds || 1;
            const score = diamonds * VERSUS_CONFIG.giftMultiplier;
            const comment = (event.comment || "").toLowerCase();
            let fighterId = state.fighters[Math.floor(Math.random() * 2)].id;
            for (const f of state.fighters) {
                for (const kw of f.keywords) {
                    if (comment.includes(kw)) { fighterId = f.id; break; }
                }
            }
            addScore(fighterId, score, { 
                username: event.user?.name || "Donor", 
                avatar: event.user?.avatar, 
                emoji: GIFT_EMOJIS[giftName] || "🎁",
                diamonds
            });
        }
    };
}

module.exports = createVersusManager;
