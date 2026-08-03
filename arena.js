const socket = io();

// Mensajes de atracción rotativos (neuromarketing: 1 mensaje claro a la vez)
const ATTRACT_MESSAGES = [
    { text: "¡TU CARA CAE EN LA PANTALLA!",   sub: "Manda una Rosa para empezar",       color: "#ff4757" },
    { text: "¡DA TAP TAP!",                     sub: "Cada 3 taps = una bolita tuya",      color: "#ffa502" },
    { text: "¿QUIÉN LLEGA AL X10?",             sub: "El que dé más Rosas gana",           color: "#2ed573" },
    { text: "¡ATACA A TUS AMIGOS!",             sub: "Manda más Rosas = más bolas = más puntos", color: "#1e90ff" },
    { text: "¿LISTO PARA VOLAR?",              sub: "Un León = Bola Gigante que aplasta todo", color: "#a55eea" },
];
let attractIdx = 0;
setInterval(() => { attractIdx = (attractIdx + 1) % ATTRACT_MESSAGES.length; }, 3000);

// ==========================================
// DOM & CANVAS SETUP
// ==========================================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const leaderboardEl = document.getElementById("arena-leaderboard");
const floatingLayer = document.getElementById("floating-ui-layer");

const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "1";

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    initBoard();
});

// ==========================================
// ESTADO GLOBAL
// ==========================================
let players = {};
let roundRanking = [];
let persistentHOF = [];

// ==========================================
// AUDIO (Web Audio API)
// ==========================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioUnlocked = false;

function unlockAudio() {
    if (audioUnlocked) return;
    audioCtx.resume().then(() => { audioUnlocked = true; });
}

function playSynth(freq, type, duration, volume = 0.2) {
    try {
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
    } catch(e) {}
}

function sfxPeg()      { playSynth(600 + Math.random()*400, 'sine', 0.08, 0.06); }
function sfxJoin()     { playSynth(440,'sine',0.1,0.1); setTimeout(()=>playSynth(880,'sine',0.12,0.1),120); }
function sfxGift()     { playSynth(300,'sawtooth',0.3,0.25); setTimeout(()=>playSynth(600,'square',0.2,0.2),150); }
function sfxMega()     { [80,120,200,300].forEach((f,i)=>setTimeout(()=>playSynth(f,'sawtooth',0.5,0.35),i*60)); }
function sfxBucket(m)  { playSynth(220*m,'sine',0.4,0.25); }
function sfxRoundEnd() { [300,200,100].forEach((f,i)=>setTimeout(()=>playSynth(f,'sawtooth',0.3,0.3),i*180)); }

// ==========================================
// BGM DINÁMICO
// ==========================================
const BGM_NOTES = [196.00, 220.00, 261.63, 293.66, 349.23, 392.00];
const BGM_SEQ   = [0, 2, 4, 2, 5, 4, 2, 0, 1, 3, 1, 0];
let bgmStep = 0;
let bgmNext = 0;
let bgmRunning = false;

function bgmTick() {
    if (!bgmRunning) return;
    const t = audioCtx.currentTime;
    if (t >= bgmNext) {
        const intensity = Math.min(balls.length, 80) / 80;
        const step = 0.45 - intensity * 0.33;
        const octave = intensity > 0.6 ? 2 : 1;
        const freq = BGM_NOTES[BGM_SEQ[bgmStep % BGM_SEQ.length]] * octave;
        playSynth(freq, 'sine', step * 0.7, 0.04 + intensity * 0.04);
        if (bgmStep % 4 === 0) playSynth(55, 'square', 0.18, 0.08);
        bgmNext = t + step;
        bgmStep++;
    }
    requestAnimationFrame(bgmTick);
}

function startBGM() {
    if (bgmRunning) return;
    bgmRunning = true;
    bgmNext = audioCtx.currentTime;
    requestAnimationFrame(bgmTick);
}

// ==========================================
// VOZ (TTS)
// ==========================================
let voiceQueue = [];
let isSpeaking = false;
let lastVoiceTime = 0;
const VOICE_COOLDOWN = 3000;

function speak(text) {
    if (!window.speechSynthesis) return;
    if (Date.now() - lastVoiceTime < VOICE_COOLDOWN) { voiceQueue.push(text); return; }
    lastVoiceTime = Date.now();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES"; u.rate = 1.1; u.volume = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(v => v.lang.startsWith("es")) || voices[0];
    if (v) u.voice = v;
    u.onend = () => { isSpeaking = false; if (voiceQueue.length) setTimeout(()=>speak(voiceQueue.shift()),400); };
    isSpeaking = true;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
}

if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ==========================================
// PLINKO ENGINE
// ==========================================
const GRAVITY       = 0.13;   // Lento = más drama
const BALL_R        = 20;
const PEG_R         = 7;      // Clavos más grandes = más rebotes
const BOUNCE        = 0.62;   // Más elástico = más caos

const balls      = [];
const pegs       = [];
const buckets    = [];
const particles  = [];
const toasts     = [];
let screenShake  = 0;
let flashAlpha   = 0;
let flashColor   = "255,255,255";

// Paleta de colores vibrantes
const COLORS = ["#ff4757","#2ed573","#1e90ff","#ffa502","#ff6b81","#7bed9f","#eccc68","#00d8d6","#a55eea","#ff7f50"];
const playerColors = {};
function getColor(id) {
    if (!playerColors[id]) playerColors[id] = COLORS[Object.keys(playerColors).length % COLORS.length];
    return playerColors[id];
}

// Avatar cache
const avatarCache = {};
function getAvatar(url) {
    if (!url) return null;
    if (avatarCache[url]) return avatarCache[url];
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = url;
    avatarCache[url] = img;
    return img;
}

// Asegurar/crear jugador on-the-fly
function ensurePlayer(id, name, avatar) {
    if (!players[id]) players[id] = { id, name: name || id, avatar: avatar || "", score: 0 };
    return players[id];
}

// ==========================================
// BOARD INIT
// ==========================================
function initBoard() {
    pegs.length = 0;
    buckets.length = 0;

    const rows = 16;   // Más filas = caida más lenta y caótica
    const gapY = canvas.height * 0.048;
    const gapX = Math.min(canvas.width * 0.085, 68);
    const startY = canvas.height * 0.12;

    for (let r = 0; r < rows; r++) {
        const cols = r + 3;
        const rowW = (cols - 1) * gapX;
        const ox = (canvas.width - rowW) / 2;
        for (let c = 0; c < cols; c++) {
            // Bombas: ~8% de probabilidad en las filas centrales
            const isBomb = Math.random() < 0.08 && r > 4 && r < rows - 3;
            pegs.push({ x: ox + c * gapX, y: startY + r * gapY, lit: 0, isBomb });
        }
    }

    // Canastas proporcionales con x3 incluido
    const mults   = [1, 3, 5, 10, 5, 3, 1];
    const bColors = ["#1e90ff", "#2ed573", "#a55eea", "#ff4757", "#a55eea", "#2ed573", "#1e90ff"];
    // Porcentajes del ancho total (suma 100%): el x5 ahora es más difícil que el x3
    // x1 (20%) | x3 (17%) | x5 (10%) | x10 (6%) | x5 (10%) | x3 (17%) | x1 (20%)
    const bWidths = [0.20, 0.17, 0.10, 0.06, 0.10, 0.17, 0.20]; 
    const bY = canvas.height - 75;
    
    let currentX = 0;
    for (let i = 0; i < mults.length; i++) {
        const w = canvas.width * bWidths[i];
        buckets.push({ x: currentX, y: bY, w: w, h: 75, mult: mults[i], color: bColors[i], flash: 0 });
        currentX += w;
    }
}
initBoard();

// ==========================================
// SPAWN BALLS
// ==========================================
function spawnBall(player, sizeScale = 1, count = 1, delay = 180) {
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            balls.push({
                player,
                x: canvas.width / 2 + (Math.random() - 0.5) * 160,
                y: -BALL_R * sizeScale - Math.random() * 40,
                vx: (Math.random() - 0.5) * 4,
                vy: 1 + Math.random() * 2,
                r: BALL_R * sizeScale,
                heavy: sizeScale >= 2.5,
                color: getColor(player.id),
                active: true,
                lastSfxTime: 0,
                stuckFrames: 0
            });
        }, i * delay);
    }
}

// Demo balls (idle screen – caen automaticamente con colores vibrantes, sin iconos)
function spawnDemoBall() {
    const id = "demo_" + Math.floor(Math.random()*10000);
    const color = COLORS[Math.floor(Math.random()*COLORS.length)];
    playerColors[id] = color;
    balls.push({
        player: { id, name: "", avatar: "" },
        x: canvas.width / 2 + (Math.random() - 0.5) * 220,
        y: -BALL_R,
        vx: (Math.random() - 0.5) * 4,
        vy: 1,
        r: BALL_R * 0.65,
        heavy: false,
        color,
        active: true,
        isDemo: true,
        lastSfxTime: 0,
        stuckFrames: 0
    });
}
// Caen cada 1400ms para mantener el tablero vivo sin saturarlo
setInterval(() => {
    if (Object.keys(players).filter(k => !k.startsWith("demo_")).length === 0) spawnDemoBall();
}, 1400);

// ==========================================
// FLOATING TEXT
// ==========================================
function floatText(text, x, y, color) {
    const d = document.createElement("div");
    d.className = "floating-score";
    d.style.cssText = `position:absolute;left:${x}px;top:${y}px;color:${color};font:bold 18px Orbitron,monospace;pointer-events:none;transition:transform 0.8s ease,opacity 0.8s ease;`;
    d.innerText = text;
    floatingLayer.appendChild(d);
    requestAnimationFrame(() => {
        d.style.transform = "translateY(-60px)";
        d.style.opacity = "0";
    });
    setTimeout(() => d.remove(), 900);
}

// ==========================================
// TOAST ANUNCIOS
// ==========================================
function toast(text, color = "#fff", duration = 2500) {
    toasts.push({ text, color, birth: Date.now(), duration });
}

// ==========================================
// PARTICLES
// ==========================================
function explode(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
        particles.push({
            x, y,
            vx: (Math.random()-0.5)*12,
            vy: (Math.random()-0.5)*12,
            life: 1,
            color,
            size: Math.random()*4+2
        });
    }
}

// ==========================================
// LEADERBOARD DOM
// ==========================================
function updateLeaderboard() {
    if (!leaderboardEl) return;
    leaderboardEl.innerHTML = roundRanking.slice(0, 5).map((p,i) => {
        const name = p.name || p.n || "?";
        const score = p.score || p.s || 0;
        const medals = ["🥇","🥈","🥉","4️⃣","5️⃣"];
        return `<div class="lb-row">${medals[i]} <span class="lb-name">${name}</span> <span class="lb-score">${score} pts</span></div>`;
    }).join("");
}

// ==========================================
// NARRACIÓN DEL LÍDER
// ==========================================
let lastNarrate = 0;
function maybeNarrate() {
    if (Date.now() - lastNarrate < 30000) return;
    if (!roundRanking.length) return;
    lastNarrate = Date.now();
    const top = roundRanking[0];
    const name = top.name || top.n || "Líder";
    speak(rnd([
        () => `¡${name} va en primer lugar! ¿Quién lo destronará?`,
        () => `${name} domina el Plinko. ¡Tira más bolas para alcanzarlo!`,
        () => `¡${name} está ganando! ¡Donen para subir en el ranking!`
    ])());
}

// ==========================================
// SOCKET EVENTS
// ==========================================
// ==========================================
// TIMER
// ==========================================
let currentTimerSeconds = 0;
let timerFlash = false;

socket.on("timerUpdate", (seconds) => {
    currentTimerSeconds = seconds;
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const timerEl = document.getElementById("main-round-timer");
    if (timerEl) {
        timerEl.textContent = `${mins}:${secs}`;
        // Parpadeo rojo en los últimos 30 segundos
        timerEl.style.color = seconds <= 30 ? (timerFlash ? "#ff4757" : "#fff") : "#ff4757";
        timerFlash = !timerFlash;
    }
});

socket.on("arena:sync", (data) => {
    for (const [, m] of Object.entries(data)) {
        const id = m.i || m.id;
        if (!id) continue;
        if (!players[id]) players[id] = { id, name: m.n || m.name || id, avatar: m.a || m.avatar || "", score: m.s || 0 };
        else { players[id].score = m.s || 0; }
    }
});

socket.on("arena:currentRanking", (data) => {
    roundRanking = data;
    updateLeaderboard();
});

socket.on("arena:join", (player) => {
    ensurePlayer(player.id || player.i, player.name || player.n, player.avatar || player.a);
    spawnBall(players[player.id || player.i], 1, 1);
    sfxJoin();
    speak(rnd([
        () => `¡${player.name || player.n || "alguien"} se unió al Plinko!`,
        () => `¡Bienvenido ${player.name || player.n || "jugador"}!`
    ])());
});

socket.on("arena:likesBatch", (batch) => {
    for (const data of batch) {
        ensurePlayer(data.userId, data.userName, "");
        const player = players[data.userId];
        const count = Math.max(1, Math.floor((data.likeCount || 1) / 3));
        spawnBall(player, 0.55, Math.min(count, 4), 80);
    }
});

socket.on("arena:gift", (data) => {
    const aData  = data.attacker || {};
    const id     = aData.id || aData.i;
    const name   = aData.name || aData.n || "Donador";
    const avatar = aData.avatar || aData.a || "";
    const diamonds = data.diamondsTotal || 1;

    ensurePlayer(id, name, avatar);
    const player = players[id];

    let count = 1, scale = 1, label = "Rosa";

    if (diamonds >= 30000)      { count = 1;  scale = 4.5; label = "LEON";    sfxMega();  screenShake = 25; speak(`¡${name} mandó un LEON! ¡TEMBLEMOS!`); }
    else if (diamonds >= 5000)  { count = 20; scale = 1;   label = "GALAXIA"; sfxMega();  screenShake = 15; speak(`¡${name} lanzó una GALAXIA! ¡Lluvia de avatares!`); }
    else if (diamonds >= 1000)  { count = 10; scale = 1.2; label = "ATAQUE";  sfxGift();  screenShake = 8;  speak(`¡${name} atacó con fuerza!`); }
    else if (diamonds >= 99)    { count = 5;  scale = 1;   label = "REGALO";  sfxGift(); }
    else                        { count = 2;  scale = 0.9; label = "Rosa";    sfxPeg();  }

    toast(`${name}: ${label}!`, getColor(id), 2500);
    explode(canvas.width / 2, 80, getColor(id), 20);
    spawnBall(player, scale, count);
});

socket.on("arena:roundEnd", () => {
    // Mostrar ganador
    const winner = roundRanking[0];
    const winnerName = winner ? (winner.name || winner.n || "???") : "???";
    const winnerScore = winner ? (winner.score || winner.s || 0) : 0;
    toast(`🏆 GANADOR: ${winnerName} (${winnerScore} pts)`, "#ffd700", 5000);
    flashAlpha = 0.5; flashColor = "255,71,87";
    sfxRoundEnd();
    speak(`¡Tiempo! El ganador es ${winnerName} con ${winnerScore} puntos. ¡Felicitaciones!`);
    setTimeout(() => balls.length = 0, 4000);
});

// ==========================================
// RENDER LOOP
// ==========================================
function drawBackground() {
    // Fondo negro con gradiente radial para profundidad
    const grd = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, canvas.width * 0.8);
    grd.addColorStop(0, "#0d1224");
    grd.addColorStop(1, "#03050f");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid de puntos decorativos
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    const gs = 40;
    for (let x = gs; x < canvas.width; x += gs) {
        for (let y = gs; y < canvas.height; y += gs) {
            ctx.fillRect(x-1, y-1, 2, 2);
        }
    }
}

    // Dibujar canastas con label explicativo
function drawBuckets() {
    for (const b of buckets) {
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.15 + b.flash * 0.6;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.globalAlpha = 1;

        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.flash > 0.1 ? 3 : 1.5;
        ctx.shadowBlur = b.flash > 0.1 ? 20 : 0;
        ctx.shadowColor = b.color;
        ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
        ctx.shadowBlur = 0;

        // Multiplicador grande
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 0.95;
        ctx.font = `bold ${b.mult === 10 ? 30 : 24}px Orbitron, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`x${b.mult}`, b.x + b.w / 2, b.y + b.h / 2 - 8);

        // Etiqueta pequena que explica qué es
        ctx.font = `bold 10px Rajdhani, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        const label = b.mult === 10 ? "JACKPOT" : b.mult === 5 ? "MEGA" : b.mult === 3 ? "BONUS" : "PUNTOS";
        ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 14);
        ctx.globalAlpha = 1;

        if (b.flash > 0) b.flash *= 0.88;
    }
}

function drawPegs() {
    for (const peg of pegs) {
        const isLit = peg.lit > 0;
        ctx.beginPath();
        // Las bombas son un poco más grandes
        ctx.arc(peg.x, peg.y, PEG_R + (peg.isBomb ? 2 : 0), 0, Math.PI * 2);
        ctx.fillStyle = isLit ? "#ffffff" : (peg.isBomb ? "#111111" : "#ff4757");
        if (peg.isBomb) {
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "#ff4757";
            ctx.stroke();
        }
        ctx.shadowBlur = isLit ? 18 : (peg.isBomb ? 10 : 6);
        ctx.shadowColor = isLit ? "#ffffff" : (peg.isBomb ? "#ff0000" : "#ff4757");
        ctx.fill();
        
        if (peg.isBomb) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = "#ff4757";
            ctx.font = "bold 9px Rajdhani, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("-50", peg.x, peg.y - 14);
        }

        if (peg.lit > 0) peg.lit -= 0.04;
    }
    ctx.shadowBlur = 0;
}

function drawBall(b) {
    ctx.save();

    // Sombra exterior (glow)
    ctx.shadowBlur = b.heavy ? 35 : 14;
    ctx.shadowColor = b.color;

    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = b.color;
    ctx.fill();

    // Avatar (jugador real)
    const img = getAvatar(b.player.avatar);
    if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
        ctx.restore();
    } else if (b.isDemo) {
        // Demo: círculo con brillo interior, sin emojis de casino
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fill();
    }

    ctx.shadowBlur = 0;

    // Borde
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.strokeStyle = b.heavy ? "#ffffff" : "rgba(255,255,255,0.4)";
    ctx.lineWidth = b.heavy ? 3 : 1.5;
    ctx.stroke();

    ctx.restore();

    // Nombre del jugador SOLO si tiene avatar real y bola normal
    if (!b.isDemo && b.r >= BALL_R * 0.8 && b.player.name) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        const nameW = Math.min(b.player.name.length * 7, 80);
        ctx.fillRect(b.x - nameW/2, b.y + b.r + 2, nameW, 16);
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 11px Rajdhani, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(b.player.name.substring(0, 12), b.x, b.y + b.r + 4);
    }
}

function physicsStep(b) {
    b.vy += GRAVITY * (b.heavy ? 1.5 : 1);
    const spd = Math.hypot(b.vx, b.vy);
    if (spd > 22) { b.vx = b.vx/spd*22; b.vy = b.vy/spd*22; }
    b.x += b.vx;
    b.y += b.vy;

    // Paredes
    if (b.x < b.r)              { b.x = b.r;              b.vx = Math.abs(b.vx) * BOUNCE; }
    if (b.x > canvas.width-b.r) { b.x = canvas.width-b.r; b.vx = -Math.abs(b.vx) * BOUNCE; }

    // Anti-atascamiento: si la bola casi no se mueve, acumula frames atascada
    if (spd < 0.5 && Math.abs(b.vy) < 0.5) {
        b.stuckFrames++;
        if (b.stuckFrames > 60) {
            // Empujón lateral aleatorio fuerte para sacarla
            b.vx += (Math.random() > 0.5 ? 2 : -2);
            b.vy -= 2;
            b.stuckFrames = 0;
        }
    } else {
        b.stuckFrames = 0;
    }

    // Pegs
    const now = Date.now();
    for (const peg of pegs) {
        const dx = b.x - peg.x, dy = b.y - peg.y;
        const dist = Math.hypot(dx, dy);
        const min = b.r + PEG_R;
        if (dist < min && dist > 0) {
            const nx = dx/dist, ny = dy/dist;
            b.x += nx*(min-dist);
            b.y += ny*(min-dist);
            const dot = b.vx*nx + b.vy*ny;
            if (dot < 0) {
                b.vx -= (1+BOUNCE)*dot*nx;
                b.vy -= (1+BOUNCE)*dot*ny;
            }
            peg.lit = 1;
            
            // Si es bomba, castigo!
            if (peg.isBomb && !b.isDemo) {
                // Explosión más grande
                explode(b.x, b.y, "#ff0000", 18);
                if (now - b.lastSfxTime > 500) {
                    floatText(`-50 pts`, b.x, b.y - 15, "#ff0000");
                    socket.emit("arena:bombHit", { targetId: b.player.id });
                    // No saturar sonido de bomba
                }
            }
            
            // Cooldown de sonido para evitar ruido abrumador cuando rebota muy rápido
            if (now - b.lastSfxTime > 120) {
                if (peg.isBomb) sfxRoundEnd(); // Sonido feo
                else sfxPeg(); // Sonido normal
                b.lastSfxTime = now;
            }
        }
    }

    // Bola pesada empuja a otras
    if (b.heavy) {
        for (const o of balls) {
            if (o === b || !o.active) continue;
            const dx = o.x-b.x, dy = o.y-b.y;
            const dist = Math.hypot(dx,dy);
            const min = b.r+o.r;
            if (dist < min && dist > 0) {
                const nx=dx/dist, ny=dy/dist;
                o.x += nx*(min-dist);
                o.y += ny*(min-dist);
                o.vx += nx*6; o.vy += ny*3;
            }
        }
    }

    // Caída en bucket
    if (b.y > canvas.height - 75) {
        b.active = false;
        for (const bucket of buckets) {
            if (b.x > bucket.x && b.x < bucket.x + bucket.w) {
                bucket.flash = 1;
                const pName = b.player.name || "";
                const m = bucket.mult;

                // Explosion proporcional al multiplicador
                explode(b.x, b.y, b.color, m === 10 ? 40 : m === 5 ? 22 : 10);

                if (!b.isDemo) {
                    if (m === 10) {
                        // JACKPOT — pantalla entera
                        flashAlpha = 0.45; flashColor = "255,215,0";
                        screenShake = 18;
                        toast(`${pName} ¡JACKPOT x10! +PUNTOS MAXIMOS`, "#ffd700", 4000);
                        floatText(`JACKPOT x10`, b.x, b.y - 40, "#ffd700");
                        sfxBucket(10);
                        setTimeout(()=>sfxBucket(10), 200);
                        speak(`¡${pName} cayó en el DIEZ! ¡JACKPOT! ¡Máximos puntos!`);
                    } else if (m === 5) {
                        flashAlpha = 0.2; flashColor = "165,90,234";
                        screenShake = 8;
                        toast(`${pName} ganó x5 ¡Muy bien!`, "#a55eea", 2500);
                        floatText(`x5!`, b.x, b.y - 30, "#a55eea");
                        sfxBucket(5);
                        if (Math.random() < 0.4) speak(`¡${pName} en el cinco! ¡Bien jugado!`);
                    } else if (m === 3) {
                        flashAlpha = 0.1; flashColor = "46,213,115";
                        toast(`${pName} ganó x3`, "#2ed573", 2000);
                        floatText(`x3`, b.x, b.y - 25, "#2ed573");
                        sfxBucket(3);
                    } else {
                        floatText(`x1`, b.x, b.y - 20, "#1e90ff");
                        // Sin sonido para no saturar en x1
                    }
                    socket.emit("arena:tapAttack", { targetId: b.player.id, mult: m });
                }
                break;
            }
        }
        return false;
    }
    return true;
}

// ==========================================
// REY GLOBAL (TOP DE VICTORIAS)
// ==========================================
let globalKingData = null;
socket.on("arena:globalKing", (king) => {
    globalKingData = king;
});

// SCOREBOARD EN CANVAS (top 5 durante juego)
// ==========================================
function drawScoreboard() {
    // Dibujar al Rey Global por encima si existe
    if (globalKingData) {
        const boardW = Math.min(canvas.width * 0.45, 230);
        const boardX = canvas.width - boardW - 8;
        const kingY = 10;
        const rowH = 42;

        ctx.fillStyle = "rgba(255,215,0,0.2)";
        ctx.strokeStyle = "#ffd700";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(boardX, kingY, boardW, rowH, 8);
        ctx.fill();
        ctx.stroke();

        ctx.font = `bold 14px Rajdhani, sans-serif`;
        ctx.fillStyle = "#ffd700";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`👑 REY`, boardX + 8, kingY + rowH / 2);

        const name = (globalKingData.name || "?").substring(0, 10);
        const avatarUrl = globalKingData.avatar || "";
        const avatarSize = 28;
        const avatarX = boardX + 55;
        const avatarY = kingY + rowH / 2 - avatarSize / 2;

        if (avatarUrl) {
            const img = getAvatar(avatarUrl);
            if (img && img.complete) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI*2);
                ctx.clip();
                ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
                ctx.restore();
            }
        }

        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 12px Rajdhani, sans-serif`;
        ctx.fillText(name, avatarX + avatarSize + 8, kingY + rowH / 2 - 6);

        ctx.fillStyle = "#ffd700";
        ctx.font = `11px Rajdhani, sans-serif`;
        ctx.fillText(`${globalKingData.victories} VICTORIAS`, avatarX + avatarSize + 8, kingY + rowH / 2 + 8);
    }

    if (roundRanking.length === 0) return;
    const top = roundRanking.slice(0, 5);
    const rowH = 46;
    const boardW = Math.min(canvas.width * 0.45, 230);
    const boardX = canvas.width - boardW - 8;
    const boardY = 60;
    const medals = ["1", "2", "3", "4", "5"];
    const medalColors = ["#ffd700", "#c0c0c0", "#cd7f32", "#87ceeb", "#87ceeb"];

    // Fondo
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath();
    ctx.roundRect(boardX, boardY, boardW, top.length * rowH + 8, 10);
    ctx.fill();

    top.forEach((p, i) => {
        const name  = (p.name || p.n || "?").substring(0, 12);
        const score = p.score || p.s || 0;
        const y     = boardY + 8 + i * rowH;
        const color = getColor(p.id || p.i || name);
        const avatarUrl = p.avatar || p.a || "";

        // Medalla / número
        ctx.font = `bold 14px Rajdhani, sans-serif`;
        ctx.fillStyle = medalColors[i];
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`#${medals[i]}`, boardX + 8, y + rowH / 2);

        // Barra de color del jugador
        ctx.fillStyle = color;
        ctx.fillRect(boardX + 28, y + 4, 4, rowH - 8);

        // Avatar
        const avatarSize = 30;
        const avatarX = boardX + 38;
        const avatarY = y + rowH / 2 - avatarSize / 2;
        if (avatarUrl) {
            const img = getAvatar(avatarUrl);
            if (img && img.complete) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI*2);
                ctx.clip();
                ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
                ctx.restore();
            } else {
                ctx.fillStyle = "#333";
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI*2);
                ctx.fill();
            }
        } else {
            ctx.fillStyle = "#333";
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI*2);
            ctx.fill();
        }

        // Nombre
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 13px Rajdhani, sans-serif`;
        ctx.fillText(name, avatarX + avatarSize + 10, y + rowH / 2 - 7);

        // Puntos
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = `11px Rajdhani, sans-serif`;
        ctx.fillText(`${score} pts`, avatarX + avatarSize + 10, y + rowH / 2 + 8);
    });
}

function drawIdleScreen() {
    const t = Date.now() * 0.001;
    const msg = ATTRACT_MESSAGES[attractIdx];

    // Panel central semitransparente — único bloque de texto
    const panelW = Math.min(canvas.width * 0.82, 420);
    const panelH = 110;
    const panelX = canvas.width / 2 - panelW / 2;
    const panelY = canvas.height * 0.35 - panelH / 2;

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, 16);
    ctx.fill();

    // Borde coloreado del panel
    ctx.strokeStyle = msg.color;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 18;
    ctx.shadowColor = msg.color;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, 16);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // MENSAJE PRINCIPAL — grande, claro, UN texto
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.min(28, canvas.width * 0.058)}px Rajdhani, sans-serif`;
    ctx.fillStyle = msg.color;
    ctx.fillText(msg.text, canvas.width / 2, panelY + 38);

    // SUB-MENSAJE — acción concreta
    ctx.font = `${Math.min(17, canvas.width * 0.036)}px Rajdhani, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(msg.sub, canvas.width / 2, panelY + 76);

    // Flecha animada abajo del panel (CTA)
    const arrowY = Math.sin(t * 4) * 6;
    ctx.font = `bold 20px Rajdhani, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("▼  TAP TAP PARA EMPEZAR  ▼", canvas.width / 2, panelY + panelH + 28 + arrowY);
}

function drawToasts() {
    const now = Date.now();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = toasts.length - 1; i >= 0; i--) {
        const a = toasts[i];
        const elapsed = now - a.birth;
        if (elapsed > a.duration) { toasts.splice(i, 1); continue; }
        const p = elapsed / a.duration;
        const alpha = p < 0.1 ? p / 0.1 : p > 0.7 ? (1-p)/0.3 : 1;
        const scale = p < 0.1 ? 0.5 + p * 5 : 1;
        ctx.save();
        ctx.translate(canvas.width/2, 80 + i * 42);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.font = `bold 20px Orbitron, monospace`;
        ctx.shadowBlur = 15;
        ctx.shadowColor = a.color;
        ctx.fillStyle = a.color;
        ctx.fillText(a.text, 0, 0);
        ctx.shadowBlur = 0;
        ctx.restore();
    }
    ctx.globalAlpha = 1;
}

function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life -= 0.022;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function loop() {
    // Screen shake
    ctx.save();
    if (screenShake > 0) {
        ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake);
        screenShake *= 0.88;
        if (screenShake < 0.5) screenShake = 0;
    }

    drawBackground();

    // Siempre dibujar el tablero (pegs y buckets)
    drawBuckets();
    drawPegs();

    // Pantalla de espera (sin jugadores reales)
    if (Object.keys(players).filter(k => !k.startsWith("demo_")).length === 0) {
        drawIdleScreen();
    }

    // Física y dibujo de bolas
    for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (!b.active) { balls.splice(i, 1); continue; }
        const alive = physicsStep(b);
        if (!alive) { balls.splice(i, 1); continue; }
        drawBall(b);
    }

    drawParticles();
    drawToasts();

    // Scoreboard en canvas (top 3 siempre visible durante el juego)
    const hasRealPlayers = Object.keys(players).filter(k => !k.startsWith("demo_") && !k.startsWith("local_")).length > 0;
    if (hasRealPlayers) drawScoreboard();

    // Flash overlay
    if (flashAlpha > 0.01) {
        ctx.fillStyle = `rgba(${flashColor},${flashAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        flashAlpha *= 0.82;
    }

    ctx.restore();

    maybeNarrate();
    requestAnimationFrame(loop);
}

// ==========================================
// INTERACCIÓN LOCAL
// ==========================================
let tapDebounce = 0;
function onTap(e) {
    unlockAudio();
    startBGM();
    // Limitar a 1 tap visual cada 400ms para no saturar
    const now = Date.now();
    if (now - tapDebounce < 400) return;
    tapDebounce = now;
    const p = { id: "local_tap", name: "TAP", avatar: "" };
    ensurePlayer(p.id, p.name, p.avatar);
    spawnBall(players[p.id], 0.55, 1, 0);
    sfxPeg();
}

canvas.addEventListener("mousedown",  onTap);
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); onTap(e); }, { passive: false });

// ==========================================
// DEBUG PANEL
// ==========================================
if (DEBUG_MODE) {
    document.getElementById("debug-panel").style.display = "block";

    document.getElementById("debug-spawn-bot")?.addEventListener("click", () => {
        const id = "bot_" + Date.now();
        const p = ensurePlayer(id, "Bot_" + Math.floor(Math.random()*99), "");
        spawnBall(players[id], 1, 3);
        toast("Bot spawneado", "#2ed573");
    });

    document.getElementById("debug-gift-rose")?.addEventListener("click", () => {
        const id = "rose_" + Date.now();
        const p = ensurePlayer(id, "RoseGifter", "");
        spawnBall(players[id], 1, 5);
        sfxGift();
        toast("🌹 Rosa simulada", "#ff6b81");
    });

    document.getElementById("debug-gift-galaxy")?.addEventListener("click", () => {
        const id = "galaxy_" + Date.now();
        const p = ensurePlayer(id, "GalaxyGifter", "");
        spawnBall(players[id], 4.5, 1);
        screenShake = 20; sfxMega();
        toast("🦁 León simulado", "#ffa502");
    });
}

// ==========================================
// ARRANQUE
// ==========================================
requestAnimationFrame(loop);
