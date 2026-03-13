// ============================================================
// TikTok LIVE Countries Ranking — Overlay Client
// ============================================================

const socket = io();

// ──────────────────────────────────────────────────────────────
// Estado
// ──────────────────────────────────────────────────────────────
let previousScores = {};
let maxScore = 0;
const ROUND_DURATION = 7 * 60;
const MAX_VISIBLE = 20;
let elapsedSeconds = 0;
let elapsedInterval = null;
let latestCountries = {};
let lastVoiceAt = 0;
let lastJoinVoiceAt = 0;
let lastGiftVoiceAt = 0;
let lastLikeVoiceAt = 0;
let lastPromptVoiceAt = 0;
let speechQueue = [];
let speechBusy = false;

// ──────────────────────────────────────────────────────────────
// 🔊 Sistema de Sonido (Web Audio API)
// ──────────────────────────────────────────────────────────────
let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

// Desbloqueo agresivo para iOS/Safari
['click', 'touchstart', 'mousedown'].forEach(evt => {
    document.addEventListener(evt, () => {
        tryUnlockAudio();
    }, { once: true });
});

function tryUnlockAudio() {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
            if (!bgmStarted) {
                playBackgroundMusic();
                bgmStarted = true;
            }
        });
    } else {
        if (!bgmStarted) {
            playBackgroundMusic();
            bgmStarted = true;
        }
    }
}

// Revisar contínuamente si ya está running (OBS / TikTok Studio)
let ctxUnlocker = setInterval(() => {
    const ctx = getAudioCtx();
    if (ctx.state === 'running') {
        clearInterval(ctxUnlocker);
        if (!bgmStarted) {
            playBackgroundMusic();
            bgmStarted = true;
        }
    } else {
        ctx.resume().catch(() => { });
    }
}, 1000);

let bgmStarted = false;
function playBackgroundMusic() {
    const ctx = getAudioCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.2; // Aumentado de 0.08 a 0.2 (250% más fuerte)
    masterGain.connect(ctx.destination);

    const notes = [
        392.00, 392.00, 440.00, 392.00, 523.25, 493.88, // G4 G4 A4 G4 C5 B4
        392.00, 392.00, 440.00, 392.00, 587.33, 523.25, // G4 G4 A4 G4 D5 C5
        392.00, 392.00, 783.99, 659.25, 523.25, 493.88, 440.00, // G4 G4 G5 E5 C5 B4 A4
        698.46, 698.46, 659.25, 523.25, 587.33, 523.25  // F5 F5 E5 C5 D5 C5
    ];
    let step = 0;

    function nextStep() {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = (step % 4 === 0) ? 'square' : 'triangle';
        osc.frequency.setValueAtTime(notes[step % notes.length], now);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.2, now + 0.02);
        g.gain.linearRampToValueAtTime(0, now + 0.2);
        osc.connect(g).connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.2);
        step++;
        setTimeout(nextStep, 200); // More energetic tempo
    }
    nextStep();
}

// Sonido: regalo normal (cha-ching moneda)
function playCoinSound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    // Nota aguda tipo moneda
    [1200, 1600, 2000].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.15, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.15);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.15);
    });
}

// Sonido: regalo grande (fanfarria épica)
function playBigGiftSound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const notes = [523, 659, 784, 1047, 1319, 1568];
    notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.12, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.3);
    });
    // Sub bass boom
    const bass = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bass.type = 'sine';
    bass.frequency.setValueAtTime(80, now);
    bass.frequency.exponentialRampToValueAtTime(40, now + 0.5);
    bassGain.gain.setValueAtTime(0.3, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    bass.connect(bassGain).connect(ctx.destination);
    bass.start(now);
    bass.stop(now + 0.5);
}

// Sonido: cambio de líder (trompetas triunfantes)
function playLeaderSound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const melody = [
        { f: 523, t: 0, d: 0.15 },
        { f: 659, t: 0.15, d: 0.15 },
        { f: 784, t: 0.3, d: 0.15 },
        { f: 1047, t: 0.45, d: 0.4 },
    ];
    melody.forEach(({ f, t, d }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, now + t);
        gain.gain.setValueAtTime(0.08, now + t);
        gain.gain.setValueAtTime(0.08, now + t + d * 0.7);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + d);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + t);
        osc.stop(now + t + d);
    });
}

// Sonido: victoria de ronda
function playVictorySound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const fanfare = [
        { f: 392, t: 0, d: 0.2 },
        { f: 523, t: 0.2, d: 0.2 },
        { f: 659, t: 0.4, d: 0.2 },
        { f: 784, t: 0.6, d: 0.15 },
        { f: 1047, t: 0.75, d: 0.5 },
    ];
    fanfare.forEach(({ f, t, d }) => {
        ['sawtooth', 'square'].forEach((type, ti) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(f * (ti === 1 ? 1.005 : 1), now + t);
            gain.gain.setValueAtTime(0.06, now + t);
            gain.gain.exponentialRampToValueAtTime(0.001, now + t + d);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + t);
            osc.stop(now + t + d);
        });
    });
}

// Sonido: warning del timer
function playTickSound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
}

// Sonido: subida de ranking (whoosh ascendente)
function playRankUpSound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.2);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
}

function speakOverlay(text, { minGapMs = 4500, priority = false } = {}) {
    if (!("speechSynthesis" in window) || !text) return;
    const now = Date.now();
    if (!priority && now - lastVoiceAt < minGapMs) return;
    lastVoiceAt = now;
    if (priority) {
        speechQueue.unshift(text);
    } else {
        speechQueue.push(text);
    }
    flushSpeechQueue();
}

function flushSpeechQueue() {
    if (speechBusy || !speechQueue.length || !("speechSynthesis" in window)) return;
    const text = speechQueue.shift();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 1.06;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    speechBusy = true;
    utterance.onend = utterance.onerror = () => {
        speechBusy = false;
        setTimeout(flushSpeechQueue, 250);
    };
    window.speechSynthesis.speak(utterance);
}

// ──────────────────────────────────────────────────────────────
// Inicialización
// ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    createStars();
    createParticles();
    startReactionLoop();
    startElapsed();
    setTimeout(() => {
        speakOverlay("Escribe tu país en el chat para entrar. Tap tap suma a tu barra. Los regalos empujan fuerte a tu país.", { priority: true, minGapMs: 0 });
    }, 1200);
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

// 💎 LLUVIA DE DIAMANTES (NEUROMARKETING)
function spawnDiamondRain() {
    const container = document.body;
    const count = 50;
    const emojis = ["💎", "✨", "👑", "❤️"];

    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const d = document.createElement("div");
            d.className = "diamond-rain";
            d.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            d.style.left = Math.random() * 100 + "vw";
            d.style.fontSize = (20 + Math.random() * 30) + "px";
            d.style.setProperty("--dur", (1.5 + Math.random() * 2) + "s");
            d.style.opacity = 0.8 + Math.random() * 0.2;
            container.appendChild(d);
            setTimeout(() => d.remove(), 4000);
        }, i * 40);
    }
}

function triggerScreenShake(intensity = 15) {
    const overlay = document.getElementById("overlay");
    overlay.style.animation = `none`;
    overlay.offsetHeight; // trigger reflow
    overlay.style.animation = `screenShakeOverlay 0.5s ease-out`;
    overlay.style.transform = `translate3d(${Math.round(intensity / 3)}px, 0, 0)`;
    setTimeout(() => {
        overlay.style.transform = "";
    }, 500);
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
        if (seconds > 0 && seconds % 2 === 0) playTickSound();
    } else if (seconds <= 60) {
        timerEl.classList.add("warning");
        if (seconds % 5 === 0) playTickSound();
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

function getGiftAccent(giftName = "") {
    const lower = String(giftName).toLowerCase();
    if (lower.includes("rose") || lower.includes("rosa")) return "🌹";
    if (lower.includes("capy") || lower.includes("capib")) return "🦫";
    if (lower.includes("ice")) return "🍦";
    if (lower.includes("donut") || lower.includes("dona")) return "🍩";
    if (lower.includes("fire")) return "🎆";
    if (lower.includes("galaxy") || lower.includes("galaxia")) return "🌌";
    if (lower.includes("lion") || lower.includes("león") || lower.includes("leon")) return "🦁";
    if (lower.includes("universe") || lower.includes("universo")) return "💥";
    return "💎";
}

function triggerRowExcitement(row, intensity = "normal") {
    if (!row) return;
    row.classList.remove("rush", "gift-impact");
    row.offsetHeight;
    row.classList.add(intensity === "gift" ? "gift-impact" : "rush");
    setTimeout(() => row.classList.remove("rush", "gift-impact"), intensity === "gift" ? 1200 : 700);
}

function spawnBarBurst(row, emoji = "✨", count = 6) {
    const barOuter = row?.querySelector(".rank-bar-outer");
    if (!barOuter) return;
    for (let i = 0; i < count; i++) {
        const burst = document.createElement("div");
        burst.className = "bar-burst";
        burst.textContent = emoji;
        burst.style.left = `${12 + Math.random() * 76}%`;
        burst.style.top = `${35 + Math.random() * 30}%`;
        burst.style.animationDelay = `${i * 40}ms`;
        barOuter.appendChild(burst);
        setTimeout(() => burst.remove(), 1200);
    }
}

// ──────────────────────────────────────────────────────────────
// Ranking Update
// ──────────────────────────────────────────────────────────────
socket.on("rankingUpdate", (countries) => {
    latestCountries = countries || {};
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

        // Construir avatares HTML - ahora irán dentro de la barra
        let avatarsHTML = "";
        if (avatars.length > 0) {
            avatars.slice(0, 3).forEach((url, i) => {
                avatarsHTML += `<div class="rank-avatar in-bar" style="right:${i * 18 + 5}px; z-index:${5 - i}">
          <img src="${url}" alt="" onerror="this.remove();" />
        </div>`;
            });
        }

        // Posición class
        let posClass = "rank-pos";
        if (pos === 1) posClass += " p1";
        else if (pos === 2) posClass += " p2";
        else if (pos === 3) posClass += " p3";

        row.innerHTML = `
      <div class="${posClass}">${pos}.</div>
      <div class="rank-avatars" style="width:34px">
        <div class="rank-avatar placeholder" style="left:0">${data.flag}</div>
      </div>
      <div class="rank-code">${code}</div>
      <div class="rank-bar-wrap">
        <div class="rank-bar-outer">
          <div class="rank-bar-fill ${colorClass}" style="width:${barPct}%"></div>
          <div class="bar-avatars-container" style="left:${barPct}%">${avatarsHTML}</div>
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
            playCoinSound();
            triggerRowExcitement(row, scoreDiff >= 50 ? "gift" : "normal");
            spawnBarBurst(row, scoreDiff >= 50 ? "💥" : "✨", scoreDiff >= 50 ? 10 : 5);
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
    playLeaderSound();
    speakOverlay(`${leader.name || leader.code} toma la punta. Tap tap y regalos para cambiar la batalla.`, { priority: true, minGapMs: 2500 });
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
    spawnDiamondRain();
    triggerScreenShake();
    playBigGiftSound();
    speakOverlay(`Gran regalo para ${data.country}. Sigan enviando poder a su país.`, { priority: true, minGapMs: 2500 });
});

// ──────────────────────────────────────────────────────────────
// Round Reset
// ──────────────────────────────────────────────────────────────
socket.on("roundReset", (data) => {
    const overlay = document.getElementById("round-reset-overlay");
    const avatarEl = document.getElementById("winner-avatar");

    if (data.winner) {
        document.getElementById("winner-flag").textContent = data.winner.flag;
        document.getElementById("winner-name").textContent = (data.winner.name || data.winner.code);
        document.getElementById("winner-score").textContent = formatScore(data.winner.score) + " 💎";

        // Mostrar avatar ganador si tiene
        if (data.winner.avatars && data.winner.avatars.length > 0) {
            avatarEl.innerHTML = `<img src="${data.winner.avatars[0]}" alt="MVP">`;
            avatarEl.classList.remove("hidden");
        } else {
            avatarEl.classList.add("hidden");
        }
    } else {
        document.getElementById("winner-flag").textContent = "🏁";
        document.getElementById("winner-name").textContent = "Sin ganador";
        document.getElementById("winner-score").textContent = "";
        avatarEl.classList.add("hidden");
    }

    overlay.classList.remove("hidden");
    overlay.classList.add("visible");
    setTimeout(() => {
        overlay.classList.remove("visible");
        overlay.classList.add("hidden");
        avatarEl.classList.add("hidden");
    }, 4000);

    previousScores = {};
    elapsedSeconds = 0;

    for (let i = 0; i < 10; i++) {
        setTimeout(() => spawnReaction("🎉"), i * 200);
    }
    playVictorySound();
});

// ──────────────────────────────────────────────────────────────
// Estado de conexión
// ──────────────────────────────────────────────────────────────
socket.on("status", (data) => {
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-text");
    if (!dot || !text) return;

    if (data.connected) {
        dot.className = "connected"; // Clase definida en style.css (verde)
        text.textContent = "EN VIVO — @" + data.username;
    } else if (data.error) {
        dot.className = "disconnected"; // Rojo
        text.textContent = "ERROR: " + data.error;
    } else if (data.streamEnded) {
        dot.className = "disconnected";
        text.textContent = "Stream finalizado";
    } else {
        dot.className = ""; // Naranja (default blink)
        text.textContent = "Conectando a @" + (data.username || "...");
    }
});

socket.on("ranking:countryJoined", (data) => {
    // Si queremos un popup de feedback
    const container = document.getElementById("reactions-container");
    const el = document.createElement("div");
    el.className = "reaction join-alert";
    el.innerHTML = `<span style="font-size:40px">${data.flag}</span><br>@${data.userId} unido!`;
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.top = "40%";
    el.style.setProperty("--dur", "3s");
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);

    // Sonidito
    playRankUpSound();
    if (Date.now() - lastJoinVoiceAt > 7000) {
        lastJoinVoiceAt = Date.now();
        speakOverlay(`${data.country} entra a la batalla. Ahora tap tap y regalos para subir esa barra.`, { minGapMs: 2500 });
    }
});

socket.on("connect", () => {
    console.log("✅ Conectado al servidor");
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-text");
    if (dot) dot.className = "dot online";
    if (text) text.innerText = "Sincronizando TikTok...";
});

socket.on("disconnect", () => {
    console.log("❌ Desconectado del servidor");
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-text");
    if (dot) dot.className = "dot offline";
    if (text) text.innerText = "Servidor Desconectado";
});

// ──────────────────────────────────────────────────────────────
// Animación de Regalo Volador en la Barra
// ──────────────────────────────────────────────────────────────
socket.on("ranking:gift", (data) => {
    spawnGiftFly(data);
    const row = document.querySelector(`.rank-row[data-code="${data.country}"]`);
    triggerRowExcitement(row, "gift");
    spawnBarBurst(row, getGiftAccent(data.giftName), Math.min(14, 4 + (data.repeatCount || 1)));
    if (Date.now() - lastGiftVoiceAt > 5500) {
        lastGiftVoiceAt = Date.now();
        speakOverlay(`Regalo para ${data.country}. Esa barra se enciende.`, { minGapMs: 2500 });
    }
});

socket.on("ranking:like", (data) => {
    const row = document.querySelector(`.rank-row[data-code="${data.country}"]`);
    if (!row) return;
    triggerRowExcitement(row, "normal");
    spawnBarBurst(row, "❤️", Math.min(8, Math.max(3, Math.ceil((data.likeCount || 1) / 2))));
    const barOuter = row.querySelector(".rank-bar-outer");
    if (barOuter) {
        const tapCue = document.createElement("div");
        tapCue.className = "tap-cue";
        tapCue.textContent = `TAP +${Math.max(1, data.likeCount || 1)}`;
        barOuter.appendChild(tapCue);
        setTimeout(() => tapCue.remove(), 1100);
    }
    if (Date.now() - lastLikeVoiceAt > 9000 && (data.likeCount || 0) >= 3) {
        lastLikeVoiceAt = Date.now();
        speakOverlay(`Tap tap para ${data.country}. Sigan tocando para empujar esa barra.`, { minGapMs: 2500 });
    }
});

function spawnGiftFly(data) {
    const { country, avatarUrl, giftName, coins } = data;
    const row = document.querySelector(`.rank-row[data-code="${country}"]`);
    if (!row) return;
    const barOuter = row.querySelector(".rank-bar-outer");
    if (!barOuter) return;

    const fly = document.createElement("div");
    fly.className = "gift-fly";
    const accent = getGiftAccent(giftName);

    fly.innerHTML = `
        <div class="gift-fly-core">
            ${avatarUrl ? `<img src="${avatarUrl}" alt="gift" onerror="this.src='https://www.tiktok.com/favicon.ico'" />` : `<div class="gift-fly-fallback">${accent}</div>`}
        </div>
        <div class="gift-fly-chip">${accent} ${giftName || "REGALO"} · ${formatScore(coins || 0)}</div>
    `;

    barOuter.appendChild(fly);
    setTimeout(() => fly.remove(), 2000);
}

// 🏆 Actualizar Campeón del Día (12h)
socket.on("ranking:championUpdate", (data) => {
    const section = document.getElementById("champion-section");
    const nameEl = document.getElementById("champion-name");
    const countryEl = document.getElementById("champion-country");
    const avatarEl = document.getElementById("champion-avatar");
    const followBtn = document.getElementById("follow-winner-btn");

    if (!data) {
        section.classList.add("hidden");
        return;
    }

    section.classList.remove("hidden");
    nameEl.textContent = data.name;
    countryEl.textContent = `${data.flag} ${data.country}`;

    if (data.avatar) {
        avatarEl.innerHTML = "";
        avatarEl.style.backgroundImage = `url(${data.avatar})`;
    } else {
        avatarEl.style.backgroundImage = `none`;
        avatarEl.innerHTML = `<div style="font-size:30px; display:flex; align-items:center; justify-content:center; height:100%">${data.flag}</div>`;
    }

    if (followBtn) {
        followBtn.onclick = () => {
            spawnReaction("👤");
            // Nota: En un overlay real no podemos forzar follow, pero simulamos el feedback
            followBtn.textContent = "✅ SIGUIENDO...";
            setTimeout(() => { followBtn.textContent = "👤 SEGUIR AL GANADOR"; }, 3000);
        };
    }
});

window.setInterval(() => {
    const now = Date.now();
    if (now - lastPromptVoiceAt < 25000) return;
    lastPromptVoiceAt = now;

    const sorted = Object.entries(latestCountries || {})
        .sort((a, b) => b[1].score - a[1].score)
        .filter(([, data]) => (data.score || 0) > 0);

    const leader = sorted[0];
    const runner = sorted[1];

    if (!leader) {
        speakOverlay("Escribe tu país en el chat para entrar. Después tap tap y regalos para subir la barra.", { minGapMs: 0 });
        return;
    }

    if (runner) {
        speakOverlay(`${leader[0]} lidera. ${runner[0]} lo persigue. Tap tap y regalos para mover la pelea.`, { minGapMs: 0 });
        return;
    }

    speakOverlay(`${leader[0]} va primero. Si quieres entrar a la batalla, escribe tu país en el chat y empieza con tap tap.`, { minGapMs: 0 });
}, 32000);
