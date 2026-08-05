const CONFIG = {
    winTarget: 8000,
    likeChargeThreshold: 200,
    suddenDeathMs: 30000,
    roundDurationMs: 5 * 60 * 1000
};

let socket = null;
let soundEnabled = false;

// --- ELEMENTOS DOM ---
const timerEl = document.getElementById("main-timer");
const scoreRedEl = document.getElementById("score-red");
const scoreBlueEl = document.getElementById("score-blue");
const donorsRedEl = document.getElementById("donors-red");
const donorsBlueEl = document.getElementById("donors-blue");
const markerEl = document.getElementById("rope-marker");
const titanRedEl = document.getElementById("titan-red");
const titanBlueEl = document.getElementById("titan-blue");
const chargeFillRed = document.getElementById("charge-fill-red");
const chargeFillBlue = document.getElementById("charge-fill-blue");
const membersRedEl = document.getElementById("members-red");
const membersBlueEl = document.getElementById("members-blue");
const announcerContainer = document.getElementById("announcer-container");
const finalPushOverlay = document.getElementById("final-push-overlay");
const victoryOverlay = document.getElementById("victory-overlay");
const floatingLayer = document.getElementById("floating-ui-layer");
const fxCanvas = document.getElementById("fx-canvas");
const fxCtx = fxCanvas.getContext("2d");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const soundBtn = document.getElementById("sound-btn");

// --- AUDIO (Web Audio sintetizado) ---
let audioCtx = null;
let bgmGain = null;
let bgmOsc1 = null;
let bgmOsc2 = null;

function ensureAudio() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        bgmGain = audioCtx.createGain();
        bgmGain.gain.value = 0.06;
        bgmGain.connect(audioCtx.destination);
        startBGM();
    } catch (e) {
        console.warn("Audio no disponible:", e.message);
    }
}

function startBGM() {
    if (!audioCtx || bgmOsc1) return;
    bgmOsc1 = audioCtx.createOscillator();
    bgmOsc2 = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    oscGain.gain.value = 1;
    bgmOsc1.type = "sawtooth";
    bgmOsc2.type = "sawtooth";
    bgmOsc1.frequency.value = 55;
    bgmOsc2.frequency.value = 82.5;
    bgmOsc1.connect(oscGain);
    bgmOsc2.connect(oscGain);
    oscGain.connect(bgmGain);
    bgmOsc1.start();
    bgmOsc2.start();

    let up = true;
    let base = 55;
    setInterval(() => {
        if (!audioCtx) return;
        const t = audioCtx.currentTime;
        up = !up;
        const target = up ? base * 1.5 : base;
        bgmOsc1.frequency.setTargetAtTime(target, t, 0.3);
        bgmOsc2.frequency.setTargetAtTime(target * 1.5, t, 0.3);
    }, 1800);
}

function playTone(freq, duration, type = "sine", volume = 0.15, slideTo = null) {
    if (!audioCtx || !soundEnabled) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, audioCtx.currentTime + duration);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playPush(teamId, power) {
    if (!soundEnabled) return;
    const base = teamId === "red" ? 120 : 160;
    playTone(base, 0.18, "square", 0.12, base * 1.6);
    if (power > 500) {
        setTimeout(() => playTone(base * 1.5, 0.3, "sawtooth", 0.16, base * 2.2), 80);
        setTimeout(() => playTone(base * 2, 0.5, "sawtooth", 0.12, base * 3), 200);
    }
}

// --- TTS ---
let speechQueue = [];
let speaking = false;

function tts(text, opts = {}) {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = opts.rate || 1.02;
    utterance.pitch = opts.pitch || 1.05;
    utterance.volume = opts.volume || 1;
    speechQueue.push(utterance);
    if (!speaking) processQueue();
}

function processQueue() {
    const next = speechQueue.shift();
    if (!next) {
        speaking = false;
        return;
    }
    speaking = true;
    next.onend = () => {
        speaking = false;
        setTimeout(processQueue, 120);
    };
    next.onerror = () => {
        speaking = false;
        setTimeout(processQueue, 120);
    };
    window.speechSynthesis.speak(next);
}

function speakImmediate(text, opts = {}) {
    speechQueue = [];
    if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
    tts(text, opts);
}

// --- ANUNCIADOR ---
function showAnnouncer(text, color = "#fff") {
    const el = document.createElement("div");
    el.className = "announcer-banner";
    el.style.borderColor = color;
    el.style.color = color;
    el.textContent = text;
    announcerContainer.innerHTML = "";
    announcerContainer.appendChild(el);
}

// --- FLOATING TEXT ---
function spawnFloatingText(text, x, y, color = "#fff", size = 22) {
    const el = document.createElement("div");
    el.className = "float-text";
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.color = color;
    el.style.fontSize = size + "px";
    el.textContent = text;
    floatingLayer.appendChild(el);
    setTimeout(() => el.remove(), 1500);
}

function centerFloat(text, color = "#fff", size = 28) {
    spawnFloatingText(text, window.innerWidth / 2 - text.length * size * 0.28, window.innerHeight * 0.4, color, size);
}

// --- PARTICLES (canvas FX) ---
let particles = [];
let shockwaves = [];

function resizeCanvas() {
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function pushParticle(p) {
    particles.push({
        x: p.x, y: p.y,
        vx: p.vx || 0, vy: p.vy || 0,
        life: p.life || 1,
        maxLife: p.life || 1,
        size: p.size || 8,
        color: p.color || "#fff",
        gravity: p.gravity ?? 0.2
    });
}

function pushShockwave(x, y, r, color) {
    shockwaves.push({ x, y, r: r || 10, maxR: r * 4 || 60, life: 1, color: color || "#fff" });
}

function burstAt(x, y, color, count, spread) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * (spread || 7) + 2;
        pushParticle({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0.5 + Math.random() * 0.7,
            size: Math.random() * 10 + 5,
            color
        });
    }
    pushShockwave(x, y, 12, color);
}

function renderFx() {
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.life -= 0.02;
        fxCtx.globalAlpha = Math.max(0, Math.min(1, p.life));
        fxCtx.fillStyle = p.color;
        fxCtx.beginPath();
        fxCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        fxCtx.fill();
    }

    shockwaves = shockwaves.filter((s) => s.life > 0);
    for (const s of shockwaves) {
        s.life -= 0.03;
        s.r += 3;
        fxCtx.globalAlpha = Math.max(0, s.life) * 0.7;
        fxCtx.strokeStyle = s.color;
        fxCtx.lineWidth = 4 * s.life + 1;
        fxCtx.beginPath();
        fxCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        fxCtx.stroke();
    }

    fxCtx.globalAlpha = 1;
    requestAnimationFrame(renderFx);
}
renderFx();

// --- TIMER ---
function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return m + ":" + s;
}

// --- RENDER STATE ---
function renderDonors(teamId) {
    const el = teamId === "red" ? donorsRedEl : donorsBlueEl;
    const donors = arguments[2] || [];
    el.innerHTML = "";
    for (const d of donors) {
        const chip = document.createElement("div");
        chip.className = "donor-chip";
        const avatar = d.avatar
            ? `<img src="${d.avatar}" onerror="this.style.display='none'"/>`
            : `<img src="https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image" onerror="this.style.display='none'"/>`;
        chip.innerHTML = `${avatar}<span class="d-name">${escapeHtml(d.name)}</span><span class="d-val">💎${Math.floor(d.total)}</span>`;
        el.appendChild(chip);
    }
}

function renderMembers(teamId) {
    const el = teamId === "red" ? membersRedEl : membersBlueEl;
    const members = arguments[2] || [];
    el.innerHTML = "";
    const maxShown = 8;
    for (const m of members.slice(0, maxShown)) {
        const img = document.createElement("img");
        img.className = "member-avatar";
        img.src = m.avatar || "https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image";
        img.alt = m.name || "";
        img.title = m.name || "";
        img.onerror = () => { img.style.display = "none"; };
        el.appendChild(img);
    }
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function applyState(state) {
    if (!state) return;
    timerEl.textContent = formatTime(state.timeRemainingMs);
    if (state.phase === "suddenDeath") {
        timerEl.classList.add("sudden-death");
        finalPushOverlay.classList.remove("hidden");
    } else {
        timerEl.classList.remove("sudden-death");
        finalPushOverlay.classList.add("hidden");
    }

    const r = state.teams?.red;
    const b = state.teams?.blue;
    if (r) {
        scoreRedEl.textContent = Math.floor(r.score);
        titanRedEl.querySelector(".titan-wins").textContent = "RONDAS: " + (r.wins || 0);
        renderDonors("red", null, r.donors || []);
        renderMembers("red", null, r.members || []);
        titanRedEl.classList.toggle("winning", (r.score || 0) >= (b?.score || 0) && r.score > 0);
    }
    if (b) {
        scoreBlueEl.textContent = Math.floor(b.score);
        titanBlueEl.querySelector(".titan-wins").textContent = "RONDAS: " + (b.wins || 0);
        renderDonors("blue", null, b.donors || []);
        renderMembers("blue", null, b.members || []);
        titanBlueEl.classList.toggle("winning", (b.score || 0) > (r?.score || 0) && b.score > 0);
    }

    if (state.charges) {
        chargeFillRed.style.width = Math.min(100, (state.charges.red || 0) / CONFIG.likeChargeThreshold * 100) + "%";
        chargeFillBlue.style.width = Math.min(100, (state.charges.blue || 0) / CONFIG.likeChargeThreshold * 100) + "%";
    }

    if (Number.isFinite(state.bar)) {
        markerEl.style.left = (state.bar * 100) + "%";
    }
}

// --- EVENTS ---
function handlePush(data) {
    if (!data) return;
    const teamId = data.teamId;
    const meta = data.meta || {};
    const isRed = teamId === "red";
    const color = isRed ? "#ef4444" : "#3b82f6";
    const donor = meta.donor || {};
    const power = data.power || 0;
    const rect = markerEl.getBoundingClientRect();
    const mx = rect.left + rect.width / 2;
    const my = rect.top + rect.height / 2;

    if (meta.type === "gift") {
        const count = Math.min(40, Math.max(10, Math.round(power / 60)));
        burstAt(mx, my, color, count, 10);
        centerFloat(`+${power} ⚡`, color, 30);
        if (meta.diamonds >= 1000) {
            showAnnouncer(`🔥 ${meta.diamonds} 💎 DE ${(donor.name || "").toUpperCase()}`, "#ffd700");
            speakImmediate(`${donor.name || "Alguien"} libera un poder absoluto con ${meta.diamonds} diamantes. El ${isRed ? "titán rojo" : "titán azul"} avanza con furia!`, { rate: 1.05 });
            burstAt(mx, my, "#ffd700", 50, 14);
            playTone(80, 0.8, "sawtooth", 0.2, 180);
        } else if (meta.diamonds >= 500) {
            showAnnouncer(`💎 ${donor.name || ""} DONA ${meta.diamonds}`, "#fbbf24");
            burstAt(mx, my, "#ffd700", 30, 10);
            playTone(100, 0.4, "sawtooth", 0.15, 200);
        } else {
            burstAt(mx, my, color, count, 8);
            playPush(teamId, power);
        }
        if (meta.sabotage) {
            showAnnouncer("🔥 ¡CAOS! EL RIVAL RETROCEDE", "#ff6600");
            speakImmediate(`¡Caos! El regalo de ${donor.name || "alguien"} empuja al rival hacia atrás.`, { rate: 1.08 });
            pushShockwave(mx, my, 20, "#ff6600");
        }
    } else if (meta.type === "burst") {
        centerFloat("💥 ¡CARGA LIBERADA!", "#ffd700", 34);
        burstAt(mx, my, "#ffd700", 36, 12);
        playTone(140, 0.5, "square", 0.2, 260);
        speakImmediate(`¡Carga liberada! El equipo ${isRed ? "rojo" : "azul"} empuja con toda su fuerza!`, { rate: 1.05 });
    } else if (meta.type === "like") {
        burstAt(mx + (isRed ? -40 : 40), my, color, 6, 5);
        playTone(isRed ? 220 : 260, 0.08, "sine", 0.06);
    } else if (meta.type === "chat") {
        burstAt(mx, my, color, 8, 6);
    } else if (meta.type === "sabotage" && power !== 0) {
        centerFloat(`-${Math.abs(power)} AL RIVAL`, "#ff6600", 26);
        burstAt(mx, my, "#ff6600", 20, 9);
    }

    const scoreEl = isRed ? scoreRedEl : scoreBlueEl;
    scoreEl.classList.remove("bump");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("bump");
}

function handleRoundEnd(data) {
    if (!data) return;
    const winnerId = data.winnerId;
    const isRed = winnerId === "red";
    const color = isRed ? "#ef4444" : "#3b82f6";
    const emoji = isRed ? "🔥" : "🌊";

    const podium = (data.podium || []).slice(0, 3);
    const podiumHTML = podium.length > 0 ? `
        <div class="victory-podium">
            ${podium.map((d, i) => `
                <div class="podium-slot">
                    <div class="podium-rank">${["🥇", "🥈", "🥉"][i] || "🏅"}</div>
                    <img src="${d.avatar || 'https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image'}" onerror="this.style.display='none'"/>
                    <div class="podium-name">${escapeHtml(d.name)}</div>
                    <div class="podium-val">💎${Math.floor(d.total)}</div>
                </div>`).join("")}
        </div>` : "";

    victoryOverlay.style.setProperty("--win-color", color);
    victoryOverlay.innerHTML = `
        <div class="victory-card">
            <div class="victory-title">🏆 ¡GANADOR! 🏆</div>
            <div class="victory-titan">${emoji}</div>
            <div class="victory-stats">${data.winnerName || "TITÁN"}</div>
            <div class="victory-stats">${Math.floor(data.red?.score || 0)} vs ${Math.floor(data.blue?.score || 0)}</div>
            ${data.mvp ? `
                <div class="victory-mvp">
                    <img src="${data.mvp.avatar || 'https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image'}" onerror="this.style.display='none'"/>
                    <span>⭐ MVP: ${escapeHtml(data.mvp.name)} · 💎${Math.floor(data.mvp.diamonds)}</span>
                </div>` : ""}
            ${podiumHTML}
        </div>
    `;
    victoryOverlay.classList.remove("hidden");

    for (let i = 0; i < 30; i++) {
        setTimeout(() => {
            burstAt(Math.random() * window.innerWidth, Math.random() * window.innerHeight * 0.6, Math.random() < 0.5 ? color : "#ffd700", 12, 9);
        }, i * 90);
    }

    const teamWord = isRed ? "titán rojo" : "titán azul";
    const mvpName = data.mvp?.name || "El equipo ganador";
    speakImmediate(`¡FIN DE LA BATALLA! El ${teamWord} gana la ronda. ${mvpName} es el MVP con ${Math.floor(data.mvp?.diamonds || 0)} diamantes. ¡Nueva ronda en breve!`, { rate: 1.04 });
}

function handleMotivate(data) {
    if (!data?.phrase) return;
    showAnnouncer(data.phrase, "#7dd3fc");
    tts(data.phrase, { rate: 1.0, pitch: 1.0 });
}

function handleJoin(data) {
    if (!data?.user?.name) return;
    const teamWord = data.teamId === "red" ? "titán rojo" : "titán azul";
    centerFloat(`${data.user.name} se une al ${teamWord.toUpperCase()}`, data.teamId === "red" ? "#ef4444" : "#3b82f6", 20);
}

// --- SOCKET ---
function connect() {
    socket = io();
    socket.on("connect", () => {
        statusDot.className = "dot online";
        statusText.textContent = "Servidor conectado";
        centerFloat("¡GUERRA DE TITANES!", "#ffd700", 36);
        if (soundEnabled) playTone(200, 0.4, "square", 0.15, 400);
    });
    socket.on("disconnect", () => {
        statusDot.className = "dot offline";
        statusText.textContent = "Desconectado";
    });
    socket.on("status", (status) => {
        if (status?.connected) {
            statusDot.className = "dot online";
            statusText.textContent = "LIVE: @" + (status.username || "");
        } else {
            statusDot.className = "dot connecting";
            statusText.textContent = status?.error || status?.message || "Esperando LIVE...";
        }
    });
    socket.on("titan:sync", applyState);
    socket.on("titan:push", handlePush);
    socket.on("titan:motivate", handleMotivate);
    socket.on("titan:join", handleJoin);
    socket.on("titan:roundEnd", handleRoundEnd);
}

// --- DEBUG ---
function setupDebug() {
    const q = new URLSearchParams(window.location.search);
    if (q.get("debug") !== "1") return;
    document.getElementById("debug-panel").classList.remove("hidden");
    document.getElementById("debug-push-red").addEventListener("click", () => {
        socket.emit("titan:debug:push", { teamId: "red", power: 300 });
    });
    document.getElementById("debug-push-blue").addEventListener("click", () => {
        socket.emit("titan:debug:push", { teamId: "blue", power: 300 });
    });
}

// --- INIT ---
soundBtn.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    ensureAudio();
    soundBtn.textContent = soundEnabled ? "🔇 Silenciar" : "🔊 Activar Sonido";
    if (soundEnabled) {
        playTone(300, 0.2, "square", 0.12, 500);
        speakImmediate("Audio activado. ¡Que empiece la batalla de titanes!");
    }
});

connect();
setupDebug();

// Demo visual: pequeñas partículas ambientales
setInterval(() => {
    pushParticle({
        x: Math.random() * window.innerWidth,
        y: window.innerHeight + 10,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -Math.random() * 3 - 1,
        life: 2,
        size: Math.random() * 4 + 2,
        color: Math.random() < 0.5 ? "rgba(239,68,68,0.7)" : "rgba(59,130,246,0.7)",
        gravity: -0.02
    });
}, 300);
