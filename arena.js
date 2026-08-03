const socket = io();

// Elementos DOM
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
const leaderboardEl = document.getElementById("arena-leaderboard");
const floatingLayer = document.getElementById("floating-ui-layer");

const DEBUG_MODE = new window.URLSearchParams(window.location.search).get("debug") === "1";
const CLEAR_CACHE = new window.URLSearchParams(window.location.search).get("clearCache") === "1";

// Ajustar Canvas a pantalla completa
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    TILE_W = canvas.width / GRID_COLS;
    TILE_H = canvas.height / GRID_ROWS;
});

if (CLEAR_CACHE) {
    console.warn("🧹 Limpiando caché local...");
    localStorage.clear();
    sessionStorage.clear();
}

let persistentHOF = [];
let roundRanking = [];

// Variables del juego
let players = {};
let currentRoundSeconds = 180;

// Audio
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let soundEnabled = true; // Sonido activo por defecto

// ===========================================
// SISTEMA DE SONIDO PROCEDURAL (sin archivos)
// ===========================================
function playSynth(freq, type, duration, volume = 0.3) {
    if (!soundEnabled) return;
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.5, audioCtx.currentTime + duration);
        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch(e) { /* ignore */ }
}

function sfxConquer() {
    playSynth(600, 'square', 0.15, 0.2);
    setTimeout(() => playSynth(900, 'square', 0.1, 0.15), 80);
}

function sfxExplosion() {
    playSynth(150, 'sawtooth', 0.4, 0.3);
    playSynth(80, 'square', 0.5, 0.2);
}

function sfxMegaBlast() {
    playSynth(100, 'sawtooth', 0.6, 0.4);
    setTimeout(() => playSynth(200, 'square', 0.3, 0.3), 100);
    setTimeout(() => playSynth(400, 'sine', 0.2, 0.2), 250);
}

function sfxTap() {
    playSynth(800, 'sine', 0.08, 0.15);
}

function sfxJoin() {
    playSynth(440, 'sine', 0.1, 0.15);
    setTimeout(() => playSynth(660, 'sine', 0.1, 0.15), 100);
    setTimeout(() => playSynth(880, 'sine', 0.15, 0.12), 200);
}

function sfxRoundEnd() {
    playSynth(300, 'sawtooth', 0.3, 0.25);
    setTimeout(() => playSynth(200, 'sawtooth', 0.4, 0.2), 200);
    setTimeout(() => playSynth(100, 'sawtooth', 0.5, 0.3), 400);
}

// ===========================================
// SISTEMA DE VOZ (TTS en Español)
// ===========================================
let voiceQueue = [];
let isSpeaking = false;
let lastVoiceTime = 0;
const VOICE_COOLDOWN_MS = 2000; // Mínimo 2 segundos entre frases

const VOICE_GIFT_PHRASES = [
    (name, cuadros) => `${name} conquistó ${cuadros} cuadros. ¡Increíble!`,
    (name, cuadros) => `¡${name} ataca con fuerza! Más ${cuadros} cuadros suyos.`,
    (name, cuadros) => `${name} se expande. ${cuadros} cuadros más.`,
    (name) => `¡Gracias ${name} por la donación!`,
    (name) => `${name} marca territorio. ¡Quién lo detendrá!`,
];

const VOICE_BIG_GIFT_PHRASES = [
    (name) => `¡Atención! ${name} lanzó una GALAXIA. ¡Destrucción total!`,
    (name) => `¡${name} arrasó la pantalla! ¡Eso es poder!`,
    (name) => `¡MEGA DONACIÓN de ${name}! ¡La pantalla tiembla!`,
];

const VOICE_MEGA_PHRASES = [
    (name) => `¡ANIQUILACIÓN! ${name} acaba de dominar casi toda la pantalla. ¡Es imparable!`,
    (name) => `¡${name} lo destruyó todo! ¡LEÓN en la pantalla!`,
];

const VOICE_JOIN_PHRASES = [
    (name) => `¡${name} entró a la guerra!`,
    (name) => `Bienvenido ${name}. ¡A conquistar!`,
];

const VOICE_TOP_PHRASES = [
    (name, pct) => `${name} lidera con ${pct} por ciento de la pantalla.`,
    (name) => `${name} va primero. ¿Alguien lo desafía?`,
];

function getSpanishVoice() {
    const voices = window.speechSynthesis.getVoices();
    return voices.find(v => v.lang.startsWith("es")) ||
           voices.find(v => v.lang.includes("es")) ||
           voices[0];
}

function speak(text) {
    if (!soundEnabled || !window.speechSynthesis) return;
    const now = Date.now();
    if (now - lastVoiceTime < VOICE_COOLDOWN_MS) {
        // Encolar si el cooldown no ha pasado
        voiceQueue.push(text);
        if (!isSpeaking) processVoiceQueue();
        return;
    }
    lastVoiceTime = now;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    utterance.volume = 0.9;
    const voice = getSpanishVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
        isSpeaking = false;
        processVoiceQueue();
    };
    isSpeaking = true;
    window.speechSynthesis.cancel(); // Cancelar cualquier voz previa
    window.speechSynthesis.speak(utterance);
}

function processVoiceQueue() {
    if (voiceQueue.length === 0) return;
    const next = voiceQueue.shift();
    setTimeout(() => speak(next), 500);
}

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Precargar voces (Chrome las carga async)
if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// Narración periódica del líder (cada 30 segundos)
let lastLeaderNarration = 0;
function narrateLeader() {
    const now = Date.now();
    if (now - lastLeaderNarration < 30000) return;
    if (roundRanking.length === 0) return;
    lastLeaderNarration = now;

    const leader = roundRanking[0];
    const name = leader.name || leader.n || "Líder";
    const pid = leader.id || leader.i;
    let tiles = 0;
    for (let i = 0; i < TOTAL_TILES; i++) if (grid[i] === pid) tiles++;
    const pct = ((tiles / TOTAL_TILES) * 100).toFixed(0);

    if (tiles > 0) {
        speak(pickRandom(VOICE_TOP_PHRASES)(name, pct));
    }
}

// UI Throttle
let lastUIUpdate = 0;
const UI_THROTTLE_MS = 800;

// Caché de Avatares
const avatarCache = {};
function getAvatarImage(url) {
    if (!url) return null;
    if (avatarCache[url]) return avatarCache[url];
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = url;
    avatarCache[url] = img;
    return img;
}

// ==========================================
// LÓGICA DE GUERRA DE TERRITORIOS (GRID)
// ==========================================
const GRID_COLS = 20;
const GRID_ROWS = 35;
const TOTAL_TILES = GRID_COLS * GRID_ROWS;
let TILE_W = canvas.width / GRID_COLS;
let TILE_H = canvas.height / GRID_ROWS;

const grid = new Array(TOTAL_TILES).fill(null);
const cellFlash = new Array(TOTAL_TILES).fill(0);

// Colores vibrantes por jugador
const playerColors = {};
const COLOR_PALETTE = [
    "#ff4757", "#2ed573", "#1e90ff", "#ffa502", "#ff6b81",
    "#7bed9f", "#70a1ff", "#eccc68", "#ff7f50", "#ff4d4d",
    "#00d8d6", "#0fb9b1", "#a55eea", "#fd79a8", "#fdcb6e",
    "#6c5ce7", "#00cec9", "#e17055", "#d63031", "#55efc4"
];

function getPlayerColor(id) {
    if (!playerColors[id]) {
        playerColors[id] = COLOR_PALETTE[Object.keys(playerColors).length % COLOR_PALETTE.length];
    }
    return playerColors[id];
}

function getIndex(col, row) {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return -1;
    return row * GRID_COLS + col;
}

function getCellCenter(index) {
    const col = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    return { x: col * TILE_W + TILE_W / 2, y: row * TILE_H + TILE_H / 2 };
}

// Conquista con onda expansiva animada
function conquerArea(targetIndex, attackerId, radius) {
    const targetCol = targetIndex % GRID_COLS;
    const targetRow = Math.floor(targetIndex / GRID_COLS);
    let conquered = 0;

    for (let r = targetRow - radius; r <= targetRow + radius; r++) {
        for (let c = targetCol - radius; c <= targetCol + radius; c++) {
            const dist = Math.sqrt(Math.pow(c - targetCol, 2) + Math.pow(r - targetRow, 2));
            if (dist <= radius) {
                const idx = getIndex(c, r);
                if (idx !== -1) {
                    grid[idx] = attackerId;
                    cellFlash[idx] = 1.0;
                    conquered++;
                }
            }
        }
    }
    return conquered;
}

// ==========================================
// EFECTOS VISUALES
// ==========================================
let particles = [];
let overlayFlashAlpha = 0;
let overlayFlashColor = "255,255,255";
let screenShake = 0;
let announcements = []; // Texto flotante grande en el centro

function spawnFloatingText(text, x, y, color = "#fff") {
    if (!floatingLayer) return;
    const el = document.createElement("div");
    el.className = "floating-text";
    el.textContent = text;
    el.style.color = color;

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    el.style.left = `${(x * scaleX) + rect.left}px`;
    el.style.top = `${(y * scaleY) + rect.top}px`;

    floatingLayer.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1200);
}

function createExplosion(x, y, color, count = 20) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 8 + 2;
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            color: color,
            size: Math.random() * 5 + 2
        });
    }
}

function announce(text, color = "#ffd700", duration = 2500) {
    announcements.push({ text, color, birth: Date.now(), duration });
}

// ==========================================
// UNMINIFY - El servidor comprime los datos
// ==========================================
function unminifyPlayer(p) {
    return {
        id: p.i || p.id,
        name: p.n || p.name,
        avatar: p.a || p.avatar,
        score: p.s !== undefined ? p.s : (p.score || 0),
        hp: p.h !== undefined ? p.h : (p.hp || 100),
        state: p.st || p.state || "ACTIVE"
    };
}

// ==========================================
// SOCKET EVENTS
// ==========================================
socket.on("arena:join", (p) => {
    const player = unminifyPlayer(p);
    players[player.id] = player;
    announce(`🟩 ${player.name} ENTRÓ A LA GUERRA`, getPlayerColor(player.id));
    // Spawn inicial: conquistar un bloque aleatorio
    const startIdx = Math.floor(Math.random() * TOTAL_TILES);
    conquerArea(startIdx, player.id, 1);
    const pos = getCellCenter(startIdx);
    createExplosion(pos.x, pos.y, getPlayerColor(player.id), 10);
    sfxJoin();
    speak(pickRandom(VOICE_JOIN_PHRASES)(player.name));
});

socket.on("arena:sync", (data) => {
    for (const [, minified] of Object.entries(data)) {
        const p = unminifyPlayer(minified);
        if (!players[p.id]) {
            players[p.id] = p;
        } else {
            players[p.id].score = p.score;
            players[p.id].hp = p.hp;
            players[p.id].state = p.state;
        }
    }
});

socket.on("arena:currentRanking", (data) => {
    roundRanking = data;
    updateRankingDOM();
});

socket.on("arena:hallOfFameUpdate", (list) => {
    persistentHOF = Array.isArray(list) ? list : [];
});

socket.on("arena:lastRoundWinner", () => {});

socket.on("timerUpdate", (seconds) => {
    currentRoundSeconds = Math.max(0, Number(seconds) || 0);
    const mainTimerEl = document.getElementById("main-round-timer");
    const minutes = String(Math.floor(currentRoundSeconds / 60)).padStart(2, "0");
    const secs = String(currentRoundSeconds % 60).padStart(2, "0");
    if (mainTimerEl) mainTimerEl.textContent = `${minutes}:${secs}`;
});

socket.on("arena:suddenDeath", () => {});
socket.on("arena:goldenMinute", () => {});
socket.on("arena:frenzyUpdate", () => {});

socket.on("arena:roundEnd", () => {
    // Limpiar la cuadrícula para la nueva ronda
    grid.fill(null);
    cellFlash.fill(0);
    announce("⚔️ NUEVA RONDA ⚔️", "#ff4757", 3000);
    overlayFlashAlpha = 0.6;
    overlayFlashColor = "255,71,87";
    sfxRoundEnd();
    speak("¡Se acabó el tiempo! Comienza una nueva ronda. ¡A conquistar!");
});

// ==========================================
// REGALO = ATAQUE DE CONQUISTA
// ==========================================
socket.on("arena:gift", (data) => {
    const attackerData = data.attacker || {};
    const attacker = players[attackerData.id || attackerData.i];
    if (!attacker) return;

    const targetData = data.target || {};
    const target = players[targetData.id || targetData.i] || null;
    const diamondsTotal = data.diamondsTotal || 1;

    // Radio basado en el valor del regalo
    let impactRadius = 1;
    let label = "🌹 ROSA";
    if (diamondsTotal >= 100) { impactRadius = 3; label = "⚡ ATAQUE"; }
    if (diamondsTotal >= 1000) { impactRadius = 5; label = "🌌 GALAXIA"; }
    if (diamondsTotal >= 5000) { impactRadius = 7; label = "💎 MEGA"; }
    if (diamondsTotal >= 30000) { impactRadius = 10; label = "🦁 ANIQUILACIÓN"; }

    // Impacto: priorizar territorio enemigo
    let impactIdx = Math.floor(Math.random() * TOTAL_TILES);
    if (target) {
        const targetTiles = [];
        for (let i = 0; i < TOTAL_TILES; i++) {
            if (grid[i] === (target.id || targetData.id || targetData.i)) targetTiles.push(i);
        }
        if (targetTiles.length > 0) {
            impactIdx = targetTiles[Math.floor(Math.random() * targetTiles.length)];
        }
    }

    const pos = getCellCenter(impactIdx);
    const color = getPlayerColor(attacker.id);
    const conquered = conquerArea(impactIdx, attacker.id, impactRadius);

    // Efectos visuales épicos
    createExplosion(pos.x, pos.y, color, Math.min(50, conquered * 2));
    spawnFloatingText(`+${conquered} 🟩`, pos.x, pos.y - 30, color);
    announce(`${label} ${attacker.name} → +${conquered} CUADROS`, color, 2000);

    if (diamondsTotal >= 100) {
        screenShake = Math.min(20, diamondsTotal / 30);
        overlayFlashAlpha = Math.min(0.6, diamondsTotal / 5000);
        overlayFlashColor = color.replace("#", "").match(/.{2}/g).map(h => parseInt(h, 16)).join(",");
        
        if (diamondsTotal >= 30000) { sfxMegaBlast(); speak(pickRandom(VOICE_MEGA_PHRASES)(attacker.name)); }
        else if (diamondsTotal >= 1000) { sfxExplosion(); speak(pickRandom(VOICE_BIG_GIFT_PHRASES)(attacker.name)); }
        else { sfxExplosion(); speak(pickRandom(VOICE_GIFT_PHRASES)(attacker.name, conquered)); }
    } else {
        sfxConquer();
        // Solo un 20% de probabilidad de narrar una simple rosa para no hacer spam de voz
        if (Math.random() < 0.2) speak(pickRandom(VOICE_GIFT_PHRASES)(attacker.name, conquered));
    }
});

// ==========================================
// EXPANSIÓN ORGÁNICA DEL TERRITORIO
// ==========================================
function simulateTerritoryGrowth() {
    let totalScore = 0;
    const scores = {};
    const tileCounts = {};

    for (const id in players) {
        const p = players[id];
        if (p.state !== "REMOVED" && p.state !== "ELIMINATED" && p.score > 0) {
            scores[id] = p.score;
            totalScore += p.score;
            tileCounts[id] = 0;
        }
    }
    if (totalScore === 0) return;

    for (let i = 0; i < TOTAL_TILES; i++) {
        if (grid[i] && scores[grid[i]]) tileCounts[grid[i]]++;
    }

    for (const id in scores) {
        const targetTiles = Math.floor((scores[id] / totalScore) * TOTAL_TILES);
        const current = tileCounts[id] || 0;

        if (current < targetTiles) {
            const ownTiles = [];
            for (let i = 0; i < TOTAL_TILES; i++) if (grid[i] === id) ownTiles.push(i);

            if (ownTiles.length > 0) {
                const sourceIdx = ownTiles[Math.floor(Math.random() * ownTiles.length)];
                const sourceCol = sourceIdx % GRID_COLS;
                const sourceRow = Math.floor(sourceIdx / GRID_COLS);
                const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                const dir = dirs[Math.floor(Math.random() * dirs.length)];
                const targetIdx = getIndex(sourceCol + dir[0], sourceRow + dir[1]);

                if (targetIdx !== -1 && grid[targetIdx] !== id) {
                    grid[targetIdx] = id;
                    cellFlash[targetIdx] = 0.3;
                }
            } else {
                const randIdx = Math.floor(Math.random() * TOTAL_TILES);
                grid[randIdx] = id;
                cellFlash[randIdx] = 0.8;
            }
        }
    }
}

// ==========================================
// UI (Leaderboard con % de territorio)
// ==========================================
function formatScoreShort(s) {
    if (s >= 1e6) return (s / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (s >= 1e3) return (s / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return String(s);
}

function countTiles(playerId) {
    let count = 0;
    for (let i = 0; i < TOTAL_TILES; i++) if (grid[i] === playerId) count++;
    return count;
}

function updateRankingDOM(force = false) {
    const now = Date.now();
    if (!force && (now - lastUIUpdate < UI_THROTTLE_MS)) return;
    lastUIUpdate = now;

    if (!leaderboardEl) return;
    leaderboardEl.innerHTML = "";
    const top10 = roundRanking.slice(0, 8);
    top10.forEach((p, index) => {
        const pid = p.id || p.i;
        const name = p.name || p.n;
        const avatar = p.avatar || p.a || 'https://www.tiktok.com/favicon.ico';
        const tiles = countTiles(pid);
        const pct = ((tiles / TOTAL_TILES) * 100).toFixed(1);
        const color = getPlayerColor(pid);

        const item = document.createElement("div");
        item.className = "leaderboard-item";
        item.innerHTML = `
            <span class="rank-num" style="color:${color}">#${index + 1}</span>
            <img class="rank-avatar" src="${avatar}" onerror="this.src='https://www.tiktok.com/favicon.ico'" />
            <span class="rank-name">${name}</span>
            <span class="rank-score" style="color:${color}">${pct}%</span>
        `;
        leaderboardEl.appendChild(item);
    });
}

// ==========================================
// RENDER LOOP (60 FPS)
// ==========================================
let frameCount = 0;
const hasPlayers = () => Object.keys(players).length > 0;

function drawWaitingScreen() {
    // Animación de fondo "esperando" - onda de color suave
    const time = Date.now() * 0.001;
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            const cx = c * TILE_W;
            const cy = r * TILE_H;
            const wave = Math.sin(c * 0.3 + time) * Math.cos(r * 0.3 + time * 0.7);
            const alpha = (wave + 1) * 0.03;
            ctx.fillStyle = `rgba(46, 213, 115, ${alpha})`;
            ctx.fillRect(cx, cy, TILE_W, TILE_H);

            ctx.strokeStyle = "rgba(46, 213, 115, 0.04)";
            ctx.lineWidth = 1;
            ctx.strokeRect(cx, cy, TILE_W, TILE_H);
        }
    }

    // Texto central
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Título pulsante
    const pulse = Math.sin(time * 2) * 0.1 + 1;
    ctx.font = `bold ${Math.floor(48 * pulse)}px Orbitron, monospace`;
    ctx.fillStyle = "#2ed573";
    ctx.shadowColor = "#2ed573";
    ctx.shadowBlur = 20;
    ctx.fillText("🟩 PIXEL WAR", canvas.width / 2, canvas.height / 2 - 60);

    ctx.shadowBlur = 0;
    ctx.font = "bold 20px Rajdhani, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("¡REGALA PARA CONQUISTAR LA PANTALLA!", canvas.width / 2, canvas.height / 2);

    ctx.font = "bold 16px Rajdhani, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText("🌹 1 Rosa = 1 Cuadro  |  🌌 Galaxia = Bomba  |  🦁 León = Domina Todo", canvas.width / 2, canvas.height / 2 + 40);

    // Flecha animada
    const arrowY = Math.sin(time * 3) * 8;
    ctx.font = "30px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("⬇️ DONA PARA EMPEZAR ⬇️", canvas.width / 2, canvas.height / 2 + 100 + arrowY);
}

function loop() {
    frameCount++;

    // Fondo oscuro
    ctx.fillStyle = "#050810";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Screen Shake
    ctx.save();
    if (screenShake > 0) {
        ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
        screenShake *= 0.9;
        if (screenShake < 0.5) screenShake = 0;
    }

    if (!hasPlayers()) {
        drawWaitingScreen();
    } else {
        // Dibujar el Grid con territorio
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const idx = getIndex(c, r);
                const ownerId = grid[idx];
                const cx = c * TILE_W;
                const cy = r * TILE_H;

                // Borde sutil
                ctx.strokeStyle = "rgba(255,255,255, 0.03)";
                ctx.lineWidth = 1;
                ctx.strokeRect(cx, cy, TILE_W, TILE_H);

                if (ownerId && players[ownerId]) {
                    const color = getPlayerColor(ownerId);

                    // Fondo coloreado (territorio)
                    ctx.fillStyle = color;
                    ctx.globalAlpha = 0.45;
                    ctx.fillRect(cx + 1, cy + 1, TILE_W - 2, TILE_H - 2);
                    ctx.globalAlpha = 1.0;

                    // Avatar en la celda
                    const img = getAvatarImage(players[ownerId].avatar);
                    if (img && img.complete && img.naturalWidth > 0) {
                        ctx.save();
                        ctx.beginPath();
                        const rad = (Math.min(TILE_W, TILE_H) / 2) * 0.75;
                        ctx.arc(cx + TILE_W / 2, cy + TILE_H / 2, rad, 0, Math.PI * 2);
                        ctx.clip();
                        ctx.drawImage(img, cx + TILE_W / 2 - rad, cy + TILE_H / 2 - rad, rad * 2, rad * 2);
                        ctx.restore();
                    }

                    // Borde del color del jugador
                    ctx.strokeStyle = color;
                    ctx.globalAlpha = 0.6;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(cx, cy, TILE_W, TILE_H);
                    ctx.globalAlpha = 1.0;
                }

                // Flash de conquista
                if (cellFlash[idx] > 0) {
                    ctx.fillStyle = "#ffffff";
                    ctx.globalAlpha = cellFlash[idx];
                    ctx.fillRect(cx, cy, TILE_W, TILE_H);
                    cellFlash[idx] *= 0.88;
                    if (cellFlash[idx] < 0.01) cellFlash[idx] = 0;
                    ctx.globalAlpha = 1.0;
                }
            }
        }

        // Expansión orgánica (2 veces por segundo)
        if (frameCount % 30 === 0) {
            simulateTerritoryGrowth();
        }
    }

    // Partículas
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.15; // Gravedad suave
        p.life -= 0.025;
        if (p.life <= 0) { particles.splice(i, 1); continue; }

        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Anuncios centrales (textos grandes temporales)
    const now = Date.now();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = announcements.length - 1; i >= 0; i--) {
        const a = announcements[i];
        const elapsed = now - a.birth;
        if (elapsed > a.duration) { announcements.splice(i, 1); continue; }

        const progress = elapsed / a.duration;
        const alpha = progress < 0.1 ? progress / 0.1 : progress > 0.8 ? (1 - progress) / 0.2 : 1;
        const scale = progress < 0.1 ? 0.5 + progress * 5 : 1;

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height * 0.15 + i * 40);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.font = "bold 22px Orbitron, monospace";
        ctx.fillStyle = a.color;
        ctx.shadowColor = a.color;
        ctx.shadowBlur = 15;
        ctx.fillText(a.text, 0, 0);
        ctx.shadowBlur = 0;
        ctx.restore();
    }
    ctx.globalAlpha = 1.0;

    // Flash overlay global
    if (overlayFlashAlpha > 0.01) {
        ctx.fillStyle = `rgba(${overlayFlashColor}, ${overlayFlashAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        overlayFlashAlpha *= 0.85;
    } else {
        overlayFlashAlpha = 0;
    }

    ctx.restore(); // Restore shake
    
    // Narración de la IA
    if (hasPlayers()) narrateLeader();
    
    requestAnimationFrame(loop);
}

// ==========================================
// INTERACCIÓN: Click / Tap
// ==========================================
function handleCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX = e.clientX, clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    }

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const col = Math.floor(x / TILE_W);
    const row = Math.floor(y / TILE_H);
    const idx = getIndex(col, row);

    if (idx !== -1) {
        const ownerId = grid[idx];
        screenShake = 4;
        createExplosion(x, y, ownerId ? getPlayerColor(ownerId) : "#2ed573", 8);
        sfxTap();

        if (ownerId) {
            socket.emit("arena:tapAttack", { targetId: ownerId });
            grid[idx] = null;
            cellFlash[idx] = 1.0;
            spawnFloatingText("💥", x, y - 20, "#ff4757");
        } else {
            cellFlash[idx] = 0.5;
        }
    }
}

canvas.addEventListener("mousedown", handleCanvasClick);
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); handleCanvasClick(e); }, { passive: false });

// Arrancar motor
requestAnimationFrame(loop);

// ==========================================
// MODO DEBUG (para probar sin TikTok LIVE)
// ==========================================
if (DEBUG_MODE) {
    const debugPanel = document.getElementById("debug-panel");
    if (debugPanel) debugPanel.style.display = "block";

    const DEMO_AVATARS = [
        "https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image",
        "https://www.tiktok.com/favicon.ico"
    ];

    let mockScore = 500;
    document.getElementById("debug-spawn-bot")?.addEventListener("click", () => {
        const id = "bot_" + Math.floor(Math.random() * 1000);
        const name = ["Warrior", "Shadow", "Dragon", "Phoenix", "Storm"][Math.floor(Math.random() * 5)] + id.slice(-3);
        players[id] = { id, name, score: mockScore, avatar: DEMO_AVATARS[Math.floor(Math.random() * DEMO_AVATARS.length)], state: "ACTIVE" };
        roundRanking.push(players[id]);
        mockScore += 200;
        roundRanking.sort((a, b) => b.score - a.score);
        updateRankingDOM(true);

        // Auto-conquista para demo
        const startIdx = Math.floor(Math.random() * TOTAL_TILES);
        conquerArea(startIdx, id, 2);
        const pos = getCellCenter(startIdx);
        createExplosion(pos.x, pos.y, getPlayerColor(id), 15);
        announce(`🟩 ${name} ENTRÓ A LA GUERRA`, getPlayerColor(id));
    });

    document.getElementById("debug-gift-rose")?.addEventListener("click", () => {
        if (roundRanking.length > 0) {
            const attacker = roundRanking[Math.floor(Math.random() * Math.min(3, roundRanking.length))];
            const impactIdx = Math.floor(Math.random() * TOTAL_TILES);
            const conquered = conquerArea(impactIdx, attacker.id, 1);
            const pos = getCellCenter(impactIdx);
            createExplosion(pos.x, pos.y, getPlayerColor(attacker.id), 12);
            spawnFloatingText(`+${conquered} 🌹`, pos.x, pos.y - 30, getPlayerColor(attacker.id));
            announce(`🌹 ${attacker.name} +${conquered} CUADROS`, getPlayerColor(attacker.id));
            screenShake = 3;
        }
    });

    document.getElementById("debug-gift-galaxy")?.addEventListener("click", () => {
        if (roundRanking.length > 0) {
            const attacker = roundRanking[0];
            const impactIdx = Math.floor(Math.random() * TOTAL_TILES);
            const conquered = conquerArea(impactIdx, attacker.id, 5);
            const pos = getCellCenter(impactIdx);
            createExplosion(pos.x, pos.y, getPlayerColor(attacker.id), 40);
            spawnFloatingText(`+${conquered} 🌌`, pos.x, pos.y - 30, getPlayerColor(attacker.id));
            announce(`🌌 GALAXIA! ${attacker.name} CONQUISTÓ ${conquered} CUADROS`, getPlayerColor(attacker.id), 3000);
            screenShake = 12;
            overlayFlashAlpha = 0.5;
        }
    });
}
