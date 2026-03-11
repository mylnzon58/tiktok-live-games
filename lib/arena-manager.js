const fs = require("fs");
const path = require("path");

function createArenaManager(io) {
    let arenaPlayers = {};
    let arenaHallOfFame = {};
    let lastArenaWinnerId = null;

    const HOF_FILE = path.join(__dirname, "..", "arena_hof.json");

    function saveHOF() {
        try {
            fs.writeFileSync(HOF_FILE, JSON.stringify(arenaHallOfFame));
        } catch (e) {
            console.error("❌ Error saving HOF:", e.message);
        }
    }

    function loadHOF() {
        if (fs.existsSync(HOF_FILE)) {
            try {
                arenaHallOfFame = JSON.parse(fs.readFileSync(HOF_FILE));
                console.log(`📜 HOF cargado desde disco: ${Object.keys(arenaHallOfFame).length} jugadores`);
            } catch (err) {
                arenaHallOfFame = {};
            }
        }
    }

    loadHOF();

    return {
        getPlayers: () => arenaPlayers,
        getHOF: () => arenaHallOfFame,
        getLastWinnerId: () => lastArenaWinnerId,
        setLastWinnerId: (val) => { lastArenaWinnerId = val; },

        initOrUpdatePlayer: (userData) => {
            const id = userData.uniqueId || userData.userId;
            if (!id) return null;

            if (!arenaPlayers[id]) {
                // Cargar desde HOF si existe
                if (arenaHallOfFame[id]) {
                    arenaPlayers[id] = { ...arenaHallOfFame[id], hp: 500, lastActive: Date.now() };
                    console.log(`🏰 RE-ENTRY HOF: @${id} volvió con ${arenaPlayers[id].victories} victorias.`);
                } else {
                    arenaPlayers[id] = {
                        id: id,
                        name: userData.nickname || id,
                        avatar: userData.profilePictureUrl || "",
                        score: 0,
                        hp: 500,
                        x: Math.random() * 800 + 100,
                        y: Math.random() * 400 + 100,
                        lastActive: Date.now(),
                        victories: 0,
                        comboCount: 0,
                        lastGiftTime: 0
                    };
                }
            } else {
                arenaPlayers[id].lastActive = Date.now();
                if (userData.profilePictureUrl) arenaPlayers[id].avatar = userData.profilePictureUrl;
            }
            return arenaPlayers[id];
        },

        updateHOF: (player) => {
            if (!player || !player.id) return;
            arenaHallOfFame[player.id] = {
                id: player.id,
                name: player.name,
                avatar: player.avatar,
                score: player.score,
                victories: player.victories || 0,
                lastActive: Date.now()
            };
            saveHOF();
        },

        resetScores: () => {
            for (const id in arenaPlayers) {
                if (!arenaHallOfFame[id]) {
                    arenaPlayers[id].score = 0;
                    arenaPlayers[id].comboCount = 0;
                }
            }
        },

        cleanup: (TWELVE_HOURS_MS) => {
            const now = Date.now();
            let changed = false;

            // Limpiar HOF
            for (const id in arenaHallOfFame) {
                if (now - arenaHallOfFame[id].lastActive > TWELVE_HOURS_MS) {
                    delete arenaHallOfFame[id];
                    changed = true;
                    console.log(`📜 HOF CLEANUP: Removido ${id} por antigüedad`);
                }
            }
            if (changed) saveHOF();

            // Limpiar jugadores AFK
            const playerIds = Object.keys(arenaPlayers);
            if (playerIds.length === 0) return false;

            let arenaChanged = false;
            for (const id in arenaPlayers) {
                const p = arenaPlayers[id];
                const idleTime = now - p.lastActive;
                const isKing = !!arenaHallOfFame[id];

                let shouldRemove = false;
                if (playerIds.length > 50) {
                    if (!isKing && idleTime > 120000) shouldRemove = true;
                    else if (isKing && idleTime > 1800000) shouldRemove = true;
                } else {
                    if (!isKing && idleTime > 120000) shouldRemove = true;
                }

                if (shouldRemove) {
                    delete arenaPlayers[id];
                    arenaChanged = true;
                    io.emit("arena:leave", { id });
                }
            }
            return arenaChanged || changed;
        }
    };
}

module.exports = { createArenaManager };
