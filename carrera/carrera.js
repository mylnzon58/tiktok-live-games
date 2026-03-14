const socket = io();
const params = new URLSearchParams(window.location.search);
const DEBUG = params.get("debug") === "1";

const state = {
    players: {},
    ranking: [],
    champions: [],
    hallOfFame: [],
    lastRoundWinner: null,
    timer: 90,
    liveStatus: { connected: false, username: "" },
    feed: [],
    audioEnabled: false
};

const elements = {
    body: document.body,
    timer: document.getElementById("timer"),
    timerPill: document.getElementById("timer-pill"),
    statusPill: document.getElementById("status-pill"),
    leaderName: document.getElementById("leader-name"),
    leaderMeta: document.getElementById("leader-meta"),
    rankingList: document.getElementById("ranking-list"),
    trackLanes: document.getElementById("track-lanes"),
    actionFeed: document.getElementById("action-feed"),
    championsList: document.getElementById("champions-list"),
    hofList: document.getElementById("hof-list"),
    lastWinner: document.getElementById("last-winner"),
    winnerOverlay: document.getElementById("winner-overlay"),
    winnerTitle: document.getElementById("winner-title"),
    winnerSubtitle: document.getElementById("winner-subtitle"),
    roundPhase: document.getElementById("round-phase"),
    warningChip: document.getElementById("warning-chip"),
    finishChip: document.getElementById("finish-chip"),
    fxLayer: document.getElementById("fx-layer"),
    audioToggle: document.getElementById("audio-toggle"),
    debugPanel: document.getElementById("debug-panel")
};

const audioState = {
    ctx: null
};

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}

function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const mins = String(Math.floor(safe / 60)).padStart(2, "0");
    const secs = String(safe % 60).padStart(2, "0");
    return `${mins}:${secs}`;
}

function findPlayer(id) {
    return id ? state.players[id] || null : null;
}

function getLeader() {
    const leader = state.ranking[0];
    return leader ? findPlayer(leader.id) || leader : null;
}

function addFeed(message, type = "info") {
    state.feed.unshift({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        message,
        type
    });
    state.feed = state.feed.slice(0, 8);
    renderFeed();
}

function renderFeed() {
    if (!state.feed.length) {
        elements.actionFeed.innerHTML = '<div class="feed-row">Esperando movimiento del chat...</div>';
        return;
    }

    elements.actionFeed.innerHTML = state.feed.map((entry) => `
        <div class="feed-row ${entry.type}">
            ${entry.message}
        </div>
    `).join("");
}

function renderStatus() {
    const label = state.liveStatus.connected
        ? `LIVE conectado @${state.liveStatus.username || ""}`.trim()
        : (state.liveStatus.error || "Esperando LIVE...");
    elements.statusPill.textContent = label;
    elements.statusPill.classList.toggle("live", Boolean(state.liveStatus.connected));
}

function renderTimer() {
    elements.timer.textContent = formatTime(state.timer);
    const warning = state.timer <= 20;
    elements.body.classList.toggle("warning-phase", warning);
    elements.warningChip.textContent = warning ? "Ultimos 20 segundos" : "Power zone";
    if (state.timer <= 15) {
        elements.roundPhase.textContent = "Cierre total";
    } else if (state.timer <= 45) {
        elements.roundPhase.textContent = "Pelea caliente";
    } else {
        elements.roundPhase.textContent = "Tramo inicial";
    }
}

function renderLeader() {
    const leader = getLeader();
    if (!leader) {
        elements.leaderName.textContent = "Esperando corredores";
        elements.leaderMeta.textContent = "Sin datos todavia";
        return;
    }

    elements.leaderName.textContent = leader.name || leader.id;
    const wins = leader.victories || 0;
    const pct = Math.round(leader.progressPct || 0);
    elements.leaderMeta.textContent = `${pct}% de pista · ${wins} victorias`;
}

function renderRanking() {
    if (!state.ranking.length) {
        elements.rankingList.innerHTML = '<div class="ranking-row">Todavia no hay corredores activos.</div>';
        return;
    }

    elements.rankingList.innerHTML = state.ranking.slice(0, 8).map((entry, index) => `
        <div class="ranking-row ${index === 0 ? "leading" : ""}">
            <div class="ranking-badge">${index + 1}</div>
            <div class="ranking-avatar" style="background-image:url('${escapeHtml(entry.avatar || "")}')"></div>
            <div class="ranking-meta">
                <strong>${escapeHtml(entry.name)}</strong>
                <span>${entry.victories || 0} victorias · ${entry.totalGiftDiamonds || 0} diamantes</span>
            </div>
            <div class="ranking-progress">${Math.round(entry.progressPct || 0)}%</div>
        </div>
    `).join("");
}

function renderTrack() {
    const racers = state.ranking.slice(0, 6).map((entry) => findPlayer(entry.id) || entry);
    const emptySlots = Math.max(0, 6 - racers.length);

    const laneMarkup = racers.map((player, index) => {
        const turbo = Date.now() < (player.turboUntil || 0);
        const shielded = Date.now() < (player.shieldUntil || 0);
        const stunned = Date.now() < (player.stunnedUntil || 0);
        const burning = Date.now() < (player.burnUntil || 0);
        const finished = player.state === "FINISHED";
        const power = player.lastEffectLabel || (shielded ? "Escudo" : turbo ? "Turbo" : stunned ? "Golpeado" : burning ? "En fuego" : "En carrera");
        const pct = Math.max(0, Math.min(92, Number(player.progressPct || 0) * 0.92));

        return `
            <div class="lane">
                <div class="lane-info">
                    <div class="lane-avatar" style="background-image:url('${escapeHtml(player.avatar || "")}')"></div>
                    <div class="lane-meta">
                        <strong>${escapeHtml(player.name || player.id)}</strong>
                        <span>Carril ${index + 1} · ${Math.round(player.progress || 0)} m</span>
                    </div>
                </div>
                <div class="lane-track">
                    <div class="lane-progress"></div>
                    <div class="car ${shielded ? "shielded" : ""} ${turbo ? "turbo" : ""} ${stunned ? "stunned" : ""} ${burning ? "burning" : ""} ${finished ? "finished" : ""}"
                        style="transform: translate(calc(${pct}% + 4px), -50%);">
                        <div class="car-body">
                            <div class="car-avatar" style="background-image:url('${escapeHtml(player.avatar || "")}')"></div>
                            <div class="car-name">${escapeHtml(player.name || player.id)}</div>
                            <div class="car-power">${escapeHtml(power)}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    const emptyMarkup = Array.from({ length: emptySlots }).map((_, index) => `
        <div class="lane">
            <div class="lane-info">
                <div class="lane-avatar"></div>
                <div class="lane-meta">
                    <strong>Carril libre</strong>
                    <span>Espera un like o regalo para entrar</span>
                </div>
            </div>
            <div class="lane-track">
                <div class="lane-progress"></div>
            </div>
        </div>
    `).join("");

    elements.trackLanes.innerHTML = laneMarkup + emptyMarkup;
}

function renderChampions() {
    if (!state.champions.length) {
        elements.championsList.innerHTML = '<div class="mini-row">Sin campeones recientes.</div>';
        return;
    }

    elements.championsList.innerHTML = state.champions.slice(0, 6).map((entry, index) => `
        <div class="mini-row">
            <div class="mini-rank">${index + 1}</div>
            <div class="mini-avatar" style="background-image:url('${escapeHtml(entry.avatar || "")}')"></div>
            <div class="mini-meta">
                <strong>${escapeHtml(entry.name)}</strong>
                <span>${entry.victories || 0} victorias</span>
            </div>
        </div>
    `).join("");
}

function renderHallOfFame() {
    if (!state.hallOfFame.length) {
        elements.hofList.innerHTML = '<div class="mini-row">Todavia no hay historial.</div>';
        return;
    }

    elements.hofList.innerHTML = state.hallOfFame.slice(0, 6).map((entry, index) => `
        <div class="mini-row">
            <div class="mini-rank">${index + 1}</div>
            <div class="mini-avatar" style="background-image:url('${escapeHtml(entry.avatar || "")}')"></div>
            <div class="mini-meta">
                <strong>${escapeHtml(entry.name)}</strong>
                <span>${entry.victories || 0} victorias · ${Math.round(entry.bestProgress || 0)} m</span>
            </div>
        </div>
    `).join("");
}

function renderLastWinner() {
    if (!state.lastRoundWinner?.id) {
        elements.lastWinner.textContent = "Todavia no hay ganador de ronda.";
        return;
    }

    const finish = state.lastRoundWinner.finishMs ? ` · meta en ${(state.lastRoundWinner.finishMs / 1000).toFixed(1)} s` : "";
    elements.lastWinner.textContent = `${state.lastRoundWinner.name} gano la ronda con ${Math.round(state.lastRoundWinner.progress || 0)} m${finish}`;
}

function renderAll() {
    renderStatus();
    renderTimer();
    renderLeader();
    renderRanking();
    renderTrack();
    renderChampions();
    renderHallOfFame();
    renderLastWinner();
}

function setEffectClass(kind) {
    elements.body.classList.remove("effect-lightning", "effect-mega", "effect-fire");
    if (!kind) return;
    elements.body.classList.add(`effect-${kind}`);
    window.clearTimeout(setEffectClass.timer);
    setEffectClass.timer = window.setTimeout(() => {
        elements.body.classList.remove(`effect-${kind}`);
    }, 500);
}

function spawnFx(kind = "mega") {
    const burst = document.createElement("div");
    burst.className = `fx-burst ${kind}`;
    burst.style.left = `${20 + Math.random() * 60}%`;
    burst.style.top = `${18 + Math.random() * 64}%`;
    elements.fxLayer.appendChild(burst);
    window.setTimeout(() => burst.remove(), 900);
}

function showWinnerOverlay(winner, reason) {
    if (!winner?.id) return;
    elements.winnerTitle.textContent = `${winner.name} domina la ronda`;
    elements.winnerSubtitle.textContent = reason === "finish"
        ? "Cruzo la meta antes que todos."
        : `Cerro arriba con ${Math.round(winner.progress || 0)} m.`;
    elements.winnerOverlay.classList.remove("hidden");
    window.clearTimeout(showWinnerOverlay.timer);
    showWinnerOverlay.timer = window.setTimeout(() => {
        elements.winnerOverlay.classList.add("hidden");
    }, 2800);
}

function ensureAudioContext() {
    if (!audioState.ctx) {
        audioState.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioState.ctx;
}

function playTone({ frequency = 440, duration = 0.16, type = "sawtooth", volume = 0.04, slideTo = 0 }) {
    if (!state.audioEnabled) return;
    const ctx = ensureAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (slideTo) {
        osc.frequency.linearRampToValueAtTime(slideTo, ctx.currentTime + duration);
    }
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
}

function playGiftSound(category) {
    if (category === "mega") {
        playTone({ frequency: 92, duration: 0.34, type: "sawtooth", volume: 0.09, slideTo: 54 });
        playTone({ frequency: 184, duration: 0.2, type: "triangle", volume: 0.05, slideTo: 140 });
        return;
    }
    if (category === "lightning") {
        playTone({ frequency: 760, duration: 0.12, type: "square", volume: 0.05, slideTo: 420 });
        playTone({ frequency: 980, duration: 0.08, type: "triangle", volume: 0.035, slideTo: 210 });
        return;
    }
    if (category === "fire") {
        playTone({ frequency: 210, duration: 0.24, type: "sawtooth", volume: 0.06, slideTo: 120 });
        return;
    }
    playTone({ frequency: 440, duration: 0.12, type: "triangle", volume: 0.035, slideTo: 520 });
}

function setupDebugPanel() {
    if (!DEBUG) return;
    elements.debugPanel.classList.remove("hidden");
    elements.debugPanel.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-gift]");
        if (!button) return;
        socket.emit("race:debug:gift", {
            giftName: button.dataset.gift,
            diamondCount: Number(button.dataset.diamonds) || 1,
            uniqueId: `debug_${button.dataset.gift.toLowerCase().replace(/\s+/g, "_")}`
        });
    });
}

elements.audioToggle.addEventListener("click", async () => {
    state.audioEnabled = !state.audioEnabled;
    if (state.audioEnabled) {
        const ctx = ensureAudioContext();
        if (ctx.state === "suspended") {
            await ctx.resume();
        }
    }
    elements.audioToggle.textContent = state.audioEnabled ? "Audio activo" : "Activar audio";
    elements.audioToggle.classList.toggle("enabled", state.audioEnabled);
});

socket.on("status", (status) => {
    state.liveStatus = status || state.liveStatus;
    renderStatus();
});

socket.on("race:sync", (players) => {
    state.players = players || {};
    renderAll();
});

socket.on("race:currentRanking", (ranking) => {
    state.ranking = Array.isArray(ranking) ? ranking : [];
    renderAll();
});

socket.on("race:timerUpdate", (seconds) => {
    state.timer = Number(seconds) || 0;
    renderTimer();
});

socket.on("race:lastRoundWinner", (winner) => {
    state.lastRoundWinner = winner || null;
    renderLastWinner();
});

socket.on("race:champions", (entries) => {
    state.champions = Array.isArray(entries) ? entries : [];
    renderChampions();
});

socket.on("race:hallOfFameUpdate", (entries) => {
    state.hallOfFame = Array.isArray(entries) ? entries : [];
    renderHallOfFame();
});

socket.on("race:leaderChanged", (leader) => {
    if (!leader?.id) return;
    addFeed(`<strong>${escapeHtml(leader.name)}</strong> toma la punta del circuito.`, "leader");
    playTone({ frequency: 520, duration: 0.14, type: "triangle", volume: 0.05, slideTo: 780 });
});

socket.on("race:gift", (payload) => {
    const attacker = payload?.attacker?.name || "Alguien";
    const targets = Array.isArray(payload?.targets) ? payload.targets : [];
    const targetText = targets.length
        ? ` contra <strong>${escapeHtml(targets.map((entry) => entry.name).join(", "))}</strong>`
        : "";
    addFeed(
        `<strong>${escapeHtml(attacker)}</strong> lanzo <strong>${escapeHtml(payload.giftName)}</strong>${targetText} · ${escapeHtml(payload.powerLabel || payload.label || "Power-up")}`,
        "gift"
    );
    if (payload?.category === "lightning") {
        setEffectClass("lightning");
        spawnFx("lightning");
    } else if (payload?.category === "fire") {
        setEffectClass("fire");
        spawnFx("fire");
    } else if (payload?.category === "mega") {
        setEffectClass("mega");
        spawnFx("mega");
    } else {
        spawnFx("mega");
    }
    playGiftSound(payload?.category);
});

socket.on("race:like", (payload) => {
    if (!payload?.player?.id) return;
    addFeed(
        `<strong>${escapeHtml(payload.player.name)}</strong> empuja con ${payload.likeCount} likes · +${Math.round(payload.progressGain || 0)} m`,
        "like"
    );
    if (payload.turboUntil) {
        playTone({ frequency: 620, duration: 0.14, type: "triangle", volume: 0.04, slideTo: 780 });
    }
});

socket.on("race:chatBoost", (payload) => {
    if (!payload?.player?.id) return;
    addFeed(
        `<strong>${escapeHtml(payload.player.name)}</strong> activa ${escapeHtml(payload.keyword)} desde el chat.`,
        "chat"
    );
});

socket.on("race:roundEnd", (payload) => {
    showWinnerOverlay(payload?.winner, payload?.reason);
    if (payload?.winner?.id) {
        addFeed(`<strong>${escapeHtml(payload.winner.name)}</strong> gana la ronda.`, "winner");
    }
});

socket.on("race:leave", ({ id }) => {
    if (!id) return;
    delete state.players[id];
    state.ranking = state.ranking.filter((entry) => entry.id !== id);
    renderAll();
});

renderAll();
setupDebugPanel();
elements.finishChip.textContent = "Meta: 2200 m";
