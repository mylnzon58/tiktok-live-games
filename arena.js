const socket = io();

// Elementos DOM
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const leaderboardEl = document.getElementById("arena-leaderboard");
const floatingLayer = document.getElementById("floating-ui-layer");

// Ajustar Canvas
canvas.width = window.innerWidth || 800;
canvas.height = window.innerHeight || 1920;
window.addEventListener("resize", () => {
    canvas.width = window.innerWidth || 800;
    canvas.height = window.innerHeight || 1920;
});

// ==========================================
// MOTOR DE AUDIO (SYNTH)
// ==========================================
let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let soundEnabled = true; // REVERTIDO: Por defecto activado (OBS / TikTok Studio lo permiten)

// Attempt auto-unlock de AudioContext silencioso
function tryUnlockAudio() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            checkAudioState();
        }).catch(e => { });
    } else {
        checkAudioState();
    }
}

function checkAudioState() {
    if (audioCtx.state === 'running' || audioCtx.state === 'closed') {
        if (!isBgmPlaying && typeof startBgm === 'function' && soundEnabled) {
            startBgm();
        }
        // Limpiar hooks globales si ya arrancó
        document.removeEventListener('click', tryUnlockAudio);
        document.removeEventListener('touchstart', tryUnlockAudio);
        document.removeEventListener('keydown', tryUnlockAudio);
    }
}

// Vincular interacción general en todo el documento
document.addEventListener('click', tryUnlockAudio);
document.addEventListener('touchstart', tryUnlockAudio);
document.addEventListener('keydown', tryUnlockAudio);

// Revisar contínuamente si ya está running (Navegadores comunes o si OBS permite autoplay)
let ctxUnlocker = setInterval(() => {
    if (audioCtx.state === 'running') {
        clearInterval(ctxUnlocker);
        checkAudioState();
    } else {
        // Intento silencioso constante
        audioCtx.resume().catch(e => { });
    }
}, 500);

const soundBtn = document.getElementById('sound-btn');
soundBtn.textContent = '🔊 Sonido ON';
soundBtn.classList.add('active');

soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    // Si estaba pausado el contexto, asegúrate de levantarlo primero
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => checkAudioState());
    }

    soundEnabled = !soundEnabled;
    e.target.textContent = soundEnabled ? '🔊 Sonido ON' : '🔇 Sonido OFF';
    e.target.classList.toggle('active', soundEnabled);

    if (soundEnabled) {
        startBgm();
        playSound("heal"); // Sonido de feedback
    } else {
        // Detener TODO el audio
        stopBgm();
    }
});

const debugBtn = document.getElementById("debug-spawn-btn");
if (debugBtn) {
    debugBtn.onclick = () => {
        const testId = "bot_tester_" + Math.floor(Math.random() * 1000);
        players[testId] = new Player({
            id: testId,
            name: "TESTER 🤖",
            hp: 500,
            score: 100
        });
        console.log("🧪 Debug: Spawning local tester player", testId);
    };
}

let bgMusicSource = null;

function playBackgroundMusic() {
    if (!soundEnabled || bgMusicSource) return;

    // Sintetizar un loop melódico suave (Ambient Techno/Game style)
    const now = audioCtx.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5

    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.12, now); // Volumen triplicado (era 0.04) para que sea el 'vibe' principal
    masterGain.connect(audioCtx.destination);

    function triggerNote(freq, time) {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, time);
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(0.06, time + 0.1); // Notas más claras
        g.gain.linearRampToValueAtTime(0, time + 2);
        osc.connect(g).connect(masterGain);
        osc.start(time);
        osc.stop(time + 2);
    }

    let nextNoteTime = now;
    const timer = setInterval(() => {
        if (!soundEnabled) { clearInterval(timer); bgMusicSource = null; return; }
        const note = notes[Math.floor(Math.random() * notes.length)];
        triggerNote(note, audioCtx.currentTime);
    }, 1000);

    bgMusicSource = timer;
}

const sfx = {
    shoot: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.01, audioCtx.currentTime); // Reducido aún más para no tapar música
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.1);
    },
    hit: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.02, audioCtx.currentTime); // Reducido aún más
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.2);
    },
    explosion: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sawtooth'; // Ruido blanco sería mejor pero esto sirve
        osc.frequency.setValueAtTime(50, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1, audioCtx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.4, audioCtx.currentTime); // Aumentado para impacto
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.5);
    },
    lightning: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(800, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.6, audioCtx.currentTime); // Duplicado de 0.3 para ser "Sorprendente"
        gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.2);
    },
    heal: (pitchMod = 1, force = false) => {
        if (!soundEnabled) return;

        // Throttling: máximo 10 sonidos de "pop" por segundo
        const now = Date.now();
        if (!force && lastHealSoundTime && (now - lastHealSoundTime < 100)) return;
        lastHealSoundTime = now;

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);

        // Sonido tipo "Burbuja" o "Pop" limpio
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800 * pitchMod, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100 * pitchMod, audioCtx.currentTime + 0.05);

        gain.gain.setValueAtTime(0.01, audioCtx.currentTime); // Casi total silencio para evitar fatiga auditiva
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);

        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.05);
    },
    tick: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.04);
        gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.04);
    },
    buzzsaw: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const oscNoise = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.connect(gain);
        oscNoise.connect(gain);
        gain.connect(audioCtx.destination);

        // Motor grave
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(50, audioCtx.currentTime);

        // Ruido metálico agudo
        oscNoise.type = 'square';
        oscNoise.frequency.setValueAtTime(800, audioCtx.currentTime);
        oscNoise.frequency.linearRampToValueAtTime(1200, audioCtx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.4, audioCtx.currentTime); // Sierra ruidosa y dopamínica
        // Fade out
        gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);

        osc.start(audioCtx.currentTime);
        oscNoise.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.4);
        oscNoise.stop(audioCtx.currentTime + 0.4);
    },
    heavyExplosion: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(40, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1, audioCtx.currentTime + 1.2);
        gain.gain.setValueAtTime(0.6, audioCtx.currentTime); // Boom masivo
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.2);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 1.2);
    },
    jackpot: () => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        // Sonido ascendente tipo tragamonedas (arpegio rápido)
        [440, 554, 659, 880, 1108, 1318].forEach((f, i) => {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(f, now + i * 0.05);
            g.gain.setValueAtTime(0.1, now + i * 0.05);
            g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.05 + 0.1);
            osc.connect(g).connect(audioCtx.destination);
            osc.start(now + i * 0.05);
            osc.stop(now + i * 0.05 + 0.1);
        });
    }
};

function playSound(type, param) {
    if (sfx[type]) sfx[type](param);
}

// ==========================================
// MÚSICA DE FONDO (BGM 8-BIT PROCEDURAL)
// ==========================================
let nextNoteTime = 0;
let currentNote = 0;
let bgmTimerID;
let isBgmPlaying = false;

// Escalas estilo 8-bit Dopamina / Boss Battle
const arp1 = [261.63, 311.13, 392.00, 523.25]; // Cm
const arp2 = [233.08, 277.18, 349.23, 466.16]; // Bbm
const arp3 = [207.65, 261.63, 311.13, 415.30]; // Ab
const arp4 = [196.00, 246.94, 293.66, 392.00]; // G

// Un loop de 64 pasos (cada acorde 16 semicorcheas)
const sequence = [
    ...Array(16).fill(0).map((_, i) => ({ arp: arp1[i % 4], bass: 130.81 })),
    ...Array(16).fill(0).map((_, i) => ({ arp: arp2[i % 4], bass: 116.54 })),
    ...Array(16).fill(0).map((_, i) => ({ arp: arp3[i % 4], bass: 103.83 })),
    ...Array(16).fill(0).map((_, i) => ({ arp: arp4[i % 4], bass: 98.00 }))
];

function scheduleNote(step, time) {
    if (!soundEnabled) return;
    const { arp, bass } = sequence[step];

    // Synth Lead (Melodía Rápida Arpegiada)
    const oscArp = audioCtx.createOscillator();
    const gainArp = audioCtx.createGain();
    oscArp.type = 'square';
    oscArp.frequency.value = arp * 2;

    // Decaimiento corto para dar efecto de 8-bits percusivo
    gainArp.gain.setValueAtTime(0.04, time);
    gainArp.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

    oscArp.connect(gainArp); gainArp.connect(audioCtx.destination);
    oscArp.start(time); oscArp.stop(time + 0.1);

    // Bajo 8-Bits (A tiempo de Octavos - Ritmo constante)
    if (step % 2 === 0) {
        const oscBass = audioCtx.createOscillator();
        const gainBass = audioCtx.createGain();
        oscBass.type = 'sawtooth';
        oscBass.frequency.value = bass / 2; // Bien grave

        gainBass.gain.setValueAtTime(0.08, time);
        gainBass.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

        oscBass.connect(gainBass); gainBass.connect(audioCtx.destination);
        oscBass.start(time); oscBass.stop(time + 0.2);
    }

    // Snare simulado 8-bit (Ruido blanco simple c/ onda muy grave que decae veloz)
    if (step % 8 === 4) {
        const oscSnare = audioCtx.createOscillator();
        const gainSnare = audioCtx.createGain();
        oscSnare.type = 'square';
        oscSnare.frequency.setValueAtTime(400, time);
        oscSnare.frequency.exponentialRampToValueAtTime(10, time + 0.1);

        gainSnare.gain.setValueAtTime(0.05, time);
        gainSnare.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

        oscSnare.connect(gainSnare); gainSnare.connect(audioCtx.destination);
        oscSnare.start(time); oscSnare.stop(time + 0.1);
    }
}

function scheduler() {
    if (!isBgmPlaying) return;
    // Programa notas hasta 100ms en el futuro para mantener la cadencia exacta
    while (nextNoteTime < audioCtx.currentTime + 0.1) {
        scheduleNote(currentNote, nextNoteTime);
        const secondsPerBeat = 0.11; // Ritmo súper rápido dopamina (aprox 136 bpm / semicorcheas)
        nextNoteTime += secondsPerBeat;
        currentNote = (currentNote + 1) % sequence.length;
    }
    bgmTimerID = setTimeout(scheduler, 25);
}

function startBgm() {
    if (isBgmPlaying) return;
    isBgmPlaying = true;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    nextNoteTime = audioCtx.currentTime + 0.05;
    scheduler();
}

function stopBgm() {
    isBgmPlaying = false;
    clearTimeout(bgmTimerID);
}

// ==========================================
// ESTRUCTURAS DE DATOS EN MEMORIA
// ==========================================
const players = {};
let projectiles = [];
let particles = [];
let lightningBolts = [];
let hazards = []; // Elementos peligrosos en el mapa como sierras y lasers
let ambientParticles = []; // Partículas ambientales de fondo

let lastHealSoundTime = 0;
const shockwaves = []; // Para efectos visuales de impactos grandes

let screenShake = 0; // Intensidad de vibración de pantalla
let hitStopFrames = 0; // Para el efecto visual congelado en grandes impactos

// ==========================================
// CONFIGURACIONES FÍSICAS
// ==========================================
const MAX_HP = 500; // Sincronizado con el servidor
let PLAYER_RADIUS = 50; // Aumentado de 45 a 50 para mejor escala inicial
const BASE_SPEED = 2; // Velocidad de rebote
const NUM_STARS = 100;

// Caché de imágenes pre-cargadas (Avatares)
const avatarCache = {};

// Dibujar fondo animado espacial (estrellas)
const bgStars = Array.from({ length: NUM_STARS }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: Math.random() * 2,
    speedY: Math.random() * 0.5 + 0.1
}));

function drawBackground() {
    // Fondo más claro para mayor visibilidad
    ctx.fillStyle = "rgba(15, 20, 35, 1)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    bgStars.forEach(s => {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        s.y -= s.speedY; // van hacia arriba simulando avance
        if (s.y < 0) {
            s.y = canvas.height;
            s.x = Math.random() * canvas.width;
        }
    });

    // Dibujar Jaula Circular (Arena limit)
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const arenaRadius = Math.min(canvas.width, canvas.height) / 2 - 10;

    ctx.beginPath();
    ctx.arc(cx, cy, arenaRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 240, 255, 0.2)";
    ctx.lineWidth = 15;
    ctx.stroke();

    // --- NÚCLEO: ZONA REY ---
    const coreRadius = 120;
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 215, 0, 0.08)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 215, 0, 0.4)";
    ctx.setLineDash([10, 10]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(255, 215, 0, 0.5)";
    ctx.font = "bold 24px Rajdhani";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("👑 ZONA REY", cx, cy);
    // ------------------------

    ctx.beginPath();
    ctx.arc(cx, cy, arenaRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 240, 255, 0.8)";
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#00f0ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
}

// ==========================================
// MOUSE INTERACTION (Para lanzar bot local de prueba)
// ==========================================
canvas.addEventListener("mousedown", (e) => {
    // Inicializar audio al hacer click (necesario por navegadores)
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    // Test hit stop y sonido
    // screenShake = 20;
    // hitStopFrames = 10;
    // playSound("heavyExplosion");
});

// Inicializar partículas ambientales
for (let i = 0; i < 50; i++) {
    ambientParticles.push({
        x: Math.random() * ctx.canvas.width,
        y: Math.random() * ctx.canvas.width, // Usar width por si no hay height aún
        vx: (Math.random() - 0.5) * 0.5,
        vy: -Math.random() * 1.5 - 0.5,
        size: Math.random() * 2 + 1,
        opacity: Math.random() * 0.5 + 0.1
    });
}

// ==========================================
// FUNCIONES DE GRÁFICOS Y UTILIDADES
// ==========================================

function getAvatarImage(url) {
    if (!url) return null;
    if (avatarCache[url]) return avatarCache[url];
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    avatarCache[url] = img;
    return img;
}

function spawnFloatingText(text, x, y, color) {
    const el = document.createElement("div");
    el.className = "floating-text";
    el.textContent = text;
    el.style.color = color;
    el.style.left = x + "px";
    el.style.top = y + "px";
    floatingLayer.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

function createExplosion(x, y, color) {
    // Screen shake en explosiones
    screenShake = Math.max(screenShake, 10);

    for (let i = 0; i < 30; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 12,
            vy: (Math.random() - 0.5) * 12,
            life: 1.0,
            size: Math.random() * 4 + 2,
            color: color || "#fff"
        });
    }
}

// ==========================================
// CLASES
// ==========================================
class Player {
    constructor(data) {
        this.id = data.id;
        this.name = data.name || "Guerrero";
        this.avatar = data.avatar || "";
        this.hp = data.hp || MAX_HP;
        this.score = data.score || 0;
        this.lastActive = data.lastActive || Date.now();

        // Spawn Random (Asegurando que no sea NaN)
        const safeWidth = canvas.width || 800;
        const safeHeight = canvas.height || 1920;
        this.x = data.x || (Math.random() * (safeWidth - 200) + 100);
        this.y = data.y || (Math.random() * (safeHeight - 200) + 100);

        // Sanity Check por si acaso
        if (isNaN(this.x) || isNaN(this.y)) {
            this.x = 200;
            this.y = 200;
        }

        // Propiedades dinámicas
        this.currentRadius = PLAYER_RADIUS;
        this.opacity = 1.0;

        // Vector de Movimiento Bouncingueno
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * BASE_SPEED;
        this.vy = Math.sin(angle) * BASE_SPEED;

        // Estado Flash visual por daño
        this.flash = 0;

        // Intervalo de reporte de posición al servidor
        if (this.id === socket.id || this.id.startsWith("bot_")) { // Opcional para bots locales
            // No hacemos nada especial aquí, se maneja en el loop principal
        }
    }

    update() {
        // AFK Shrinking & Fading (si pasaron más de 15 segundos)
        const idleTime = Date.now() - this.lastActive;
        const scoreScale = Math.min(Math.sqrt(this.score) / 0.8, 200); // Crecimiento aún más agresivo y tope de 200px extra
        const targetRadius = PLAYER_RADIUS + scoreScale;

        if (idleTime > 30000) {
            const decayFactor = Math.min((idleTime - 30000) / 15000, 1);

            // SPECTATOR MODE: No desaparecen del todo hasta que el servidor los borre
            const minRadius = PLAYER_RADIUS * 0.8;
            const minOpacity = 0.35;

            // Limitar encogimiento y transparencia
            this.currentRadius = Math.max(targetRadius * (1 - decayFactor * 0.6), minRadius);
            this.opacity = Math.max(1 - decayFactor, minOpacity);

            // Flotar suavemente en el fondo
            this.vx *= 0.98;
            this.vy *= 0.98;
        } else {
            // Suavizar el crecimiento
            this.currentRadius += (targetRadius - this.currentRadius) * 0.1;
            this.opacity = 1.0;

            // Restaurar velocidad si estaban lentos (Wandering activo)
            const currentSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
            if (currentSpeed < (BASE_SPEED * 0.5)) {
                const angle = Math.atan2(this.vy, this.vx) || (Math.random() * Math.PI * 2);
                this.vx = Math.cos(angle) * BASE_SPEED;
                this.vy = Math.sin(angle) * BASE_SPEED;
            }

            // --- MOVIMIENTO DINÁMICO (WANDERING) ---
            // Añadir pequeña fuerza aleatoria para que no se queden quietos
            if (Math.random() < 0.05) {
                this.vx += (Math.random() - 0.5) * 0.5;
                this.vy += (Math.random() - 0.5) * 0.5;
            }
        }

        // --- LÍMITE DE VELOCIDAD MÁXIMA ---
        const computedSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        const maxSpeed = 15;
        if (computedSpeed > maxSpeed) {
            this.vx = (this.vx / computedSpeed) * maxSpeed;
            this.vy = (this.vy / computedSpeed) * maxSpeed;
        }

        // Físicas
        this.x += this.vx;
        this.y += this.vy;

        // Rebote Jaula Circular
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const arenaRadius = Math.min(canvas.width, canvas.height) / 2 - 10;
        const dx = this.x - cx;
        const dy = this.y - cy;
        const distToCenter = Math.sqrt(dx * dx + dy * dy);

        // --- MOTIVACIÓN: ZONA REY ---
        const coreRadius = 120;
        if (this.opacity > 0.5 && distToCenter < coreRadius) {
            this.score += 0.1; // Crece más lento en el centro (ajustado de 0.3 a 0.1)
            if (Math.random() < 0.02) {
                spawnFloatingText("👑 +Poder", this.x, this.y - this.currentRadius, "#ffd700");
                this.flash = Math.max(this.flash, 0.5);
            }
            // Sincronizar periódicamente el score pasivo
            if (Math.random() < 0.02) {
                syncStateToServer(this);
            }
        }
        // ----------------------------

        if (distToCenter + this.currentRadius > arenaRadius) {
            const overlap = (distToCenter + this.currentRadius) - arenaRadius;
            const nx = dx / distToCenter;
            const ny = dy / distToCenter;
            this.x -= nx * overlap;
            this.y -= ny * overlap;

            const dotProd = this.vx * nx + this.vy * ny;
            if (dotProd > 0) {
                this.vx -= 2 * dotProd * nx;
                this.vy -= 2 * dotProd * ny;
            }
        } else if (this.opacity < 0.5) {
            // --- INACTIVIDAD FÍSICA: Empujar hacia los bordes ---
            // Si el jugador está inactivo (opacidad < 0.5), lo empujamos radialmente hacia fuera
            const pushForce = 0.2;
            const nx = dx / (distToCenter || 1);
            const ny = dy / (distToCenter || 1);
            this.vx += nx * pushForce;
            this.vy += ny * pushForce;
        }

        // CHOCAR CONTRA OTROS JUGADORES (MOSH PIT DOPAMÍNICO)
        for (const otherId in players) {
            if (otherId === this.id) continue;
            const other = players[otherId];
            if (!other || this.opacity < 0.5 || other.opacity < 0.5) continue; // Solo chocan activos

            const pdx = this.x - other.x;
            const pdy = this.y - other.y;
            const pdistance = Math.sqrt(pdx * pdx + pdy * pdy);
            const minDistance = this.currentRadius + other.currentRadius;

            if (pdistance > 0 && pdistance < minDistance) {
                const overlap = minDistance - pdistance;
                const pnx = pdx / pdistance;
                const pny = pdy / pdistance;

                // Empujar a los jugadores fuera de la colisión ponderado por masa/tamaño
                const massThis = this.currentRadius;
                const massOther = other.currentRadius;
                const totalMass = massThis + massOther;
                const ratioThis = massOther / totalMass;
                const ratioOther = massThis / totalMass;

                this.x += pnx * overlap * ratioThis;
                this.y += pny * overlap * ratioThis;
                other.x -= pnx * overlap * ratioOther;
                other.y -= pny * overlap * ratioOther;

                // --- MUERTE SÚBITA: Empuje violento ---
                if (isSuddenDeath) {
                    this.vx += pnx * 2;
                    this.vy += pny * 2;
                    other.vx -= pnx * 2;
                    other.vy -= pny * 2;
                }

                // Velocidad relativa
                const rvx = this.vx - other.vx;
                const rvy = this.vy - other.vy;

                // Velocidad a lo largo de la normal
                const velAlongNormal = rvx * pnx + rvy * pny;

                // Si se están alejando, no resolver velocidad
                if (velAlongNormal < 0) {
                    // Restitución (elasticidad)
                    const e = 0.8; // Bouncy
                    const j = -(1 + e) * velAlongNormal / (1 / massThis + 1 / massOther);

                    // Aplicar impulso
                    const impulseX = j * pnx;
                    const impulseY = j * pny;

                    this.vx += impulseX / massThis;
                    this.vy += impulseY / massThis;
                    other.vx -= impulseX / massOther;
                    other.vy -= impulseY / massOther;

                    // Añadir un micro-caos dopamínico
                    this.vx += (Math.random() - 0.5) * 1.5; // Incrementado jitter
                    this.vy += (Math.random() - 0.5) * 1.5;
                    other.vx += (Math.random() - 0.5) * 1.5;
                    other.vy += (Math.random() - 0.5) * 1.5;
                }

                const impactSpeed = Math.abs(this.vx) + Math.abs(this.vy) + Math.abs(other.vx) + Math.abs(other.vy);
                if (impactSpeed > 4 && Math.random() > 0.8) {
                    playSound("hit"); // Ruidito de choque adictivo
                }
            }
        }

        if (this.flash > 0) this.flash -= 0.05;
    }

    draw() {
        if (this.opacity <= 0.01) return; // Ya casi invisible, culling relajado

        // Failsafe preventivo por si NaN se filtró
        if (isNaN(this.currentRadius)) this.currentRadius = 15;
        if (isNaN(this.x) || isNaN(this.y)) return;

        ctx.save();
        ctx.globalAlpha = this.opacity;

        // Si flash es mayor a 0, añadir sombra blanca brillante (recibió daño o cura)
        if (this.flash > 0) {
            ctx.shadowBlur = 20;
            ctx.shadowColor = "#fff";
        }

        // Dibujar clip circular (avatar)
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip(); // Cortar a círculo

        const img = getAvatarImage(this.avatar);
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, this.x - this.currentRadius, this.y - this.currentRadius, this.currentRadius * 2, this.currentRadius * 2);
        } else {
            // Fallback de alto contraste
            ctx.fillStyle = "#666"; // Gris más claro
            ctx.fill();
            // Dibujar inicial o icono
            ctx.fillStyle = "white";
            ctx.font = `bold ${this.currentRadius}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(this.name[0].toUpperCase(), this.x, this.y);
        }

        ctx.restore(); // limpiar clip

        // Dibujar Borde (Color depende de Vida)
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
        ctx.lineWidth = 5 * (this.currentRadius / PLAYER_RADIUS); // Border un poco más grueso

        if (this.flash > 0) {
            ctx.strokeStyle = "white";
        } else {
            const hpPercent = (this.hp || 500) / MAX_HP; // Fallback para HP
            if (hpPercent > 0.6) {
                ctx.strokeStyle = "#2ed573";
            } else if (hpPercent > 0.3) {
                ctx.strokeStyle = "#ffa502";
            } else {
                ctx.strokeStyle = "#ff4757";
                // Heartbeat adictivo de "Near Miss"
                if (Date.now() % 600 < 300) {
                    ctx.lineWidth += 4;
                    ctx.shadowBlur = 15;
                    ctx.shadowColor = "#ff4757";
                }
            }
        }
        ctx.stroke();
        ctx.shadowBlur = 0; // reset

        // NOMBRE SIEMPRE VISIBLE
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Rajdhani";
        ctx.textAlign = "center";
        ctx.shadowBlur = 4;
        ctx.shadowColor = "black";
        ctx.fillText(this.name, this.x, this.y + this.currentRadius + 15);
        ctx.shadowBlur = 0;

        ctx.globalAlpha = 1.0;

        // Si está muy chico, no mostramos texto para evitar choclazo visual
        if (this.currentRadius < 15) return;

        // Dibujar nombre y HP
        ctx.fillStyle = "white";
        ctx.font = "bold 12px Rajdhani";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${Math.floor(this.hp)} HP`, this.x, this.y + this.currentRadius + 12);

        // Nombre
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "10px sans-serif";
        ctx.fillText(this.name.substring(0, 10), this.x, this.y + this.currentRadius + 24);

        // --- CORONA DE CAMPEÓN ---
        if (this.id === lastArenaChampionId) {
            ctx.fillStyle = "#ffd700";
            ctx.font = "24px Arial";
            ctx.fillText("👑", this.x, this.y - this.currentRadius - 38);
        }
    }

    takeDamage(amount, attackerId) {
        if (this.hp <= 0) return; // ya muerto

        // DUPLICAR DAÑO EN MUERTE SÚBITA
        let finalAmt = isSuddenDeath ? amount * 2 : amount;

        this.hp -= finalAmt;
        this.flash = 1;

        spawnFloatingText(`-${Math.floor(finalAmt)}`, this.x, this.y, isSuddenDeath ? "#ff0000" : "#ff4757");

        // Recompensar al atacante
        if (attackerId && players[attackerId]) {
            players[attackerId].score += finalAmt;
            syncStateToServer(players[attackerId]);
        }

        if (this.hp <= 0) {
            // Muerte explosiva masiva
            createExplosion(this.x, this.y, "#ff4757");
            screenShake = 20;
            spawnFloatingText(`💥 K.O.`, this.x, this.y, "#ffeb3b");
            playSound("explosion");

            // RECOMPENSA DE K.O. (Bono Gladiador + ROBO DE PUNTOS)
            if (attackerId && players[attackerId]) {
                const stolenScore = Math.floor(this.score * 0.2); // Roba el 20%
                this.score -= stolenScore;
                players[attackerId].score += (500 + stolenScore);

                spawnFloatingText(`+${500 + stolenScore} KILL STEAL! ⚔️`, players[attackerId].x, players[attackerId].y - 40, "#ffd700");
                syncStateToServer(players[attackerId]);
            }

            // Respawn después de 2 segs
            this.hp = 0; // dejar muerto visualmente o mandarlo a volar
            setTimeout(() => {
                this.hp = MAX_HP;
                this.x = Math.random() * (canvas.width - 200) + 100;
                this.y = Math.random() * (canvas.height - 200) + 100;
                this.flash = 1;
                createExplosion(this.x, this.y, "#2ed573"); // Explosion verde spawn
                syncStateToServer(this);
            }, 2000);
        }

        syncStateToServer(this);
    }

    heal(amount) {
        if (this.hp <= 0) return;

        const wasCritical = this.hp < MAX_HP * 0.15; // Menos del 15%
        this.hp = Math.min(this.hp + amount, MAX_HP);
        this.score += amount; // Hacemos que los Tap Taps (curación) también sumen para crecer
        this.flash = 1;

        // Efecto visual "Salvada Épica" (Near Miss neuromarketing)
        if (wasCritical && this.hp >= MAX_HP * 0.15) {
            spawnFloatingText("¡SALVADA ÉPICA! 🛡️", this.x, this.y - 40, "#2ed573");
            screenShake = Math.max(screenShake, 15);
        } else {
            spawnFloatingText(`+${amount}`, this.x, this.y, "#2ed573");
        }

        playSound("heal");
        syncStateToServer(this);
    }
}

class Projectile {
    constructor(sx, sy, targetId, damage, attackerId, color) {
        this.x = sx; this.y = sy;
        this.targetId = targetId;
        this.damage = damage;
        this.attackerId = attackerId;
        this.color = color || "#00f0ff";
        this.speed = 10;
        this.active = true;
    }
    update() {
        const target = players[this.targetId];
        if (!target || target.hp <= 0) {
            this.active = false; // Objetivo murió en camino
            return;
        }

        // Homming missile (sigue al objetivo en movimiento)
        const dx = target.x - this.x; const dy = target.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        this.x += (dx / dist) * this.speed;
        this.y += (dy / dist) * this.speed;

        particles.push({ x: this.x, y: this.y, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, life: 0.5, color: this.color });

        if (dist < PLAYER_RADIUS) {
            this.active = false; // Impactó
            playSound("hit");
            target.takeDamage(this.damage, this.attackerId);
        }
    }
    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, 8, 0, Math.PI * 2); // Más grande (8 en vez de 6)
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 15; // Más brillo
        ctx.shadowColor = this.color;
        ctx.fill();
        ctx.shadowBlur = 0;
    }
}

// Clase para Peligros (Buzzsaw / Sierra)
class Buzzsaw {
    constructor(x, y, attackerId, duration) {
        this.x = x; this.y = y;
        this.radius = 40;
        this.attackerId = attackerId; // Quien lo tiró (para puntos)
        this.angle = 0;
        const moveAngle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(moveAngle) * 5; // Más rápida
        this.vy = Math.sin(moveAngle) * 5;
        this.life = duration; // frames de vida (~600 = 10 segundos)
        this.active = true;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.angle += 0.3; // Rota muy rápido
        this.life--;

        if (this.life <= 0) this.active = false;

        // Rebote furioso en Jaula Circular
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const arenaRadius = Math.min(canvas.width, canvas.height) / 2 - 10;
        const dx = this.x - cx;
        const dy = this.y - cy;
        const distToCenter = Math.sqrt(dx * dx + dy * dy);

        if (distToCenter + this.radius > arenaRadius) {
            playSound("hit");
            const overlap = (distToCenter + this.radius) - arenaRadius;
            const nx = dx / distToCenter;
            const ny = dy / distToCenter;
            this.x -= nx * overlap;
            this.y -= ny * overlap;

            const dotProd = this.vx * nx + this.vy * ny;
            if (dotProd > 0) {
                this.vx -= 2 * dotProd * nx;
                this.vy -= 2 * dotProd * ny;
            }
        }

        // Colisión con jugadores (Daño en área constante)
        if (this.life % 5 === 0) { // Check collision every 5 frames to prevent instakill
            for (const id in players) {
                const p = players[id];
                if (p.hp > 0 && p.opacity > 0.5) { // Solo hace daño a activos
                    const dist = Math.sqrt((this.x - p.x) ** 2 + (this.y - p.y) ** 2);
                    if (dist < this.radius + p.currentRadius) {
                        p.takeDamage(20, this.attackerId); // 20 daño contínuo
                        createExplosion(p.x, p.y, "#999");
                    }
                }
            }
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // Dibujar cuerpo de la sierra
        ctx.beginPath();
        ctx.arc(0, 0, this.radius - 5, 0, Math.PI * 2);
        ctx.fillStyle = "#7f8fa6"; // Metal base
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#353b48";
        ctx.stroke();

        // Dibujar dientes de la sierra
        ctx.beginPath();
        const teeth = 12;
        for (let i = 0; i < teeth; i++) {
            const rot = (i * Math.PI * 2) / teeth;
            ctx.moveTo(Math.cos(rot) * (this.radius - 8), Math.sin(rot) * (this.radius - 8));
            ctx.lineTo(Math.cos(rot + 0.1) * this.radius, Math.sin(rot + 0.1) * this.radius);
            ctx.lineTo(Math.cos(rot + 0.2) * (this.radius - 8), Math.sin(rot + 0.2) * (this.radius - 8));
        }
        ctx.fillStyle = "#e84118"; // Sangre o rojo furioso
        ctx.fill();

        // Agujero centro
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fillStyle = "#2f3640";
        ctx.fill();

        ctx.restore();
    }
}

// Clase para Rayos Giratorios (Laser Beam)
class LaserBeam {
    constructor(x, y, attackerId, duration) {
        this.x = x; this.y = y;
        this.attackerId = attackerId;
        this.angle = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() > 0.5 ? 1 : -1) * 0.05;
        this.length = 1500; // Suficiente para cruzar la pantalla
        this.life = duration;
        this.active = true;
        this.color = "#a855f7"; // Morado NEON
    }

    update() {
        this.angle += this.rotationSpeed;
        this.life--;
        if (this.life <= 0) this.active = false;

        // Cada 10 frames checkeamos hit para no ser demasiado op
        if (this.life % 4 === 0) {
            for (const id in players) {
                const p = players[id];
                if (p.hp > 0 && p.opacity > 0.5 && p.id !== this.attackerId) {
                    // Colision Linea-Circulo
                    // Simplificado: punto p proyectado en la linea del laser
                    const dx = p.x - this.x;
                    const dy = p.y - this.y;
                    const distToLine = Math.abs(dx * Math.sin(this.angle) - dy * Math.cos(this.angle));

                    if (distToLine < p.currentRadius + 5) {
                        p.takeDamage(15, this.attackerId);
                        createExplosion(p.x, p.y, this.color);
                    }
                }
            }
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // Brillo exterior
        ctx.beginPath();
        ctx.moveTo(-this.length, 0);
        ctx.lineTo(this.length, 0);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 15;
        ctx.globalAlpha = 0.3;
        ctx.stroke();

        // Nucleo blanco
        ctx.beginPath();
        ctx.moveTo(-this.length, 0);
        ctx.lineTo(this.length, 0);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 4;
        ctx.globalAlpha = 1.0;
        ctx.stroke();

        ctx.restore();
    }
}

// ==========================================
// ESTADO GLADIADOR (ROUND RULES)
// ==========================================
let isSuddenDeath = false;
let lastArenaChampionId = null;

socket.on("arena:suddenDeath", (active) => {
    isSuddenDeath = active;
    if (active) {
        spawnFloatingText("🔥 MUERTE SÚBITA: DAÑO x2 🔥", canvas.width / 2, canvas.height / 2 - 200, "#ff0000");
        screenShake = 30;
        playSound("heavyExplosion");
    }
});

socket.on("arena:champion", (id) => {
    lastArenaChampionId = id;
    console.log("🏆 El campeón reinante es:", id);
});

// ==========================================
// MÉTODOS DE RED (SOCKETS)
// ==========================================
function syncStateToServer(p) {
    // Solo reportamos si somos nosotros mismos (el dueño del socket)
    // O si queremos que el servidor sepa dónde está este jugador para calcular distancias
    socket.emit("arena:updatePlayer", {
        id: p.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        hp: p.hp,
        score: p.score
    });
}

let myArenaId = null;

socket.on("arena:sync", (serverPlayers) => {
    for (const id in serverPlayers) {
        const sp = serverPlayers[id];
        if (!players[id]) {
            players[id] = new Player(sp);
        } else {
            // Sincronizar stats vitales desde el servidor (Autoridad)
            players[id].hp = sp.hp;
            players[id].score = sp.score;
            players[id].name = sp.name;
            if (sp.avatar) players[id].avatar = sp.avatar;

            // Solo sincronizamos X/Y si NO es nuestro propio jugador (para evitar jitter)
            if (id !== myArenaId && !id.startsWith("bot_")) {
                players[id].x = sp.x;
                players[id].y = sp.y;
            }
        }
    }
    // Remover juagadores que ya no están en el servidor
    for (const id in players) {
        if (!serverPlayers[id]) delete players[id];
    }
    updateRankingDOM();
});

// --- CAPA TOP SHOWCASE (Podio Superior) ---
const topShowcaseEl = document.getElementById("top-arena-showcase") || document.createElement("div");
if (!topShowcaseEl.id) {
    topShowcaseEl.id = "top-arena-showcase";
    document.body.appendChild(topShowcaseEl);
}

// Nueva función para inyectar la guía de poderes con iconos reales
function updatePowersGuide() {
    const guideEl = document.getElementById("powers-guide");
    if (!guideEl) return;

    const basicGifts = [
        { name: "ROSA", effect: "DISPARO", icon: "🌹" },
        { name: "PESAS", effect: "GOLPE X3", icon: "🏋️" },
        { name: "DORMIR", effect: "CONGELAR", icon: "😴" },
        { name: "CORAZÓN", effect: "REGEN", icon: "💖" }
    ];

    const legendaryGifts = [
        { name: "GALAXIA", effect: "⚡ RAYO", icon: "🌌" },
        { name: "FUEGO", effect: "¡ INCENDIO !", icon: "🔥" },
        { name: "UNIVERSO", effect: "💥 K.O. TOTAL!", icon: "🪐" },
        { name: "LEÓN", effect: "⚙️ SIERRA", icon: "🦁" }
    ];

    const renderList = (list) => `<ul>${list.map(g => `
        <li>
            <span class="emoji">${g.icon}</span>
            <span class="gift-text">${g.name} = <span class="effect-text">${g.effect}</span></span>
        </li>
    `).join('')}</ul>`;

    guideEl.innerHTML = `
        <div class="powers-row">
            <div class="powers-category">⚡ BÁSICOS</div>
            ${renderList(basicGifts)}
        </div>
        <div class="powers-row">
            <div class="powers-category">🔥 LEGENDARIOS</div>
            ${renderList(legendaryGifts)}
        </div>
    `;
}
// Escuchamos el Hall of Fame persistente del servidor (Top 10 real de 12 horas)
socket.on("arena:hallOfFameUpdate", (list) => {
    console.log("🏆 Recibido Hall of Fame:", list);
    persistentHOF = list;
    updateTopShowcase(); // Actualizar el podio de gala superior
});

updatePowersGuide();

function updateTopShowcase() {
    // Tomamos los 3 primeros del Hall of Fame PERSISTENTE (Sincronizado del servidor)
    const top3 = [...persistentHOF]; // Copiar lista

    // Rellenamos con placeholders si hay menos de 3 para que el podio no desaparezca
    while (top3.length < 3) {
        top3.push({
            name: "ESPERANDO...",
            avatar: "https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image", // Icono por defecto
            score: 0,
            isPlaceholder: true
        });
    }

    topShowcaseEl.style.display = "flex";
    topShowcaseEl.innerHTML = ""; // Limpiar antes de rellenar

    if (top3.length === 0) {
        console.warn("⚠️ Top Hall of Fame está vacío.");
    }

    // Orden Visual: [Rank 2] [Rank 1] [Rank 3]
    const visualOrder = [top3[1], top3[0], top3[2]]; // 2nd, 1st, 3rd

    visualOrder.forEach((p, idx) => {
        if (!p) return;
        const realRank = (idx === 0) ? 2 : (idx === 1 ? 1 : 3);
        const item = document.createElement("div");
        item.className = `top-player-item rank-${realRank} ${p.isPlaceholder ? 'placeholder' : ''}`;

        item.innerHTML = `
            <div class="top-player-avatar" style="background-image: url('${p.avatar || ''}')"></div>
            <div class="top-rank-badge">${realRank}</div>
            <div class="top-player-name">${p.name}</div>
            ${p.isPlaceholder ? '' : '<div class="follow-arrow">⬆️</div>'}
        `;
        topShowcaseEl.appendChild(item);
    });
}


// Sincronización de identidad
socket.on("arena:you", (data) => {
    myArenaId = data.uniqueId;
    console.log("👤 Identidad en Arena:", myArenaId);
});

// --- CAPA CUENTA REGRESIVA ---
const countdownOverlay = document.createElement("div");
countdownOverlay.className = "countdown-overlay";
document.body.appendChild(countdownOverlay);

socket.on("timerUpdate", (seconds) => {
    if (seconds <= 10 && seconds > 0) {
        countdownOverlay.textContent = seconds;
        countdownOverlay.classList.add("active");

        // Cambiar color si es crítico
        if (seconds <= 5) {
            countdownOverlay.classList.remove("normal");
            countdownOverlay.classList.add("warning");
        } else {
            countdownOverlay.classList.remove("warning");
            countdownOverlay.classList.add("normal");
        }

        // Sonido de "Tick" suave para no molestar
        playSound("tick");
    } else {
        countdownOverlay.classList.remove("active");
    }
});

// Listener para el botón de sonido (usando delegación o buscando el elemento)
document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "toggle-sound") {
        soundEnabled = !soundEnabled;
        const btn = e.target;
        if (soundEnabled) {
            btn.textContent = "🔊 SONIDO ON";
            btn.classList.add("active");
            if (audioCtx.state === 'suspended') audioCtx.resume();
            playBackgroundMusic();
        } else {
            btn.textContent = "🔇 SONIDO OFF";
            btn.classList.remove("active");
        }
    }
});

socket.on("arena:roundEnd", (data) => {
    countdownOverlay.classList.remove("active");
    if (!data || !data.winner) {
        spawnFloatingText("⚔️ FIN DE RONDA - EMPATE ⚔️", canvas.width / 2, canvas.height / 2 - 100, "#fff");
        return;
    }

    const w = data.winner;
    console.log("🏆 GANADOR DE LA ARENA:", w.name);

    // Efecto visual masivo de Victoria (Volumen reducido)
    screenShake = 50;
    playSound("jackpot", 0.8);
    setTimeout(() => playSound("heavyExplosion", 0.7), 500);

    // Overlay de Victoria
    const overlay = document.createElement("div");
    overlay.className = "victory-overlay";
    overlay.innerHTML = `
        <div class="victory-card">
            <h1 class="victory-title">👑 CAMPEÓN ARENA 👑</h1>
            <img class="victory-avatar" src="${w.avatar || 'https://www.tiktok.com/favicon.ico'}" onerror="this.src='https://www.tiktok.com/favicon.ico'"/>
            <h2 class="victory-name">${w.name}</h2>
            <div class="victory-stats">🏆 MVP GLADIADOR - SCORE: ${Math.floor(w.score)}</div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Fuegos artificiales (explosiones doradas)
    for (let i = 0; i < 15; i++) {
        setTimeout(() => {
            const rx = Math.random() * canvas.width;
            const ry = Math.random() * canvas.height;
            createExplosion(rx, ry, "#ffd700");
            playSound("explosion");
        }, i * 200);
    }

    // Auto-remover overlay después de 8 segundos
    setTimeout(() => {
        overlay.classList.add("fade-out");
        setTimeout(() => overlay.remove(), 1000);
    }, 8000);
});

socket.on("arena:join", (p) => {
    if (!players[p.id]) {
        players[p.id] = new Player(p);
        createExplosion(players[p.id].x, players[p.id].y, "#00f0ff");
        playSound("heal", 1.5);
    }
    updateRankingDOM();
});

socket.on("arena:jackpot", (data) => {
    const attacker = players[data.attackerId];
    if (!attacker) return;

    playSound("jackpot");
    spawnFloatingText(`🎰 JACKPOT x${data.multiplier}! 🎰`, attacker.x, attacker.y - 60, "#fbbf24");
    screenShake = Math.max(screenShake, 20);

    // Efecto visual de destello en el atacante
    attacker.flash = 1;

    // Crear muchas chispas doradas
    for (let i = 0; i < 20; i++) {
        particles.push({
            x: attacker.x,
            y: attacker.y,
            vx: (Math.random() - 0.5) * 15,
            vy: (Math.random() - 0.5) * 15,
            life: 1.0,
            color: "#fbbf24"
        });
    }
});

// EVENTO SALIDA / AFK (GC Sweep)
socket.on("arena:leave", (data) => {
    if (players[data.id]) {
        // Efecto visual de salir
        createExplosion(players[data.id].x, players[data.id].y, "#555");
        delete players[data.id];
        updateRankingDOM();
    }
});

// Variables para combo de Likes
const recentHeals = {};

// EVENTO DE CURACIÓN / APOYO (LIKES / TAP TAP)
socket.on("arena:like", (data) => {
    const p = players[data.userId];
    if (p) {
        p.lastActive = Date.now(); // Despierta de AFK inmediatamente
        p.heal(data.likeCount * 5); // Aumentado de 1 para crecimiento más visible
        p.flash = 1;

        // Crecimiento físico real
        p.radius = Math.min(p.radius + (data.likeCount * 0.1), 120);
        screenShake = Math.max(screenShake, 2); // Micro-temblor por cada like activo

        // Dopamina física: El jugador "salta" o se empuja al recibir likes
        p.vx += (Math.random() - 0.5) * 6;
        p.vy += (Math.random() - 0.5) * 6;

        // Calcular combo de curación para Pitch Shifting
        const now = Date.now();
        if (!recentHeals[data.userId] || (now - recentHeals[data.userId].time > 2000)) {
            recentHeals[data.userId] = { strikes: 0, time: now };
        }
        recentHeals[data.userId].strikes += 1;
        recentHeals[data.userId].time = now;

        // Limitar pitch para no romper los tímpanos (máximo 2x pitch normal)
        const pitchMod = Math.min(1 + (recentHeals[data.userId].strikes * 0.05), 2.0);

        playSound("heal", pitchMod);

        // Mostrar texto de apoyo adictivo (Combos épicos)
        const strikes = recentHeals[data.userId].strikes;
        if (strikes > 0 && strikes % 50 === 0) {
            spawnFloatingText(`🔥 COMBO x${strikes}! 🔥`, p.x, p.y - 40, "#ff4757");
            screenShake = Math.max(screenShake, 15);
            playSound("heavyExplosion"); // Boom para celebrar el combo
        } else if (data.likeCount >= 5 || strikes % 10 === 0) {
            spawnFloatingText(`TAP TAP x${strikes}! ✨`, p.x, p.y, "#2ed573");
        }
    }
});

// EVENTO DE PODER POR CHAT (Aura Visual)
socket.on("arena:chatPower", (data) => {
    const p = players[data.userId];
    if (p) {
        // Efecto visual de "Aura"
        p.flash = 1;
        spawnFloatingText(`✨ ${data.keyword}! ✨`, p.x, p.y - 40, "#00f0ff");

        // Pequeño impulso físico
        p.vx += (Math.random() - 0.5) * 4;
        p.vy += (Math.random() - 0.5) * 4;

        // Partículas circulares tipo Aura
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            particles.push({
                x: p.x + Math.cos(angle) * p.radius,
                y: p.y + Math.sin(angle) * p.radius,
                vx: Math.cos(angle) * 3,
                vy: Math.sin(angle) * 3,
                life: 0.8,
                color: "#00f0ff"
            });
        }

        playSound("heal", 0.5); // Sonido suave para el aura
        screenShake = Math.max(screenShake, 3);
    }
});

// EVENTO DE ATAQUE (REGALOS)
socket.on("arena:gift", (data) => {
    const attacker = players[data.userId];
    if (!attacker) return;

    attacker.lastActive = Date.now(); // Despierta de AFK inmediatamente

    attacker.lastActive = Date.now(); // Reset AFK timer on attack

    const diamonds = data.diamondCount * data.count;
    console.log(`🎁 GIFT RECEIVED: ${data.giftName} x${data.count} (${diamonds} 💎) from ${data.userId}`);

    // Feedback visual inmediato para TODOS los regalos
    spawnFloatingText(`${data.giftName} x${data.count} ✨`, attacker.x, attacker.y, "#fdcb6e");

    // Usar el objetivo dictado por el servidor para consistencia
    let target = players[data.targetId];

    // Fallback por si el objetivo no existe localmente aún
    if (!target) {
        let minDist = Infinity;
        for (const id in players) {
            if (id === attacker.id || players[id].hp <= 0) continue;
            const enemy = players[id];
            const dist = Math.sqrt((attacker.x - enemy.x) ** 2 + (attacker.y - enemy.y) ** 2);
            if (dist < minDist) { minDist = dist; target = enemy; }
        }
    }

    if (!target) return; // No hay a quien atacar

    // Logica por regalo (Daño base)
    let damage = diamonds * 100; // Daño duplicado de 50 a 100

    // Crecimiento agresivo por regalo
    attacker.radius = Math.min(attacker.radius + (diamonds * 0.5), 180);
    screenShake = Math.max(screenShake, 10 + (diamonds * 0.1)); // Temblor dinámico
    attacker.flash = 1;
    let atkType = "projectile";
    let color = "#00f0ff";

    // Efectos visuales según nombre del regalo (Detección bilingüe avanzada)
    const gName = data.giftName.toLowerCase();

    // 1. NIVEL DIOS (Universe, León, Interstellar)
    if (gName.includes("universe") || gName.includes("universo") || gName.includes("lion") || gName.includes("león") || diamonds >= 20000) {
        playSound("heavyExplosion"); // Sonido pesado
        screenShake = 100; // Sacudida extrema
        hitStopFrames = 15; // Congela el juego durante 15 frames (cuarto de segundo) para impacto brutal
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)"; // DESTELO BLANCO
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        spawnFloatingText("🌌 UNIVERSO !", target.x, target.y, "#ff00ff");
        createExplosion(target.x, target.y, "#fff"); // Explosión blanca cegadora
        shockwaves.push({ x: target.x, y: target.y, r: 10, opacity: 1.0, color: "#fff" });

        // Daño devastador inmediato
        target.takeDamage(diamonds * 15, attacker.id);
        atkType = "none";
    }
    // 2. NIVEL LEYENDA (Galaxia, Planeta, Interstellar, etc)
    else if (gName.includes("galaxy") || gName.includes("galaxia") || gName.includes("planet") || gName.includes("planeta") || diamonds >= 5000) {
        playSound("lightning");
        screenShake = 30;
        spawnFloatingText("✨ GALAXIA !", target.x, target.y, "#0abde3");

        // Múltiples rayos secuenciales
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                lightningBolts.push({
                    sx: attacker.x, sy: attacker.y,
                    tx: target.x + (Math.random() - 0.5) * 100,
                    ty: target.y + (Math.random() - 0.5) * 100,
                    life: 1.0, color: "#0abde3"
                });
                target.takeDamage(diamonds * 5, attacker.id);
            }, i * 150);
        }
        atkType = "none";
    }
    // 3. NIVEL ESPECIAL (Sierra)
    else if (diamonds > 900) {
        atkType = "buzzsaw";
    }
    // 4. NIVEL ATAQUE (Star, Zapato, etc)
    else if (gName.includes("star") || gName.includes("estrella") || gName.includes("zapato") || gName.includes("hat") || gName.includes("gorra")) {
        atkType = "laser";
    }
    // 5. NIVEL BÁSICO (Rosita, Donut, etc)
    else if (gName.includes("rose") || gName.includes("rosa")) {
        atkType = "projectile"; color = "#ff4757";
    } else if (gName.includes("donut") || gName.includes("dona") || gName.includes("ray") || gName.includes("relámpago")) {
        atkType = "lightning"; color = "#fbbf24";
    } else if (gName.includes("perfume") || gName.includes("makeup") || gName.includes("maquillaje")) {
        atkType = "projectile"; color = "#a855f7";
    } else {
        // Regalo genérico o mediano
        atkType = diamonds > 50 ? "lightning" : "projectile";
        color = "#00f0ff";
    }

    // Efecto de onda al recibir CUALQUIER regalo moderado
    if (attacker && diamonds > 10) {
        shockwaves.push({ x: attacker.x, y: attacker.y, r: 10, opacity: 0.8, color: color });
    }

    // Ejecutar efectos remanentes si no fue daño directo (none)
    if (atkType === "projectile") {
        // Daño inicial inmediato para regalos grandes para que se sienta el golpe
        if (diamonds >= 500) {
            target.takeDamage(damage * 0.2, attacker.id);
        }

        for (let i = 0; i < Math.min(data.count, 15); i++) {
            setTimeout(() => {
                playSound("shoot");
                projectiles.push(new Projectile(attacker.x, attacker.y, target.id, (damage / data.count), attacker.id, color));
            }, i * 120);
        }
    } else if (atkType === "lightning") {
        playSound("lightning");
        lightningBolts.push({ sx: attacker.x, sy: attacker.y, tx: target.x, ty: target.y, life: 1.0, color });
        target.takeDamage(damage, attacker.id);
        const tx = target.x;
        const ty = target.y;
        createExplosion(tx, ty, color);

        // Shockwave para rayos
        shockwaves.push({ x: tx, y: ty, r: 10, opacity: 1.0, color: color });

        // Más partículas
        for (let i = 0; i < 15; i++) {
            particles.push({ x: tx, y: ty, vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 0.5) * 15, life: 1.0, color });
        }
    } else if (atkType === "buzzsaw") {
        playSound("buzzsaw");
        playSound("explosion"); // Sonido de Spawn inicial
        spawnFloatingText("⚠️ SIERRA !", canvas.width / 2, canvas.height / 2, "#ff0000");
        hazards.push(new Buzzsaw(canvas.width / 2, canvas.height / 2, attacker.id, 600));
    } else if (atkType === "laser") {
        playSound("lightning");
        spawnFloatingText("⚡ LASER !", attacker.x, attacker.y, "#a855f7");
        hazards.push(new LaserBeam(attacker.x, attacker.y, attacker.id, 400));
    }
});

// ==========================================
// GAME LOOP Y DIBUJADO
// ==========================================

// Registro persistente de los mejores jugadores de la sesión (Hall of Fame) - AHORA MANEJADO POR SERVIDOR
let arenaHallOfFame = []; // Ranking de la ronda actual
let persistentHOF = [];   // Top 10 histórico de 12 horas

function updateRankingDOM() {
    updateTopShowcase(); // Actualizar podio superior
    // Solo mostramos el TOP 5 en el ranking horizontal
    const top5 = arenaHallOfFame.slice(0, 5);
    leaderboardEl.innerHTML = "";

    top5.forEach((p, idx) => {
        let rankClass = (idx === 0) ? "p1" : "p-rest";

        const row = document.createElement("div");
        row.className = `arena-board-row ${rankClass}`;

        // Fallback Image real de la API o genérica
        const imgUrl = p.avatar || "https://www.tiktok.com/favicon.ico";

        row.innerHTML = `
            <span class="board-pos">#${idx + 1}</span>
            <img class="board-avatar" src="${imgUrl}" onerror="this.src='https://www.tiktok.com/favicon.ico'" />
            <div class="board-info">
                <span class="board-name">${p.name}</span>
                <div class="board-stats">
                    <span class="stat-hp">❤️ ${Math.floor(p.hp || 0)}</span>
                    <span class="stat-score">⚔️ ${Math.floor(p.score || 0)}</span>
                </div>
            </div>
        `;
        leaderboardEl.appendChild(row);
    });
}

socket.on("arena:currentRanking", (data) => {
    arenaHallOfFame = data; // Reutilizamos variable pero ahora contiene el ranking de la ronda
    updateRankingDOM();
});

let frameCount = 0;
let currentArenaKingId = null;

// Bucle principal a 60FPS
function loop() {
    frameCount++;
    ctx.save();

    // Aplicar Screen Shake si hay intensidad
    if (screenShake > 0) {
        const sx = (Math.random() - 0.5) * screenShake;
        const sy = (Math.random() - 0.5) * screenShake;
        ctx.translate(sx, sy);
        screenShake *= 0.9; // Atenuación rápida
        if (screenShake < 0.5) screenShake = 0;
    }

    drawBackground();

    // Dibujar Partículas Ambientales (Siempre se mueven y dibujan, independiente del Hit Stop)
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ambientParticles.forEach(p => {
        p.y += p.vy;
        p.x += p.vx;
        if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }

        ctx.globalAlpha = p.opacity;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // --- HIT STOP ---
    // Si hay un impacto tremendo, congelamos la lógica pero seguimos dibujando el frame anterior
    if (hitStopFrames > 0) {
        hitStopFrames--;

        // Solo dibujamos a los jugadores en su posición congelada sin update()
        const pList = Object.values(players);
        pList.forEach(p => {
            if ((p.hp === undefined ? 500 : p.hp) > 0) {
                p.draw();
            }
        });

        requestAnimationFrame(loop);
        ctx.restore();
        return;
    }

    // Físicas entre jugadores
    const pList = Object.values(players);
    for (let i = 0; i < pList.length; i++) {
        for (let j = i + 1; j < pList.length; j++) {
            let p1 = pList[i]; let p2 = pList[j];
            if (p1.hp <= 0 || p2.hp <= 0) continue;

            let dx = p2.x - p1.x; let dy = p2.y - p1.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            // Distancia combinada de los radios modificados
            const minDist = p1.currentRadius + p2.currentRadius;

            // Chocan
            if (dist < minDist) {
                // Evitar superposición excesiva 
                let overlap = minDist - dist;
                if (dist === 0) { dx = 1; dy = 0; dist = 1; }

                // Normalizar
                let nx = dx / dist; let ny = dy / dist;
                // Intercambiar velocidades sencillamente y separar un poco
                let tx = p1.vx; let ty = p1.vy;
                p1.vx = p2.vx; p1.vy = p2.vy;
                p2.vx = tx; p2.vy = ty;

                // Separar basándonos en overlap
                let sep = (overlap / 2) + 0.5;
                p1.x -= nx * sep; p1.y -= ny * sep;
                p2.x += nx * sep; p2.y += ny * sep;
            }
        }
    }

    // Actualizar y dibujar Jugadores
    let positionBatch = {};
    let currentClosestToCenter = null;
    let minCenterDist = 120; // coreRadius

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    pList.forEach(p => {
        // Check King of the Hill location
        if (p.opacity > 0.5) {
            const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
            if (dist < minCenterDist) {
                minCenterDist = dist;
                currentClosestToCenter = p;
            }
        }

        // Dibujamos si HP > 0, si falta HP (undefined) forzamos 500 para debug
        const effectiveHP = (p.hp === undefined) ? 500 : p.hp;

        if (effectiveHP > 0) {
            p.update();
            p.draw();

            // Recolectar posición (Solo si es nuestro uniqueId o bot)
            if (p.id === myArenaId || (p.id && p.id.startsWith("bot_"))) {
                positionBatch[p.id] = { x: Math.round(p.x), y: Math.round(p.y) };
            }
        }
    });

    // Lógica del Nuevo Rey
    if (currentClosestToCenter && currentClosestToCenter.id !== currentArenaKingId) {
        currentArenaKingId = currentClosestToCenter.id;
        // Coronación Pública
        spawnFloatingText(`👑 ¡${currentClosestToCenter.name.toUpperCase()} ES EL NUEVO REY! 👑`, cx, cy - 150, "#ffd700");
        screenShake = Math.max(screenShake, 25);
        playSound("heal", 0.5); // Sonido triunfal pitch grave

        // Destello visual de coronación
        ctx.fillStyle = "rgba(255, 215, 0, 0.3)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (!currentClosestToCenter) {
        currentArenaKingId = null; // Nadie en el centro
    }

    // Enviar lote de posiciones cada 10 frames (~160ms) - MÁS RÁPIDO para reducir lag percibido
    if (frameCount % 10 === 0 && Object.keys(positionBatch).length > 0) {
        socket.emit("arena:batchUpdate", positionBatch);
        positionBatch = {}; // Limpiar lote después de enviar
    }

    // Hazars (Sierras, etc)
    for (let i = hazards.length - 1; i >= 0; i--) {
        let h = hazards[i];
        h.update();
        h.draw();
        if (!h.active) hazards.splice(i, 1);
    }

    // Proyectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let proj = projectiles[i];
        proj.update();
        proj.draw();
        if (!proj.active) {
            createExplosion(proj.x, proj.y, proj.color);
            projectiles.splice(i, 1);
        }
    }

    // Rayos (Lightning)
    for (let i = lightningBolts.length - 1; i >= 0; i--) {
        let l = lightningBolts[i];
        ctx.beginPath();
        ctx.moveTo(l.sx, l.sy);

        // Dibujar linea quebrada para efecto rayo
        let steps = 5;
        let dx = (l.tx - l.sx) / steps;
        let dy = (l.ty - l.sy) / steps;
        let x = l.sx, y = l.sy;

        ctx.lineWidth = l.life * 5;
        ctx.strokeStyle = l.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = l.color;

        for (let j = 1; j < steps; j++) {
            x += dx + (Math.random() - 0.5) * 30; // zigzag
            y += dy + (Math.random() - 0.5) * 30;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(l.tx, l.ty);
        ctx.stroke();
        ctx.shadowBlur = 0;

        l.life -= 0.1;
        if (l.life <= 0) lightningBolts.splice(i, 1);
    }

    // Partículas (Efectos de golpes)
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx; p.y += p.vy;
        p.life -= 0.05;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1.0;
        if (p.life <= 0) particles.splice(i, 1);
    }

    // Dibujar Shockwaves (Ondas de choque)
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        let sw = shockwaves[i];
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
        ctx.strokeStyle = sw.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = sw.opacity;
        ctx.stroke();

        sw.r += 10;
        sw.opacity -= 0.05;
        if (sw.opacity <= 0) shockwaves.splice(i, 1);
    }
    ctx.globalAlpha = 1.0;

    ctx.restore(); // Limpiar Screen Shake
    requestAnimationFrame(loop);
}

// Iniciar Motor
requestAnimationFrame(loop);
