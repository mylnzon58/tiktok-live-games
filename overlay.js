// ============================================================
// TikTok LIVE Countries Ranking — Overlay Client
// ============================================================

const socket = io();

// ──────────────────────────────────────────────────────────────
// Estado
// ──────────────────────────────────────────────────────────────
let countriesData = {};
let previousScores = {};
let maxScore = 0;
const ROUND_DURATION = 7 * 60;
const MAX_VISIBLE = 20;
let elapsedSeconds = 0;
let elapsedInterval = null;

// ──────────────────────────────────────────────────────────────
// Inicialización
// ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    createStars();
    createParticles();
    startReactionLoop();
    startElapsed();
});

// ──────────────────────────────────────────────────────────────
// Elapsed timer (tiempo transcurrido)
// ──────────────────────────────────────────────────────────────
function startElapsed() {
    elapsedSeconds = 0;
    clearInterval(elapsedInterval);
    elapsedInterval = setInterval(() => {
        elapsedSeconds++;
        const h = Math.floor(elapsedSeconds / 3600);
        const m = Math.floor((elapsedSeconds % 3600) / 60);
        const s = elapsedSeconds % 60;
        const el = document.getElementById("timer-elapsed");
        if (el) {
            el.textContent =
                String(h).padStart(2, "0") + ":" +
                String(m).padStart(2, "0") + ":" +
                String(s).padStart(2, "0");
        }
    }, 1000);
}

// ──────────────────────────────────────────────────────────────
// Estrellas de fondo
// ──────────────────────────────────────────────────────────────
function createStars() {
    const container = document.getElementById("stars-container");
    for (let i = 0; i < 200; i++) {
        const star = document.createElement("div");
        star.className = "star";
        star.style.left = Math.random() * 100 + "%";
        star.style.top = Math.random() * 100 + "%";
        star.style.setProperty("--dur", (2 + Math.random() * 4) + "s");
        star.style.animationDelay = Math.random() * 4 + "s";
        const size = 1 + Math.random() * 3;
        star.style.width = size + "px";
        star.style.height = size + "px";
        container.appendChild(star);
    }
}

// ──────────────────────────────────────────────────────────────
// Partículas flotantes
// ──────────────────────────────────────────────────────────────
function createParticles() {
    const container = document.getElementById("particles-container");
    const colors = [
        "rgba(0, 240, 255, 0.12)",
        "rgba(168, 85, 247, 0.1)",
        "rgba(236, 72, 153, 0.08)",
        "rgba(251, 191, 36, 0.06)",
    ];
    for (let i = 0; i < 25; i++) {
        const p = document.createElement("div");
        p.className = "particle";
        const size = 4 + Math.random() * 16;
        p.style.width = size + "px";
        p.style.height = size + "px";
        p.style.left = Math.random() * 100 + "%";
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.setProperty("--dur", (12 + Math.random() * 20) + "s");
        p.style.animationDelay = Math.random() * 15 + "s";
        container.appendChild(p);
    }
}

// ──────────────────────────────────────────────────────────────
// Reacciones flotantes
// ──────────────────────────────────────────────────────────────
const REACTION_EMOJIS = ["❤️", "🔥", "⭐", "💎", "🎉", "✨", "💜", "🌟"];

function startReactionLoop() {
    setInterval(() => {
        if (maxScore > 0) spawnReaction();
    }, 3500);
}

function spawnReaction(emoji) {
    const container = document.getElementById("reactions-container");
    const el = document.createElement("div");
    el.className = "reaction";
    el.textContent = emoji || REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
    el.style.left = Math.random() * 50 + "px";
    el.style.setProperty("--dur", (3 + Math.random() * 3) + "s");
    container.appendChild(el);
    setTimeout(() => el.remove(), 6000);
}

// ──────────────────────────────────────────────────────────────
// Formatear score — con decimales como la referencia
// ──────────────────────────────────────────────────────────────
function formatScore(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + "M";
    if (n >= 100000) return (n / 1000).toFixed(1) + "K";
    return n.toLocaleString("es");
}

// ──────────────────────────────────────────────────────────────
// Timer
// ──────────────────────────────────────────────────────────────
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

socket.on("timerUpdate", (seconds) => {
    const timerEl = document.getElementById("timer");
    const barEl = document.getElementById("timer-progress");

    timerEl.textContent = formatTime(seconds);

    const pct = (seconds / ROUND_DURATION) * 100;
    barEl.style.width = pct + "%";

    timerEl.classList.remove("warning", "critical");
    if (seconds <= 30) {
        timerEl.classList.add("critical");
    } else if (seconds <= 60) {
        timerEl.classList.add("warning");
    }

    // Actualizar escala dinámica
    updateScaleLabels();
});

function updateScaleLabels() {
    const labels = document.getElementById("scale-labels");
    if (!labels) return;
    if (maxScore <= 0) {
        labels.innerHTML = "<span>0</span><span>500</span><span>1K</span>";
    } else {
        const half = Math.round(maxScore / 2);
        labels.innerHTML =
            "<span>0</span>" +
            "<span>" + formatScore(half) + "</span>" +
            "<span>" + formatScore(maxScore) + "</span>";
    }
}

// ──────────────────────────────────────────────────────────────
// Ranking Update
// ──────────────────────────────────────────────────────────────
socket.on("rankingUpdate", (countries) => {
    countriesData = countries;
    renderRanking(countries);
});

function renderRanking(countries) {
    const container = document.getElementById("ranking-container");
    const emptyEl = document.getElementById("ranking-empty");

    // Solo mostrar países con score > 0
    const sorted = Object.entries(countries)
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, MAX_VISIBLE);

    // Mostrar/ocultar estado vacío
    if (emptyEl) {
        emptyEl.classList.toggle("hidden", sorted.length > 0);
    }

    if (sorted.length === 0) {
        // Limpiar filas
        const existingRows = container.querySelectorAll(".rank-row");
        existingRows.forEach((r) => r.remove());
        maxScore = 0;
        previousScores = {};
        return;
    }

    maxScore = sorted[0][1].score;
    if (maxScore === 0) maxScore = 1;

    updateScaleLabels();

    // Construir/actualizar filas
    const existingRows = container.querySelectorAll(".rank-row");
    const existingMap = {};
    existingRows.forEach((row) => {
        existingMap[row.dataset.code] = row;
    });

    const fragment = document.createDocumentFragment();
    const usedCodes = new Set();

    sorted.forEach(([code, data], index) => {
        usedCodes.add(code);
        const pos = index + 1;
        const isLeader = pos === 1;
        const barPct = Math.max((data.score / maxScore) * 100, 3);
        const colorClass = isLeader ? "bar-leader" : "bar-c" + (index % 20);
        const prevScore = previousScores[code] || 0;
        const scoreDiff = data.score - prevScore;
        const avatars = data.avatars || [];

        let row = existingMap[code];

        if (!row) {
            row = document.createElement("div");
            row.className = "rank-row new-entry";
            row.dataset.code = code;
        } else {
            row.classList.remove("new-entry");
        }

        // Construir avatares HTML
        let avatarsHTML = "";
        if (avatars.length > 0) {
            avatars.slice(0, 3).forEach((url, i) => {
                avatarsHTML += `<div class="rank-avatar" style="left:${i * 18}px; z-index:${5 - i}">
          <img src="${url}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove();" />
        </div>`;
            });
        } else {
            avatarsHTML = `<div class="rank-avatar placeholder" style="left:0">${data.flag}</div>`;
        }

        // Posición class
        let posClass = "rank-pos";
        if (pos === 1) posClass += " p1";
        else if (pos === 2) posClass += " p2";
        else if (pos === 3) posClass += " p3";

        row.innerHTML = `
      <div class="${posClass}">${pos}.</div>
      <div class="rank-avatars" style="width:${Math.min(avatars.length, 3) * 18 + 20}px">
        ${avatarsHTML}
      </div>
      <div class="rank-code">${code}</div>
      <div class="rank-bar-wrap">
        <div class="rank-bar-outer">
          <div class="rank-bar-fill ${colorClass}" style="width:${barPct}%"></div>
        </div>
      </div>
      <div class="rank-flag">${data.flag}</div>
      <div class="rank-score${isLeader ? ' leader-score' : ''}">${formatScore(data.score)}</div>
    `;

        // Corona
        const existingCrown = row.querySelector(".rank-crown");
        if (isLeader && !existingCrown) {
            const crown = document.createElement("div");
            crown.className = "rank-crown";
            crown.textContent = "👑";
            row.appendChild(crown);
        } else if (!isLeader && existingCrown) {
            existingCrown.remove();
        }

        // Score popup
        if (scoreDiff > 0 && prevScore > 0) {
            const popup = document.createElement("div");
            popup.className = "score-popup";
            popup.textContent = "+" + formatScore(scoreDiff);
            row.appendChild(popup);
            setTimeout(() => popup.remove(), 1500);

            row.classList.add("flash");
            setTimeout(() => row.classList.remove("flash"), 500);

            spawnReaction("💎");
        }

        fragment.appendChild(row);
    });

    // Remover filas que salieron del ranking
    existingRows.forEach((row) => {
        if (!usedCodes.has(row.dataset.code)) row.remove();
    });

    // Reordenar
    // Remover filas actuales y agregar en orden
    const rows = container.querySelectorAll(".rank-row");
    rows.forEach((r) => r.remove());
    container.appendChild(fragment);

    // Guardar scores
    previousScores = {};
    Object.entries(countries).forEach(([code, data]) => {
        previousScores[code] = data.score;
    });
}

// ──────────────────────────────────────────────────────────────
// Leader Changed
// ──────────────────────────────────────────────────────────────
socket.on("leaderChanged", (leader) => {
    const overlay = document.getElementById("leader-change-overlay");
    document.getElementById("leader-flag-mega").textContent = leader.flag;
    document.getElementById("leader-name-mega").textContent = leader.name || leader.code;
    document.getElementById("leader-score-mega").textContent = formatScore(leader.score) + " 💎";

    overlay.classList.remove("hidden");
    overlay.classList.add("visible");

    setTimeout(() => {
        overlay.classList.remove("visible");
        overlay.classList.add("hidden");
    }, 3000);

    for (let i = 0; i < 8; i++) {
        setTimeout(() => spawnReaction("👑"), i * 200);
    }
});

// ──────────────────────────────────────────────────────────────
// Big Gift Effect
// ──────────────────────────────────────────────────────────────
socket.on("bigGift", (data) => {
    const overlay = document.getElementById("big-gift-overlay");
    const avatarEl = document.getElementById("big-gift-avatar");

    if (data.avatarUrl) {
        avatarEl.innerHTML = `<img src="${data.avatarUrl}" alt="avatar" />`;
    } else {
        avatarEl.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:44px;">${data.flag}</div>`;
    }

    document.getElementById("big-gift-username").textContent = "@" + data.username;
    document.getElementById("big-gift-amount").textContent = formatScore(data.coins) + " 💎";
    document.getElementById("big-gift-country").textContent = data.flag;

    overlay.classList.remove("hidden");
    overlay.classList.add("visible");
    setTimeout(() => {
        overlay.classList.remove("visible");
        overlay.classList.add("hidden");
    }, 3000);

    document.body.style.boxShadow = "inset 0 0 150px rgba(251, 191, 36, 0.3)";
    setTimeout(() => { document.body.style.boxShadow = "none"; }, 500);

    for (let i = 0; i < 10; i++) {
        setTimeout(() => spawnReaction("💥"), i * 150);
    }
});

// ──────────────────────────────────────────────────────────────
// Round Reset
// ──────────────────────────────────────────────────────────────
socket.on("roundReset", (data) => {
    const overlay = document.getElementById("round-reset-overlay");

    if (data.winner) {
        document.getElementById("winner-flag").textContent = data.winner.flag;
        document.getElementById("winner-name").textContent = (data.winner.name || data.winner.code);
        document.getElementById("winner-score").textContent = formatScore(data.winner.score) + " 💎";
    } else {
        document.getElementById("winner-flag").textContent = "🏁";
        document.getElementById("winner-name").textContent = "Sin ganador";
        document.getElementById("winner-score").textContent = "";
    }

    overlay.classList.remove("hidden");
    overlay.classList.add("visible");
    setTimeout(() => {
        overlay.classList.remove("visible");
        overlay.classList.add("hidden");
    }, 4000);

    previousScores = {};
    elapsedSeconds = 0;

    for (let i = 0; i < 10; i++) {
        setTimeout(() => spawnReaction("🎉"), i * 200);
    }
});

// ──────────────────────────────────────────────────────────────
// Estado de conexión
// ──────────────────────────────────────────────────────────────
socket.on("status", (data) => {
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-text");
    if (data.connected) {
        dot.className = "connected";
        text.textContent = "EN VIVO — @" + data.username;
    } else if (data.streamEnded) {
        dot.className = "disconnected";
        text.textContent = "Stream finalizado";
    } else {
        dot.className = "disconnected";
        text.textContent = "Reconectando...";
    }
});

socket.on("connect", () => console.log("✅ Overlay conectado"));
socket.on("disconnect", () => {
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-text");
    dot.className = "disconnected";
    text.textContent = "Sin conexión al servidor";
});
