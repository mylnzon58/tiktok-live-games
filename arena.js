const socket = io();

// Elementos DOM
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true }) || canvas.getContext("2d");
const leaderboardEl = document.getElementById("arena-leaderboard");
const floatingLayer = document.getElementById("floating-ui-layer");
const debugPanel = document.getElementById("debug-panel");
const DEBUG_MODE = new window.URLSearchParams(window.location.search).get("debug") === "1";

if (debugPanel) {
    debugPanel.hidden = !DEBUG_MODE;
}

// Ajustar Canvas
canvas.width = window.innerWidth || 800;
canvas.height = window.innerHeight || 1920;
window.addEventListener("resize", () => {
    canvas.width = window.innerWidth || 800;
    canvas.height = window.innerHeight || 1920;
    camera.x = camera.targetX = canvas.width / 2;
    camera.y = camera.targetY = canvas.height / 2;
});

// CONFIGURACIÓN DE CÁMARA DINÁMICA
let camera = {
    x: 0,
    y: 0,
    scale: 1,
    targetX: 0,
    targetY: 0,
    targetScale: 1,
    zoomTimer: 0
};

function getArenaBounds() {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(canvas.width, canvas.height) / 2 - 30;
    return { cx, cy, radius };
}

function clampToArena(x, y, margin = 120) {
    const { cx, cy, radius } = getArenaBounds();
    const dx = x - cx;
    const dy = y - cy;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const maxDistance = Math.max(radius - margin, 1);

    if (distance <= maxDistance) {
        return { x, y };
    }

    const ratio = maxDistance / distance;
    return {
        x: cx + dx * ratio,
        y: cy + dy * ratio
    };
}

function focusCamera(x, y, scale, frames) {
    const clamped = clampToArena(x, y);
    camera.targetX = clamped.x;
    camera.targetY = clamped.y;
    camera.targetScale = Math.min(scale, 1.45);
    camera.zoomTimer = frames;
}

// Inicializar cámara al centro después de que el canvas tenga tamaño
setTimeout(() => {
    camera.x = camera.targetX = canvas.width / 2;
    camera.y = camera.targetY = canvas.height / 2;
}, 100);
let duelBeams = []; // Phase 4
let arenaHallOfFame = {}; // Kings of the last 12 hours
let persistentHOF = [];

// ==========================================
// MOTOR DE AUDIO (SYNTH)
// ==========================================
let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let soundEnabled = true; // REVERTIDO: Por defecto activado (OBS / TikTok Studio lo permiten)
let preferredVoices = { es: null, en: null };
let speechQueue = [];
let speechTimer = null;
let lastSpeechAt = 0;
let lastTopArenaHypeAt = 0;
let lastLeaderHypeId = null;

// Attempt auto-unlock de AudioContext silencioso
function tryUnlockAudio() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            checkAudioState();
        }).catch(() => { });
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
        audioCtx.resume().catch(() => { });
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

function resolvePreferredVoice(lang) {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (lang === "es") {
        return voices.find((voice) => /es-/i.test(voice.lang) && /female|monica|paulina|helena|sabina|google español/i.test(voice.name))
            || voices.find((voice) => /es-/i.test(voice.lang))
            || null;
    }
    return voices.find((voice) => /en-/i.test(voice.lang) && /female|samantha|victoria|zira|ava|google us english/i.test(voice.name))
        || voices.find((voice) => /en-/i.test(voice.lang))
        || null;
}

function flushSpeechQueue() {
    if (!soundEnabled || !speechQueue.length || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        speechTimer = null;
        return;
    }
    if (window.speechSynthesis.speaking) {
        speechTimer = window.setTimeout(flushSpeechQueue, 350);
        return;
    }

    const next = speechQueue.shift();
    const voice = preferredVoices[next.lang] || resolvePreferredVoice(next.lang);
    preferredVoices[next.lang] = voice;

    const msg = new window.SpeechSynthesisUtterance(next.text);
    msg.lang = next.lang === "es" ? "es-ES" : "en-US";
    if (voice) msg.voice = voice;
    msg.rate = next.rate ?? 1.03;
    msg.pitch = next.pitch ?? 1;
    msg.volume = next.volume ?? 0.92;
    msg.onend = () => {
        lastSpeechAt = Date.now();
        speechTimer = window.setTimeout(flushSpeechQueue, next.gapMs ?? 550);
    };
    msg.onerror = () => {
        lastSpeechAt = Date.now();
        speechTimer = window.setTimeout(flushSpeechQueue, 600);
    };
    window.speechSynthesis.speak(msg);
}

function queueAnnouncement(text, options = {}) {
    if (!soundEnabled || !text) return;
    try {
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
        const now = Date.now();
        const minIntervalMs = options.minIntervalMs ?? 1400;
        if (!options.force && now - lastSpeechAt < minIntervalMs) return;
        speechQueue.push({
            text,
            lang: options.lang === "es" ? "es" : "en",
            rate: options.rate,
            pitch: options.pitch,
            volume: options.volume,
            gapMs: options.gapMs
        });
        if (!speechTimer) {
            flushSpeechQueue();
        }
    } catch (error) {
        console.error("Speech queue error:", error);
    }
}

function announce(text, options = {}) {
    queueAnnouncement(text, { lang: "en", rate: 1.12, pitch: 0.88, volume: 0.86, ...options });
}

function announceEs(text, options = {}) {
    queueAnnouncement(text, { lang: "es", rate: 1.02, pitch: 0.98, volume: 0.9, ...options });
}

function announceBilingual(spanishText, englishText, options = {}) {
    announceEs(spanishText, { ...options, force: true, minIntervalMs: 0 });
    announce(englishText, { ...options, force: true, minIntervalMs: 0, gapMs: options.gapMs ?? 700 });
}

// --- 🎙️ DOPAMINE ANNOUNCER (Voice Lines) ---
window.speechSynthesis?.addEventListener?.("voiceschanged", () => {
    preferredVoices = { es: null, en: null };
});

function speakCountdownNumber(seconds) {
    const words = {
        10: "ten",
        9: "nine",
        8: "eight",
        7: "seven",
        6: "six",
        5: "five",
        4: "four",
        3: "three",
        2: "two",
        1: "one"
    };
    const word = words[seconds];
    if (word) announce(word);
}

const sfx = {
    roseShot: () => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        [980, 1320, 1760].forEach((freq, index) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + index * 0.03);
            gain.gain.setValueAtTime(0.08, now + index * 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.03 + 0.09);
            osc.start(now + index * 0.03);
            osc.stop(now + index * 0.03 + 0.1);
        });
    },
    shoot: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.1);
    },
    hit: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, audioCtx.currentTime); // Más grave
        osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.15);
    },
    explosion: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(60, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1, audioCtx.currentTime + 0.6);
        gain.gain.setValueAtTime(0.8, audioCtx.currentTime); // ¡DOPAMINA! Aumentado de 0.4 a 0.8
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.6);
    },
    lightning: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(420, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(920, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.22);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.22);
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
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(720, audioCtx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.025, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.05);
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
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(70, audioCtx.currentTime);

        // Ruido metálico agudo
        oscNoise.type = 'triangle';
        oscNoise.frequency.setValueAtTime(240, audioCtx.currentTime);
        oscNoise.frequency.linearRampToValueAtTime(380, audioCtx.currentTime + 0.25);

        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        // Fade out
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.28);

        osc.start(audioCtx.currentTime);
        oscNoise.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.28);
        oscNoise.stop(audioCtx.currentTime + 0.28);
    },
    heavyExplosion: () => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(55, now);
        osc.frequency.exponentialRampToValueAtTime(28, now + 0.4);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.start(now);
        osc.stop(now + 0.45);
    },
    fire: () => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.35);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
    },
    jackpot: () => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        // Sonido ascendente tipo tragamonedas (rápido y brillante)
        [440, 554, 659, 880, 1108, 1318, 1760].forEach((f, i) => {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(f, now + i * 0.04);
            g.gain.setValueAtTime(0.15, now + i * 0.04);
            g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.04 + 0.1);
            osc.connect(g).connect(audioCtx.destination);
            osc.start(now + i * 0.04);
            osc.stop(now + i * 0.04 + 0.12);
        });
    },
    powerUp: () => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.3);
        g.gain.setValueAtTime(0.1, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(g).connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
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
        gainArp.gain.setValueAtTime(0.028, time);
    gainArp.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

    oscArp.connect(gainArp); gainArp.connect(audioCtx.destination);
    oscArp.start(time); oscArp.stop(time + 0.1);

    // Bajo 8-Bits (A tiempo de Octavos - Ritmo constante)
    if (step % 2 === 0) {
        const oscBass = audioCtx.createOscillator();
        const gainBass = audioCtx.createGain();
        oscBass.type = 'sawtooth';
        oscBass.frequency.value = bass / 2; // Bien grave

        gainBass.gain.setValueAtTime(0.05, time);
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

        gainSnare.gain.setValueAtTime(0.03, time);
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
let overlayFlashAlpha = 0;
let overlayFlashColor = "255, 255, 255";
let lastFloatingTextAt = 0;
let lastAnnouncerAt = 0;
const MAX_PARTICLES = 900;
const MAX_AMBIENT_PARTICLES = 220;
const MAX_LIGHTNING_BOLTS = 18;
const MAX_FLOATING_TEXTS = 40;
const MAX_PROJECTILES = 32;
const MAX_HAZARDS = 12;
const MAX_SHOCKWAVES = 12;
const FLOATING_TEXT_INTERVAL_MS = 90;
const ANNOUNCER_INTERVAL_MS = 240;

function pushParticle(particle) {
    if (particles.length >= MAX_PARTICLES) {
        particles.splice(0, particles.length - MAX_PARTICLES + 1);
    }
    particles.push(particle);
}

function pushAmbientParticle(particle) {
    if (ambientParticles.length >= MAX_AMBIENT_PARTICLES) {
        ambientParticles.splice(0, ambientParticles.length - MAX_AMBIENT_PARTICLES + 1);
    }
    ambientParticles.push(particle);
}

function pushLightningBolt(bolt) {
    if (!bolt.path) {
        bolt.path = buildLightningPath(bolt, bolt.segments || 8, bolt.spread || 26);
    }
    if (lightningBolts.length >= MAX_LIGHTNING_BOLTS) {
        lightningBolts.shift();
    }
    lightningBolts.push(bolt);
}

function pushShockwave(shockwave) {
    if (shockwaves.length >= MAX_SHOCKWAVES) {
        shockwaves.shift();
    }
    shockwaves.push(shockwave);
}

function pushProjectile(projectile) {
    if (projectiles.length >= MAX_PROJECTILES) {
        projectiles.shift();
    }
    projectiles.push(projectile);
}

function pushHazard(hazard) {
    if (hazards.length >= MAX_HAZARDS) {
        hazards.shift();
    }
    hazards.push(hazard);
}

// ==========================================
// CONFIGURACIONES FÍSICAS
// ==========================================
const MAX_HP = 1000; // Incrementado de 500 para mayor supervivencia
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
    // Fondo dinámico según intensidad
    let intensity = Math.min(1, particles.length / 50 + shockwaves.length / 5);
    let r = 15 + intensity * 40;
    let g = 20 + intensity * 10;
    let b = 35 + intensity * 20;

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 1)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    bgStars.forEach(s => {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        s.y -= s.speedY * (1 + intensity * 2); // Estrellas más rápidas en combate
        if (s.y < 0) {
            s.y = canvas.height;
            s.x = Math.random() * canvas.width;
        }
    });

    // Dibujar Jaula Circular (Arena limit)
    const { cx, cy, radius: arenaRadius } = getArenaBounds();

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
canvas.addEventListener("mousedown", () => {
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
    pushAmbientParticle({
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
    const now = Date.now();
    if (now - lastFloatingTextAt < FLOATING_TEXT_INTERVAL_MS) {
        return;
    }
    lastFloatingTextAt = now;

    while (floatingLayer.childElementCount >= MAX_FLOATING_TEXTS) {
        floatingLayer.firstElementChild?.remove();
    }
    const el = document.createElement("div");
    el.className = "floating-text";
    el.textContent = text;
    el.style.color = color;
    el.style.left = x + "px";
    el.style.top = y + "px";
    floatingLayer.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

function triggerOverlayFlash(color, alpha = 0.18) {
    overlayFlashColor = color;
    overlayFlashAlpha = Math.max(overlayFlashAlpha, Math.min(alpha, 0.22));
}

function createExplosion(x, y, color, options = {}) {
    const count = Math.min(options.count || 30, 40);
    const speed = Math.min(options.speed || 12, 14);
    const shake = Math.min(options.shake || 10, 18);

    screenShake = Math.max(screenShake, shake);

    for (let i = 0; i < count; i++) {
        pushParticle({
            x, y,
            vx: (Math.random() - 0.5) * speed,
            vy: (Math.random() - 0.5) * speed,
            life: 1.0,
            size: Math.random() * 4 + 2,
            color: color || "#fff"
        });
    }
}

function createFireBurst(x, y, radius = 70) {
    for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        pushParticle({
            x: x + Math.cos(angle) * radius * 0.25,
            y: y + Math.sin(angle) * radius * 0.25,
            vx: Math.cos(angle) * (2 + Math.random() * 4),
            vy: Math.sin(angle) * (2 + Math.random() * 4) - Math.random() * 2,
            life: 1.0,
            size: Math.random() * 6 + 4,
            color: i % 3 === 0 ? "#ff6b00" : (i % 2 === 0 ? "#ffb400" : "#ff3b30")
        });
    }
}

function buildLightningPath(bolt, segments = 8, spread = 22) {
    const points = [{ x: bolt.sx, y: bolt.sy }];
    const dx = bolt.tx - bolt.sx;
    const dy = bolt.ty - bolt.sy;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;

    for (let step = 1; step < segments; step++) {
        const t = step / segments;
        const offset = (Math.random() - 0.5) * spread * (1 - Math.abs(0.5 - t));
        points.push({
            x: bolt.sx + dx * t + nx * offset,
            y: bolt.sy + dy * t + ny * offset
        });
    }

    points.push({ x: bolt.tx, y: bolt.ty });
    return points;
}

function drawLightningBolt(bolt) {
    const mainPath = bolt.path || buildLightningPath(bolt, 8, 26);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Outer glow
    ctx.beginPath();
    ctx.moveTo(mainPath[0].x, mainPath[0].y);
    for (let i = 1; i < mainPath.length; i++) {
        ctx.lineTo(mainPath[i].x, mainPath[i].y);
    }
    ctx.strokeStyle = "rgba(125, 211, 252, 0.22)";
    ctx.lineWidth = Math.max(8, bolt.life * 12);
    ctx.shadowBlur = 28;
    ctx.shadowColor = bolt.color;
    ctx.stroke();

    // Core beam
    ctx.beginPath();
    ctx.moveTo(mainPath[0].x, mainPath[0].y);
    for (let i = 1; i < mainPath.length; i++) {
        ctx.lineTo(mainPath[i].x, mainPath[i].y);
    }
    ctx.strokeStyle = bolt.color;
    ctx.lineWidth = Math.max(2.5, bolt.life * 4.2);
    ctx.shadowBlur = 14;
    ctx.shadowColor = "#ffffff";
    ctx.stroke();

    // White hot center
    ctx.beginPath();
    ctx.moveTo(mainPath[0].x, mainPath[0].y);
    for (let i = 1; i < mainPath.length; i++) {
        ctx.lineTo(mainPath[i].x, mainPath[i].y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = Math.max(1.2, bolt.life * 1.9);
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Small branches
    const branchCount = 2;
    for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
        const anchorIndex = 1 + Math.floor(Math.random() * (mainPath.length - 2));
        const anchor = mainPath[anchorIndex];
        const next = mainPath[Math.min(anchorIndex + 1, mainPath.length - 1)];
        const bx = next.x - anchor.x;
        const by = next.y - anchor.y;
        const branchLength = 18 + Math.random() * 26;
        const norm = Math.sqrt(bx * bx + by * by) || 1;
        const px = -by / norm;
        const py = bx / norm;
        const polarity = Math.random() > 0.5 ? 1 : -1;

        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y);
        ctx.lineTo(
            anchor.x + px * branchLength * polarity + (Math.random() - 0.5) * 10,
            anchor.y + py * branchLength * polarity + (Math.random() - 0.5) * 10
        );
        ctx.strokeStyle = "rgba(180, 235, 255, 0.7)";
        ctx.lineWidth = Math.max(1, bolt.life * 1.6);
        ctx.shadowBlur = 10;
        ctx.shadowColor = bolt.color;
        ctx.stroke();
    }

    // Source marker
    ctx.beginPath();
    ctx.arc(bolt.sx, bolt.sy, 8 + (bolt.life * 2), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 16;
    ctx.shadowColor = bolt.color;
    ctx.fill();

    // Target marker
    ctx.beginPath();
    ctx.arc(bolt.tx, bolt.ty, 10 + (bolt.life * 3), 0, Math.PI * 2);
    ctx.fillStyle = bolt.color;
    ctx.shadowBlur = 22;
    ctx.shadowColor = bolt.color;
    ctx.fill();

    ctx.restore();
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
        this.state = data.state || "NEW";
        this.invulnerableUntil = data.invulnerableUntil || 0;

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

        // Power-ups
        this.sawLife = 0;
        this.sawAngle = 0;
        this.spinDirection = Math.random() > 0.5 ? 1 : -1;
        this.engagement = 0;
        this.lastTapBoostAt = 0;
        this.respawnSizeLockUntil = 0;
        this.lastBodyHitAt = 0;

        // Intervalo de reporte de posición al servidor
        if (this.id === socket.id || this.id.startsWith("bot_")) {
            // No hacemos nada especial aquí, se maneja en el loop principal
        }
    }

    update() {
        // --- DINÁMICA DE TAMAÑO ---
        const safeScore = Math.max(this.score || 0, 0);
        const scoreScale = Math.min(
            (Math.sqrt(safeScore) * 1.45) + (Math.log2(safeScore + 1) * 3.5),
            118
        );
        const engagementScale = Math.min(this.engagement * 0.2, 8);
        const baseTargetRadius = PLAYER_RADIUS + scoreScale;
        let targetRadius = Math.max(PLAYER_RADIUS, baseTargetRadius + engagementScale);

        // Tras respawn reaparece pequeno y vuelve a escalar despues del blindaje inicial.
        if (Date.now() < (this.respawnSizeLockUntil || 0)) {
            targetRadius = Math.min(targetRadius, PLAYER_RADIUS + 10);
        }

        if (this.state === "ELIMINATED") {
            this.opacity = 0.32;
            this.currentRadius += ((PLAYER_RADIUS * 0.82) - this.currentRadius) * 0.14;
            this.vx *= 0.96;
            this.vy *= 0.96;
        } else if (this.state === "IDLE") {
            this.opacity = Math.max(this.opacity - 0.03, 0.12);
            this.currentRadius += ((Math.max(PLAYER_RADIUS, targetRadius * 0.94)) - this.currentRadius) * 0.08;
            this.vx *= 0.99;
            this.vy *= 0.99;
        } else {
            this.currentRadius += (targetRadius - this.currentRadius) * 0.1;
            this.opacity = 1.0;
        }

        const timeSinceTapBoost = Date.now() - (this.lastTapBoostAt || 0);
        if (this.sawLife <= 0) {
            const passiveDecay = timeSinceTapBoost < 900 ? 0.08 : 0.42;
            this.engagement = Math.max(this.engagement - passiveDecay, 0);
        }

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

        // --- LÓGICA DE SIERRA (POWER-UP) ---
        if (this.sawLife > 0) {
            this.sawLife--;
            this.sawAngle += 0.4 * this.spinDirection;
            this.engagement = Math.max(this.engagement - 0.01, 0);

            // Daño en área (Aura de Sierra)
            if (Date.now() % 200 < 50) { // Throttled damage
                for (const otherId in players) {
                    if (otherId === this.id) continue;
                    const other = players[otherId];
                    if (!other || other.opacity < 0.5 || other.hp <= 0 || other.state === "ELIMINATED") continue;

                    const dx = this.x - other.x;
                    const dy = this.y - other.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const auraRadius = this.currentRadius + 25; // El aura es un poco más grande

                    if (dist < auraRadius + other.currentRadius) {
                        // REQUERIMIENTO: "quita puntos y achica al otro"
                        other.takeDamage(10, this.id);

                        createExplosion(other.x, other.y, "#999");
                        if (Math.random() > 0.8) playSound("hit");
                    }
                }
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
        const { cx, cy, radius: arenaRadius } = getArenaBounds();
        const dx = this.x - cx;
        const dy = this.y - cy;
        const distToCenter = Math.sqrt(dx * dx + dy * dy);

        // --- MOTIVACIÓN: ZONA REY ---
        const coreRadius = 120;
        if (this.opacity > 0.5 && distToCenter < coreRadius) {
            if (Math.random() < 0.02) {
                spawnFloatingText("👑 +Poder", this.x, this.y - this.currentRadius, "#ffd700");
                this.flash = Math.max(this.flash, 0.5);
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

        const clamped = clampToArena(this.x, this.y, this.currentRadius + 6);
        this.x = clamped.x;
        this.y = clamped.y;

        // CHOCAR CONTRA OTROS JUGADORES (MOSH PIT DOPAMÍNICO)
        for (const otherId in players) {
            if (otherId === this.id) continue;
            const other = players[otherId];
            if (!other || this.opacity < 0.5 || other.opacity < 0.5 || this.state === "ELIMINATED" || other.state === "ELIMINATED") continue;

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
            ctx.font = `bold ${this.currentRadius}px Rajdhani`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(this.name[0].toUpperCase(), this.x, this.y);
        }

        // --- PUNTOS / SCORE DENTRO DEL GLOBO ---
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = this.opacity;

        // Badge de Score (Central)
        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        const badgeSize = Math.max(this.currentRadius * 0.7, 18);
        ctx.beginPath();
        ctx.arc(this.x, this.y + (this.currentRadius * 0.3), badgeSize / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "white";
        ctx.font = `bold ${Math.floor(badgeSize * 0.55)}px Rajdhani`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(Math.floor(this.score), this.x, this.y + (this.currentRadius * 0.3));

        // Rango HOF (Si existe)
        if (!!arenaHallOfFame[this.id]) {
            ctx.fillStyle = "#ffd700";
            ctx.font = `bold ${Math.floor(badgeSize * 0.4)}px Rajdhani`;
            ctx.fillText("RANK 👑", this.x, this.y - (this.currentRadius * 0.4));
        }

        // --- PRESTIGE AURAS (Tiered Glow) ---
        let auraColor = null;
        if (this.score >= 5000) auraColor = "#e5e7eb"; // Platinum
        else if (this.score >= 1000) auraColor = "#fbbf24"; // Gold
        else if (this.score >= 500) auraColor = "#94a3b8"; // Silver
        else if (this.score >= 100) auraColor = "#d97706"; // Bronze

        if (auraColor) {
            const pulse = 0.65 + ((Math.sin(Date.now() / 180) + 1) * 0.35);
            ctx.shadowBlur = 32 + Math.sin(Date.now() / 200) * 12;
            ctx.shadowColor = auraColor;
            ctx.strokeStyle = auraColor;
            ctx.lineWidth = 4 + (pulse * 2.5);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.currentRadius + 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
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
            const latentPulse = 0.55 + ((Math.sin(Date.now() / 160) + 1) * 0.3);
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
            ctx.shadowBlur = Math.max(ctx.shadowBlur || 0, 10 + (this.engagement * 0.28));
            ctx.shadowColor = ctx.strokeStyle;
            ctx.lineWidth += latentPulse * 1.8;
        }
        ctx.stroke();
        ctx.shadowBlur = 0; // reset

        // NOMBRE SIEMPRE VISIBLE (Arriba de la burbuja para que no tape nada)
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Rajdhani";
        ctx.textAlign = "center";
        ctx.shadowBlur = 4;
        ctx.shadowColor = "black";
        ctx.fillText(this.name, this.x, this.y - this.currentRadius - 10);
        ctx.shadowBlur = 0;

        ctx.globalAlpha = 1.0;

        // Dibujar HP (Debajo de la burbuja)
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.font = "bold 12px Rajdhani";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${Math.floor(this.hp)} HP`, this.x, this.y + this.currentRadius + 15);

        if (this.state === "ELIMINATED") {
            ctx.fillStyle = "#ff8c42";
            ctx.font = "bold 13px Rajdhani";
            ctx.fillText("RESPAWN...", this.x, this.y + this.currentRadius + 30);
        } else if (this.state === "IDLE") {
            ctx.fillStyle = "#8ec5ff";
            ctx.font = "bold 13px Rajdhani";
            ctx.fillText("IDLE", this.x, this.y + this.currentRadius + 30);
        } else if (this.invulnerableUntil > Date.now()) {
            ctx.fillStyle = "#7dd3fc";
            ctx.font = "bold 13px Rajdhani";
            ctx.fillText("SHIELD", this.x, this.y + this.currentRadius + 30);
        }

        // --- TEAM SHIELDS (Phase 4) ---
        if (this.shieldActive) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.currentRadius + 15, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(100, 200, 255, 0.6)";
            ctx.lineWidth = 4;
            ctx.setLineDash([5, 5]);
            ctx.lineDashOffset = -Date.now() / 50;
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.shadowBlur = 15;
            ctx.shadowColor = "#00f";
        }

        if (this.invulnerableUntil > Date.now()) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.currentRadius + 12, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(125, 211, 252, 0.7)";
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 6]);
            ctx.lineDashOffset = -Date.now() / 60;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // --- 👑 CORONA DE CAMPEÓN ---
        if (this.id === lastArenaChampionId) {
            ctx.fillStyle = "#ffd700";
            ctx.font = "24px Arial";
            ctx.textAlign = "center";
            ctx.fillText("👑", this.x, this.y - this.currentRadius - 38);
        }

        // --- ⚙️ AURA DE SIERRA (PLAYER POWER) ---
        if (this.sawLife > 0) {
            const worldSawRadius = this.currentRadius + 15;
            const worldTrailingAngle = this.sawAngle - (Math.PI / 2) * this.spinDirection;
            ctx.save();
            ctx.translate(this.x, this.y);

            // RAYOS ELÉCTRICOS (Neuromarketing visual)
            if (this.sawLife > 0 && Math.random() < 0.3) {
                ctx.beginPath();
                ctx.strokeStyle = "#00d2ff";
                ctx.lineWidth = 2;
                ctx.moveTo(0, 0);
                for (let i = 0; i < 3; i++) {
                    ctx.lineTo((Math.random() - 0.5) * 150, (Math.random() - 0.5) * 150);
                }
                ctx.stroke();
                if (Math.random() > 0.9) sfx.lightning();
            }

            ctx.rotate(this.sawAngle);

            const sawRadius = worldSawRadius;
            const teethCount = Math.max(16, Math.min(34, 16 + Math.floor(this.engagement * 1.8)));
            const toothDepth = 12 + Math.min(24, this.engagement * 0.8);
            ctx.beginPath();
            for (let i = 0; i < teethCount * 2; i++) {
                const angle = (i / (teethCount * 2)) * Math.PI * 2;
                const r = (i % 2 === 0) ? sawRadius + toothDepth : sawRadius;
                ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            ctx.closePath();

            // Gradiente metálico
            const grad = ctx.createRadialGradient(0, 0, sawRadius, 0, 0, sawRadius + toothDepth);
            grad.addColorStop(0, "#7f8fa6");
            grad.addColorStop(0.5, "#dcdde1");
            grad.addColorStop(1, "#353b48");

            ctx.lineWidth = 4;
            ctx.strokeStyle = grad;
            ctx.shadowBlur = 16;
            ctx.shadowColor = "rgba(255,255,255,0.55)";
            ctx.stroke();
            ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
            ctx.fill();

            // Nucleo visible para que la sierra nunca se pierda sobre el avatar.
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(10, sawRadius * 0.22), 0, Math.PI * 2);
            ctx.fillStyle = "#f5f5f5";
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = "#4b5563";
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Chispas
            if (Math.random() < 0.55) {
                ctx.beginPath();
                ctx.fillStyle = "#fbc531";
                ctx.arc(Math.cos(worldTrailingAngle) * (sawRadius + 4), Math.sin(worldTrailingAngle) * (sawRadius + 4), 3, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();

            if (Math.random() < 0.35) {
                createExplosion(
                    this.x + Math.cos(worldTrailingAngle) * worldSawRadius,
                    this.y + Math.sin(worldTrailingAngle) * worldSawRadius,
                    "#fbc531",
                    { count: 4, speed: 4, shake: 0 }
                );
            }

            // Hum de sierra (Throttled)
            if (Date.now() % 500 < 50) sfx.buzzsaw();
        }

        ctx.shadowBlur = 0;
    }

    takeDamage(amount, attackerId) {
        // DUPLICAR DAÑO EN MUERTE SÚBITA
        let finalAmt = isSuddenDeath ? amount * 2 : amount;
        this.hp = Math.max(this.hp - finalAmt, 0);
        if (this.hp <= 0) {
            this.state = "ELIMINATED";
        }

        this.flash = 1;
        spawnFloatingText(`-${Math.floor(finalAmt)}`, this.x, this.y, isSuddenDeath ? "#ff0000" : "#ff4757");

        syncStateToServer(attackerId && players[attackerId] ? players[attackerId] : this);
    }

    heal(amount) {
        if (this.hp <= 0 && this.state === "ELIMINATED") return;

        const wasCritical = this.hp < MAX_HP * 0.15; // Menos del 15%
        this.hp = Math.min(this.hp + amount, MAX_HP);
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
    constructor(sx, sy, targetId, damage, attackerId, color, options = {}) {
        this.x = sx;
        this.y = sy;
        this.targetId = targetId;
        this.damage = damage;
        this.attackerId = attackerId;
        this.color = color || "#00f0ff";
        this.speed = options.speed || 10;
        this.targetOffsetX = options.targetOffsetX || 0;
        this.targetOffsetY = options.targetOffsetY || 0;
        this.wobble = options.wobble || 0;
        this.wobblePhase = options.wobblePhase || 0;
        this.life = options.life || 120;
        this.active = true;
    }
    update() {
        const target = players[this.targetId];
        if (!target || target.hp <= 0 || this.life <= 0) {
            this.active = false; // Objetivo murió en camino
            return;
        }

        // Homming missile (sigue al objetivo en movimiento)
        const aimX = target.x + this.targetOffsetX + Math.sin(this.wobblePhase) * this.wobble;
        const aimY = target.y + this.targetOffsetY + Math.cos(this.wobblePhase) * this.wobble;
        const dx = aimX - this.x;
        const dy = aimY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        this.x += (dx / dist) * this.speed;
        this.y += (dy / dist) * this.speed;
        this.wobblePhase += 0.22;
        this.life -= 1;

        pushParticle({ x: this.x, y: this.y, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, life: 0.5, color: this.color });

        if (dist < target.currentRadius) {
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

function spawnProjectileBurst(attacker, target, count, totalDamage, color, options = {}) {
    const burstCount = Math.max(1, count);
    const damagePerProjectile = totalDamage / burstCount;

    for (let i = 0; i < burstCount; i++) {
        const angle = (i / burstCount) * Math.PI * 2;
        const spawnRadius = Math.min(attacker.currentRadius * 0.35, 22);
        const spawnX = attacker.x + Math.cos(angle) * spawnRadius;
        const spawnY = attacker.y + Math.sin(angle) * spawnRadius;
        const spreadRadius = Math.min(target.currentRadius * 0.45, 34);
        const targetOffsetX = Math.cos(angle) * spreadRadius;
        const targetOffsetY = Math.sin(angle) * spreadRadius;

        pushProjectile(new Projectile(
            spawnX,
            spawnY,
            target.id,
            damagePerProjectile,
            attacker.id,
            color,
            {
                speed: 9 + (i % 3),
                targetOffsetX,
                targetOffsetY,
                wobble: options.wobble || 0,
                wobblePhase: angle,
                life: options.life || 120
            }
        ));
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
                        p.takeDamage(8, this.attackerId); // Reducido de 15
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
    const sdOverlay = document.getElementById("x2-alpha-overlay");
    if (active) {
        if (sdOverlay) sdOverlay.style.display = "flex";
        spawnFloatingText("SUDDEN DEATH", canvas.width / 2, canvas.height / 2 - 200, "#ff8c42");
        showAnnouncer("SUDDEN DEATH", "#ff8c42");
        playSound("heavyExplosion");
        triggerOverlayFlash("255, 120, 80", 0.1);
        screenShake = 8;
        announce("Sudden Death! Double damage enabled! Fight for your life!");
    } else {
        if (sdOverlay) sdOverlay.style.display = "none";
        showAnnouncer("NORMAL MODE", "#2ed573");
        announce("Normal mode restored.");
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
    return p;
}

// --- 🏆 EVENTOS PHASE 2: PRESTIGIO ---
socket.on("arena:champions", (winners) => {
    const ticker = document.getElementById("champions-ticker");
    if (!ticker) return;
    if (!winners || winners.length === 0) {
        ticker.innerHTML = "<span>ESPERANDO CAMPEONES...</span>";
        return;
    }
    const html = winners.map(w => `
        <div class="champion-item">
            <span class="champ-crown">👑</span>
            <span class="champ-name">${w.name}</span>
            <span class="champ-wins">${w.victories} VICS</span>
            <span class="champ-time">${w.time}</span>
        </div>
    `).join('<span class="champ-sep">|</span>');
    ticker.innerHTML = `<div class="ticker-scroll">${html} ${html}</div>`; // Duplicado para loop infinito
});
// ------------------------------------------

socket.on("arena:combo", () => {
    createComboBurst();
});

function createComboBurst() {
    const activePlayers = Object.values(players).filter((player) => player.opacity > 0.5);
    if (activePlayers.length === 0) return;

    const source = activePlayers[Math.floor(Math.random() * activePlayers.length)];
    for (let i = 0; i < 26; i++) {
        const angle = (i / 26) * Math.PI * 2;
        pushParticle({
            x: source.x,
            y: source.y,
            vx: Math.cos(angle) * (2 + Math.random() * 5),
            vy: Math.sin(angle) * (2 + Math.random() * 5),
            life: 0.8,
            size: Math.random() * 4 + 2,
            color: i % 2 === 0 ? "#ffd700" : "#ffffff"
        });
    }
    playSound("jackpot");
}
// ------------------------------------------

// --- 🎭 EVENTOS PHASE 3: VISUALES Y SONIDO ---
const announcerOverlay = document.getElementById("announcer-container");
function showAnnouncer(text, color) {
    if (!announcerOverlay) return;
    const now = Date.now();
    if (now - lastAnnouncerAt < ANNOUNCER_INTERVAL_MS) return;
    lastAnnouncerAt = now;
    announcerOverlay.innerHTML = "";
    const line = document.createElement("div");
    line.className = "announcement-text";
    line.textContent = text;
    line.style.setProperty("--accent", color);
    line.style.color = color;
    announcerOverlay.appendChild(line);

    // Voces de locutor (Sintetizadas o sounds)
    if (text.includes("LEGENDARIO")) {
        playSound("heavyExplosion"); // Más fuerte que jackpot
    }
}

socket.on("arena:sync", (serverPlayers) => {
    for (const id in serverPlayers) {
        const sp = serverPlayers[id];
        syncPlayerFromServer(sp);
    }

    // Remover jugadores que ya no están en el servidor
    for (const id in players) {
        if (!serverPlayers[id]) delete players[id];
    }
});

function syncPlayerFromServer(sp) {
    if (!sp?.id) return null;

    const existingPlayer = players[sp.id];
    const previousState = existingPlayer?.state || null;

    if (!existingPlayer) {
        players[sp.id] = new Player(sp);
    } else {
        players[sp.id].score = sp.score ?? players[sp.id].score;
        players[sp.id].hp = sp.hp ?? players[sp.id].hp;
        players[sp.id].name = sp.name || players[sp.id].name;
        players[sp.id].victories = sp.victories ?? players[sp.id].victories ?? 0;
        players[sp.id].bestScore = sp.bestScore ?? players[sp.id].bestScore ?? 0;
        players[sp.id].state = sp.state || players[sp.id].state;
        players[sp.id].lastActive = sp.lastActive || players[sp.id].lastActive;
        players[sp.id].invulnerableUntil = sp.invulnerableUntil || 0;
        players[sp.id].totalGiftDiamonds = sp.totalGiftDiamonds || players[sp.id].totalGiftDiamonds || 0;
        players[sp.id].totalLikes = sp.totalLikes || players[sp.id].totalLikes || 0;
        if (sp.avatar) players[sp.id].avatar = sp.avatar;

        // El servidor solo es autoritativo en posicion para spawn/respawn o jugadores sinteticos.
        const shouldSyncPosition =
            sp.id.startsWith("bot_") ||
            previousState === "ELIMINATED" ||
            (previousState && previousState !== sp.state);

        if (shouldSyncPosition) {
            players[sp.id].x = sp.x ?? players[sp.id].x;
            players[sp.id].y = sp.y ?? players[sp.id].y;
        }
    }

    players[sp.id].hp = sp.hp ?? players[sp.id].hp;
    players[sp.id].state = sp.state || players[sp.id].state;
    players[sp.id].invulnerableUntil = sp.invulnerableUntil || 0;

    if (sp.sawActiveUntil > Date.now()) {
        const remainingFrames = Math.floor((sp.sawActiveUntil - Date.now()) / (1000 / 60));
        if (Math.abs((players[sp.id].sawLife || 0) - remainingFrames) > 60) {
            players[sp.id].sawLife = remainingFrames;
        }
    } else {
        players[sp.id].sawLife = 0;
    }

    return players[sp.id];
}

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

    const giftRules = [
        { name: "ROSE / ICE CREAM", effect: "DISPARO RAPIDO", icon: "🌹" },
        { name: "DONUT / PERFUME", effect: "CHOQUE Y EMPUJE", icon: "🍩" },
        { name: "FIREWORKS / DRAGON", effect: "ANILLO DE FUEGO", icon: "🔥" },
        { name: "GALAXY / PLANET", effect: "RAYO PREMIUM", icon: "🌌" },
        { name: "LION / UNIVERSE", effect: "MEGABLAST + KO", icon: "🦁" },
        { name: "LIKES / YO", effect: "CURA Y RESPAWN", icon: "💖" }
    ];

    const renderList = (list) => `<ul>${list.map(g => `
        <li>
            <span class="emoji">${g.icon}</span>
            <span class="gift-text">${g.name} = <span class="effect-text">${g.effect}</span></span>
        </li>
    `).join('')}</ul>`;

    guideEl.innerHTML = `
        <div class="powers-row full-guide">
            ${renderList(giftRules)}
        </div>
        <div class="powers-footer">
            <span class="powers-timer-label">FIN DE RONDA</span>
            <span id="round-time-remaining">05:00</span>
        </div>
    `;
}
// Escuchamos el Hall of Fame persistente del servidor (Top 10 real de 12 horas)
socket.on("arena:hallOfFameUpdate", (list) => {
    console.log("🏆 Recibido Hall of Fame:", list);
    persistentHOF = Array.isArray(list) ? list : [];
    arenaHallOfFame = persistentHOF.reduce((acc, player) => {
        if (player?.id) acc[player.id] = player;
        return acc;
    }, {});
    updateTopShowcase(); // Actualizar el podio de gala superior
});

updatePowersGuide();

function updateTopShowcase() {
    const podium3 = Object.values(players)
        .filter((player) => player?.id)
        .filter((player) => player.state !== "REMOVED")
        .map((player) => ({
            ...player,
            currentScore: Math.floor(player.score || 0),
            displayScore: Math.floor(player.score || 0),
            bestScore: Math.floor(player.bestScore || player.score || 0),
            victories: Math.floor(player.victories || 0)
        }))
        .sort((a, b) =>
            (b.victories - a.victories) ||
            (b.currentScore - a.currentScore) ||
            (b.bestScore - a.bestScore)
        )
        .slice(0, 3);

    // Rellenamos hasta tener siempre 3 slots
    while (podium3.length < 3) {
        podium3.push({
            name: "ESPERANDO...",
            avatar: "https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image",
            score: 0,
            isPlaceholder: true
        });
    }

    topShowcaseEl.innerHTML = "";
    topShowcaseEl.style.display = "flex";

    podium3.forEach((p, i) => {
        const rank = i + 1;
        const item = document.createElement("div");
        // Clasificamos por RANK real para que el CSS aplique 'order' y 'scale'
        item.className = `top-player-item rank-${rank} ${p.isPlaceholder ? 'placeholder' : ''}`;

        item.innerHTML = `
            ${p.title ? `<div class="top-player-title">${p.title}</div>` : ''}
            <div class="top-player-avatar" style="background-image: url('${p.avatar || ''}')"></div>
            <div class="top-rank-badge">${rank}</div>
            <div class="top-player-name">${p.name}</div>
            ${p.victories > 0 ? `<div class="top-player-victories">🏆 ${p.victories}</div>` : ''}
            ${!p.isPlaceholder ? `<div class="top-player-score">${p.victories > 0 ? `RONDAS ${Math.floor(p.victories || 0)}` : `PTS ${Math.floor(p.currentScore || p.displayScore || 0)}`}</div>` : ''}
            ${p.isPlaceholder ? '' : '<div class="follow-arrow">⬆️</div>'}
        `;
        topShowcaseEl.appendChild(item);
    });
}


// --- CAPA CUENTA REGRESIVA ---
const countdownOverlay = document.createElement("div");
countdownOverlay.className = "countdown-overlay";
document.body.appendChild(countdownOverlay);

socket.on("timerUpdate", (seconds) => {
    const roundTimerEl = document.getElementById("round-time-remaining");
    if (roundTimerEl) {
        const safeSeconds = Math.max(0, Number(seconds) || 0);
        const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
        const secs = String(safeSeconds % 60).padStart(2, "0");
        roundTimerEl.textContent = `${minutes}:${secs}`;
    }

    // REQUERIMIENTO: La sierra ahora es un poder de jugador, no un peligro global
    if (seconds <= 10 && seconds > 0) {
        countdownOverlay.textContent = seconds;
        countdownOverlay.classList.add("active");

        // Cambiar color si es crítico
        if (seconds <= 5) {
            countdownOverlay.classList.remove("normal");
            countdownOverlay.classList.add("warning");
            speakCountdownNumber(seconds);
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

socket.on("arena:roundEnd", (data) => {
    countdownOverlay.classList.remove("active");
    Object.values(players).forEach((player) => {
        player.hp = MAX_HP;
        player.sawLife = 0;
        player.flash = 0;
        player.engagement = 0;
    });

    if (!data || !data.winner) {
        spawnFloatingText("FIN DE RONDA", canvas.width / 2, canvas.height / 2 - 100, "#fff");
        return;
    }

    const w = data.winner;
    console.log("🏆 GANADOR DE LA ARENA:", w.name);
    announceBilingual(
        `Sigan todos a ${w.name}. Ganador de la ronda.`,
        `Everybody follow ${w.name}. Round winner.`
    );

    // Efecto visual masivo de Victoria (Volumen reducido)
    screenShake = 24;
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

socket.on("arena:powerup", (data) => {
    const target = players[data.userId];
    if (target) {
        if (data.type === "buzzsaw") {
            target.sawLife = data.duration || 600;
            target.engagement = Math.min((target.engagement || 0) + 16, 40);
            playSound("buzzsaw");
            setTimeout(() => playSound("buzzsaw", 0.92), 120);
            spawnFloatingText("SIERRA ACTIVA", target.x, target.y - 40, "#ff9f43");
            triggerOverlayFlash("255, 180, 90", 0.06);
        }
    }
});

socket.on("arena:burst", (data) => {
    const burstCount = Math.max(1, Math.min(data.count || 3, 6));
    for (let i = 0; i < burstCount; i++) {
        setTimeout(() => {
            const offsetX = (Math.random() - 0.5) * 180;
            const offsetY = (Math.random() - 0.5) * 180;
            createExplosion(data.x + offsetX, data.y + offsetY, data.color || "#ffd700", { count: 18, speed: 9, shake: 6 });
            playSound(i % 2 === 0 ? "explosion" : "heavyExplosion");
        }, i * 80);
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

socket.on("arena:respawn", (data) => {
    const player = players[data.userId];
    if (!player) return;
    player.state = "ACTIVE";
    player.engagement = 0;
    player.currentRadius = Math.max(PLAYER_RADIUS, Math.min(player.currentRadius || PLAYER_RADIUS, PLAYER_RADIUS + 6));
    player.respawnSizeLockUntil = Date.now() + 1800;
    player.flash = 1;
    spawnFloatingText("RESPAWN", player.x, player.y - 40, "#7dd3fc");
    playSound("heal");
});

// Variables para combo de Likes
const recentHeals = {};

// EVENTO DE CURACIÓN / APOYO (LIKES / TAP TAP)
socket.on("arena:like", (data) => {
    const p = syncPlayerFromServer(data.player) || players[data.userId];
    if (p) {
        p.lastActive = Date.now(); // Despierta de AFK inmediatamente
        p.heal(data.heal || data.likeCount);
        p.engagement = Math.min((p.engagement || 0) + Math.max(5, data.likeCount * 1.75), 40);
        p.lastTapBoostAt = Date.now();
        p.flash = 1;

        screenShake = Math.max(screenShake, 2); // Micro-temblor por cada like activo

        // Dopamina física: El jugador "salta" o se empuja al recibir likes (MÁS INTENSO)
        p.vx += (Math.random() - 0.5) * 15;
        p.vy += (Math.random() - 0.5) * 15;

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
        playSound("hit", 1.2); // Ruidito extra "pop" para los taps
        if (data.scoreGain > 0) {
            spawnFloatingText(`+${data.scoreGain} PTS`, p.x, p.y - 28, "#fff3b0");
        }
        if (data.comboLikes >= 25 && data.comboLikes % 25 === 0) {
            spawnFloatingText(`RUSH x${data.comboLikes}`, p.x, p.y - 54, "#7dd3fc");
            triggerOverlayFlash("120, 255, 210", 0.04);
            screenShake = Math.max(screenShake, Math.min(9, 4 + (data.comboLikes / 18)));
        }

        // Mostrar texto de apoyo adictivo (Combos épicos)
        const strikes = recentHeals[data.userId].strikes;
        if (strikes > 0 && strikes % 50 === 0) {
            spawnFloatingText(`COMBO x${strikes}`, p.x, p.y - 40, "#ff9f43");
            screenShake = Math.max(screenShake, 10);
            playSound("heavyExplosion"); // Boom para celebrar el combo
        } else if (data.likeCount >= 5 || strikes % 10 === 0) {
            spawnFloatingText(`TAP x${strikes}`, p.x, p.y, "#2ed573");
        }
    }
});

socket.on("arena:likeStrike", (data) => {
    const attacker = syncPlayerFromServer(data.attacker) || players[data.attacker?.id];
    const target = syncPlayerFromServer(data.target) || players[data.target?.id];
    if (!attacker || !target) return;

    const comboLikes = data.comboLikes || data.likeCount || 0;
    if (comboLikes >= 25) {
        const burstShots = Math.min(4, Math.max(2, Math.floor(comboLikes / 25)));
        setTimeout(() => {
            spawnProjectileBurst(attacker, target, burstShots, Math.max(6, data.damage || 0), "#bbf7d0", { wobble: 10, life: 90 });
            playSound("shoot", 1.18);
        }, 0);
        playSound("heavyExplosion", 0.78);
    } else {
        pushLightningBolt({
            sx: attacker.x,
            sy: attacker.y,
            tx: target.x,
            ty: target.y,
            life: 0.7,
            color: "#bbf7d0"
        });
    }
    pushShockwave({ x: target.x, y: target.y, r: 16, opacity: 0.8, color: "#bbf7d0" });
    target.flash = 1;
    spawnFloatingText(`-${Math.floor(data.damage || 0)}`, target.x, target.y - 24, "#bbf7d0");
    if ((data.scoreLoss || 0) > 0) {
        spawnFloatingText(`-${Math.floor(data.scoreLoss)} PTS`, target.x, target.y - 50, "#fca5a5");
    }
    if (comboLikes >= 20) {
        spawnFloatingText("TAP STRIKE", attacker.x, attacker.y - 34, "#bbf7d0");
    }
    screenShake = Math.max(screenShake, Math.min(10, 2 + (comboLikes / 10)));
    playSound("hit", 1.08);
});

// EVENTO DE PODER POR CHAT (Aura Visual)
socket.on("arena:chatPower", (data) => {
    const p = syncPlayerFromServer(data.player) || players[data.userId];
    if (p) {
        // Efecto visual de "Aura"
        p.flash = 1;
        if (data.heal > 0) {
            p.heal(data.heal);
        }
        spawnFloatingText(`${data.keyword}`, p.x, p.y - 40, "#00f0ff");
        if (data.scoreGain > 0) {
            spawnFloatingText(`+${data.scoreGain} PTS`, p.x, p.y - 62, "#fef08a");
        }

        // Pequeño impulso físico
        p.vx += (Math.random() - 0.5) * 4;
        p.vy += (Math.random() - 0.5) * 4;

        // Partículas circulares tipo Aura
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            pushParticle({
                x: p.x + Math.cos(angle) * p.currentRadius,
                y: p.y + Math.sin(angle) * p.currentRadius,
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

function resolveArenaGiftEffect(data, attacker, target, diamondsTotal, giftValue, giftName) {
    const effectKey = data.effectKey || "";
    const category = data.category || "";
    const lowerName = (giftName || "").toLowerCase();

    if (effectKey === "megaBlast" || category === "mega" || lowerName.includes("universe") || lowerName.includes("universo") || lowerName.includes("lion") || lowerName.includes("león") || giftValue >= 20000) {
        return { type: "megaBlast", color: "#ffd166" };
    }
    if (effectKey === "orbitalStrike" || effectKey === "tripleLightning" || effectKey === "lightning" || category === "lightning" || lowerName.includes("galaxy") || lowerName.includes("galaxia") || lowerName.includes("planet") || lowerName.includes("planeta") || giftValue >= 1000) {
        return { type: "lightningStorm", color: "#7dd3fc" };
    }
    if (effectKey === "fireBurst" || effectKey === "fireStorm" || category === "fire" || lowerName.includes("fire") || lowerName.includes("fuego") || lowerName.includes("flame") || lowerName.includes("fireworks")) {
        return { type: "fireBurst", color: "#ff6b00" };
    }
    if (effectKey === "shockwave" || category === "shockwave" || lowerName.includes("donut") || lowerName.includes("dona") || lowerName.includes("ray") || lowerName.includes("relámpago")) {
        return { type: "shockwave", color: "#fbbf24" };
    }
    if (effectKey === "buzzsaw") {
        return { type: "buzzsaw", color: "#ff9f43" };
    }
    if (effectKey === "roseVolley" || effectKey === "projectile" || effectKey === "iceShot" || effectKey === "tapSpark" || category === "projectile" || category === "tap" || lowerName.includes("rose") || lowerName.includes("rosa") || lowerName.includes("ice")) {
        return {
            type: effectKey === "tapSpark" ? "tapSpark" : "projectile",
            color: effectKey === "iceShot" ? "#9be7ff" : (effectKey === "tapSpark" ? "#fef08a" : "#ff4757")
        };
    }
    return { type: "projectile", color: "#00f0ff" };
}

// EVENTO DE ATAQUE (REGALOS)
socket.on("arena:gift", (data) => {
    const attackerId = data.attacker?.id;
    const attacker = syncPlayerFromServer(data.attackerState) || players[attackerId];
    if (!attacker) return;

    attacker.lastActive = Date.now(); // Despierta de AFK inmediatamente
    attacker.engagement = Math.min((attacker.engagement || 0) + Math.max(4, Math.log2((data.diamondCount || 1) * (data.repeatCount || 1) + 1) * 5), 40);
    const count = data.repeatCount || 1;
    const giftValue = data.diamondCount || 1;
    const diamondsTotal = giftValue * count;

    // Feedback visual inmediato para TODOS los regalos
    spawnFloatingText(`${data.giftName} x${count}`, attacker.x, attacker.y, "#fdcb6e");
    if ((data.scoreGain || 0) > 0) {
        spawnFloatingText(`+${Math.floor(data.scoreGain)} PTS`, attacker.x, attacker.y - 28, "#fff3b0");
    }

    // Zoom automático si es un regalo grande
    if (giftValue >= 100) {
        focusCamera(attacker.x, attacker.y, 1.22, 60);

        if (giftValue >= 500) {
            focusCamera(attacker.x, attacker.y, 1.4, 110);
            showAnnouncer("MOMENTO LEGENDARIO!!! 🔥", "#ffd700");
            announceBilingual("Regalo legendario. Sigan al ataque.", "Legendary gift. Follow the attack.");
        } else {
            showAnnouncer("GRAN REGALO! ✨", "#00d2ff");
            announceBilingual("Gran regalo. Poder extremo.", "Big gift. Extreme power.");
        }
    }

    // Buscar el objetivo más cercano
    let target = syncPlayerFromServer(data.target) || players[data.targetId];
    if (!target) {
        let minDist = Infinity;
        for (const id in players) {
            if (id === attacker.id || players[id].hp <= 0 || players[id].opacity < 0.5) continue;
            const enemy = players[id];
            const dist = Math.sqrt((attacker.x - enemy.x) ** 2 + (attacker.y - enemy.y) ** 2);
            if (dist < minDist) { minDist = dist; target = enemy; }
        }
    }

    if (!target) return; // No hay a quien atacar
    if ((data.scoreLoss || 0) > 0) {
        spawnFloatingText(`-${Math.floor(data.scoreLoss)} PTS`, target.x, target.y - 48, "#fca5a5");
    }

    // --- DUEL BEAMS (Visual effect) ---
    duelBeams.push({
        sx: attacker.x, sy: attacker.y,
        tx: target.x, ty: target.y,
        life: 30, // 0.5 seg a 60fps
        color: giftValue >= 100 ? "#f0f" : "#0ff"
    });

    // Logica por regalo (Daño base)
    let damage = diamondsTotal * 100;

    attacker.flash = 1;
    screenShake = Math.max(screenShake, Math.min(18, 6 + Math.log2(diamondsTotal + 1) * 2));

    const giftEffect = resolveArenaGiftEffect(data, attacker, target, diamondsTotal, giftValue, data.giftName || "");
    let atkType = "projectile";
    let color = giftEffect.color;

    // Detección de tipos de ataque: cubrir todos los effectKey emitidos por el servidor.
    if (giftEffect.type === "megaBlast") {
        playSound("heavyExplosion");
        screenShake = 14;
        hitStopFrames = 12;
        triggerOverlayFlash("255, 240, 200", 0.16);
        spawnFloatingText("UNIVERSO", target.x, target.y, "#ffd166");
        announceBilingual("Universo activado. Sigan al ganador.", "Universe activated. Follow the winner.");
        createExplosion(target.x, target.y, "#fff", { count: 26, speed: 10, shake: 10 });
        createExplosion(target.x + 40, target.y - 30, "#fbbf24", { count: 18, speed: 8, shake: 6 });
        createExplosion(target.x - 50, target.y + 20, "#ff8c42", { count: 18, speed: 8, shake: 6 });
        pushShockwave({ x: target.x, y: target.y, r: 10, opacity: 0.9, color: "#fff7d6" });
        target.takeDamage(diamondsTotal * 20, attacker.id);
        atkType = "none";
    } else if (giftEffect.type === "lightningStorm") {
        playSound("lightning");
        screenShake = 8;
        triggerOverlayFlash("90, 200, 255", 0.08);
        spawnFloatingText("GALAXIA", target.x, target.y, "#7dd3fc");
        announceBilingual("Galaxia activada. Top arena en combate.", "Galaxy activated. Top arena battle.");
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                pushLightningBolt({
                    sx: attacker.x, sy: attacker.y,
                    tx: target.x + (Math.random() - 0.5) * 100,
                    ty: target.y + (Math.random() - 0.5) * 100,
                    life: 1.0, color: "#0abde3"
                });
                target.takeDamage(diamondsTotal * 5, attacker.id);
            }, i * 150);
        }
        atkType = "none";
    } else if (giftEffect.type === "buzzsaw" || giftValue >= 500) {
        // Power-up de Sierra (Aura)
        playSound("buzzsaw");
        attacker.sawLife = Math.max(attacker.sawLife, 900); // 15s de aura
        spawnFloatingText("SIERRA ACTIVA", attacker.x, attacker.y - 40, "#ff9f43");
        atkType = "none";
    } else if (giftEffect.type === "projectile") {
        playSound("roseShot");
        atkType = "projectile";
    } else if (giftEffect.type === "tapSpark") {
        playSound("hit");
        atkType = "projectile";
    } else if (giftEffect.type === "fireBurst") {
        playSound("fire");
        createFireBurst(target.x, target.y, attacker.currentRadius + 50);
        atkType = "lightning";
    } else if (giftEffect.type === "shockwave") {
        playSound("hit");
        pushShockwave({ x: target.x, y: target.y, r: 20, opacity: 0.85, color });
        atkType = "lightning";
    } else if (data.sfx) {
        playSound(data.sfx);
    }

    // Shockwave al atacar
    if (diamondsTotal > 10) {
        pushShockwave({ x: attacker.x, y: attacker.y, r: 10, opacity: 0.8, color: color });
    }

    // Ejecución de Proyectiles/Efectos persistentes
    if (atkType === "projectile") {
        const pCount = Math.min(count, 10);
        for (let i = 0; i < pCount; i++) {
            setTimeout(() => {
                if (attacker && target && target.hp > 0) {
                    playSound("shoot");
                    spawnProjectileBurst(attacker, target, 1, damage / pCount, color, { wobble: 4, life: 100 });
                }
            }, i * 100);
        }
    } else if (atkType === "lightning") {
        playSound("lightning");
        pushLightningBolt({ sx: attacker.x, sy: attacker.y, tx: target.x, ty: target.y, life: 1.0, color });
        target.takeDamage(damage, attacker.id);
        createExplosion(target.x, target.y, color);
    } else if (atkType === "laser") {
        playSound("lightning");
        spawnFloatingText("LASER", attacker.x, attacker.y, "#a855f7");
        pushHazard(new LaserBeam(attacker.x, attacker.y, attacker.id, 400));
    }
});

// ==========================================
// GAME LOOP Y DIBUJADO
// ==========================================

// Registro persistente de los mejores jugadores de la sesión (Hall of Fame) - AHORA MANEJADO POR SERVIDOR
let roundRanking = []; // Ranking de la ronda actual

let lastUIUpdate = 0;
const UI_THROTTLE_MS = 1000; // Máximo 1 actualización de DOM por segundo

function updateRankingDOM(force = false) {
    const now = Date.now();
    if (!force && (now - lastUIUpdate < UI_THROTTLE_MS)) return;
    lastUIUpdate = now;

    updateTopShowcase(); // Actualizar podio superior
    // Solo mostramos el TOP 5 en el ranking horizontal
    const top5 = roundRanking.slice(0, 5);
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
                <div class="board-name-row">
                    <span class="board-name">${p.name}</span>
                    ${p.victories > 0 ? `<span class="board-victories">🏆 ${p.victories}</span>` : ''}
                </div>
                <div class="board-stats">
                    <span class="stat-hp">❤️ HP ${Math.floor(p.hp || 0)}</span>
                    <span class="stat-score">⚔️ PTS ${Math.floor(p.score || 0)}</span>
                    ${p.state && p.state !== "ACTIVE" ? `<span class="stat-score">${p.state}</span>` : ""}
                </div>
            </div>
        `;
        leaderboardEl.appendChild(row);
    });
}

socket.on("arena:currentRanking", (data) => {
    roundRanking = data; // Ranking de la ronda actual
    updateRankingDOM(true); // Forzar actualización cuando cambian los líderes

    const leader = roundRanking[0];
    const now = Date.now();
    if (leader && leader.name) {
        const shouldHypeLeader =
            leader.id !== lastLeaderHypeId ||
            now - lastTopArenaHypeAt > 55000;

        if (shouldHypeLeader) {
            lastLeaderHypeId = leader.id;
            lastTopArenaHypeAt = now;
            announceEs(`Sigan al top arena. ${leader.name} va ganando.`, { minIntervalMs: 0 });
            announce(`Follow the arena leader. ${leader.name} is on top.`, { minIntervalMs: 0, gapMs: 700 });
            screenShake = Math.max(screenShake, 5);
        }
    }
});

window.setInterval(() => {
    if (!soundEnabled || !roundRanking.length) return;
    const leader = roundRanking[0];
    if (!leader?.name) return;

    announceEs(`Top arena. Sigan a ${leader.name}.`, { minIntervalMs: 0 });
    announce(`Top arena. Follow ${leader.name}.`, { minIntervalMs: 0, gapMs: 700 });
}, 78000);

let frameCount = 0;
let currentArenaKingId = null;

// Bucle principal a 60FPS
function loop() {
    frameCount++;

    // 1. DIBUJAR FONDO ESTÁTICO (Limpia el canvas sin offsets)
    drawBackground();

    if (overlayFlashAlpha > 0.01) {
        ctx.save();
        ctx.fillStyle = `rgba(${overlayFlashColor}, ${overlayFlashAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        overlayFlashAlpha *= 0.82;
    } else {
        overlayFlashAlpha = 0;
    }

    ctx.save(); // Save para Screen Shake

    // Aplicar Screen Shake
    if (screenShake > 0) {
        const sx = (Math.random() - 0.5) * screenShake;
        const sy = (Math.random() - 0.5) * screenShake;
        ctx.translate(sx, sy);
        screenShake *= 0.9;
        if (screenShake < 0.5) screenShake = 0;
    }

    ctx.save(); // Save para Cámara

    // Aplicar Cámara
    if (camera.zoomTimer > 0) {
        camera.zoomTimer--;
        camera.scale += (camera.targetScale - camera.scale) * 0.1;
        camera.x += (camera.targetX - camera.x) * 0.1;
        camera.y += (camera.targetY - camera.y) * 0.1;
    } else {
        camera.targetScale = 1;
        camera.targetX = canvas.width / 2;
        camera.targetY = canvas.height / 2;
        camera.scale += (1 - camera.scale) * 0.05;
        camera.x += (canvas.width / 2 - camera.x) * 0.05;
        camera.y += (canvas.height / 2 - camera.y) * 0.05;
    }

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);

    // Dibujar Partículas Ambientales (Siempre se mueven y dibujan, independiente del Hit Stop)
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ambientParticles.forEach(p => {
        p.y += p.vy;
        p.x += p.vx;

        if (p.isCoin) {
            p.rot += p.rotV;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = "#ffd700";
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#b45309";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = `bold ${p.size * 0.7}px Arial`;
            ctx.fillText("$", 0, 0);
            ctx.restore();
            // No reset for coins, they fall off screen
            return;
        }

        if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }

        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
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

        ctx.restore(); // Restore Camera
        ctx.restore(); // Restore Shake
        requestAnimationFrame(loop);
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

                const p1Clamped = clampToArena(p1.x, p1.y, p1.currentRadius + 6);
                const p2Clamped = clampToArena(p2.x, p2.y, p2.currentRadius + 6);
                p1.x = p1Clamped.x; p1.y = p1Clamped.y;
                p2.x = p2Clamped.x; p2.y = p2Clamped.y;

                const relativeSpeed = Math.sqrt((p1.vx - p2.vx) ** 2 + (p1.vy - p2.vy) ** 2);
                const now = Date.now();
                const canDamageOnCrash = now - (p1.lastBodyHitAt || 0) > 450 && now - (p2.lastBodyHitAt || 0) > 450;
                if (canDamageOnCrash && relativeSpeed > 2.6) {
                    const crashDamage = Math.min(16, Math.max(3, Math.round(relativeSpeed * 1.8)));
                    p1.lastBodyHitAt = now;
                    p2.lastBodyHitAt = now;
                    p1.takeDamage(crashDamage, p2.id);
                    p2.takeDamage(crashDamage, p1.id);
                    spawnFloatingText("CHOQUE", (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 16, "#fecaca");
                    screenShake = Math.max(screenShake, 3.5);
                }
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
            if (p.id && p.id.startsWith("bot_")) {
                positionBatch[p.id] = { x: Math.round(p.x), y: Math.round(p.y) };
            }
        }
    });

    // Lógica del Nuevo Rey
    if (currentClosestToCenter && currentClosestToCenter.id !== currentArenaKingId) {
        currentArenaKingId = currentClosestToCenter.id;
        // Coronación Pública
        spawnFloatingText(`${currentClosestToCenter.name.toUpperCase()} REY DEL CENTRO`, cx, cy - 150, "#ffd700");
        screenShake = Math.max(screenShake, 10);
        playSound("heal", 0.5); // Sonido triunfal pitch grave

        triggerOverlayFlash("255, 215, 120", 0.08);
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
        const l = lightningBolts[i];
        drawLightningBolt(l);
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

    ctx.restore(); // Restore Camera
    ctx.restore(); // Restore Shake
    requestAnimationFrame(loop);
}

// Iniciar Motor
requestAnimationFrame(loop);

// ------------------------------------------
// --- ⚙️ LÓGICA DE DEBUG (OCULTA POR DEFECTO) ---
// ------------------------------------------
if (DEBUG_MODE) {
    document.getElementById("debug-spawn-bot")?.addEventListener("click", () => {
        socket.emit("arena:debug:gift", { giftName: "Bot Spawn", diamondCount: 1, uniqueId: "bot_" + Math.floor(Math.random() * 1000) });
        spawnFloatingText("BOT", canvas.width / 2, canvas.height / 2, "#fff");
    });

    document.getElementById("debug-gift-rose")?.addEventListener("click", () => {
        socket.emit("arena:debug:gift", { giftName: "Rosa", diamondCount: 1 });
        spawnFloatingText("ROSE", canvas.width / 2, canvas.height / 2, "#ff4757");
    });

    document.getElementById("debug-gift-galaxy")?.addEventListener("click", () => {
        socket.emit("arena:debug:gift", { giftName: "Galaxia", diamondCount: 1000 });
    });

    document.getElementById("debug-gift-universe")?.addEventListener("click", () => {
        socket.emit("arena:debug:gift", { giftName: "Universo", diamondCount: 35000 });
    });

    document.getElementById("debug-toggle-sd")?.addEventListener("click", () => {
        socket.emit("arena:debug:toggleSD");
    });
}

// Auto-despertar AudioContext si es necesario
document.addEventListener("mousedown", () => {
    if (audioCtx?.state === 'suspended') audioCtx.resume();
});
