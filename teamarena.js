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
    const side = Math.min(canvas.width, canvas.height) - 96;
    const half = side / 2;
    return {
        cx,
        cy,
        side,
        half,
        left: cx - half,
        right: cx + half,
        top: cy - half,
        bottom: cy + half
    };
}

function clampToArena(x, y, margin = 120) {
    const { left, right, top, bottom } = getArenaBounds();
    return {
        x: Math.min(Math.max(x, left + margin), right - margin),
        y: Math.min(Math.max(y, top + margin), bottom - margin)
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
let sessionChampions = [];

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
let introAnnouncementDone = false;
let lastReturnPromptAt = 0;
let currentTopArenaLeader = null;
let lastGiftTipAt = 0;
let lastPromoTipAt = 0;
let currentRoundSeconds = 5 * 60;
let lastRoundLeaderId = null;
let lastRoundLeaderCueAt = 0;
let lastClutchCueAt = 0;
let lastFinalStretchCueAt = 0;
let lastReentryCueAt = 0;
let lastVisibleCompetitorCount = 0;
let lastCompletedRoundWinner = null;
let lastRoundWinnerHypeAt = 0;
let lastRoundWinnerHypeId = null;
let lastTopDuelVoiceAt = 0;
let lastRoundRankingAt = 0;

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

function resolvePreferredVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return voices.find((voice) => /es-/i.test(voice.lang) && /sabina|helena|paulina|monica|mónica|soledad|laura|google español|microsoft/i.test(voice.name))
        || voices.find((voice) => /es-/i.test(voice.lang) && /google|microsoft|natural|neural/i.test(voice.name))
        || voices.find((voice) => /es-/i.test(voice.lang))
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
    const voice = preferredVoices[next.lang] || resolvePreferredVoice();
    preferredVoices[next.lang] = voice;

    const msg = new window.SpeechSynthesisUtterance(next.text);
    msg.lang = "es-ES";
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
            lang: "es",
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

function announceEs(text, options = {}) {
    queueAnnouncement(text, { lang: "es", rate: 0.96, pitch: 0.96, volume: 0.95, ...options });
}

function announce(spanishText, options = {}) {
    announceEs(spanishText, { ...options, force: true, minIntervalMs: 0 });
}

function playArenaIntroAnnouncement(force = false) {
    if (introAnnouncementDone && !force) return;
    introAnnouncementDone = true;
    announce("Arena por paises activa. Para entrar, escriban su pais o su prefijo en el chat y luego hagan tap tap.", { gapMs: 650 });
    announce("Los regalos empujan con mucha fuerza a su pais y el ganador de la ronda sube al podio del arena.", { gapMs: 700 });
}

function promptReturnToArena(force = false) {
    const now = Date.now();
    if (!force && now - lastReturnPromptAt < 45000) return;
    lastReturnPromptAt = now;
    spawnFloatingText("ESCRIBE TU PAIS Y HAZ TAP TAP", canvas.width / 2, canvas.height / 2 - 140, "#fef08a");
    announce("Escribe tu pais o prefijo en el chat y luego tap tap para volver a la partida.", { gapMs: 650 });
    screenShake = Math.max(screenShake, 4);
}

function announceGiftTip() {
    const now = Date.now();
    if (now - lastGiftTipAt < 52000) return;
    lastGiftTipAt = now;
    const tips = [
        "Escriban su pais o prefijo y hagan tap tap para unirse a su equipo en esta arena.",
        "La rosa activa disparo rapido para su pais y baja puntos del rival.",
        "Capibara, rosa o dona meten presion inmediata y hacen reaccionar la arena de paises.",
        "La dona empuja al rival y activa una onda especial para su equipo.",
        "Fuegos artificiales activan una rafaga enorme que se siente en toda la arena.",
        "Galaxia desata rayos premium enormes y cambia por completo una ronda.",
        "Leon y Universo activan un megablast descomunal que sacude toda la arena."
    ];
    announce(tips[Math.floor(Math.random() * tips.length)], { gapMs: 650 });
}

function announcePromoTip() {
    const now = Date.now();
    if (now - lastPromoTipAt < 98000) return;
    lastPromoTipAt = now;
    const promos = [
        "Escriban su pais o prefijo y luego tap tap para sumar gente a su equipo.",
        "Prueben rosa, capibara, helado o dona y miren como cambia la pelea en segundos.",
        "Compartir y apoyarnos entre todos ayuda a viralizar este live y sumar seguidores.",
        "Apoyen siguiendo al creador del juego para impulsar esta arena en TikTok.",
        "Quien gane la ronda puede cambiar toda la historia del arena.",
        "El pais que gane la ronda sube al podio del arena y queda marcado arriba.",
        "Si les interesa un juego como este, consulten por privado.",
        "Este juego tambien puede adaptarse por encargo. Consulten precio por privado."
    ];
    announce(promos[Math.floor(Math.random() * promos.length)], { gapMs: 700 });
}

function speakLeaderChat(name, comment) {
    const cleanName = String(name || "Numero uno del arena").trim().slice(0, 32);
    const cleanComment = String(comment || "").replace(/\s+/g, " ").trim().slice(0, 110);
    if (!cleanComment) return;
    announce(`Numero uno del arena. ${cleanName} dice: ${cleanComment}`, { gapMs: 700 });
}

// --- 🎙️ DOPAMINE ANNOUNCER (Voice Lines) ---
window.speechSynthesis?.addEventListener?.("voiceschanged", () => {
    preferredVoices = { es: null, en: null };
    if (!introAnnouncementDone) {
        window.setTimeout(() => playArenaIntroAnnouncement(true), 300);
    }
});

window.setTimeout(() => playArenaIntroAnnouncement(), 900);
window.addEventListener("pointerdown", () => {
    if (!introAnnouncementDone || !window.speechSynthesis?.speaking) {
        playArenaIntroAnnouncement(true);
    }
}, { once: true });

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
    if (word) {
        const spanishWords = {
            ten: "diez",
            nine: "nueve",
            eight: "ocho",
            seven: "siete",
            six: "seis",
            five: "cinco",
            four: "cuatro",
            three: "tres",
            two: "dos",
            one: "uno"
        };
        announce(spanishWords[word] || word);
    }
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
        const now = audioCtx.currentTime;
        const oscClick = audioCtx.createOscillator();
        osc.connect(gain);
        oscClick.connect(gain);
        osc.type = 'square';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(34, now + 0.18);
        oscClick.type = 'triangle';
        oscClick.frequency.setValueAtTime(540, now);
        oscClick.frequency.exponentialRampToValueAtTime(120, now + 0.08);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        osc.start(now);
        oscClick.start(now);
        osc.stop(now + 0.18);
        oscClick.stop(now + 0.09);
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
        const now = audioCtx.currentTime;
        const pulseOffsets = [0, 0.032, 0.064, 0.096];

        pulseOffsets.forEach((offset, index) => {
            const osc = audioCtx.createOscillator();
            const oscNoise = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.connect(gain);
            oscNoise.connect(gain);
            gain.connect(audioCtx.destination);

            osc.type = 'square';
            osc.frequency.setValueAtTime(96 + (index * 18), now + offset);
            osc.frequency.linearRampToValueAtTime(132 + (index * 22), now + offset + 0.04);

            oscNoise.type = 'sawtooth';
            oscNoise.frequency.setValueAtTime(310 + (index * 45), now + offset);
            oscNoise.frequency.linearRampToValueAtTime(510 + (index * 50), now + offset + 0.04);

            gain.gain.setValueAtTime(0.06, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.002, now + offset + 0.05);

            osc.start(now + offset);
            oscNoise.start(now + offset);
            osc.stop(now + offset + 0.055);
            oscNoise.stop(now + offset + 0.055);
        });
    },
    heavyExplosion: () => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const oscPunch = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        oscPunch.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(62, now);
        osc.frequency.exponentialRampToValueAtTime(24, now + 0.5);
        oscPunch.type = 'square';
        oscPunch.frequency.setValueAtTime(118, now);
        oscPunch.frequency.exponentialRampToValueAtTime(42, now + 0.12);
        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);
        osc.start(now);
        oscPunch.start(now);
        osc.stop(now + 0.52);
        oscPunch.stop(now + 0.14);
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
    },
    glide: (pitchMod = 1) => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const noise = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        noise.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'triangle';
        noise.type = 'sawtooth';
        osc.frequency.setValueAtTime(120 * pitchMod, now);
        osc.frequency.exponentialRampToValueAtTime(72 * pitchMod, now + 0.12);
        noise.frequency.setValueAtTime(240 * pitchMod, now);
        noise.frequency.exponentialRampToValueAtTime(130 * pitchMod, now + 0.12);
        gain.gain.setValueAtTime(0.022, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        noise.start(now);
        osc.stop(now + 0.12);
        noise.stop(now + 0.12);
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

function getSizeDominance(player) {
    if (!player) return 0;
    return Math.max(0, Math.min(1.2, ((player.currentRadius || PLAYER_RADIUS) - PLAYER_RADIUS) / 90));
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
const BASE_SPEED = 2.8; // Un poco mas de rebote para evitar quietud
const NUM_STARS = 100;
const PASSIVE_SAW_SMALL_SCORE = 400;
const PASSIVE_SAW_CONTINUOUS_SCORE = 550;
const PASSIVE_SAW_MEDIUM_SCORE = 700;
const PASSIVE_SAW_LARGE_SCORE = 1000;

// Caché de imágenes pre-cargadas (Avatares)
const avatarCache = {};
const kingZoneImageUrl = "/zona-rey.webp";

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

    // Dibujar Jaula Cuadrada (Arena limit)
    const { cx, cy, left, top, side } = getArenaBounds();

    ctx.beginPath();
    ctx.roundRect(left, top, side, side, 28);
    ctx.strokeStyle = "rgba(0, 240, 255, 0.2)";
    ctx.lineWidth = 15;
    ctx.stroke();

    // --- NÚCLEO: ZONA REY ---
    const coreRadius = 120;
    const kingZonePulse = 0.94 + ((Math.sin(Date.now() / 280) + 1) * 0.05);
    const kingZoneImage = getAvatarImage(kingZoneImageUrl);
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 215, 0, 0.08)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 215, 0, 0.4)";
    ctx.setLineDash([10, 10]);
    ctx.stroke();
    ctx.setLineDash([]);

    const kingImageRadius = coreRadius * 0.64 * kingZonePulse;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy - 6, kingImageRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (kingZoneImage && kingZoneImage.complete && kingZoneImage.naturalWidth > 0) {
        ctx.drawImage(
            kingZoneImage,
            cx - kingImageRadius,
            cy - kingImageRadius - 6,
            kingImageRadius * 2,
            kingImageRadius * 2
        );
    } else {
        ctx.fillStyle = "rgba(255, 215, 0, 0.18)";
        ctx.fillRect(cx - kingImageRadius, cy - kingImageRadius - 6, kingImageRadius * 2, kingImageRadius * 2);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy - 6, kingImageRadius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 223, 128, 0.9)";
    ctx.lineWidth = 4;
    ctx.shadowBlur = 18;
    ctx.shadowColor = "rgba(255, 215, 0, 0.55)";
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(cx, cy - 6, kingImageRadius + 11, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 215, 0, 0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 215, 0, 0.88)";
    ctx.font = "bold 20px Rajdhani";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("👑 ZONA REY", cx, cy + coreRadius - 24);
    // ------------------------

    ctx.beginPath();
    ctx.roundRect(left, top, side, side, 28);
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
    const shake = Math.min(options.shake || 10, 24);
    const finalCount = isSuddenDeath ? Math.min(40, Math.round(count * 1.22)) : count;
    const finalSpeed = isSuddenDeath ? Math.min(14, speed + 2) : speed;
    const finalShake = isSuddenDeath ? Math.min(24, shake + 4) : shake;

    screenShake = Math.max(screenShake, finalShake);

    for (let i = 0; i < finalCount; i++) {
        pushParticle({
            x, y,
            vx: (Math.random() - 0.5) * finalSpeed,
            vy: (Math.random() - 0.5) * finalSpeed,
            life: 1.0,
            size: Math.random() * 4 + 2,
            color: color || "#fff"
        });
    }
}

function createDirectedBurst(source, target, options = {}) {
    if (!source || !target) return;
    const bursts = Math.max(1, Math.min(options.count || 4, 10));
    const color = options.color || "#ffd700";
    const dx = target.x - source.x;
    const dy = target.y - source.y;

    for (let i = 0; i < bursts; i++) {
        const t = bursts === 1 ? 1 : i / (bursts - 1);
        const arc = Math.sin(t * Math.PI) * (options.arcHeight || 36);
        const px = source.x + dx * t + (Math.random() - 0.5) * 18;
        const py = source.y + dy * t - arc + (Math.random() - 0.5) * 18;
        setTimeout(() => {
            createExplosion(px, py, color, {
                count: options.particleCount || 16,
                speed: options.speed || 8,
                shake: options.shake || 4
            });
            if (t >= 0.85) {
                pushShockwave({
                    x: target.x,
                    y: target.y,
                    r: options.impactRadius || 18,
                    opacity: 0.78,
                    color
                });
            }
            playSound(i % 2 === 0 ? "explosion" : "heavyExplosion");
        }, i * (options.delayMs || 70));
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
        this.flag = data.flag || data.countryFlag || "";
        this.flagUrl = data.flagUrl || "";
        this.countryCode = data.countryCode || this.id;
        this.memberAvatars = Array.isArray(data.memberAvatars) ? data.memberAvatars.slice(0, 4) : [];
        this.memberCount = data.memberCount || 1;
        this.activeCount = data.activeCount || 1;
        this.hp = data.hp || MAX_HP;
        this.score = data.score || 0;
        this.standingScore = data.standingScore || this.score || 0;
        this.deaths = data.deaths || 0;
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
        this.lastSawAudioAt = 0;
        this.lastGlideAudioAt = 0;

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
        const engagementScale = Math.min(this.engagement * 0.34, 42);
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
            this.opacity = Math.max(this.opacity - 0.06, 0.06);
            this.currentRadius += ((Math.max(PLAYER_RADIUS, targetRadius * 0.9)) - this.currentRadius) * 0.16;
            this.vx *= 0.995;
            this.vy *= 0.995;
        } else {
            this.currentRadius += (targetRadius - this.currentRadius) * 0.16;
            this.opacity = 1.0;
        }

        const timeSinceTapBoost = Date.now() - (this.lastTapBoostAt || 0);
        if (this.sawLife <= 0) {
            const passiveDecay = timeSinceTapBoost < 700 ? 0.18 : 0.95;
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
        if (Math.random() < 0.1) {
            this.vx += (Math.random() - 0.5) * 1.1;
            this.vy += (Math.random() - 0.5) * 1.1;
        }

        // --- LÓGICA DE SIERRA (POWER-UP) ---
        const passiveSawTier = this.getPassiveSawTier();
        const hasContinuousSaw = (this.score || 0) >= PASSIVE_SAW_CONTINUOUS_SCORE;
        if (this.sawLife > 0 || passiveSawTier > 0) {
            if (this.sawLife > 0) {
                this.sawLife--;
            }
            const sawSpinBoost = passiveSawTier >= 3 ? 0.2 : passiveSawTier >= 2 ? 0.12 : (hasContinuousSaw ? 0.1 : 0.06);
            this.sawAngle += (0.4 + sawSpinBoost) * this.spinDirection;
            this.engagement = Math.max(this.engagement - 0.01, 0);
            const now = Date.now();
            const sawPulseEveryMs = Math.max(60, 118 - Math.min(42, this.engagement * 1.6));
            if (now - (this.lastSawAudioAt || 0) >= sawPulseEveryMs) {
                this.lastSawAudioAt = now;
                playSound("buzzsaw");
            }
        }

        // --- LÍMITE DE VELOCIDAD MÁXIMA ---
        const computedSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        const maxSpeed = 15;
        if (computedSpeed > maxSpeed) {
            this.vx = (this.vx / computedSpeed) * maxSpeed;
            this.vy = (this.vy / computedSpeed) * maxSpeed;
        }

        if (this.opacity > 0.45 && this.state === "ACTIVE" && computedSpeed > 5.2) {
            const now = Date.now();
            if (now - (this.lastGlideAudioAt || 0) > 420 && Math.random() < 0.08) {
                this.lastGlideAudioAt = now;
                playSound("glide", Math.min(1.45, 0.9 + (computedSpeed / 14)));
            }
        }

        // Físicas
        this.x += this.vx;
        this.y += this.vy;

        // Rebote Jaula Cuadrada
        const { cx, cy, left, right, top, bottom } = getArenaBounds();
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

        let bounced = false;
        if (this.x + this.currentRadius > right) {
            this.x = right - this.currentRadius;
            this.vx = -Math.abs(this.vx);
            bounced = true;
        } else if (this.x - this.currentRadius < left) {
            this.x = left + this.currentRadius;
            this.vx = Math.abs(this.vx);
            bounced = true;
        }

        if (this.y + this.currentRadius > bottom) {
            this.y = bottom - this.currentRadius;
            this.vy = -Math.abs(this.vy);
            bounced = true;
        } else if (this.y - this.currentRadius < top) {
            this.y = top + this.currentRadius;
            this.vy = Math.abs(this.vy);
            bounced = true;
        }

        if (bounced) {
            const now = Date.now();
            const impact = Math.sqrt((this.vx * this.vx) + (this.vy * this.vy));
            if (now - (this.lastGlideAudioAt || 0) > 180) {
                this.lastGlideAudioAt = now;
                playSound("glide", Math.min(1.5, 1 + (impact / 12)));
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
        const flagImg = getAvatarImage(this.flagUrl);
        const gradient = ctx.createRadialGradient(this.x, this.y, this.currentRadius * 0.15, this.x, this.y, this.currentRadius);
        gradient.addColorStop(0, "rgba(255,255,255,0.28)");
        gradient.addColorStop(1, "rgba(15,23,42,0.92)");
        ctx.fillStyle = gradient;
        ctx.fillRect(this.x - this.currentRadius, this.y - this.currentRadius, this.currentRadius * 2, this.currentRadius * 2);

        if (img && img.complete && img.naturalWidth > 0) {
            ctx.globalAlpha = 0.22;
            ctx.drawImage(img, this.x - this.currentRadius, this.y - this.currentRadius, this.currentRadius * 2, this.currentRadius * 2);
            ctx.globalAlpha = this.opacity;
        }

        ctx.fillStyle = "rgba(4, 10, 24, 0.4)";
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius * 0.52, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius * 0.42, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        if (flagImg && flagImg.complete && flagImg.naturalWidth > 0) {
            ctx.drawImage(flagImg, this.x - (this.currentRadius * 0.5), this.y - (this.currentRadius * 0.34), this.currentRadius, this.currentRadius * 0.68);
        } else {
            ctx.fillStyle = "white";
            ctx.font = `bold ${Math.max(26, Math.floor(this.currentRadius * 0.9))}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(this.flag || this.name[0].toUpperCase(), this.x, this.y - 2);
        }
        ctx.restore();

        // --- PUNTOS / SCORE DENTRO DEL GLOBO ---
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = this.opacity;

        const badgeSize = Math.max(this.currentRadius * 0.7, 18);

        if ((this.deaths || 0) > 0) {
            const skullX = this.x + (this.currentRadius * 0.56);
            const skullY = this.y - (this.currentRadius * 0.58);
            const skullRadius = Math.max(10, this.currentRadius * 0.19);
            ctx.beginPath();
            ctx.arc(skullX, skullY, skullRadius, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
            ctx.fill();
            ctx.fillStyle = "#fecaca";
            ctx.font = `bold ${Math.max(9, Math.floor(skullRadius * 0.68))}px Rajdhani`;
            ctx.fillText(`VP ${this.deaths}`, skullX, skullY);
        }

        if (this.memberAvatars?.length) {
            const slots = this.memberAvatars.slice(0, 4);
            slots.forEach((url, index) => {
                const angle = (-Math.PI / 2) + ((index / Math.max(1, slots.length)) * Math.PI * 2);
                const orbitRadius = this.currentRadius + 16;
                const faceX = this.x + Math.cos(angle) * orbitRadius;
                const faceY = this.y + Math.sin(angle) * orbitRadius;
                const faceRadius = Math.max(12, this.currentRadius * 0.18);
                const faceImg = getAvatarImage(url);

                ctx.save();
                ctx.beginPath();
                ctx.arc(faceX, faceY, faceRadius, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                if (faceImg && faceImg.complete && faceImg.naturalWidth > 0) {
                    ctx.drawImage(faceImg, faceX - faceRadius, faceY - faceRadius, faceRadius * 2, faceRadius * 2);
                } else {
                    ctx.fillStyle = "rgba(148,163,184,0.95)";
                    ctx.fillRect(faceX - faceRadius, faceY - faceRadius, faceRadius * 2, faceRadius * 2);
                }
                ctx.restore();

                ctx.beginPath();
                ctx.arc(faceX, faceY, faceRadius, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(255,255,255,0.9)";
                ctx.lineWidth = 2;
                ctx.stroke();
            });
        }

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
        if ((this.memberCount || 1) > 1) {
            ctx.fillStyle = "#cbd5e1";
            ctx.font = "bold 12px Rajdhani";
            ctx.fillText(`${this.activeCount || 0}/${this.memberCount} EN EQUIPO`, this.x, this.y - this.currentRadius - 28);
        }
        ctx.shadowBlur = 0;

        ctx.globalAlpha = 1.0;

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
        const passiveSawTier = this.getPassiveSawTier();
        if (this.sawLife > 0 || passiveSawTier > 0) {
            const tierRadiusBoost = passiveSawTier >= 3 ? 38 : passiveSawTier >= 2 ? 26 : passiveSawTier >= 1 ? 14 : 0;
            const worldSawRadius = this.currentRadius + 15 + tierRadiusBoost;
            const worldTrailingAngle = this.sawAngle - (Math.PI / 2) * this.spinDirection;
            ctx.save();
            ctx.translate(this.x, this.y);

            // RAYOS ELÉCTRICOS (Neuromarketing visual)
            if ((this.sawLife > 0 || passiveSawTier >= 2) && Math.random() < 0.3) {
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
            const teethCount = Math.max(16, Math.min(42, 16 + Math.floor(this.engagement * 1.8) + (passiveSawTier * 4)));
            const toothDepth = 12 + Math.min(30, this.engagement * 0.8) + (passiveSawTier * 3);
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

            ctx.lineWidth = 6;
            ctx.strokeStyle = grad;
            ctx.shadowBlur = 24;
            ctx.shadowColor = "rgba(255,255,255,0.72)";
            ctx.stroke();
            ctx.fillStyle = "rgba(235, 239, 245, 0.42)";
            ctx.fill();

            ctx.beginPath();
            ctx.arc(0, 0, sawRadius + 6, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255, 184, 28, 0.38)";
            ctx.lineWidth = 3;
            ctx.stroke();

            // Nucleo visible para que la sierra nunca se pierda sobre el avatar.
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(10, sawRadius * 0.22), 0, Math.PI * 2);
            ctx.fillStyle = "#fff7cc";
            ctx.fill();
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#374151";
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
        }

        const sawActive = this.sawLife > 0 || passiveSawTier > 0;
        const badgeY = sawActive ? this.y : this.y + (this.currentRadius * 0.3);
        const scoreBadgeSize = sawActive ? badgeSize * 0.82 : badgeSize;
        ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
        ctx.beginPath();
        ctx.arc(this.x, badgeY, scoreBadgeSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = sawActive ? "rgba(255, 230, 160, 0.8)" : "rgba(255,255,255,0.18)";
        ctx.stroke();

        ctx.fillStyle = "white";
        ctx.font = `bold ${Math.floor(scoreBadgeSize * 0.55)}px Rajdhani`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(Math.floor(this.standingScore ?? this.score), this.x, badgeY);

        ctx.shadowBlur = 0;
    }

    getPassiveSawTier() {
        if ((this.score || 0) >= PASSIVE_SAW_LARGE_SCORE) return 3;
        if ((this.score || 0) >= PASSIVE_SAW_MEDIUM_SCORE) return 2;
        if ((this.score || 0) >= PASSIVE_SAW_SMALL_SCORE) return 1;
        return 0;
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

socket.on("teamArena:suddenDeath", (active) => {
    isSuddenDeath = active;
    const sdOverlay = document.getElementById("x2-alpha-overlay");
    if (active) {
        if (sdOverlay) sdOverlay.style.display = "flex";
        spawnFloatingText("FASE FINAL", canvas.width / 2, canvas.height / 2 - 200, "#ff8c42");
        showAnnouncer("FASE FINAL", "#ff8c42");
        playSound("heavyExplosion");
        triggerOverlayFlash("255, 120, 80", 0.1);
        createExplosion(canvas.width / 2, canvas.height / 2, "#ff8c42", { count: 36, speed: 14, shake: 18 });
        pushShockwave({ x: canvas.width / 2, y: canvas.height / 2, r: 120, opacity: 0.85, color: "#ff8c42" });
        screenShake = 16;
        announce("Fase final activada. Impacto reforzado.");
    } else {
        if (sdOverlay) sdOverlay.style.display = "none";
        showAnnouncer("RITMO NORMAL", "#2ed573");
        announce("Modo normal restaurado.");
    }
});

socket.on("teamArena:champion", (id) => {
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
socket.on("teamArena:champions", (winners) => {
    const ticker = document.getElementById("champions-ticker");
    sessionChampions = Array.isArray(winners) ? winners : [];
    if (!ticker) return;
    if (!winners || winners.length === 0) {
        ticker.innerHTML = "<span>ESPERANDO CAMPEONES...</span>";
        updateTopShowcase();
        return;
    }
    const html = winners.map(w => `
        <div class="champion-item">
            <span class="champ-crown">👑</span>
            <span class="champ-crown">${w.flag || "🌍"}</span>
            <span class="champ-name">${w.name}</span>
            <span class="champ-wins">${w.victories} VICS</span>
            <span class="champ-time">${w.time}</span>
        </div>
    `).join('<span class="champ-sep">|</span>');
    ticker.innerHTML = `<div class="ticker-scroll">${html} ${html}</div>`; // Duplicado para loop infinito
    updateTopShowcase();
});
// ------------------------------------------

socket.on("teamArena:combo", () => {
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

socket.on("teamArena:sync", (serverPlayers) => {
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
        players[sp.id].standingScore = sp.standingScore ?? players[sp.id].standingScore ?? players[sp.id].score ?? 0;
        players[sp.id].deaths = sp.deaths ?? players[sp.id].deaths ?? 0;
        players[sp.id].hp = sp.hp ?? players[sp.id].hp;
        players[sp.id].name = sp.name || players[sp.id].name;
        players[sp.id].victories = sp.victories ?? players[sp.id].victories ?? 0;
        players[sp.id].bestScore = sp.bestScore ?? players[sp.id].bestScore ?? 0;
        players[sp.id].state = sp.state || players[sp.id].state;
        players[sp.id].lastActive = sp.lastActive || players[sp.id].lastActive;
        players[sp.id].invulnerableUntil = sp.invulnerableUntil || 0;
        players[sp.id].totalGiftDiamonds = sp.totalGiftDiamonds || players[sp.id].totalGiftDiamonds || 0;
        players[sp.id].totalLikes = sp.totalLikes || players[sp.id].totalLikes || 0;
        players[sp.id].flag = sp.flag || sp.countryFlag || players[sp.id].flag || "";
        players[sp.id].flagUrl = sp.flagUrl || players[sp.id].flagUrl || "";
        players[sp.id].countryCode = sp.countryCode || players[sp.id].countryCode || sp.id;
        players[sp.id].memberAvatars = Array.isArray(sp.memberAvatars) ? sp.memberAvatars.slice(0, 4) : (players[sp.id].memberAvatars || []);
        players[sp.id].memberCount = sp.memberCount ?? players[sp.id].memberCount ?? 1;
        players[sp.id].activeCount = sp.activeCount ?? players[sp.id].activeCount ?? 1;
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
    players[sp.id].flag = sp.flag || sp.countryFlag || players[sp.id].flag || "";
    players[sp.id].flagUrl = sp.flagUrl || players[sp.id].flagUrl || "";
    players[sp.id].countryCode = sp.countryCode || players[sp.id].countryCode || sp.id;
    players[sp.id].memberAvatars = Array.isArray(sp.memberAvatars) ? sp.memberAvatars.slice(0, 4) : (players[sp.id].memberAvatars || []);
    players[sp.id].memberCount = sp.memberCount ?? players[sp.id].memberCount ?? 1;
    players[sp.id].activeCount = sp.activeCount ?? players[sp.id].activeCount ?? 1;

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
        { name: "FIREWORKS / DRAGON", effect: "RAFAGA ESPECIAL", icon: "🔥" },
        { name: "GALAXY / PLANET", effect: "RAYO PREMIUM", icon: "🌌" },
        { name: "LION / UNIVERSE", effect: "MEGABLAST + SALIDA", icon: "🦁" },
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
            <span class="powers-timer-label">ESCRIBE TU PAIS O PREFIJO PARA UNIRTE</span>
            <span class="powers-timer-label">FIN DE RONDA</span>
            <span id="round-time-remaining">05:00</span>
        </div>
    `;
}

function renderLastRoundWinner() {
    const slot = document.getElementById("round-winner-slot");
    if (!slot) return;
    const winner = lastCompletedRoundWinner;
    if (!winner?.id) {
        const minutes = String(Math.floor(currentRoundSeconds / 60)).padStart(2, "0");
        const secs = String(currentRoundSeconds % 60).padStart(2, "0");
        slot.innerHTML = `
            <div class="round-winner-empty">
                <span class="round-winner-empty-label">CIERRE DE RONDA EN</span>
                <span class="round-winner-empty-time">${minutes}:${secs}</span>
            </div>
        `;
        return;
    }

    slot.innerHTML = `
        <div class="round-winner-card">
            <div class="round-winner-avatar round-winner-flag${winner.flagUrl ? " has-flag-image" : ""}" style="${winner.flagUrl ? `background-image:url('${winner.flagUrl}')` : ""}">${winner.flagUrl ? "" : (winner.flag || "")}</div>
            <div class="round-winner-info">
                <div class="round-winner-label">GANADOR ACTUAL</div>
                <div class="round-winner-name">${winner.name}</div>
                <div class="round-winner-meta">
                    <span>PTS ${Math.floor(winner.standingScore || winner.score || 0)}</span>
                    <span>VP ${Math.floor(winner.deaths || 0)}</span>
                </div>
            </div>
        </div>
    `;
}
// Escuchamos el Hall of Fame persistente del servidor (Top 10 real de 12 horas)
socket.on("teamArena:hallOfFameUpdate", (list) => {
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
    const podium3 = sessionChampions
        .map((entry) => {
            const livePlayer = entry.id ? players[entry.id] : Object.values(players).find((player) => player?.name === entry.name);
            return {
                id: entry.id || livePlayer?.id || entry.name,
                name: entry.name,
                avatar: livePlayer?.avatar || entry.avatar || "https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image",
                flag: livePlayer?.flag || entry.flag || "",
                flagUrl: livePlayer?.flagUrl || entry.flagUrl || "",
                currentScore: Math.floor(livePlayer?.score || 0),
                displayScore: Math.floor(livePlayer?.score || 0),
                bestScore: Math.floor(livePlayer?.bestScore || livePlayer?.score || 0),
                victories: Math.floor(entry.victories || 0)
            };
        })
        .sort((a, b) =>
            (b.victories - a.victories) ||
            (b.currentScore - a.currentScore) ||
            (b.bestScore - a.bestScore)
        )
        .slice(0, 3);

    currentTopArenaLeader = podium3.find((player) => !player.isPlaceholder) || null;

    // Rellenamos hasta tener siempre 3 slots
    while (podium3.length < 3) {
        podium3.push({
            name: "ESPERANDO...",
            avatar: "https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image",
            flag: "",
            flagUrl: "",
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
            <div class="top-player-avatar" style="background-image: url('${p.avatar || ''}')">${p.flagUrl ? `<span class="top-player-flag top-player-flag-image" style="background-image:url('${p.flagUrl}')"></span>` : (p.flag ? `<span class="top-player-flag">${p.flag}</span>` : "")}</div>
            <div class="top-rank-badge">${rank}</div>
            <div class="top-player-name">${p.name}</div>
            ${!p.isPlaceholder ? `<div class="top-player-score">VICTORIAS ${Math.floor(p.victories || 0)}</div>` : ''}
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
    currentRoundSeconds = Math.max(0, Number(seconds) || 0);
    const roundTimerEl = document.getElementById("round-time-remaining");
    if (roundTimerEl) {
        const minutes = String(Math.floor(currentRoundSeconds / 60)).padStart(2, "0");
        const secs = String(currentRoundSeconds % 60).padStart(2, "0");
        roundTimerEl.textContent = `${minutes}:${secs}`;
    }
    if (!lastCompletedRoundWinner?.id) {
        renderLastRoundWinner();
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

socket.on("teamArena:roundEnd", (data) => {
    countdownOverlay.classList.remove("active");
    Object.values(players).forEach((player) => {
        player.hp = MAX_HP;
        player.sawLife = 0;
        player.flash = 0;
        player.engagement = 0;
    });

    const roundWinner = data?.roundWinner || data?.winner;
    lastCompletedRoundWinner = roundWinner || lastCompletedRoundWinner;
    renderLastRoundWinner();
    const arenaChampion = currentTopArenaLeader;

    if (!roundWinner) {
        spawnFloatingText("FIN DE RONDA", canvas.width / 2, canvas.height / 2 - 100, "#fff");
        return;
    }

    const w = roundWinner;
    console.log("🏆 GANADOR DE LA RONDA:", w.name);
    announce(`Ganador de la ronda actual. ${w.name}.`, { gapMs: 650 });
    if (arenaChampion?.name) {
        announce(`Numero uno del arena. ${arenaChampion.name}. Lleva ${Math.floor(arenaChampion.victories || 0)} rondas ganadas.`, { gapMs: 650 });
    }

    // Efecto visual masivo de Victoria (Volumen reducido)
    screenShake = 24;
    playSound("jackpot", 0.8);
    setTimeout(() => playSound("heavyExplosion", 0.7), 500);

    // Overlay de Victoria
    const overlay = document.createElement("div");
    overlay.className = "victory-overlay";
    overlay.innerHTML = `
        <div class="victory-card">
            <h1 class="victory-title">🏁 GANADOR DE LA RONDA 🏁</h1>
            <div class="victory-avatar victory-flag${w.flagUrl ? " has-flag-image" : ""}" style="${w.flagUrl ? `background-image:url('${w.flagUrl}')` : ""}">${w.flagUrl ? "" : (w.flag || "")}</div>
            <h2 class="victory-name">${w.name}</h2>
            <div class="victory-stats">PTS DE RONDA: ${Math.floor(w.standingScore || w.score || 0)}</div>
            ${arenaChampion?.name ? `<div class="victory-stats">👑 NUMERO UNO DEL ARENA: ${arenaChampion.name} · ${Math.floor(arenaChampion.victories || 0)} RONDAS</div>` : ""}
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

socket.on("teamArena:lastRoundWinner", (winner) => {
    lastCompletedRoundWinner = winner || null;
    renderLastRoundWinner();
});

socket.on("teamArena:powerup", (data) => {
    const target = players[data.userId];
    if (target) {
        if (data.type === "buzzsaw") {
            target.sawLife = Math.max(target.sawLife || 0, data.duration || 600);
            target.engagement = Math.min((target.engagement || 0) + 20, 90);
            target.lastSawAudioAt = 0;
            target.flash = 1;
            playSound("buzzsaw");
            setTimeout(() => playSound("buzzsaw", 0.92), 120);
            spawnFloatingText("SIERRA ACTIVA", target.x, target.y - 40, "#ff9f43");
            triggerOverlayFlash("255, 180, 90", 0.09);
        }
    }
});

socket.on("teamArena:burst", (data) => {
    const burstCount = Math.max(1, Math.min(data.count || 3, 8));
    const source = (data.sourceId && players[data.sourceId]) || (
        Number.isFinite(data.sourceX) && Number.isFinite(data.sourceY)
            ? { x: data.sourceX, y: data.sourceY }
            : null
    );
    const target = (data.targetId && players[data.targetId]) || (
        Number.isFinite(data.targetX) && Number.isFinite(data.targetY)
            ? { x: data.targetX, y: data.targetY }
            : null
    );

    if (source && target) {
        createDirectedBurst(source, target, {
            count: burstCount,
            color: data.color || "#ffd700",
            particleCount: 20,
            speed: 9,
            shake: 6,
            impactRadius: 20,
            arcHeight: 44,
            delayMs: 75
        });
        return;
    }

    for (let i = 0; i < burstCount; i++) {
        setTimeout(() => {
            const offsetX = (Math.random() - 0.5) * 80;
            const offsetY = (Math.random() - 0.5) * 80;
            createExplosion(data.x + offsetX, data.y + offsetY, data.color || "#ffd700", { count: 18, speed: 9, shake: 6 });
            playSound(i % 2 === 0 ? "explosion" : "heavyExplosion");
        }, i * 80);
    }
});

// EVENTO SALIDA / AFK (GC Sweep)
socket.on("teamArena:leave", (data) => {
    if (players[data.id]) {
        // Efecto visual de salir
        createExplosion(players[data.id].x, players[data.id].y, "#555");
        delete players[data.id];
        updateRankingDOM();
        if (Object.keys(players).length <= 1) {
            promptReturnToArena();
        }
    }
});

socket.on("teamArena:respawn", (data) => {
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
socket.on("teamArena:like", (data) => {
    const p = syncPlayerFromServer(data.player) || players[data.userId];
    if (p) {
        p.lastActive = Date.now(); // Despierta de AFK inmediatamente
        p.heal(data.heal || data.likeCount);
        p.engagement = Math.min((p.engagement || 0) + Math.max(10, data.likeCount * 2.8), 220);
        p.lastTapBoostAt = Date.now();
        p.flash = 1;

        screenShake = Math.max(screenShake, 2);

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

        playSound("heal", Math.min(pitchMod, 1.2));
        spawnFloatingText(`TAP +${Math.max(1, Math.floor(data.likeCount || 1))}`, p.x, p.y - 10, "#86efac");
        if (data.scoreGain > 0) {
            spawnFloatingText(`+${data.scoreGain} PTS`, p.x, p.y - 28, "#fff3b0");
        }
        if (data.comboLikes >= 16 && data.comboLikes % 8 === 0) {
            spawnFloatingText(`RUSH x${data.comboLikes}`, p.x, p.y - 54, "#7dd3fc");
            triggerOverlayFlash("120, 255, 210", 0.04);
            screenShake = Math.max(screenShake, Math.min(5, 2 + (data.comboLikes / 30)));
        }

        // Mostrar texto de apoyo adictivo (Combos épicos)
        const strikes = recentHeals[data.userId].strikes;
        if (strikes > 0 && strikes % 50 === 0) {
            spawnFloatingText(`COMBO x${strikes}`, p.x, p.y - 40, "#ff9f43");
            screenShake = Math.max(screenShake, 4);
        } else if (data.likeCount >= 3 || strikes % 6 === 0) {
            spawnFloatingText(`TAP x${strikes}`, p.x, p.y, "#2ed573");
        }
    }
});

socket.on("teamArena:likeStrike", (data) => {
    const attacker = syncPlayerFromServer(data.attacker) || players[data.attacker?.id];
    const target = syncPlayerFromServer(data.target) || players[data.target?.id];
    if (!attacker || !target) return;

    const comboLikes = data.comboLikes || data.likeCount || 0;
    const sizeDominance = getSizeDominance(attacker);
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
            life: 0.7 + (sizeDominance * 0.65),
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
    screenShake = Math.max(screenShake, Math.min(isSuddenDeath ? 13 : 9, (isSuddenDeath ? 4.6 : 2.8) + (comboLikes / (isSuddenDeath ? 9 : 12))));
    playSound("hit", 1.08);
});

socket.on("teamArena:sawHit", (data) => {
    const attacker = syncPlayerFromServer(data.attacker) || players[data.attacker?.id];
    const target = syncPlayerFromServer(data.target) || players[data.target?.id];
    if (!attacker || !target) return;

    target.flash = 1;
    createExplosion(target.x, target.y, "#fbbf24", { count: 14, speed: 6, shake: 4 });
    pushShockwave({ x: target.x, y: target.y, r: 18, opacity: 0.65, color: "#fbbf24" });
    spawnFloatingText(`-${Math.floor(data.damage || 0)}`, target.x, target.y - 22, "#fde68a");
    if ((data.scoreLoss || 0) > 0) {
        spawnFloatingText(`-${Math.floor(data.scoreLoss)} PTS`, target.x, target.y - 44, "#fca5a5");
    }
    screenShake = Math.max(screenShake, 5);
    if (Math.random() > 0.35) playSound("hit", 0.94);
});

// EVENTO DE PODER POR CHAT (Aura Visual)
socket.on("teamArena:chatPower", (data) => {
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

        playSound("heal", 0.45); // Sonido suave para el aura
        screenShake = Math.max(screenShake, 1.8);
    }
});

socket.on("teamArena:leaderChat", (data) => {
    if (!data?.comment) return;
    if (!currentTopArenaLeader?.id || data.userId !== currentTopArenaLeader.id) return;
    const focusX = canvas.width / 2;
    const focusY = canvas.height / 2 - 190;
    spawnFloatingText(`NUMERO 1 DEL ARENA: ${data.name}`, focusX, focusY, "#fde68a");
    spawnFloatingText(`"${data.comment}"`, focusX, focusY + 34, "#f8fafc");
    speakLeaderChat(data.name, data.comment);
    screenShake = Math.max(screenShake, 3);
});

socket.on("teamArena:ko", (data) => {
    const attacker = players[data.attackerId];
    const target = players[data.targetId];
    const x = target?.x || attacker?.x || (canvas.width / 2);
    const y = target?.y || attacker?.y || (canvas.height / 2);
    spawnFloatingText("KO", x, y - 70, "#fecaca");
    createExplosion(x, y, "#fecaca", { count: 24, speed: 10, shake: 10 });
    triggerOverlayFlash("255, 180, 180", 0.1);
    playSound("heavyExplosion");
    screenShake = Math.max(screenShake, 18);
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

function getPaidGiftFxProfile(giftValue, diamondsTotal) {
    const totalValue = Math.max(giftValue || 0, diamondsTotal || 0);
    if (totalValue >= 20000) {
        return {
            cameraScale: 1.72,
            cameraFrames: 185,
            flashAlpha: 0.28,
            shake: 34,
            shockwaveRadius: 52,
            burstCount: 40,
            burstSpeed: 14
        };
    }
    if (totalValue >= 1000) {
        return {
            cameraScale: 1.54,
            cameraFrames: 145,
            flashAlpha: 0.22,
            shake: 24,
            shockwaveRadius: 38,
            burstCount: 34,
            burstSpeed: 12
        };
    }
    if (totalValue >= 100) {
        return {
            cameraScale: 1.4,
            cameraFrames: 110,
            flashAlpha: 0.16,
            shake: 16,
            shockwaveRadius: 28,
            burstCount: 28,
            burstSpeed: 10
        };
    }
    return {
        cameraScale: 1.28,
        cameraFrames: 76,
        flashAlpha: 0.12,
        shake: 10,
        shockwaveRadius: 20,
        burstCount: 22,
        burstSpeed: 8
    };
}

// EVENTO DE ATAQUE (REGALOS)
socket.on("teamArena:gift", (data) => {
    const attackerId = data.attacker?.id;
    const attacker = syncPlayerFromServer(data.attackerState) || players[attackerId];
    if (!attacker) return;

    attacker.lastActive = Date.now(); // Despierta de AFK inmediatamente
    attacker.engagement = Math.min((attacker.engagement || 0) + Math.max(4, Math.log2((data.diamondCount || 1) * (data.repeatCount || 1) + 1) * 5), 120);
    const count = data.repeatCount || 1;
    const giftValue = data.diamondCount || 1;
    const diamondsTotal = giftValue * count;
    const fxProfile = getPaidGiftFxProfile(giftValue, diamondsTotal);
    const sizeDominance = getSizeDominance(attacker);

    // Feedback visual inmediato para TODOS los regalos
    spawnFloatingText(`${data.giftName} x${count}`, attacker.x, attacker.y, "#fdcb6e");
    if ((data.scoreGain || 0) > 0) {
        spawnFloatingText(`+${Math.floor(data.scoreGain)} PTS`, attacker.x, attacker.y - 28, "#fff3b0");
    }
    createExplosion(attacker.x, attacker.y, "#ffd166", {
        count: fxProfile.burstCount,
        speed: fxProfile.burstSpeed,
        shake: fxProfile.shake * 0.45
    });
    triggerOverlayFlash("255, 210, 120", fxProfile.flashAlpha * 0.7);
    pushShockwave({
        x: attacker.x,
        y: attacker.y,
        r: fxProfile.shockwaveRadius,
        opacity: 0.85,
        color: "#ffe29a"
    });

    // Zoom automático si es un regalo grande
    if (giftValue >= 1) {
        focusCamera(attacker.x, attacker.y, fxProfile.cameraScale, fxProfile.cameraFrames);

        if (giftValue >= 500) {
            focusCamera(attacker.x, attacker.y, Math.max(fxProfile.cameraScale, 1.48), Math.max(fxProfile.cameraFrames, 125));
            showAnnouncer("MOMENTO LEGENDARIO!!! 🔥", "#ffd700");
            announce("Regalo legendario. Poder gigantesco. Impacto descomunal en la arena.");
        } else {
            showAnnouncer("GRAN REGALO! ✨", "#00d2ff");
            announce("Gran regalo. Poder enorme. Ataque muy fuerte sobre la arena.");
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
    screenShake = Math.max(screenShake, Math.max(fxProfile.shake, Math.min(34, 10 + Math.log2(diamondsTotal + 1) * 3.2)));

    const giftEffect = resolveArenaGiftEffect(data, attacker, target, diamondsTotal, giftValue, data.giftName || "");
    let atkType = "projectile";
    let color = giftEffect.color;

    // Detección de tipos de ataque: cubrir todos los effectKey emitidos por el servidor.
    if (giftEffect.type === "megaBlast") {
        playSound("heavyExplosion");
        screenShake = isSuddenDeath ? 42 : 34;
        hitStopFrames = 18;
        triggerOverlayFlash("255, 240, 200", 0.24);
        spawnFloatingText("UNIVERSO", target.x, target.y, "#ffd166");
        announce("Universo activado. Megablast total. Poder premium impresionante en toda la arena.");
        createExplosion(target.x, target.y, "#fff", { count: 44, speed: 14, shake: 14 });
        createExplosion(target.x + 40, target.y - 30, "#fbbf24", { count: 28, speed: 11, shake: 10 });
        createExplosion(target.x - 50, target.y + 20, "#ff8c42", { count: 28, speed: 11, shake: 10 });
        createExplosion(target.x, target.y, "#ffd166", { count: 36, speed: 9, shake: 12 });
        pushShockwave({ x: target.x, y: target.y, r: 16, opacity: 1, color: "#fff7d6" });
        pushShockwave({ x: target.x, y: target.y, r: 28, opacity: 0.78, color: "#ffd166" });
        target.takeDamage(diamondsTotal * 20, attacker.id);
        atkType = "none";
    } else if (giftEffect.type === "lightningStorm") {
        playSound("lightning");
        screenShake = isSuddenDeath ? 30 : 22;
        triggerOverlayFlash("90, 200, 255", 0.14);
        spawnFloatingText("GALAXIA", target.x, target.y, "#7dd3fc");
        announce("Galaxia activada. Rayos premium enormes. La ronda puede cambiar por completo.");
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                pushLightningBolt({
                    sx: attacker.x, sy: attacker.y,
                    tx: target.x + (Math.random() - 0.5) * 100,
                    ty: target.y + (Math.random() - 0.5) * 100,
                    life: 1.0 + (sizeDominance * 0.85), color: "#0abde3"
                });
                createExplosion(target.x + (Math.random() - 0.5) * 24, target.y + (Math.random() - 0.5) * 24, "#7dd3fc", { count: 12, speed: 6, shake: 3 });
                target.takeDamage(diamondsTotal * 5, attacker.id);
            }, i * 150);
        }
        atkType = "none";
    } else if (giftEffect.type === "buzzsaw" || giftValue >= 500) {
        // Power-up de Sierra (Aura)
        playSound("buzzsaw");
        attacker.sawLife = Math.max(attacker.sawLife, 1080); // 18s de aura
        spawnFloatingText("SIERRA ACTIVA", attacker.x, attacker.y - 40, "#ff9f43");
        createExplosion(attacker.x, attacker.y, "#ff9f43", { count: 22, speed: 8, shake: 5 });
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
        createExplosion(target.x, target.y, "#ff8a00", { count: 30, speed: 11, shake: 10 });
        triggerOverlayFlash("255, 120, 40", 0.16);
        screenShake = Math.max(screenShake, Math.max(screenShake, isSuddenDeath ? 30 : 24));
        atkType = "lightning";
    } else if (giftEffect.type === "shockwave") {
        playSound("heavyExplosion");
        hitStopFrames = Math.max(hitStopFrames, 10);
        focusCamera(target.x, target.y, Math.max(fxProfile.cameraScale, 1.38), Math.max(fxProfile.cameraFrames, 95));
        createExplosion(target.x, target.y, color, { count: 34, speed: 12, shake: 14 });
        createExplosion(target.x + 28, target.y - 18, "#fff3b0", { count: 18, speed: 8, shake: 8 });
        createExplosion(target.x - 28, target.y + 18, "#f59e0b", { count: 18, speed: 8, shake: 8 });
        pushShockwave({ x: target.x, y: target.y, r: 30, opacity: 0.95, color });
        pushShockwave({ x: target.x, y: target.y, r: 52, opacity: 0.7, color: "#fff3b0" });
        triggerOverlayFlash("255, 214, 120", 0.18);
        screenShake = Math.max(screenShake, isSuddenDeath ? 36 : 28);
        atkType = "lightning";
    } else if (data.sfx) {
        playSound(data.sfx);
    }

    // Shockwave al atacar
    if (diamondsTotal > 10) {
        pushShockwave({ x: attacker.x, y: attacker.y, r: fxProfile.shockwaveRadius, opacity: 0.8, color: color });
    }

    // Ejecución de Proyectiles/Efectos persistentes
    if (atkType === "projectile") {
        const pCount = Math.min(Math.max(count, giftValue >= 100 ? 3 : 1), giftValue >= 1000 ? 14 : 10);
        for (let i = 0; i < pCount; i++) {
            setTimeout(() => {
                if (attacker && target && target.hp > 0) {
                    playSound("shoot");
                    spawnProjectileBurst(attacker, target, 1, damage / pCount, color, { wobble: giftValue >= 100 ? 8 : 4, life: giftValue >= 100 ? 120 : 100 });
                }
            }, i * 80);
        }
    } else if (atkType === "lightning") {
        playSound("lightning");
        pushLightningBolt({
            sx: attacker.x,
            sy: attacker.y,
            tx: target.x,
            ty: target.y,
            life: 1.0 + (sizeDominance * 0.75),
            color
        });
        target.takeDamage(damage, attacker.id);
        createExplosion(target.x, target.y, color, { count: 24, speed: 9, shake: 7 });
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
    renderLastRoundWinner();
    if (leaderboardEl) {
        leaderboardEl.innerHTML = "";
    }
}

socket.on("teamArena:currentRanking", (data) => {
    roundRanking = data; // Ranking de la ronda actual
    lastRoundRankingAt = Date.now();
    updateRankingDOM(true); // Forzar actualización cuando cambian los líderes

    const visibleCompetitors = roundRanking.filter((player) => player?.state !== "REMOVED" && player?.state !== "IDLE").length;
    if (visibleCompetitors <= 1) {
        promptReturnToArena();
    }

    const now = Date.now();
    if (visibleCompetitors >= 2 && lastVisibleCompetitorCount <= 1 && now - lastReentryCueAt > 20000) {
        lastReentryCueAt = now;
        showAnnouncer("LA ARENA VOLVIO A ENCENDERSE", "#86efac");
        spawnFloatingText("VUELVE LA PELEA", canvas.width / 2, canvas.height / 2 - 170, "#86efac");
        playSound("heal", 0.92);
        screenShake = Math.max(screenShake, 3);
    }
    lastVisibleCompetitorCount = visibleCompetitors;

    const roundLeader = roundRanking[0] || null;
    const roundRunnerUp = roundRanking[1] || null;
    const leaderStanding = Math.floor(roundLeader?.standingScore || roundLeader?.score || 0);
    const runnerStanding = Math.floor(roundRunnerUp?.standingScore || roundRunnerUp?.score || 0);
    const standingGap = Math.max(0, leaderStanding - runnerStanding);

    if (
        roundLeader?.id &&
        roundLeader.id !== lastRoundLeaderId &&
        now - lastRoundLeaderCueAt > 7000
    ) {
        lastRoundLeaderId = roundLeader.id;
        lastRoundLeaderCueAt = now;
        showAnnouncer(`NUMERO UNO DE RONDA: ${roundLeader.name}`, "#fef08a");
        spawnFloatingText(`NUMERO 1 DE RONDA`, canvas.width / 2, 190, "#fef08a");
        playSound("jackpot", 0.62);
        triggerOverlayFlash("255, 235, 140", 0.07);
        screenShake = Math.max(screenShake, 4);
    }

    if (
        roundLeader &&
        roundRunnerUp &&
        standingGap <= 90 &&
        now - lastClutchCueAt > 18000
    ) {
        lastClutchCueAt = now;
        showAnnouncer("PELEA CERRADA POR LA RONDA", "#7dd3fc");
        spawnFloatingText(`${roundLeader.name} VS ${roundRunnerUp.name}`, canvas.width / 2, 226, "#e0f2fe");
        playSound("hit", 1.05);
        triggerOverlayFlash("120, 210, 255", 0.05);
        screenShake = Math.max(screenShake, 2.4);
    }

    if (
        roundLeader &&
        roundRunnerUp &&
        now - lastTopDuelVoiceAt > 24000
    ) {
        const duelThreshold = currentRoundSeconds <= 45 ? 150 : 110;
        if (standingGap <= duelThreshold) {
            lastTopDuelVoiceAt = now;
            announce(`Duelo por la ronda. ${roundLeader.name} contra ${roundRunnerUp.name}.`, { gapMs: 650 });
        }
    }

    if (
        roundLeader &&
        roundRunnerUp &&
        currentRoundSeconds <= 45 &&
        standingGap <= 130 &&
        now - lastFinalStretchCueAt > 16000
    ) {
        lastFinalStretchCueAt = now;
        showAnnouncer("ULTIMOS SEGUNDOS TODO PUEDE CAMBIAR", "#fda4af");
        spawnFloatingText("ULTIMO EMPUJE", canvas.width / 2, canvas.height / 2 - 200, "#fda4af");
        playSound("tick");
        triggerOverlayFlash("255, 160, 160", 0.06);
        screenShake = Math.max(screenShake, 3.2);
    }

    const roundLeaderForVoice = roundRanking[0];
    if (roundLeaderForVoice?.name) {
        const shouldHypeRoundWinner =
            roundLeaderForVoice.id !== lastRoundWinnerHypeId ||
            now - lastRoundWinnerHypeAt > 21000;

        if (shouldHypeRoundWinner) {
            lastRoundWinnerHypeId = roundLeaderForVoice.id;
            lastRoundWinnerHypeAt = now;
            announce(`Ganador parcial de la ronda. ${roundLeaderForVoice.name}.`, { gapMs: 650 });
            screenShake = Math.max(screenShake, 5);
        }
    }

    const leader = currentTopArenaLeader;
    if (leader && leader.name) {
        const shouldHypeLeader =
            leader.id !== lastLeaderHypeId ||
            now - lastTopArenaHypeAt > 82000;

        if (shouldHypeLeader) {
            lastLeaderHypeId = leader.id;
            lastTopArenaHypeAt = now;
            announce(`Numero uno del arena. ${leader.name}.`, { gapMs: 650 });
            screenShake = Math.max(screenShake, 4);
        }
    }
});

window.setInterval(() => {
    if (!soundEnabled) return;
    if (Date.now() - lastRoundRankingAt > 8000) return;
    const activeRoundRanking = roundRanking.filter((player) => player?.state !== "REMOVED" && player?.state !== "IDLE");
    const liveRoundLeader = activeRoundRanking[0];
    const liveRoundRunnerUp = activeRoundRanking[1];
    if (liveRoundLeader?.name) {
        announce(`Lidera la ronda en este momento. ${liveRoundLeader.name}.`, { gapMs: 650 });
    }
    if (liveRoundLeader?.name && liveRoundRunnerUp?.name) {
        const gap = Math.max(
            0,
            Math.floor((liveRoundLeader.standingScore || liveRoundLeader.score || 0) - (liveRoundRunnerUp.standingScore || liveRoundRunnerUp.score || 0))
        );
        if (gap <= 140) {
            announce(`Pelea intensa arriba. ${liveRoundLeader.name} y ${liveRoundRunnerUp.name} van muy cerca.`, { gapMs: 650 });
        }
    }
    if (lastCompletedRoundWinner?.name) {
        announce(`Ultimo ganador de ronda. ${lastCompletedRoundWinner.name}.`, { gapMs: 650 });
    }
    if (currentTopArenaLeader?.name) {
        announce(`Numero uno del arena. ${currentTopArenaLeader.name}. Lleva ${Math.floor(currentTopArenaLeader.victories || 0)} rondas ganadas.`, { gapMs: 650 });
    }
    announceGiftTip();
    announcePromoTip();
}, 52000);

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
                    screenShake = Math.max(screenShake, 6);
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
        socket.emit("teamArena:batchUpdate", positionBatch);
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
        socket.emit("teamArena:debug:gift", { giftName: "Bot Spawn", diamondCount: 1, uniqueId: "bot_" + Math.floor(Math.random() * 1000) });
        spawnFloatingText("BOT", canvas.width / 2, canvas.height / 2, "#fff");
    });

    document.getElementById("debug-gift-rose")?.addEventListener("click", () => {
        socket.emit("teamArena:debug:gift", { giftName: "Rosa", diamondCount: 1 });
        spawnFloatingText("ROSE", canvas.width / 2, canvas.height / 2, "#ff4757");
    });

    document.getElementById("debug-gift-galaxy")?.addEventListener("click", () => {
        socket.emit("teamArena:debug:gift", { giftName: "Galaxia", diamondCount: 1000 });
    });

    document.getElementById("debug-gift-universe")?.addEventListener("click", () => {
        socket.emit("teamArena:debug:gift", { giftName: "Universo", diamondCount: 35000 });
    });

    document.getElementById("debug-toggle-sd")?.addEventListener("click", () => {
        socket.emit("teamArena:debug:toggleSD");
    });
}

// Auto-despertar AudioContext si es necesario
document.addEventListener("mousedown", () => {
    if (audioCtx?.state === 'suspended') audioCtx.resume();
});
