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
            avatar: "milei_face.png",
            color: "#6d28d9",
            score: 0,
            wins: 0
        },
        {
            id: "cristina",
            name: "CRISTINA K.",
            keywords: ["cristina", "cfk", "kirchner", "kuka", "jefa", "peron", "evita", "voto k", "voto cristina"],
            avatar: "cristina_face.png",
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

    let announceTimer = 0;
    let userAllegiance = {}; // uniqueId -> fighterId
    const phrases = [
        "¿Quién es más patriota? ¡Escribe Milei o Cristina en el chat para sumar puntos!",
        "¡La batalla está muy pareja! Tap tap en la pantalla para apoyar a tu candidato.",
        "Manda rosas o envía regalos grandes para destruir la barra del rival.",
        "¡Vamos equipo! Escriban su favorito en el chat para ganar esta ronda."
    ];

    function startNewRound() {
        state.fighters.forEach(f => f.score = 0);
        state.endTime = Date.now() + VERSUS_CONFIG.roundDurationMs;
        state.active = true;
        announceTimer = 0;
        io.emit("versus:sync", state);
        io.emit("versus:motivate", { phrase: "¡Nueva ronda iniciada! ¿Quién ganará? Voten en el chat ahora." });
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
        } else {
            announceTimer++;
            if (announceTimer >= 45) { // Cada 45 segundos
                announceTimer = 0;
                const rPhrase = phrases[Math.floor(Math.random() * phrases.length)];
                io.emit("versus:motivate", { phrase: rPhrase });
            }
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
            const uid = event.uniqueId;
            const displayName = event.nickname || event.uniqueId || "Fan";
            const avatar = event.profilePictureUrl || event.user?.profilePictureUrl || "https://p16-amd-va.tiktokcdn.com/img/musically-maliva-obj/1594805258216453~c5_720x720.jpeg";
            for (const f of state.fighters) {
                for (const kw of f.keywords) {
                    if (text.includes(kw)) {
                        userAllegiance[uid] = f.id;
                        addScore(f.id, VERSUS_CONFIG.chatScore, { username: displayName, avatar, emoji: "💬", type: 'chat' });
                        return;
                    }
                }
            }
        },
        handleVersusLike(event) {
            const uid = event.uniqueId;
            const fighterId = userAllegiance[uid]; // Solo suma si ya eligieron bando
            if (!fighterId) return; // Si dan tap sin poner favorito, NO cuenta

            const displayName = event.nickname || event.uniqueId || "Fan";
            const avatar = event.profilePictureUrl || event.user?.profilePictureUrl || "https://p16-amd-va.tiktokcdn.com/img/musically-maliva-obj/1594805258216453~c5_720x720.jpeg";
            addScore(fighterId, 10, { username: displayName, avatar, emoji: "❤️", type: 'like' });
        },
        handleVersusGift(event) {
            const giftName = event.gift?.name || "Gift";
            const diamonds = event.gift?.totalDiamonds || 1;
            const score = diamonds * VERSUS_CONFIG.giftMultiplier;
            const comment = (event.comment || "").toLowerCase();
            const uid = event.uniqueId;
            const displayName = event.nickname || event.uniqueId || "Donor";
            const avatar = event.profilePictureUrl || event.user?.profilePictureUrl || "https://p16-amd-va.tiktokcdn.com/img/musically-maliva-obj/1594805258216453~c5_720x720.jpeg";
            
            // Prioridad: 1. Comentario del regalo, 2. Lealtad previa, 3. Ignorar o Aleatorio (usamos Aleatorio para no perder plata)
            let fighterId = null;
            for (const f of state.fighters) {
                for (const kw of f.keywords) {
                    if (comment.includes(kw)) { fighterId = f.id; break; }
                }
            }
            if (!fighterId) fighterId = userAllegiance[uid];
            if (!fighterId) fighterId = state.fighters[Math.floor(Math.random() * 2)].id;

            addScore(fighterId, score, { 
                username: displayName, 
                avatar, 
                emoji: GIFT_EMOJIS[giftName] || "🎁",
                diamonds,
                type: 'gift'
            });
            
            // TTS de regalo
            const fName = state.fighters.find(f => f.id === fighterId)?.name || "su equipo";
            if (diamonds >= 500) {
                io.emit("versus:motivate", { phrase: `¡Uf! ¡${displayName} acaba de enviar un regalo increíble para apoyar a ${fName}!` });
            } else if (diamonds >= 100) {
                io.emit("versus:motivate", { phrase: `¡Genial! ${displayName} apoya fuertemente a ${fName} con su donación.` });
            } else {
                if (Math.random() > 0.8) io.emit("versus:motivate", { phrase: `Gracias ${displayName} por apoyar a ${fName}.` });
            }
        }
    };
}

module.exports = createVersusManager;
