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
// ===========================================
// MUSICA DE FONDO (BGM Dinámico)
// ===========================================
let bgmStep = 0;
let bgmActive = false;
let nextBgmTime = 0;

function bgmLoop() {
    if (!soundEnabled || audioCtx.state === 'suspended') return;
    const now = audioCtx.currentTime;
    if (now >= nextBgmTime) {
        // Velocidad base: 500ms por paso. Aumenta hasta 150ms según bolas
        const numBalls = typeof balls !== 'undefined' ? balls.length : 0;
        const ballIntensity = Math.min(numBalls, 100) / 100;
        const stepDuration = 0.5 - (ballIntensity * 0.35);
        
        // Patrón chill synthwave (Escala pentatónica menor)
        const notes = [196.00, 220.00, 261.63, 293.66, 329.63, 392.00];
        const seq = [0, 2, 4, 2, 5, 4, 2, 1];
        
        const freq = notes[seq[bgmStep % seq.length]] * (ballIntensity > 0.8 ? 2 : 1);
        
        // Tocar nota suave
        playSynth(freq, 'sine', stepDuration * 0.8, 0.05 + (ballIntensity * 0.05));
        
        // Bombo / Kick de fondo
        if (bgmStep % 4 === 0) {
            playSynth(50, 'square', 0.2, 0.1);
        }

        nextBgmTime = now + stepDuration;
        bgmStep++;
    }
    requestAnimationFrame(bgmLoop);
}

function startBGM() {
    if (bgmActive) return;
    bgmActive = true;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    nextBgmTime = audioCtx.currentTime;
    requestAnimationFrame(bgmLoop);
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
// PLINKO PHYSICS ENGINE
// ==========================================
const balls = [];
const pegs = [];
const buckets = [];
const particles = [];
const announcements = [];
let screenShake = 0;
let overlayFlashAlpha = 0;
let overlayFlashColor = "255,255,255";
let frameCount = 0;

const GRAVITY = 0.2;
const BALL_RADIUS = 20;
const PEG_RADIUS = 5;
const BOUNCE_DAMPING = 0.5;

function initBoard() {
    pegs.length = 0;
    buckets.length = 0;
    
    // Crear pirámide de clavos (pegs)
    const rows = 12;
    const spacingY = canvas.height * 0.06;
    const spacingX = Math.min(canvas.width * 0.1, 80);
    const startY = canvas.height * 0.2;
    
    for (let r = 0; r < rows; r++) {
        const cols = r + 3;
        const rowWidth = (cols - 1) * spacingX;
        const startX = (canvas.width - rowWidth) / 2;
        
        for (let c = 0; c < cols; c++) {
            pegs.push({
                x: startX + c * spacingX,
                y: startY + r * spacingY,
                r: PEG_RADIUS,
                lit: 0
            });
        }
    }
    
    // Crear canastas (buckets)
    const bucketCount = 5;
    const bWidth = canvas.width / bucketCount;
    const multipliers = [1, 5, 10, 5, 1];
    const colors = ["#1e90ff", "#a55eea", "#ff4757", "#a55eea", "#1e90ff"];
    for (let i = 0; i < bucketCount; i++) {
        buckets.push({
            x: i * bWidth,
            y: canvas.height - 60,
            w: bWidth,
            h: 60,
            mult: multipliers[i],
            color: colors[i],
            flash: 0
        });
    }
}
window.addEventListener('resize', initBoard);
initBoard();

// Colores vibrantes por jugador
const playerColors = {};
const COLOR_PALETTE = ["#ff4757", "#2ed573", "#1e90ff", "#ffa502", "#ff6b81", "#7bed9f", "#70a1ff", "#eccc68", "#00d8d6"];
function getPlayerColor(id) {
    if (!playerColors[id]) playerColors[id] = COLOR_PALETTE[Object.keys(playerColors).length % COLOR_PALETTE.length];
    return playerColors[id];
}

function spawnBall(player, sizeScale = 1, count = 1) {
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            balls.push({
                player: player,
                x: canvas.width / 2 + (Math.random() - 0.5) * 200,
                y: -50 - (Math.random() * 50),
                vx: (Math.random() - 0.5) * 5,
                vy: Math.random() * 2,
                r: BALL_RADIUS * sizeScale,
                heavy: sizeScale >= 3,
                color: getPlayerColor(player.id || player.i),
                active: true
            });
        }, i * (sizeScale < 1 ? 50 : 200));
    }
}

function createExplosion(x, y, color, count = 15) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1,
            color,
            size: Math.random() * 4 + 2
        });
    }
}

function announce(text, color = "#fff", duration = 2000) {
    announcements.push({ text, color, duration, birth: Date.now() });
}

function spawnFloatingText(text, x, y, color) {
    const el = document.createElement("div");
    el.className = "floating-score";
    el.innerText = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.color = color;
    floatingLayer.appendChild(el);
    setTimeout(() => el.remove(), 1000);
}

// ==========================================
// SOCKET EVENTS OVERRIDE
// ==========================================
socket.on("arena:join", (player) => {
    spawnBall(player, 1, 1);
    sfxJoin();
    speak(pickRandom(VOICE_JOIN_PHRASES)(player.name));
});

socket.on("arena:sync", (data) => {
    for (const [, minified] of Object.entries(data)) {
        const p = unminifyPlayer(minified);
        if (!players[p.id]) players[p.id] = p;
        else { players[p.id].score = p.score; players[p.id].hp = p.hp; }
    }
});

socket.on("arena:currentRanking", (data) => {
    roundRanking = data;
    updateRankingDOM();
});

socket.on("arena:roundEnd", () => {
    balls.length = 0; // Limpiar bolas
    announce("⏱️ FIN DEL TIEMPO ⏱️", "#ff4757", 3000);
    overlayFlashAlpha = 0.6;
    overlayFlashColor = "255,71,87";
    sfxRoundEnd();
    speak("¡Se acabó el tiempo! Comienza una nueva ronda.");
});

socket.on("arena:likesBatch", (batch) => {
    for (const data of batch) {
        const ballsToDrop = Math.max(1, Math.floor(data.likeCount / 5)); // Al menos 1 bolita por tap
        if (ballsToDrop > 0) {
            const player = players[data.userId];
            if (player) {
                spawnBall(player, 0.5, Math.min(ballsToDrop, 5));
            }
        }
    }
});

socket.on("arena:gift", (data) => {
    const attackerData = data.attacker || {};
    const attacker = players[attackerData.id || attackerData.i];
    if (!attacker) return;
    const diamondsTotal = data.diamondsTotal || 1;

    let ballCount = 1;
    let sizeScale = 1;
    let label = "ROSA";

    if (diamondsTotal >= 30000) { ballCount = 1; sizeScale = 4; label = "LEÓN"; sfxMegaBlast(); speak(pickRandom(VOICE_MEGA_PHRASES)(attacker.name)); screenShake = 20; }
    else if (diamondsTotal >= 1000) { ballCount = 15; sizeScale = 1; label = "GALAXIA"; sfxExplosion(); speak(pickRandom(VOICE_BIG_GIFT_PHRASES)(attacker.name)); screenShake = 10; }
    else if (diamondsTotal >= 100) { ballCount = 5; sizeScale = 1; label = "ATAQUE"; sfxExplosion(); speak(pickRandom(VOICE_GIFT_PHRASES)(attacker.name, "múltiples")); }
    else { sfxConquer(); if (Math.random() < 0.2) speak(pickRandom(VOICE_GIFT_PHRASES)(attacker.name, "una")); }

    announce(`${attacker.name} envió ${label}!`, getPlayerColor(attacker.id), 2000);
    spawnBall(attacker, sizeScale, ballCount);
});

// ==========================================
// RENDER LOOP & PHYSICS
// ==========================================
function loop() {
    frameCount++;
    ctx.fillStyle = "#050810";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    if (screenShake > 0) {
        ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
        screenShake *= 0.9;
        if (screenShake < 0.5) screenShake = 0;
    }

    if (!hasPlayers()) {
        const time = Date.now() * 0.002;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "bold 40px Rajdhani, sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText("🎰 PLINKO DE AVATARES 🎰", canvas.width / 2, canvas.height * 0.3);
        ctx.font = "bold 20px Rajdhani, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText("¡DONA PARA HACER CAER TU AVATAR!", canvas.width / 2, canvas.height / 2);
        
        const arrowY = Math.sin(time * 3) * 8;
        ctx.font = "30px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillText("⬇️ TAP TAP PARA EMPEZAR ⬇️", canvas.width / 2, canvas.height / 2 + 100 + arrowY);
    } else {
        // Dibujar canastas
        for (const b of buckets) {
            ctx.fillStyle = b.color;
            ctx.globalAlpha = 0.2 + b.flash;
            ctx.fillRect(b.x, b.y, b.w, b.h);
            ctx.globalAlpha = 1;
            
            ctx.strokeStyle = b.color;
            ctx.lineWidth = 2;
            ctx.strokeRect(b.x, b.y, b.w, b.h);

            ctx.fillStyle = "#fff";
            ctx.font = "bold 24px Rajdhani";
            ctx.textAlign = "center";
            ctx.fillText(`x${b.mult}`, b.x + b.w / 2, b.y + b.h / 2);
            
            if (b.flash > 0) b.flash *= 0.9;
        }

        // Dibujar clavos (pegs)
        for (const peg of pegs) {
            ctx.beginPath();
            ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
            ctx.fillStyle = peg.lit > 0 ? "#fff" : "#ff4757";
            ctx.shadowBlur = peg.lit > 0 ? 15 : 5;
            ctx.shadowColor = "#ff4757";
            ctx.fill();
            if (peg.lit > 0) peg.lit -= 0.05;
        }
        ctx.shadowBlur = 0;

        // Físicas y dibujado de bolas
        for (let i = balls.length - 1; i >= 0; i--) {
            const b = balls[i];
            if (!b.active) continue;

            // Gravedad
            b.vy += GRAVITY * (b.heavy ? 1.5 : 1);
            
            // Límite de velocidad
            const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (speed > 20) {
                b.vx = (b.vx / speed) * 20;
                b.vy = (b.vy / speed) * 20;
            }

            b.x += b.vx;
            b.y += b.vy;

            // Colisión con paredes
            if (b.x < b.r) { b.x = b.r; b.vx *= -BOUNCE_DAMPING; }
            if (b.x > canvas.width - b.r) { b.x = canvas.width - b.r; b.vx *= -BOUNCE_DAMPING; }

            // Colisión con clavos (pegs)
            for (const peg of pegs) {
                const dx = b.x - peg.x;
                const dy = b.y - peg.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = b.r + peg.r;
                
                if (dist < minDist) {
                    // Separar
                    const overlap = minDist - dist;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    b.x += nx * overlap;
                    b.y += ny * overlap;
                    
                    // Rebote elástico
                    const dot = b.vx * nx + b.vy * ny;
                    if (dot < 0) {
                        b.vx -= (1 + BOUNCE_DAMPING) * dot * nx;
                        b.vy -= (1 + BOUNCE_DAMPING) * dot * ny;
                    }
                    peg.lit = 1;
                    sfxTap();
                }
            }

            // Colisión con otros avatares pesados
            if (b.heavy) {
                for (const other of balls) {
                    if (other === b || !other.active) continue;
                    const dx = other.x - b.x;
                    const dy = other.y - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minDist = b.r + other.r;
                    if (dist < minDist) {
                        const overlap = minDist - dist;
                        const nx = dx / dist;
                        const ny = dy / dist;
                        other.x += nx * overlap;
                        other.y += ny * overlap;
                        other.vx += nx * 5;
                        other.vy += ny * 5;
                    }
                }
            }

            // Caer en canasta
            if (b.y > canvas.height - 60) {
                b.active = false;
                for (const bucket of buckets) {
                    if (b.x > bucket.x && b.x < bucket.x + bucket.w) {
                        bucket.flash = 1;
                        const pts = bucket.mult;
                        createExplosion(b.x, b.y, b.color, 10);
                        spawnFloatingText(`+${pts}`, b.x, b.y - 20, b.color);
                        socket.emit("arena:tapAttack", { targetId: b.player.id || b.player.i }); 
                        break;
                    }
                }
                balls.splice(i, 1);
                continue;
            }

            // Dibujar avatar
            const img = getAvatarImage(b.player.avatar || b.player.a);
            ctx.save();
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fillStyle = b.color;
            ctx.fill();
            if (img && img.complete && img.naturalWidth > 0) {
                ctx.clip();
                ctx.drawImage(img, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
            }
            ctx.restore();
            
            // Borde
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.strokeStyle = b.heavy ? "#fff" : b.color;
            ctx.lineWidth = b.heavy ? 4 : 2;
            ctx.stroke();
        }
    }

    // Partículas
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.15;
        p.life -= 0.025;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Anuncios
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
        ctx.fillText(a.text, 0, 0);
        ctx.restore();
    }

    if (overlayFlashAlpha > 0.01) {
        ctx.fillStyle = `rgba(${overlayFlashColor}, ${overlayFlashAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        overlayFlashAlpha *= 0.85;
    }

    ctx.restore();
    if (hasPlayers()) narrateLeader();
    requestAnimationFrame(loop);
}

// ==========================================
// INTERACCIÓN: Click / Tap
// ==========================================
function handleCanvasClick(e) {
    startBGM();
    const testPlayer = { id: "host", name: "Host", avatar: "https://www.tiktok.com/favicon.ico" };
    spawnBall(testPlayer, 0.5, 1); // Simular Tap
    sfxJoin();
}

canvas.addEventListener("mousedown", handleCanvasClick);
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); handleCanvasClick(e); }, { passive: false });

requestAnimationFrame(loop);

if (DEBUG_MODE) {
    document.getElementById("debug-panel").style.display = "block";
    document.getElementById("debug-spawn-bot")?.addEventListener("click", () => {
        const p = { id: "bot_"+Math.random(), name: "Bot", avatar: "https://www.tiktok.com/favicon.ico" };
        players[p.id] = p;
        spawnBall(p, 1, 3);
    });
    document.getElementById("debug-gift-rose")?.addEventListener("click", () => {
        const p = { id: "rose_"+Math.random(), name: "Rose Gifter", avatar: "https://www.tiktok.com/favicon.ico" };
        spawnBall(p, 1, 5);
        sfxExplosion();
    });
    document.getElementById("debug-gift-galaxy")?.addEventListener("click", () => {
        const p = { id: "galaxy_"+Math.random(), name: "Galaxy Gifter", avatar: "https://www.tiktok.com/favicon.ico" };
        spawnBall(p, 4, 1);
        screenShake = 15;
        sfxMegaBlast();
    });
}
