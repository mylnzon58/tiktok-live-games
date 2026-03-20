const socket = io();

// Elementos DOM
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
const leaderboardEl = document.getElementById("arena-leaderboard");
const floatingLayer = document.getElementById("floating-ui-layer");

const DEBUG_MODE = new window.URLSearchParams(window.location.search).get("debug") === "1";

// Ajustar Canvas a dimensiones 800x1350 para TikTok Live
canvas.width = 800;
canvas.height = 1350;
window.addEventListener("resize", () => {
    // Mantener dimensiones fijas solicitadas para evitar que se rompa el layout de widgets
    camera.x = camera.targetX = canvas.width / 2;
    camera.y = camera.targetY = canvas.height / 2;
});

// CONFIGURACIÓN DE CÁMARA DINÁMICA (centro desde el inicio para que las bolas se vean)
let camera = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    scale: 1,
    targetX: canvas.width / 2,
    targetY: canvas.height / 2,
    targetScale: 1,
    zoomTimer: 0
};

function getArenaBounds() {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    // Ahora rectangular: Ocupa casi todo el ancho y alto libre
    const width = 740; // Deja margen lateral
    const height = 1100; // Deja espacio para el header y footer widgets
    return {
        cx, cy,
        width, height,
        left: cx - width / 2,
        right: cx + width / 2,
        top: cy - height / 2 + 60, // Bajamos un poco por el header nuevo
        bottom: cy + height / 2
    };
}

function clampToArena(x, y, margin = 20) {
    const b = getArenaBounds();
    return {
        x: Math.max(b.left + margin, Math.min(b.right - margin, x)),
        y: Math.max(b.top + margin, Math.min(b.bottom - margin, y))
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
let currentRoundSeconds = 3 * 60;
let lastRoundLeaderId = null;
let lastRoundLeaderCueAt = 0;
let playerStreaks = {}; // Phase 4: Kill Streaks Dopamine
let lastStreakAnnouncementAt = 0;
let lastClutchCueAt = 0;
let lastFinalStretchCueAt = 0;
let lastReentryCueAt = 0;
let lastVisibleCompetitorCount = 0;
let lastCompletedRoundWinner = null;
let lastRoundWinnerHypeAt = 0;

// Captura de errores para visualizar en pantalla (Debug)
window.onerror = function(msg, url, line) {
    if (floatingLayer) {
        const errDiv = document.createElement("div");
        errDiv.style.color = "red";
        errDiv.style.fontSize = "20px";
        errDiv.style.position = "absolute";
        errDiv.style.top = "50px";
        errDiv.style.left = "50px";
        errDiv.textContent = `JS ERR: ${msg} (L:${line})`;
        floatingLayer.appendChild(errDiv);
        setTimeout(() => errDiv.remove(), 5000);
    }
};
let lastRoundWinnerHypeId = null;
let lastTopDuelVoiceAt = 0;
let lastRoundRankingAt = 0;
let lastCountdownSpoken = null;
let lastAnnouncementText = "";
let lastAnnouncementQueuedAt = 0;
let introHookPlayed = false;
let globalGlitchIntensity = 0; // Neuromarketing: Distorsión auditiva/visual global
let globalFlashCount = 0;

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
    const spanishVoices = voices.filter((voice) => /es/i.test(voice.lang || ""));
    if (!spanishVoices.length) return null;

    const ranked = spanishVoices
        .map((voice) => {
            const name = String(voice.name || "").toLowerCase();
            let score = 0;
            if (voice.localService) score += 20;
            // Nombres comunes de voces femeninas en Windows/Google/Apple
            const isFemale = /female|mujer|woman|helena|laura|sabina|monica|paulina|lucia|elvira|sofia|zira|aria|jenny|elena|marisol/i.test(name);
            if (isFemale) score += 50; 
            if (/microsoft|google|natural|neural|premium|enhanced|online/i.test(name)) score += 20;
            if (/es-es|es_es/i.test(voice.lang || "")) score += 10;
            return { voice, score, isFemale };
        })
        .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    return best ? { voice: best.voice, isFemale: best.isFemale } : null;
}

function flushSpeechQueue() {
    if (!soundEnabled || !speechQueue.length || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        speechTimer = null;
        return;
    }
    if (window.speechSynthesis.speaking) {
        speechTimer = window.setTimeout(flushSpeechQueue, 150);
        return;
    }

    const next = speechQueue.shift();
    if (!next) return;

    const resolvedText = typeof next.getText === "function" ? next.getText() : next.text;
    if (!resolvedText) {
        lastSpeechAt = Date.now();
        speechTimer = window.setTimeout(flushSpeechQueue, next.gapMs ?? 250);
        return;
    }
    const voiceInfo = preferredVoices[next.lang] || resolvePreferredVoice();
    preferredVoices[next.lang] = voiceInfo;

    const msg = new window.SpeechSynthesisUtterance(resolvedText);
    msg.lang = "es-ES";
    if (voiceInfo?.voice) msg.voice = voiceInfo.voice;
    
    // Si no detectamos que es mujer, forzamos un pitch muy alto para "juvenilizar" la voz
    const isFemale = voiceInfo?.isFemale;
    msg.rate = next.rate ?? (isFemale ? 1.18 : 1.25); 
    msg.pitch = next.pitch ?? (isFemale ? 1.45 : 1.8); // Pitch agresivo si es hombre para que parezca joven/femenina
    msg.volume = next.volume ?? 1;
    msg.onend = () => {
        lastSpeechAt = Date.now();
        speechTimer = window.setTimeout(flushSpeechQueue, next.gapMs ?? 300);
    };
    msg.onerror = () => {
        lastSpeechAt = Date.now();
        speechTimer = window.setTimeout(flushSpeechQueue, 400);
    };
    window.speechSynthesis.speak(msg);
}

function queueAnnouncement(text, options = {}) {
    if (!soundEnabled || !text) return;
    try {
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
        const now = Date.now();
        const minIntervalMs = options.minIntervalMs ?? 1800;
        const dedupeBase = options.dedupeKey || (typeof text === "string" ? text : options.queueKey || "");
        const normalizedText = String(dedupeBase || "").trim().toLowerCase();
        if (!options.force && normalizedText && normalizedText === lastAnnouncementText && (now - lastAnnouncementQueuedAt) < 12000) {
            return;
        }
        if (!options.force && now - lastSpeechAt < minIntervalMs && speechQueue.length > 2) return;
        if (options.queueKey) {
            speechQueue = speechQueue.filter((entry) => entry.queueKey !== options.queueKey);
        }
        lastAnnouncementText = normalizedText;
        lastAnnouncementQueuedAt = now;
        speechQueue.push({
            text,
            getText: options.getText,
            lang: "es",
            rate: options.rate,
            pitch: options.pitch,
            volume: options.volume,
            gapMs: options.gapMs,
            queueKey: options.queueKey || null
        });
        if (!speechTimer) {
            flushSpeechQueue();
        }
    } catch (error) {
        console.error("Speech queue error:", error);
    }
}

function speakImmediate(text, options = {}) {
    if (!soundEnabled || !text || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    const voice = preferredVoices.es || resolvePreferredVoice();
    preferredVoices.es = voice;
    speechQueue = [];
    speechTimer = null;
    try {
        window.speechSynthesis.cancel();
    } catch (error) {
        console.error("Speech cancel error:", error);
    }
    const msg = new window.SpeechSynthesisUtterance(text);
    msg.lang = "es-ES";
    if (voice) msg.voice = voice;
    msg.rate = options.rate ?? 0.86;
    msg.pitch = options.pitch ?? 0.84;
    msg.volume = options.volume ?? 0.9;
    msg.onend = () => {
        lastSpeechAt = Date.now();
    };
    msg.onerror = () => {
        lastSpeechAt = Date.now();
    };
    window.speechSynthesis.speak(msg);
}

function announceEs(text, options = {}) {
    queueAnnouncement(text, { lang: "es", rate: 0.88, pitch: 0.86, volume: 0.84, gapMs: 1200, ...options });
}

function announce(spanishText, options = {}) {
    announceEs(spanishText, options);
}

function announceCurrentRoundLeader() {
    const liveLeader = roundRanking[0];
    if (!liveLeader?.id) return;
    announce("Lider de ronda", {
        gapMs: 650,
        queueKey: "round-leader-live",
        dedupeKey: `round-leader-${liveLeader.id}`,
        getText: () => {
            const currentLeader = roundRanking[0];
            if (!currentLeader?.id) return "";
            return `¡Atención! ${currentLeader.name} domina con ${Math.floor(currentLeader.score || 0)} puntos. ¡Sigan al líder ahora!`;
        }
    });
}

function playArenaIntroAnnouncement(force = false) {
    if (introAnnouncementDone && !force) return;
    introAnnouncementDone = true;
    announce("Arena activa. Aqui iremos diciendo quien va liderando la ronda.", { gapMs: 1200, force });
    announce("Si ya tienes favorito, apoyalo y siguelo mientras aguanta arriba.", { gapMs: 1400, force });
}

function playOpeningHook(force = false) {
    if (introHookPlayed && !force) return;
    introHookPlayed = true;
    showAnnouncer("SUBE AL TOP Y QUEDATE CON LA VOZ", "#ffcf84");
    spawnFloatingText("SUBE AL TOP", canvas.width / 2, canvas.height / 2 - 160, "#ffcf84");
    triggerOverlayFlash("255, 230, 120", 0.08);
    screenShake = Math.max(screenShake, 5);
    playSound("jackpot");
    window.setTimeout(() => {
        showAnnouncer("EL NUMERO UNO MANDA LA ARENA", "#62e6ff");
        spawnFloatingText("DEFIENDE EL TRONO", canvas.width / 2, canvas.height / 2 - 110, "#62e6ff");
        playSound("powerUp");
    }, 1100);
}

function promptReturnToArena(force = false) {
    const now = Date.now();
    if (!force && now - lastReturnPromptAt < 70000) return;
    lastReturnPromptAt = now;
    spawnFloatingText("TAP TAP O CHATEA PARA VOLVER", canvas.width / 2, canvas.height / 2 - 140, "#ffcf84");
    announce("Tap tap o escribe en el chat para volver al arena.", { gapMs: 1400, force });
    screenShake = Math.max(screenShake, 4);
}

function announceGiftTip() {
    const now = Date.now();
    if (now - lastGiftTipAt < 90000) return;
    lastGiftTipAt = now;
    const tips = [
        "La rosa ayuda a empujar la ronda poco a poco.",
        "La dona y galaxia pueden cambiar una pelea cerrada.",
        "Likes y regalos bien metidos levantan una ronda muy rapido."
    ];
    announce(tips[Math.floor(Math.random() * tips.length)], { gapMs: 1500 });
}

function announcePromoTip() {
    const now = Date.now();
    if (now - lastPromoTipAt < 180000) return;
    lastPromoTipAt = now;
    const promos = [
        "Si ya tienes claro tu favorito, sigan al numero uno del arena y sostengan esa ventaja.",
        "El lider del arena puede cambiar rapido. Si vas con el puntero, siguelo y mantenlo arriba.",
        "Cada ronda define al puntero. Si tu favorito va ganando, siguelo y sigan apoyando."
    ];
    announce(promos[Math.floor(Math.random() * promos.length)], { gapMs: 1600 });
}

function speakLeaderChat(name, comment) {
    const cleanName = String(name || "Ganador del arena").trim().slice(0, 32);
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
window.setTimeout(() => playOpeningHook(), 1250);
window.addEventListener("pointerdown", () => {
    if (!introAnnouncementDone || !window.speechSynthesis?.speaking) {
        playArenaIntroAnnouncement(true);
    }
    playOpeningHook(true);
}, { once: true });

function speakCountdownNumber(seconds) {
    const spanishWords = {
        10: "diez",
        9: "nueve",
        8: "ocho",
        7: "siete",
        6: "seis",
        5: "cinco",
        4: "cuatro",
        3: "tres",
        2: "dos",
        1: "uno"
    };
    const spoken = spanishWords[seconds];
    if (!spoken || lastCountdownSpoken === seconds) return;
    lastCountdownSpoken = seconds;
    speakImmediate(spoken, { rate: 0.94, pitch: 0.92, volume: 1 });
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
            gain.gain.setValueAtTime(0.18, now + index * 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.03 + 0.12);
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
        gain.gain.setValueAtTime(0.14, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
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
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
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
        gain.gain.setValueAtTime(0.9, audioCtx.currentTime); // ¡DOPAMINA EXTREMA!
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
    galaxyBlast: () => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        [420, 620, 860, 1180].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = i % 2 === 0 ? "triangle" : "sawtooth";
            osc.frequency.setValueAtTime(freq, now + i * 0.035);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + i * 0.035 + 0.18);
            gain.gain.setValueAtTime(0.09, now + i * 0.035);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.035 + 0.2);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(now + i * 0.035);
            osc.stop(now + i * 0.035 + 0.22);
        });
    },
    lionRoar: () => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const noise = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sawtooth";
        noise.type = "square";
        osc.frequency.setValueAtTime(96, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.42);
        noise.frequency.setValueAtTime(180, now);
        noise.frequency.exponentialRampToValueAtTime(68, now + 0.28);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.connect(gain).connect(audioCtx.destination);
        noise.connect(gain).connect(audioCtx.destination);
        osc.start(now);
        noise.start(now);
        osc.stop(now + 0.45);
        noise.stop(now + 0.3);
    },
    universeCrash: () => {
        if (!soundEnabled) return;
        const now = audioCtx.currentTime;
        [54, 72, 96].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(freq, now + i * 0.04);
            osc.frequency.exponentialRampToValueAtTime(20, now + i * 0.04 + 0.55);
            gain.gain.setValueAtTime(0.26 - (i * 0.05), now + i * 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.58);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(now + i * 0.04);
            osc.stop(now + i * 0.04 + 0.6);
        });
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

// Escalas estilo 8-bit Dopamina / Boss Battle - MÁS ADICTIVA Y HEROICA
// Nueva escala Phrygian Dominant (A#, A, G, F# feel) - Tensa y Cyberpunk
const arp1 = [466.16, 440.00, 392.00, 369.99, 392.00, 440.00]; 
const arp2 = [349.23, 311.13, 293.66, 261.63, 293.66, 311.13]; 
const arp3 = [233.08, 220.00, 196.00, 185.00, 196.00, 220.00]; 
const arp4 = [466.16, 554.37, 622.25, 698.46, 622.25, 554.37]; 

const sequence = [
    ...Array(16).fill(0).map((_, i) => ({ arp: arp1[i % arp1.length], bass: 116.54 })), // A#
    ...Array(16).fill(0).map((_, i) => ({ arp: arp2[i % arp2.length], bass: 87.31 })),  // F
    ...Array(16).fill(0).map((_, i) => ({ arp: arp3[i % arp3.length], bass: 58.27 })),  // A# octave down
    ...Array(16).fill(0).map((_, i) => ({ arp: arp4[i % arp4.length], bass: 138.59 }))  // C# heroic tension
];

function scheduleNote(step, time) {
    if (!soundEnabled) return;
    const { arp, bass } = sequence[step];
    const bgmEnergy = currentRoundSeconds <= 45 ? 1.18 : currentRoundSeconds <= 90 ? 1.06 : 0.96;
    const arpGain = currentRoundSeconds <= 45 ? 0.036 : currentRoundSeconds <= 90 ? 0.031 : 0.026;
    const bassGain = currentRoundSeconds <= 45 ? 0.065 : currentRoundSeconds <= 90 ? 0.056 : 0.046;

    // Synth Lead (Melodía Rápida Arpegiada)
    const oscArp = audioCtx.createOscillator();
    const gainArp = audioCtx.createGain();
    oscArp.type = 'square';
    oscArp.frequency.value = arp * (1.8 + (bgmEnergy * 0.18));

    // Decaimiento corto para dar efecto de 8-bits percusivo
    gainArp.gain.setValueAtTime(arpGain, time);
    gainArp.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

    oscArp.connect(gainArp); gainArp.connect(audioCtx.destination);
    oscArp.start(time); oscArp.stop(time + 0.1);

    // Bajo 8-Bits (A tiempo de Octavos - Ritmo constante)
    if (step % 2 === 0) {
        const oscBass = audioCtx.createOscillator();
        const gainBass = audioCtx.createGain();
        oscBass.type = 'sawtooth';
        oscBass.frequency.value = (bass / 2) * bgmEnergy; // Bien grave

        gainBass.gain.setValueAtTime(bassGain, time);
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
        const secondsPerBeat = currentRoundSeconds <= 45 ? 0.094 : currentRoundSeconds <= 90 ? 0.102 : 0.116;
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
let positionBatch = {}; // Lote de posiciones para enviar al servidor

let lastHealSoundTime = 0;
const shockwaves = []; // Para efectos visuales de impactos grandes

let screenShake = 0; // Intensidad de vibración de pantalla
let hitStopFrames = 0; // Para el efecto visual congelado en grandes impactos
let overlayFlashAlpha = 0;
let overlayFlashColor = "255, 255, 255";
let arenaBorderPulse = { color: "0, 240, 255", alpha: 0, width: 0 };
let backgroundGrade = { color: "255, 255, 255", alpha: 0 };
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
// CONFIGURACIONES FÍSICAS (arena rectangular: burbujas más grandes para verse bien)
// ==========================================
const MAX_HP = 1000; 
let PLAYER_RADIUS = 72;

/** Formatea puntuación para que se lea bien en la burbuja (ej: 3689633 → "3.7M") */
function formatScoreShort(score) {
    const s = Math.floor(Number(score) || 0);
    if (s >= 1e6) return (s / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (s >= 1e3) return (s / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return String(s);
} 
const BASE_SPEED = 2.8; 
const NUM_STARS = 100;
const PASSIVE_SAW_SMALL_SCORE = 400;
const PASSIVE_SAW_CONTINUOUS_SCORE = 550;
const PASSIVE_SAW_MEDIUM_SCORE = 700;
const PASSIVE_SAW_LARGE_SCORE = 1000;

// Caché de imágenes pre-cargadas (Avatares)
const avatarCache = {};
const kingZoneImageUrl = "/zona-rey.webp";
const kingZoneImage = new Image();
kingZoneImage.src = kingZoneImageUrl;

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

    if (isSuddenDeath) {
        // Tinte de advertencia suave en Sudden Death
        ctx.fillStyle = "rgba(180, 40, 20, 0.15)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (backgroundGrade.alpha > 0.01) {
        ctx.fillStyle = `rgba(${backgroundGrade.color}, ${backgroundGrade.alpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        backgroundGrade.alpha *= 0.92;
    } else {
        backgroundGrade.alpha = 0;
    }

    ctx.fillStyle = "rgba(255, 228, 205, 0.38)";
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

    // --- ARENA RECTANGULAR Y MARCO NEÓN ---
    const arenaB = getArenaBounds();
    const rotation = Date.now() / 1200;

    // Dibujar el Rectángulo
    ctx.lineWidth = 14;
    ctx.lineJoin = "round";
    
    // Gradiente dinámico para el marco
    const gradient = ctx.createLinearGradient(arenaB.left, arenaB.top, arenaB.right, arenaB.bottom);
    gradient.addColorStop(0, "rgba(255, 46, 126, 0.6)");
    gradient.addColorStop(0.5, "rgba(102, 231, 255, 0.6)");
    gradient.addColorStop(1, "rgba(255, 46, 126, 0.6)");
    
    ctx.strokeStyle = gradient;
    ctx.strokeRect(arenaB.left, arenaB.top, arenaB.width, arenaB.height);

    // Efecto de "Ruido Eléctrico" en el marco rectangular
    for (let i = 0; i < 15; i++) {
        const side = Math.floor(Math.random() * 4);
        let sx, sy;
        if (side === 0) { sx = arenaB.left + Math.random() * arenaB.width; sy = arenaB.top; }
        else if (side === 1) { sx = arenaB.right; sy = arenaB.top + Math.random() * arenaB.height; }
        else if (side === 2) { sx = arenaB.left + Math.random() * arenaB.width; sy = arenaB.bottom; }
        else { sx = arenaB.left; sy = arenaB.top + Math.random() * arenaB.height; }
        
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fill();
    }

    // --- NÚCLEO: ZONA REY (proporciones claras, sin deformar) ---
    const coreRadius = 120;
    const kingZonePulse = 0.96 + ((Math.sin(Date.now() / 280) + 1) * 0.04);
    const cx = arenaB.cx, cy = arenaB.cy;

    ctx.fillStyle = "rgba(255, 136, 76, 0.12)";
    ctx.strokeStyle = "rgba(255, 187, 115, 0.5)";
    ctx.lineWidth = 2;
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(cx - coreRadius, cy - coreRadius, coreRadius * 2, coreRadius * 2, 16);
        ctx.fill();
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.rect(cx - coreRadius, cy - coreRadius, coreRadius * 2, coreRadius * 2);
        ctx.fill();
        ctx.stroke();
    }

    const kingImageRadius = coreRadius * 0.5 * kingZonePulse;
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
        ctx.fillStyle = "rgba(255, 175, 102, 0.24)";
        ctx.fillRect(cx - kingImageRadius, cy - kingImageRadius - 6, kingImageRadius * 2, kingImageRadius * 2);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy - 4, kingImageRadius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 226, 180, 0.9)";
    ctx.lineWidth = 3;
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(255, 137, 79, 0.5)";
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(255, 205, 140, 0.95)";
    ctx.font = "bold 18px Rajdhani";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("👑 ZONA REY", cx, cy + coreRadius - 20);
    // ------------------------

    // --- BORDE PULSANTE RECTANGULAR ---
    if (arenaBorderPulse.alpha > 0.01) {
        ctx.beginPath();
        ctx.rect(arenaB.left - 2, arenaB.top - 2, arenaB.width + 4, arenaB.height + 4);
        ctx.strokeStyle = `rgba(${arenaBorderPulse.color}, ${arenaBorderPulse.alpha})`;
        ctx.shadowBlur = 26;
        ctx.shadowColor = `rgba(${arenaBorderPulse.color}, 0.95)`;
        ctx.lineWidth = arenaBorderPulse.width;
        ctx.stroke();
        ctx.shadowBlur = 0;
        arenaBorderPulse.alpha *= 0.88;
        arenaBorderPulse.width *= 0.94;
    } else {
        arenaBorderPulse.alpha = 0;
        arenaBorderPulse.width = 0;
    }
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
    // Forzamos bypass de caché con un timestamp solo para la primera carga
    const sep = url.includes('?') ? '&' : '?';
    img.src = url + sep + "t=" + Date.now();
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
    // Usar porcentajes para alinear con el canvas en cualquier resolución
    el.style.left = (x / canvas.width * 100) + "%";
    el.style.top = (y / canvas.height * 100) + "%";
    floatingLayer.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

function triggerOverlayFlash(color, alpha = 0.18) {
    overlayFlashColor = color;
    overlayFlashAlpha = Math.max(overlayFlashAlpha, Math.min(alpha, 0.38));
}

function triggerArenaBorderPulse(color, alpha = 0.5, width = 10) {
    arenaBorderPulse = {
        color,
        alpha: Math.max(arenaBorderPulse.alpha || 0, Math.min(alpha, 0.92)),
        width: Math.max(arenaBorderPulse.width || 0, Math.min(width, 24))
    };
}

function triggerBackgroundGrade(color, alpha = 0.12) {
    backgroundGrade = {
        color,
        alpha: Math.max(backgroundGrade.alpha || 0, Math.min(alpha, 0.34))
    };
}

function createExplosion(x, y, color, options = {}) {
    const count = Math.min(options.count || 30, 72);
    const speed = Math.min(options.speed || 12, 20);
    const shake = Math.min(options.shake || 10, 42);
    const finalCount = isSuddenDeath ? Math.min(84, Math.round(count * 1.28)) : count;
    const finalSpeed = isSuddenDeath ? Math.min(22, speed + 2) : speed;
    const finalShake = isSuddenDeath ? Math.min(48, shake + 4) : shake;

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
    for (let i = 0; i < 26; i++) {
        const angle = (i / 26) * Math.PI * 2;
        pushParticle({
            x: x + Math.cos(angle) * radius * 0.25,
            y: y + Math.sin(angle) * radius * 0.25,
            vx: Math.cos(angle) * (3 + Math.random() * 6),
            vy: Math.sin(angle) * (3 + Math.random() * 6) - Math.random() * 2.5,
            life: 1.0,
            size: Math.random() * 7 + 4,
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
    constructor(data = {}) {
        this.id = String(data.i || data.id || "unknown_" + Math.random());
        this.name = String(data.n || data.name || "Guerrero");
        this.avatar = data.a || data.avatar || "";
        this.hp = Number(data.h ?? data.hp ?? 1000);
        this.score = Number(data.s ?? data.score ?? 0);
        this.standingScore = Number(data.ss ?? data.standingScore ?? this.score);
        this.deaths = Number(data.deaths || 0);
        this.lastActive = data.lastActive || Date.now();
        this.state = String(data.st || data.state || "ACTIVE");
        this.invulnerableUntil = Number(data.inv || data.invulnerableUntil || 0);
        this.victories = Number(data.v || data.victories || 0);

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

        const initialClamped = clampToArena(this.x, this.y, PLAYER_RADIUS + 6);
        this.x = initialClamped.x;
        this.y = initialClamped.y;

        // Propiedades dinámicas
        this.currentRadius = PLAYER_RADIUS * 0.94;
        this.opacity = 1.0;
        
        // Efecto de spawn épico para jugadores "competitivos" o que regresan
        if (this.score > 200 || (playerStreaks && playerStreaks[this.id] > 0)) {
            setTimeout(() => {
                createEpicSpawnEffect(this.x, this.y, this.name);
            }, 100 + Math.random() * 200);
        }

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
        this.peakRadius = PLAYER_RADIUS;
        this.scorePop = 0;

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
        this.peakRadius = Math.max(this.peakRadius || PLAYER_RADIUS, targetRadius);

        // Tras respawn reaparece pequeno y vuelve a escalar despues del blindaje inicial.
        if (Date.now() < (this.respawnSizeLockUntil || 0)) {
            targetRadius = Math.min(targetRadius, PLAYER_RADIUS + 8);
        }

        if (this.state === "ELIMINATED") {
            this.opacity = 0.32;
            this.currentRadius += ((PLAYER_RADIUS * 0.86) - this.currentRadius) * 0.08;
            this.vx *= 0.96;
            this.vy *= 0.96;
        } else if (this.state === "IDLE") {
            this.opacity = Math.max(this.opacity - 0.06, 0.06);
            const idleFloor = Math.max(PLAYER_RADIUS, targetRadius * 0.92, (this.peakRadius || PLAYER_RADIUS) * 0.78);
            this.currentRadius += (idleFloor - this.currentRadius) * 0.08;
            this.vx *= 0.995;
            this.vy *= 0.995;
        } else {
            const retainedRadius = Math.max(targetRadius, (this.peakRadius || PLAYER_RADIUS) * 0.84);
            const radiusStep = retainedRadius > this.currentRadius ? 0.18 : 0.055;
            this.currentRadius += (retainedRadius - this.currentRadius) * radiusStep;
            this.peakRadius += (targetRadius - this.peakRadius) * 0.035;
            this.peakRadius = Math.max(this.peakRadius, this.currentRadius, PLAYER_RADIUS);
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
                    this.vx += (Math.random() - 0.5) * 1.5;
                    this.vy += (Math.random() - 0.5) * 1.5;
                    other.vx += (Math.random() - 0.5) * 1.5;
                    other.vy += (Math.random() - 0.5) * 1.5;

                    const impactMag = Math.abs(velAlongNormal);
                    if (impactMag > 4 && Math.random() > 0.8) {
                        playSound("hit"); 
                    }
                }
            }
        }

        if (this.flash > 0) this.flash -= 0.05;
    }

    draw() {
        if (!ctx) return;
        const opacity = Math.max(0, Math.min(1, this.opacity || 0));
        if (opacity <= 0.01) return;
        if (isNaN(this.currentRadius) || this.currentRadius < 5) this.currentRadius = (typeof PLAYER_RADIUS !== "undefined" ? PLAYER_RADIUS : 72) || 50;
        const rawX = Number.isFinite(this.x) ? this.x : (canvas.width / 2);
        const rawY = Number.isFinite(this.y) ? this.y : (canvas.height / 2);
        
        // Sanity Check final
        this.x = rawX || 400;
        this.y = rawY || 600;

        ctx.save();
        ctx.globalAlpha = opacity;

        if (this.flash > 0) {
            // Brillo simplificado sin shadowBlur pesado para evitar lag
            ctx.globalAlpha = this.opacity * 0.8;
            ctx.fillStyle = "white";
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.currentRadius + 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = this.opacity;
        }

        // --- ⚙️ AURA DE SIERRA (Detrás del avatar) ---
        const passiveSawTier = this.getPassiveSawTier();
        if (this.sawLife > 0 || passiveSawTier > 0) {
            // ESCALADO DINÁMICO SEGÚN ACTIVIDAD (Engagement)
            const engagementFactor = Math.min(1, (this.engagement || 0) / 45); // Se llena al 45% de engagement max
            const activityBoost = 20 * engagementFactor;
            const tierRadiusBoost = (passiveSawTier >= 3 ? 38 : passiveSawTier >= 2 ? 26 : passiveSawTier >= 1 ? 14 : 0) * engagementFactor;
            
            const worldSawRadius = this.currentRadius + 8 + tierRadiusBoost;
            const worldTrailingAngle = this.sawAngle - (Math.PI / 2) * this.spinDirection;
            
            ctx.save();
            ctx.translate(this.x, this.y);

            if ((this.sawLife > 0 || passiveSawTier >= 2) && engagementFactor > 0.5 && Math.random() < 0.3) {
                ctx.beginPath();
                ctx.strokeStyle = "#00d2ff";
                ctx.lineWidth = 2;
                ctx.moveTo(0, 0);
                for (let i = 0; i < 3; i++) {
                    ctx.lineTo((Math.random() - 0.5) * 150, (Math.random() - 0.5) * 150);
                }
                ctx.stroke();
            }

            ctx.rotate(this.sawAngle);
            const sawRadius = worldSawRadius;
            const teethCount = Math.max(12, Math.min(48, 12 + Math.floor(activityBoost * 1.5) + (passiveSawTier * 4)));
            const toothDepth = 6 + (10 + activityBoost) * (0.5 + engagementFactor * 0.5);
            
            ctx.beginPath();
            for (let i = 0; i < teethCount * 2; i++) {
                const angle = (i / (teethCount * 2)) * Math.PI * 2;
                const r = (i % 2 === 0) ? sawRadius + toothDepth : sawRadius;
                ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            ctx.closePath();

            const grad = ctx.createRadialGradient(0, 0, sawRadius, 0, 0, sawRadius + toothDepth);
            grad.addColorStop(0, "#7f8fa6");
            grad.addColorStop(0.5, "#dcdde1");
            grad.addColorStop(1, "#353b48");

            ctx.lineWidth = 4; // Un poco más delgado
            ctx.strokeStyle = grad;
            ctx.stroke();
            ctx.fillStyle = "rgba(235, 239, 245, 0.35)";
            ctx.fill();
            ctx.restore();

            if (this.sawLife > 0 && Math.random() < 0.35) {
                createExplosion(
                    this.x + Math.cos(worldTrailingAngle) * worldSawRadius,
                    this.y + Math.sin(worldTrailingAngle) * worldSawRadius,
                    "#ff9f43", { count: 3, speed: 4, shake: 0 }
                );
            }
        }

        // --- DIBUJAR AVATAR (la burbuja se dibuja en el loop en coordenadas de pantalla) ---
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip(); 

        const img = getAvatarImage(this.avatar);
        
        // Fondo base para el avatar (por si es transparente o no carga rápido)
        ctx.fillStyle = "#333";
        ctx.fill();

        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, this.x - this.currentRadius, this.y - this.currentRadius, this.currentRadius * 2, this.currentRadius * 2);
        } else {
            // Inicial o icono genérico
            ctx.fillStyle = "white";
            ctx.font = `bold ${Math.max(12, this.currentRadius * 0.8)}px Rajdhani`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const initial = (this.name && this.name.length > 0) ? this.name[0].toUpperCase() : "?";
            ctx.fillText(initial, this.x, this.y);
        }
        ctx.restore();

        // --- PUNTOS / SCORE (legible: formato corto 3.7M / 12k) ---
        const scorePulse = 1 + (Math.sin(Date.now() / 150) * 0.05) + (this.scorePop || 0);
        if (this.scorePop > 0) this.scorePop *= 0.85;
        const scoreText = formatScoreShort(this.score ?? 0);
        const badgeFontSize = Math.min(26, Math.max(16, Math.floor(20 * scorePulse)));
        const badgeH = 24;
        const badgeW = Math.max(56, Math.min(90, scoreText.length * (badgeFontSize * 0.65)));
        const badgeY = this.y + this.currentRadius * 0.72;
        const badgeX = this.x - badgeW / 2;
        ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(badgeX, badgeY - badgeH / 2, badgeW, badgeH, 12);
        } else {
            ctx.rect(badgeX, badgeY - badgeH / 2, badgeW, badgeH);
        }
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 215, 0, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${badgeFontSize}px Rajdhani`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 2;
        ctx.fillText(scoreText, this.x, badgeY);
        ctx.shadowBlur = 0;

        // Calaveras de muertes
        if ((this.deaths || 0) > 0) {
            const skullX = this.x + (this.currentRadius * 0.56);
            const skullY = this.y - (this.currentRadius * 0.58);
            const skullRadius = Math.max(10, this.currentRadius * 0.19);
            ctx.beginPath();
            ctx.arc(skullX, skullY, skullRadius, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
            ctx.fill();
            ctx.fillStyle = "#fecaca";
            ctx.font = `bold ${Math.max(9, Math.floor(skullRadius * 0.62))}px Rajdhani`;
            ctx.fillText(`X${this.deaths}`, skullX, skullY);
        }

        // --- PRESTIGE AURAS ---
        let auraColor = null;
        if (this.score >= 5000) auraColor = "#e5e7eb"; 
        else if (this.score >= 1000) auraColor = "#fbbf24"; 
        else if (this.score >= 500) auraColor = "#94a3b8"; 
        else if (this.score >= 100) auraColor = "#d97706"; 

        if (auraColor) {
            const pulse = 0.65 + ((Math.sin(Date.now() / 180) + 1) * 0.35);
            ctx.shadowBlur = 32 + Math.sin(Date.now() / 200) * 12;
            ctx.shadowColor = auraColor;
            ctx.strokeStyle = auraColor;
            ctx.lineWidth = 4 + (pulse * 2.5);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.currentRadius + 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Borde de HP/Fila
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
        ctx.lineWidth = 4 * (this.currentRadius / PLAYER_RADIUS);
        if (this.flash > 0) {
            ctx.strokeStyle = "white";
        } else {
            const visiblePoints = Math.max(0, this.score || 0);
            if (visiblePoints >= 1000) ctx.strokeStyle = "#fde68a";
            else if (visiblePoints >= 300) ctx.strokeStyle = "#7dd3fc";
            else ctx.strokeStyle = "#86efac";
            
            ctx.shadowBlur = 10 + (this.engagement * 0.2);
            ctx.shadowColor = ctx.strokeStyle;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Nombre
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Rajdhani";
        ctx.textAlign = "center";
        
        // Racha de Victorias (Streak)
        const victories = Number(this.victories || (window.playerStreaks && window.playerStreaks[this.id]) || 0);
        let displayName = this.name || "Guerrero";
        if (victories > 1) {
            displayName = `🔥x${victories} ${displayName}`;
            ctx.fillStyle = "#ffecd2";
        }
        
        ctx.shadowBlur = 4;
        ctx.shadowColor = "black";
        ctx.fillText(displayName, this.x, this.y - this.currentRadius - 10);
        ctx.shadowBlur = 0;

        // Estados
        if (this.state === "ELIMINATED") {
            ctx.fillStyle = "#ff8c42";
            ctx.font = "bold 13px Rajdhani";
            ctx.fillText("RESPAWN...", this.x, this.y + this.currentRadius + 18);
        } else if (this.invulnerableUntil > Date.now()) {
            ctx.fillStyle = "#7dd3fc";
            ctx.font = "bold 13px Rajdhani";
            ctx.fillText("SHIELD", this.x, this.y + this.currentRadius + 18);
        }

        // Racha de Kills
        const streak = (window.playerStreaks && window.playerStreaks[this.id]) || 0;
        if (streak >= 3) {
            ctx.fillStyle = streak >= 5 ? "#ff4757" : "#ffa502";
            ctx.font = "bold 16px Rajdhani";
            ctx.fillText(`${streak} KILLS 🔥`, this.x, this.y + this.currentRadius + 38);
            
            if (frameCount % 4 === 0) {
                pushParticle({
                    x: this.x + (Math.random() - 0.5) * this.currentRadius,
                    y: this.y + (Math.random() - 0.5) * this.currentRadius,
                    vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
                    life: 0.6, color: streak >= 5 ? "#ff4757" : "#ffa502"
                });
            }
        }

        ctx.restore();
    }

    getPassiveSawTier() {
        if ((this.score || 0) >= PASSIVE_SAW_LARGE_SCORE) return 3;
        if ((this.score || 0) >= PASSIVE_SAW_MEDIUM_SCORE) return 2;
        if ((this.score || 0) >= PASSIVE_SAW_SMALL_SCORE) return 1;
        return 0;
    }

    takeDamage(amount, attackerId) {
        let finalAmt = isSuddenDeath ? amount * 2 : amount;
        this.hp = Math.max(this.hp - finalAmt, 0);
        this.flash = 1;
        spawnFloatingText(`-${Math.floor(finalAmt)}`, this.x, this.y, isSuddenDeath ? "#ff0000" : "#ff4757");
        syncStateToServer(attackerId && players[attackerId] ? players[attackerId] : this);

        if (this.hp <= 0 && this.state !== "ELIMINATED") {
            this.state = "ELIMINATED";
        }
    }

    heal(amount) {
        if (this.hp <= 0 && this.state === "ELIMINATED") return;
        const wasCritical = this.hp < MAX_HP * 0.15;
        this.hp = Math.min(this.hp + amount, MAX_HP);
        this.flash = 1;
        spawnFloatingText(`+${amount}`, this.x, this.y, "#2ed573");
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
        // RADIO GIGANTE "LATENTE": Base 40 si es regalo, de lo contrario 20
        const baseRadius = options.label ? 45 : 20;
        this.radius = options.radius ? options.radius * 2.5 : baseRadius; 
        this.targetOffsetX = options.targetOffsetX || 0;
        this.targetOffsetY = options.targetOffsetY || 0;
        this.wobble = options.wobble ? options.wobble * 2 : 5; 
        this.wobblePhase = options.wobblePhase || 0;
        this.life = options.life || 140;
        this.label = options.label || ""; 
        this.active = true;
        this.pulse = 0; // Para animación latente
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
        this.pulse += 0.15;
        this.life -= 1;

        // Estela Latente REFORZADA
        for (let i = 0; i < 2; i++) {
            pushParticle({ 
                x: this.x + (Math.random() - 0.5) * 15, 
                y: this.y + (Math.random() - 0.5) * 15, 
                vx: (Math.random() - 0.5) * 2, 
                vy: (Math.random() - 0.5) * 2, 
                life: 1.2, 
                size: this.radius * 0.4, 
                color: this.color 
            });
        }

        if (dist < target.currentRadius) {
            this.active = false; // Impactó
            
            // EFECTO DE IMPACTO SEGÚN TIPO
            if (this.label === "🦁" || this.label === "🌌") {
                playSound("heavyExplosion", 1.2);
                createExplosion(this.x, this.y, this.color, { count: 40, speed: 18, shake: 25 });
                pushShockwave({ x: this.x, y: this.y, r: 250, opacity: 0.9, color: this.color });
                triggerOverlayFlash(this.color.replace("#", ""), 0.3);
            } else {
                playSound("hit");
                createExplosion(this.x, this.y, this.color, { count: 8, speed: 6 });
            }
            
            target.takeDamage(this.damage, this.attackerId);
        }
    }
    draw() {
        ctx.save();
        
        // Efecto de pulso latente en el radio
        const currentR = this.radius * (1 + Math.sin(this.pulse) * 0.15);

        ctx.beginPath();
        ctx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        
        ctx.shadowBlur = currentR * 4; 
        ctx.shadowColor = this.color;
        
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, currentR);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.2, this.color);
        grad.addColorStop(1, "transparent");
        
        ctx.fillStyle = grad;
        ctx.fill();

        // --- ICONO LATENTE GIGANTE ---
        if (this.label) {
            ctx.shadowBlur = 0;
            ctx.font = `bold ${currentR * 2.2}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(this.label, this.x, this.y);
        }

        ctx.restore();
    }
}

function spawnProjectile(attacker, target, damage, color, options = {}) {
    let label = options.label || "";
    let banner = "";
    if (!label) {
        if (color === "#ff4757") { label = "💖"; }
        else if (color === "#ff5c8a") { label = "🌹"; banner = "SUPER ROSA!"; }
        else if (color === "#fbbf24") { label = "🍩"; banner = "MEGA DONA!"; }
        else if (color === "#a855f7") { label = "🌌"; banner = "GALAXY IMPACT!"; }
        else if (color === "#ffd166") { label = "🦁"; banner = "UNIVERSE BLOC!"; }
    }
    
    // Si hay un banner, lo lanzamos como texto flotante GIGANTE
    if (banner) {
        const size = (label === "🦁" || label === "🌌") ? 80 : 45;
        spawnFloatingText(banner, attacker.x, attacker.y - 80, color, { size: size, duration: 3 });
        if (label === "🦁") playSound("lionRoar");
    }

    options.label = label;
    if (label === "🦁") options.radius = (options.radius || 10) * 4;
    
    pushProjectile(new Projectile(attacker.x, attacker.y, target.id, damage, attacker.id, color, options));
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

        // Determinar icono para la ráfaga según el color
        let label = options.label || "";
        if (!label) {
            if (color === "#ff4757") label = "💖";
            else if (color === "#ff5c8a") label = "🌹";
            else if (color === "#fbbf24") label = "🍩";
            else if (color === "#a855f7") label = "🌌";
        }

        pushProjectile(new Projectile(
            spawnX,
            spawnY,
            target.id,
            damagePerProjectile,
            attacker.id,
            color,
            {
                speed: 9 + (i % 3),
                radius: options.radius || 8,
                targetOffsetX,
                targetOffsetY,
                wobble: options.wobble || 0,
                wobblePhase: angle,
                life: options.life || 120,
                label: label
            }
        ));
    }
}

function createEpicSpawnEffect(x, y, name) {
    // Rayo desde el cielo
    pushLightningBolt({
        sx: x,
        sy: -50, // Desde arriba de la pantalla
        tx: x,
        ty: y,
        life: 1.5,
        color: "#fbbf24" // Dorado
    });
    
    // Impacto en tierra (Reducido de 35 a 15 partículas para optimizar)
    createExplosion(x, y, "#fde68a", { count: 15, speed: 12, shake: 15 });
    pushShockwave({ x, y, r: 80, opacity: 0.9, color: "#fef08a" });
    pushShockwave({ x, y, r: 160, opacity: 0.5, color: "#fbbf24" });
    
    // Texto épico
    spawnFloatingText("⚡ RETADOR", x, y - 60, "#ffd700");
    triggerOverlayFlash("255, 230, 150", 0.4);
    playSound("heavyExplosion", 0.85);

    // Zoom dramático
    focusCamera(x, y, 1.4, 90);
    
    // Anuncio auditivo sutil
    announce(`¡Ha ingresado un nivel avanzado: ${name}!`);
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
        spawnFloatingText("FASE FINAL 🔥", canvas.width / 2, canvas.height / 2 - 200, "#ff8c42");
        showAnnouncer("FASE FINAL", "#ff8c42");
        playSound("heavyExplosion");
        triggerOverlayFlash("255, 120, 80", 0.08); // Overlay menos opaco
        createExplosion(canvas.width / 2, canvas.height / 2, "#ff8c42", { count: 36, speed: 14, shake: 12 });
        pushShockwave({ x: canvas.width / 2, y: canvas.height / 2, r: 120, opacity: 0.85, color: "#ff8c42" });
        screenShake = 12; // Menos vibración para no asustar
        announce("Fase final activada. El daño aumenta considerablemente.");
    } else {
        if (sdOverlay) sdOverlay.style.display = "none";
        showAnnouncer("NUEVA RONDA", "#2ed573");
        speakImmediate("Inicio de nueva ronda. Todos los jugadores reinician.", { rate: 1.0, pitch: 1.0, volume: 1 });
    }
});

socket.on("arena:champion", (id) => {
    lastArenaChampionId = id;
    console.log("🏆 El campeón reinante es:", id);
});

socket.on("arena:sawHit", (data) => {
    const attacker = syncPlayerFromServer(data.attacker) || players[data.attacker?.id];
    const target = syncPlayerFromServer(data.target) || players[data.target?.id];
    if (!attacker || !target) return;

    if (data.isTipClash) {
        spawnFloatingText("⚔️ CLASH", (attacker.x + target.x) / 2, (attacker.y + target.y) / 2, "#ffd700");
        playSound("buzzsaw", 1.4);
        createExplosion((attacker.x + target.x) / 2, (attacker.y + target.y) / 2, "#fff", { count: 12, speed: 7 });
    } else {
        target.flash = 0.8;
        createExplosion(target.x, target.y, "#fbbf24", { count: 12, speed: 6, shake: 3 });
        // Número de DAÑO (ROJO / AMARILLO para sierra)
        spawnFloatingText(`-${Math.floor(data.damage || 0)} HP`, target.x, target.y - 30, "#ef4444");
        if (data.scoreLoss > 0) {
            spawnFloatingText(`-${Math.floor(data.scoreLoss)} PTS`, target.x, target.y - 50, "#fca5a5");
        }
        if (Math.random() < 0.2) playSound("buzzsaw", 0.85);
    }
});

// ==========================================
// MÉTODOS DE RED (SOCKETS)
// ==========================================
function syncStateToServer(p) {
    return p;
}

// --- 🏆 EVENTOS PHASE 2: PRESTIGIO ---
socket.on("status", (status) => {
    updateConnectionOverlay(status);
    addConsoleLog(status.message || status.error || "Estado actualizado", status.connected ? "success" : (status.step === "error" ? "error" : ""));
});

function updateConnectionOverlay(status) {
    // UI removida del Live por petición del usuario para mayor limpieza.
    // Solo feedback en terminal del servidor.
    return;
}

function addConsoleLog(text, type = "") {
    // Consola web removida por limpieza. Logs disponibles en terminal.
    return;
}

socket.on("arena:champions", (winners) => {
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
            <span class="champ-name">${w.name}</span>
            <span class="champ-wins">${w.victories} VICS</span>
            <span class="champ-time">${w.time}</span>
        </div>
    `).join('<span class="champ-sep">|</span>');
    ticker.innerHTML = `<div class="ticker-scroll">${html} ${html}</div>`; // Duplicado para loop infinito
    updateTopShowcase();
});
// ------------------------------------------

socket.on("arena:combo", (data) => {
    createComboBurst(data?.x, data?.y);
});



function createComboBurst(x, y) {
    const activePlayers = Object.values(players).filter((player) => player.opacity > 0.5);
    if (activePlayers.length === 0) return;

    const sourceX = x ?? (activePlayers[Math.floor(Math.random() * activePlayers.length)].x);
    const sourceY = y ?? (activePlayers[Math.floor(Math.random() * activePlayers.length)].y);
    
    for (let i = 0; i < 35; i++) {
        const angle = (i / 35) * Math.PI * 2;
        pushParticle({
            x: sourceX,
            y: sourceY,
            vx: Math.cos(angle) * (3 + Math.random() * 7),
            vy: Math.sin(angle) * (3 + Math.random() * 7),
            life: 1.2,
            size: Math.random() * 5 + 3,
            color: i % 3 === 0 ? "#ffd700" : (i % 3 === 1 ? "#ff8c42" : "#ffffff")
        });
    }
    playSound("jackpot");
    screenShake = Math.max(screenShake, 8);
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

    // Remover jugadores que ya no están en el servidor (en modo debug NO borrar bots locales)
    for (const id in players) {
        if (serverPlayers[id]) continue;
        if (DEBUG_MODE && (id.startsWith("debug_bot_") || id.startsWith("bot_"))) continue;
        delete players[id];
    }

    // En debug: si quedamos con 0 jugadores, crear 3 bots para que siempre se vean bolas
    if (DEBUG_MODE && Object.keys(players).length === 0 && typeof getArenaBounds === "function") {
        const b = getArenaBounds();
        const spread = Math.min(b.width, b.height) * 0.2;
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const id = "debug_bot_" + (i + 1);
            players[id] = new Player({
                i: id, n: "BOT_" + (i + 1), s: 50 + i * 30, h: 1000, st: "ACTIVE",
                x: b.cx + Math.cos(angle) * spread,
                y: b.cy + Math.sin(angle) * spread
            });
        }
    }
});

function syncPlayerFromServer(sp) {
    if (!sp?.i) return null; // 'i' es id
    const id = sp.i;

    const existingPlayer = players[id];
    const previousState = existingPlayer?.state || null;

    if (!existingPlayer) {
        players[id] = new Player({
            id: sp.i,
            name: sp.n,
            avatar: sp.a,
            score: sp.s,
            hp: sp.h,
            x: sp.x,
            y: sp.y,
            state: sp.st
        });
    } else {
        const newScore = sp.s ?? players[id].score;
        if (newScore > (players[id].score || 0)) {
            players[id].scorePop = 1.0;
            // Aumentar engagement al recibir puntos (actividad)
            players[id].engagement = Math.min((players[id].engagement || 0) + 15, 100);
            players[id].lastTapBoostAt = Date.now();
        }
        players[id].score = newScore;
        
        players[id].standingScore = sp.ss ?? players[id].standingScore ?? players[id].score ?? 0;
        players[id].hp = sp.h ?? players[id].hp;
        players[id].name = sp.n || players[id].name;
        players[id].victories = sp.v ?? players[id].victories ?? 0;
        players[id].state = sp.st || players[id].state;
        players[id].invulnerableUntil = sp.inv || 0;

        // El servidor solo es autoritativo en posicion para spawn/respawn o jugadores sinteticos.
        const shouldSyncPosition =
            id.startsWith("bot_") ||
            previousState === "ELIMINATED" ||
            previousState === "IDLE" ||
            (previousState && previousState !== sp.st) ||
            !Number.isFinite(players[id].x) ||
            !Number.isFinite(players[id].y);

        if (shouldSyncPosition || !existingPlayer) {
            players[id].x = sp.x ?? players[id].x;
            players[id].y = sp.y ?? players[id].y;
        }
    }

    if (sp.saw > Date.now()) {
        const remainingFrames = Math.floor((sp.saw - Date.now()) / (1000 / 60));
        if (Math.abs((players[id].sawLife || 0) - remainingFrames) > 60) {
            players[id].sawLife = remainingFrames;
        }
    } else {
        players[id].sawLife = 0;
    }

    return players[id];
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
            <span class="powers-timer-label">FIN DE RONDA</span>
            <span id="round-time-remaining">03:00</span>
        </div>
    `;
}

function renderLastRoundWinner() {
    const slot = document.getElementById("round-winner-slot");
    if (!slot) return;
    const liveLeader = roundRanking[0] || null;
    const liveRunnerUp = roundRanking[1] || null;
    const leaderValue = Math.floor(liveLeader?.score || 0);
    const runnerValue = Math.floor(liveRunnerUp?.score || 0);
    const valueGap = Math.max(0, leaderValue - runnerValue);
    const winner = lastCompletedRoundWinner;
    if (liveLeader?.id) {
        const minutes = String(Math.floor(currentRoundSeconds / 60)).padStart(2, "0");
        const secs = String(currentRoundSeconds % 60).padStart(2, "0");
        slot.innerHTML = `
            <div class="round-winner-card live-leader-card">
                <img class="round-winner-avatar" src="${liveLeader.avatar || 'https://www.tiktok.com/favicon.ico'}" onerror="this.src='https://www.tiktok.com/favicon.ico'" />
                <div class="round-winner-info">
                    <div class="round-winner-label">LIDER DE ESTA RONDA</div>
                    <div class="round-winner-name">${liveLeader.name}</div>
                    <div class="round-winner-meta">
                        <span>PUNTOS ${leaderValue}</span>
                        <span>VENTAJA ${valueGap}</span>
                    </div>
                    <div class="round-winner-submeta">CIERRE EN ${minutes}:${secs}</div>
                    ${winner?.id ? `<div class="round-winner-submeta">ULTIMO GANADOR: ${winner.name}</div>` : ""}
                </div>
            </div>
        `;
        return;
    }
    if (!winner?.id) {
        const minutes = String(Math.floor(currentRoundSeconds / 60)).padStart(2, "0");
        const secs = String(currentRoundSeconds % 60).padStart(2, "0");
        slot.innerHTML = `
            <div class="round-winner-empty">
                <span class="round-winner-empty-label">LIDER DE ESTA RONDA</span>
                <span class="round-winner-empty-time">${minutes}:${secs}</span>
            </div>
        `;
        return;
    }

    slot.innerHTML = `
        <div class="round-winner-card">
            <img class="round-winner-avatar" src="${winner.avatar || 'https://www.tiktok.com/favicon.ico'}" onerror="this.src='https://www.tiktok.com/favicon.ico'" />
            <div class="round-winner-info">
                <div class="round-winner-label">ULTIMO GANADOR REAL</div>
                <div class="round-winner-name">${winner.name}</div>
                <div class="round-winner-meta">
                    <span>PUNTOS ${Math.floor(winner.score || winner.standingScore || 0)}</span>
                    <span>RONDAS ${Math.floor(winner.victories || 0)}</span>
                </div>
            </div>
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
    const podium3 = sessionChampions
        .map((entry) => {
            const livePlayer = entry.id ? players[entry.id] : Object.values(players).find((player) => player?.name === entry.name);
            return {
                id: entry.id || livePlayer?.id || entry.name,
                name: entry.name,
                avatar: livePlayer?.avatar || entry.avatar || "https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image",
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
            score: 0,
            isPlaceholder: true
        });
    }

    topShowcaseEl.innerHTML = "";
    topShowcaseEl.style.display = "flex";

    podium3.forEach((p, i) => {
        const rank = i + 1;
        const item = document.createElement("div");
        item.className = `top-player-item rank-${rank} ${p.isPlaceholder ? 'placeholder' : ''}`;

        item.innerHTML = `
            <div class="top-player-avatar" style="background-image: url('${p.avatar || ''}')">
                <div class="top-rank-badge">${rank}</div>
            </div>
            <div class="top-player-name">${p.name}</div>
            ${!p.isPlaceholder ? `<div class="top-player-score">WINS: ${Math.floor(p.victories || 0)}</div>` : ''}
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
    const mainTimerEl = document.getElementById("main-round-timer");
    const minutes = String(Math.floor(currentRoundSeconds / 60)).padStart(2, "0");
    const secs = String(currentRoundSeconds % 60).padStart(2, "0");
    const formattedTime = `${minutes}:${secs}`;

    if (roundTimerEl) roundTimerEl.textContent = formattedTime;
    if (mainTimerEl) mainTimerEl.textContent = formattedTime;
    if (!lastCompletedRoundWinner?.id) {
        renderLastRoundWinner();
    }

    if (seconds > 10) {
        lastCountdownSpoken = null;
    }

    if (seconds <= 30 && seconds > 0) {
        if (!document.body.classList.contains("dramatic-vignette")) {
            document.body.classList.add("dramatic-vignette");
            if (mainTimerEl) mainTimerEl.classList.add("dramatic");
        }
    } else {
        document.body.classList.remove("dramatic-vignette");
        if (mainTimerEl) mainTimerEl.classList.remove("dramatic");
    }

    if (seconds <= 10 && seconds > 0) {
        countdownOverlay.textContent = String(seconds).padStart(2, "0");
        countdownOverlay.classList.add("active");

        // Hablar TODOS los números del 10 al 1
        speakCountdownNumber(seconds);

        if (seconds <= 5) {
            countdownOverlay.classList.remove("normal");
            countdownOverlay.classList.add("warning");
        } else {
            countdownOverlay.classList.remove("warning");
            countdownOverlay.classList.add("normal");
        }

        playSound("tick");
    } else {
        countdownOverlay.classList.remove("active");
        countdownOverlay.classList.remove("warning");
        countdownOverlay.classList.remove("normal");
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
    
    // Limpiar cola para anuncio inmediato de ganador
    speechQueue = [];
    if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    
    speakImmediate(`¡FINAL DE LA RONDA! El gran ganador es ${w.name} con ${Math.floor(w.score || w.standingScore || 0)} puntos. ¡Felicidades al nuevo campeón!`, { rate: 1.05, pitch: 1.1, volume: 1 });
    
    if (arenaChampion?.name) {
        announce(`Récord histórico: ${arenaChampion.name} lidera el salón de la fama con ${Math.floor(arenaChampion.victories || 0)} victorias.`, { gapMs: 600 });
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
            <img class="victory-avatar" src="${w.avatar || 'https://www.tiktok.com/favicon.ico'}" onerror="this.src='https://www.tiktok.com/favicon.ico'"/>
            <h2 class="victory-name">${w.name}</h2>
            <div class="victory-stats">🏁 PUNTOS DE RONDA: ${Math.floor(w.score || w.standingScore || 0)}</div>
            ${arenaChampion?.name ? `<div class="victory-stats">👑 NUMERO UNO HISTORICO: ${arenaChampion.name} · ${Math.floor(arenaChampion.victories || 0)} RONDAS</div>` : ""}
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

socket.on("arena:lastRoundWinner", (winner) => {
    lastCompletedRoundWinner = winner || null;
    renderLastRoundWinner();
});

socket.on("arena:powerup", (data) => {
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

socket.on("arena:burst", (data) => {
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
socket.on("arena:leave", (data) => {
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

socket.on("arena:respawn", (data) => {
    const player = players[data.userId];
    if (!player) return;
    player.state = "ACTIVE";
    player.engagement = 0;
    player.currentRadius = Math.max(PLAYER_RADIUS * 0.92, Math.min(player.currentRadius || PLAYER_RADIUS, PLAYER_RADIUS + 4));
    player.peakRadius = Math.max(player.currentRadius, PLAYER_RADIUS);
    player.respawnSizeLockUntil = Date.now() + 1800;
    player.flash = 1;
    spawnFloatingText("RESPAWN", player.x, player.y - 40, "#7dd3fc");
    playSound("heal");
});

// Variables para combo de Likes
const recentHeals = {};

// EVENTO DE CURACIÓN / APOYO (LIKES / TAP TAP)
socket.on("arena:like", (data) => {
    let p = syncPlayerFromServer(data.player) || players[data.userId];
    if (!p && data?.userId) {
        p = new Player({
            id: data.userId,
            name: data.player?.name || data.userName || data.userId,
            avatar: data.player?.avatar || "",
            hp: data.player?.hp || MAX_HP,
            score: data.player?.score || 0,
            standingScore: data.player?.standingScore || data.player?.score || 0,
            state: data.player?.state || "ACTIVE"
        });
        const forcedSpawn = clampToArena(canvas.width / 2, canvas.height / 2, PLAYER_RADIUS + 12);
        p.x = forcedSpawn.x;
        p.y = forcedSpawn.y;
        players[data.userId] = p;
    }
    if (p) {
        p.lastActive = Date.now(); // Despierta de AFK inmediatamente
        p.state = "ACTIVE";
        p.opacity = 1;
        const visibleSpawn = clampToArena(p.x, p.y, p.currentRadius + 8);
        p.x = visibleSpawn.x;
        p.y = visibleSpawn.y;
        p.heal(data.heal || data.likeCount);
        // Mostrar nombre en el Tap para mayor reconocimiento
        spawnFloatingText(`${data.userName?.substring(0,8) || ''} 💖`, p.x, p.y - 30, "#ff4757");
        p.flash = 1;
        p.engagement = Math.min((p.engagement || 0) + Math.max(10, data.likeCount * 2.8), 220);
        p.lastTapBoostAt = Date.now();

        // DOPAMINA VIRAL: Lluvia de corazones en cada Like
        for (let i = 0; i < Math.min(3, data.likeCount); i++) {
            pushParticle({
                x: p.x + (Math.random() - 0.5) * 40,
                y: p.y - 20,
                vx: (Math.random() - 0.5) * 6,
                vy: -Math.random() * 8 - 2,
                life: 1.2,
                size: Math.random() * 12 + 8,
                color: "#ff4757",
                isHeart: true
            });
        }
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

        // --- DISPARO CON TAP (SOLICITADO) ---
        // Al tapear, disparamos a un oponente aleatorio o al que tenga más HP
        const opponents = Object.values(players).filter(op => op.id !== p.id && op.state === "ACTIVE" && op.hp > 0);
        if (opponents.length > 0) {
            // Apuntar al que tiene más vida para balancear la arena
            const target = opponents.sort((a, b) => b.hp - a.hp)[0];
            const tapDamage = 2; // Daño ligero por cada tap
            
            // Disparo visual similar al inicio del proyecto (veloz y directo)
            spawnProjectile(p, target, tapDamage, "#ff4757", { speed: 18, wobble: 2 });
            playSound("shoot", 1.4); // Ruidito de disparo agudo
            setTimeout(() => playSound("blip", 0.8), 50); // Ruidito extra "bonito"
        }

        // Limitar pitch para no romper los tímpanos (máximo 2x pitch normal)
        const pitchMod = Math.min(1 + (recentHeals[data.userId].strikes * 0.05), 2.0);

        playSound("heal", Math.min(pitchMod, 1.2));
        spawnFloatingText(`TAP +${Math.max(1, Math.floor(data.likeCount || 1))}`, p.x, p.y - 10, "#86efac");
        if (data.scoreGain > 0) {
            spawnFloatingText(`+${data.scoreGain} PTS`, p.x, p.y - 28, "#fff3b0");
        }
        // Gratis: flash y shake siempre por debajo de regalos de pago (máx flash 0.06, shake 8)
        if (data.comboLikes >= 16 && data.comboLikes % 8 === 0) {
            spawnFloatingText(`RUSH x${data.comboLikes}`, p.x, p.y - 54, "#7dd3fc");
            triggerOverlayFlash("120, 255, 210", 0.04);
            screenShake = Math.max(screenShake, Math.min(8, 2 + (data.comboLikes / 30)));
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

socket.on("arena:likeStrike", (data) => {
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

        playSound("heal", 0.45); // Sonido suave para el aura
        screenShake = Math.max(screenShake, 1.8);
    }
});

socket.on("arena:leaderChat", (data) => {
    if (!data?.comment) return;
    if (!currentTopArenaLeader?.id || data.userId !== currentTopArenaLeader.id) return;
    const focusX = canvas.width / 2;
    const focusY = canvas.height / 2 - 190;
    spawnFloatingText(`NUMERO 1 DEL ARENA: ${data.name}`, focusX, focusY, "#fde68a");
    spawnFloatingText(`"${data.comment}"`, focusX, focusY + 34, "#f8fafc");
    speakLeaderChat(data.name, data.comment);
    screenShake = Math.max(screenShake, 3);
});

socket.on("arena:ko", (data) => {
    const attacker = players[data.attackerId];
    const target = players[data.targetId];
    const x = target?.x || attacker?.x || (canvas.width / 2);
    const y = target?.y || attacker?.y || (canvas.height / 2);

    // Sistema de Rachas (Dopamina pura)
    if (data.attackerId) {
        playerStreaks[data.attackerId] = (playerStreaks[data.attackerId] || 0) + 1;
        const streak = playerStreaks[data.attackerId];
        const attackerName = attacker?.name || "Un gladiador";
        
        if (streak === 2) {
            announce(`¡DOBLE ELIMINACIÓN de ${attackerName}!`, { pitch: 1.1 });
            spawnFloatingText("DOUBLE KO", x, y - 100, "#f87171");
        } else if (streak === 3) {
             announce(`¡TRIPLE ELIMINACIÓN! ${attackerName} está imparable.`, { pitch: 1.2 });
             spawnFloatingText("TRIPLE KO", x, y - 120, "#ef4444");
             screenShake = Math.max(screenShake, 25);
        } else if (streak >= 5) {
             announce(`¡DOMINACIÓN TOTAL! ${attackerName} lleva ${streak} bajas seguidas.`, { pitch: 1.3, rate: 1.1 });
             spawnFloatingText("GODLIKE STREAK", x, y - 140, "#b91c1c");
             triggerOverlayFlash("255, 0, 0", 0.2);
             screenShake = Math.max(screenShake, 35);
        }
    }

    // Resetear racha de la víctima
    if (data.targetId) {
        playerStreaks[data.targetId] = 0;
    }

    spawnFloatingText("KO", x, y - 70, "#fecaca");
    createExplosion(x, y, "#fecaca", { count: 32, speed: 12, shake: 12 });
    triggerOverlayFlash("255, 180, 180", 0.15);
    playSound("heavyExplosion");
    screenShake = Math.max(screenShake, 22);
    
    // Hitstop extra en KO
    hitStopFrames = Math.max(hitStopFrames, 12);
});

function resolveArenaGiftEffect(data, attacker, target, diamondsTotal, giftValue, giftName) {
    const effectKey = data.effectKey || data.fx || ""; // Usar la clave de efecto del servidor
    const category = data.category || "";
    const lowerName = (giftName || "").toLowerCase();

    // 1. Mapeo directo por clave de efecto (Prioridad servidor)
    if (effectKey === "megaBlast" || category === "mega") return { type: "megaBlast", color: "#ffd166" };
    if (effectKey === "orbitalStrike" || effectKey === "tripleLightning" || category === "lightning") return { type: "lightningStorm", color: "#7dd3fc" };
    if (effectKey === "fireBurst" || effectKey === "fireStorm" || category === "fire") return { type: "fireBurst", color: "#ff6b00" };
    if (effectKey === "shockwave" || category === "shockwave") return { type: "shockwave", color: "#fbbf24" };
    if (effectKey === "buzzsaw") return { type: "buzzsaw", color: "#ff9f43" };
    if (effectKey === "tapSpark") return { type: "tapSpark", color: "#fef08a" };
    if (effectKey === "iceShot" || effectKey === "projectile") return { type: "projectile", color: effectKey === "iceShot" ? "#9be7ff" : "#ff4757" };

    // 2. Fallbacks basados en nombre o valor (Compatibilidad)
    if (lowerName.includes("universe") || lowerName.includes("universo") || lowerName.includes("lion") || lowerName.includes("león") || giftValue >= 10000) {
        return { type: "megaBlast", color: "#ffd166" };
    }
    if (lowerName.includes("galaxy") || lowerName.includes("galaxia") || lowerName.includes("planet") || lowerName.includes("planeta") || giftValue >= 500) {
        return { type: "lightningStorm", color: "#7dd3fc" };
    }
    if (lowerName.includes("fire") || lowerName.includes("fuego") || lowerName.includes("flame") || lowerName.includes("fireworks") || lowerName.includes("drac")) {
        return { type: "fireBurst", color: "#ff6b00" };
    }
    if (lowerName.includes("donut") || lowerName.includes("dona") || lowerName.includes("perfume") || lowerName.includes("capy") || lowerName.includes("relámpago")) {
        return { type: "shockwave", color: "#fbbf24" };
    }
    if (lowerName.includes("rose") || lowerName.includes("rosa") || lowerName.includes("ice")) {
        return { type: "projectile", color: lowerName.includes("ice") ? "#9be7ff" : "#ff4757" };
    }
    
    return { type: "projectile", color: "#00f0ff" };
}

function describeArenaGiftImpact(data, attacker, target, giftEffect) {
    const attackerName = attacker?.name || "Alguien";
    const targetName = target?.name || "un rival";
    const giftName = String(data?.giftName || "regalo").trim();
    const effectLabel = String(data?.label || "").trim();

    switch (giftEffect?.type) {
        case "megaBlast":
            return {
                overlay: `${attackerName} lanza ${giftName} contra ${targetName} · MEGABLAST TOTAL`,
                voice: `${attackerName} lanza ${giftName} contra ${targetName}. Megablast total.`
            };
        case "lightningStorm":
            return {
                overlay: `${attackerName} lanza ${giftName} sobre ${targetName} · LLUVIA DE RAYOS`,
                voice: `${attackerName} lanza ${giftName} sobre ${targetName}. Lluvia de rayos.`
            };
        case "fireBurst":
            return {
                overlay: `${attackerName} prende ${giftName} sobre ${targetName} · FUEGO DE AREA`,
                voice: `${attackerName} lanza ${giftName} contra ${targetName}. Fuego de area.`
            };
        case "shockwave":
            return {
                overlay: `${attackerName} golpea con ${giftName} a ${targetName} · ONDA DE CHOQUE`,
                voice: `${attackerName} golpea con ${giftName} a ${targetName}. Onda de choque.`
            };
        case "buzzsaw":
            return {
                overlay: `${attackerName} activa ${giftName} · SIERRA DE PODER`,
                voice: `${attackerName} activa ${giftName}. Sierra de poder.`
            };
        case "tapSpark":
        case "projectile":
        default:
            return {
                overlay: `${attackerName} lanza ${giftName} a ${targetName}${effectLabel ? ` · ${effectLabel.toUpperCase()}` : ""}`,
                voice: `${attackerName} lanza ${giftName} a ${targetName}.`
            };
    }
}

// Perfil de efectos por valor del regalo. Los GRATIS (tap/like/chat) usan siempre menos que el mínimo pagado.
function getPaidGiftFxProfile(giftValue, diamondsTotal) {
    const totalValue = Math.max(giftValue || 0, diamondsTotal || 0);
    // Tier GRATIS: nunca superar este techo para tap/like/chat (retention sin eclipsar pagos)
    if (totalValue < 2) {
        return {
            cameraScale: 1.0,
            cameraFrames: 0,
            flashAlpha: 0.04,
            shake: 4,
            shockwaveRadius: 12,
            burstCount: 6,
            burstSpeed: 4
        };
    }
    if (totalValue >= 35000) {
        return {
            cameraScale: 2.2,
            cameraFrames: 300,
            flashAlpha: 0.45,
            shake: 90,
            shockwaveRadius: 180,
            burstCount: 160,
            burstSpeed: 28
        };
    }
    if (totalValue >= 20000) {
        return {
            cameraScale: 2.05,
            cameraFrames: 240,
            flashAlpha: 0.38,
            shake: 70,
            shockwaveRadius: 130,
            burstCount: 110,
            burstSpeed: 22
        };
    }
    if (totalValue >= 5000) {
        return {
            cameraScale: 1.85,
            cameraFrames: 190,
            flashAlpha: 0.3,
            shake: 50,
            shockwaveRadius: 85,
            burstCount: 65,
            burstSpeed: 18
        };
    }
    if (totalValue >= 1000) {
        return {
            cameraScale: 1.58,
            cameraFrames: 145,
            flashAlpha: 0.22,
            shake: 26,
            shockwaveRadius: 40,
            burstCount: 36,
            burstSpeed: 12
        };
    }
    if (totalValue >= 100) {
        return {
            cameraScale: 1.42,
            cameraFrames: 112,
            flashAlpha: 0.16,
            shake: 18,
            shockwaveRadius: 30,
            burstCount: 30,
            burstSpeed: 10
        };
    }
    return {
        cameraScale: 1.24,
        cameraFrames: 68,
        flashAlpha: 0.1,
        shake: 8,
        shockwaveRadius: 20,
        burstCount: 18,
        burstSpeed: 7
    };
}

// EVENTO DE ATAQUE (REGALOS)
socket.on("arena:gift", (data) => {
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

    // Zoom automático solo si es un regalo notable (Threshold: 20 diamantes)
    if (giftValue >= 20) {
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
    let damage = Math.max(18, Math.round(diamondsTotal * (giftValue <= 1 ? 18 : 120)));

    attacker.flash = 1;
    screenShake = Math.max(screenShake, Math.max(fxProfile.shake, Math.min(34, 10 + Math.log2(diamondsTotal + 1) * 3.2)));

    const giftEffect = resolveArenaGiftEffect(data, attacker, target, diamondsTotal, giftValue, data.giftName || "");
    const giftNarration = describeArenaGiftImpact(data, attacker, target, giftEffect);
    let atkType = "projectile";
    let color = giftEffect.color;

    showAnnouncer(giftNarration.overlay, giftValue >= 500 ? "#ffd166" : (giftValue >= 20 ? "#7dd3fc" : "#f8fafc"));
    if (diamondsTotal >= 20) {
        announce(giftNarration.voice, { gapMs: 900 });
    }

    // Detección de tipos de ataque: utilizar tanto la clave sugerida como los fallbacks.
    if (giftEffect.type === "megaBlast") {
        // Sonido prioritario del servidor o fallback por nombre
        const blastSfx = data.sfx || (data.giftName?.toLowerCase().includes("lion") ? "lionRoar" : "universeCrash");
        playSound(blastSfx);
        
        hitStopFrames = giftValue >= 34999 ? 55 : (giftValue >= 1000 ? 40 : 28);
        screenShake = giftValue >= 30000 ? 95 : (giftValue >= 1000 ? 70 : 50);
        triggerOverlayFlash("255, 240, 200", giftValue >= 30000 ? 0.7 : 0.45);
        triggerArenaBorderPulse("255, 214, 102", 0.95, 25);
        triggerBackgroundGrade("255, 200, 100", 0.25);
        
        const epicLabel = giftValue >= 30000 ? "¡COLAPSO TOTAL!" : "¡SÚPER MEGA IMPACTO!";
        spawnFloatingText(epicLabel, target.x, target.y, "#ffd166");
        
        if (giftValue >= 30000) {
            announce(`¡DIOS MÍO! ${attacker.name} acaba de lanzar un UNIVERSO. ¡EL ARENA VA A EXPLOTAR!`, { volume: 1, pitch: 1.1, rate: 1.05 });
            globalGlitchIntensity = 45; // Activar distorsión global
            triggerOverlayFlash("255, 255, 255", 0.9);
            // Lluvia de monedas para el universo
            for (let i = 0; i < 50; i++) {
                ambientParticles.push({
                    x: Math.random() * canvas.width,
                    y: -20 - (Math.random() * 500),
                    vx: (Math.random() - 0.5) * 4,
                    vy: 5 + Math.random() * 10,
                    size: 15 + Math.random() * 10,
                    opacity: 1,
                    isCoin: true,
                    rot: Math.random() * Math.PI,
                    rotV: (Math.random() - 0.5) * 0.2
                });
            }
        } else {
            announce(`¡RUGIDO LEGENDARIO! Impacto masivo de ${attacker.name}. ¡Es increíble!`);
        }

        // Explosiones masivas en cadena
        for (let i = 0; i < 6; i++) {
            setTimeout(() => {
                const ox = (Math.random() - 0.5) * 150;
                const oy = (Math.random() - 0.5) * 150;
                createExplosion(target.x + ox, target.y + oy, i % 2 === 0 ? "#fff" : "#ffd166", { 
                    count: giftValue >= 30000 ? 100 : 60, 
                    speed: 22, 
                    shake: 25 
                });
                playSound("heavyExplosion");
            }, i * 110);
        }

        pushShockwave({ x: target.x, y: target.y, r: 40, opacity: 1, color: "#fff7d6" });
        pushShockwave({ x: target.x, y: target.y, r: 120, opacity: 0.9, color: "#ffd166" });
        pushShockwave({ x: target.x, y: target.y, r: 200, opacity: 0.7, color: "#ffedd5" });
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                pushLightningBolt({
                    sx: attacker.x + ((Math.random() - 0.5) * 80),
                    sy: attacker.y + ((Math.random() - 0.5) * 80),
                    tx: target.x + ((Math.random() - 0.5) * 120),
                    ty: target.y + ((Math.random() - 0.5) * 120),
                    life: 1.3,
                    color: "#fff7d6"
                });
            }, i * 70);
        }
        target.takeDamage(Math.max(220, diamondsTotal * 32), attacker.id);
        atkType = "none";
    } else if (giftEffect.type === "lightningStorm") {
        playSound(data.sfx || "galaxyBlast");
        screenShake = isSuddenDeath ? 40 : 32;
        triggerOverlayFlash("90, 200, 255", 0.24);
        triggerArenaBorderPulse("90, 200, 255", 0.72, 15);
        triggerBackgroundGrade("70, 170, 255", 0.14);
        spawnFloatingText(data.label || "GALAXIA", target.x, target.y, "#7dd3fc");
        announce("Galaxia activada. Rayos premium enormes. La ronda puede cambiar por completo.");
        for (let i = 0; i < 9; i++) {
            setTimeout(() => {
                pushLightningBolt({
                    sx: attacker.x, sy: attacker.y,
                    tx: target.x + (Math.random() - 0.5) * 100,
                    ty: target.y + (Math.random() - 0.5) * 100,
                    life: 1.0 + (sizeDominance * 0.85), color: "#0abde3"
                });
                createExplosion(target.x + (Math.random() - 0.5) * 24, target.y + (Math.random() - 0.5) * 24, "#7dd3fc", { count: 18, speed: 8, shake: 5 });
                target.takeDamage(Math.max(90, diamondsTotal * 8), attacker.id);
            }, i * 60);
        }
        atkType = "none";
    } else if (giftEffect.type === "buzzsaw" || giftValue >= 500) {
        // Power-up de Sierra (Aura)
        playSound("buzzsaw");
        attacker.sawLife = Math.max(attacker.sawLife, 1320); // 22s de aura
        spawnFloatingText("SIERRA ACTIVA", attacker.x, attacker.y - 40, "#ff9f43");
        createExplosion(attacker.x, attacker.y, "#ff9f43", { count: 36, speed: 10, shake: 10 });
        triggerOverlayFlash("255, 170, 90", 0.2);
        triggerArenaBorderPulse("255, 159, 67", 0.45, 10);
        atkType = "none";
    } else if (giftEffect.type === "projectile") {
        playSound("roseShot");
        atkType = "projectile";
    } else if (giftEffect.type === "tapSpark") {
        playSound("hit");
        atkType = "projectile";
    } else if (giftEffect.type === "fireBurst") {
        playSound(data.sfx || "fire");
        createFireBurst(target.x, target.y, attacker.currentRadius + 64);
        createExplosion(target.x, target.y, "#ff8a00", { count: 42, speed: 13, shake: 14 });
        createExplosion(target.x + 26, target.y - 20, "#ffd166", { count: 26, speed: 9, shake: 8 });
        triggerOverlayFlash("255, 120, 40", 0.22);
        triggerArenaBorderPulse("255, 120, 40", 0.62, 13);
        triggerBackgroundGrade("255, 120, 40", 0.12);
        screenShake = Math.max(screenShake, Math.max(screenShake, isSuddenDeath ? 36 : 28));
        atkType = "lightning";
    } else if (giftEffect.type === "shockwave") {
        playSound(data.sfx || "heavyExplosion");
        hitStopFrames = Math.max(hitStopFrames, 12);
        focusCamera(target.x, target.y, Math.max(fxProfile.cameraScale, 1.38), Math.max(fxProfile.cameraFrames, 95));
        createExplosion(target.x, target.y, color, { count: 44, speed: 14, shake: 18 });
        createExplosion(target.x + 28, target.y - 18, "#fff3b0", { count: 24, speed: 10, shake: 10 });
        createExplosion(target.x - 28, target.y + 18, "#f59e0b", { count: 24, speed: 10, shake: 10 });
        const swScale = (data.sizeScale || 0.45) * 1.8;
        pushShockwave({ x: target.x, y: target.y, r: 30 * swScale, opacity: 0.95, color });
        pushShockwave({ x: target.x, y: target.y, r: 52 * swScale, opacity: 0.82, color: "#fff3b0" });
        pushShockwave({ x: target.x, y: target.y, r: 72 * swScale, opacity: 0.62, color: "#fde68a" });
        triggerOverlayFlash("255, 214, 120", 0.24);
        triggerArenaBorderPulse("255, 214, 120", 0.56, 12);
        screenShake = Math.max(screenShake, isSuddenDeath ? 42 : 34);
        atkType = "lightning";
    } else if (data.sfx) {
        // Regalos de pago: volumen/pitch según valor para dopamina (pagos suenan más impactantes)
        const paidPitch = diamondsTotal >= 1000 ? 1.15 : diamondsTotal >= 100 ? 1.08 : 1.0;
        playSound(data.sfx, paidPitch);
    }

    // Shockwave al atacar
    if (diamondsTotal > 10) {
        pushShockwave({ x: attacker.x, y: attacker.y, r: fxProfile.shockwaveRadius, opacity: 0.8, color: color });
    }

    // Ejecución de Proyectiles/Efectos persistentes
    if (atkType === "projectile") {
        const pCount = Math.min(Math.max(count, giftValue >= 100 ? 4 : 1), giftValue >= 1000 ? 16 : 12);
        for (let i = 0; i < pCount; i++) {
            setTimeout(() => {
                if (attacker && target && target.hp > 0) {
                    playSound("shoot");
                    const pRadius = 10 + (data.sizeScale || 0.2) * 20;
                    spawnProjectileBurst(attacker, target, 1, damage / pCount, color, { 
                        wobble: giftValue >= 100 ? 8 : 4, 
                        life: giftValue >= 100 ? 120 : 100,
                        radius: pRadius
                    });
                }
            }, i * 40);
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
const UI_THROTTLE_MS = 100; // Máximo 10 actualizaciones de DOM por segundo (antes 1)

function updateRankingDOM(force = false) {
    const now = Date.now();
    if (!force && (now - lastUIUpdate < UI_THROTTLE_MS)) return;
    lastUIUpdate = now;

    updateTopShowcase(); // Actualizar podio superior
    renderLastRoundWinner();
    
    if (leaderboardEl) {
        leaderboardEl.innerHTML = "";
        // Repoblar con el Top 10 de la ronda actual
        const top10 = roundRanking.slice(0, 10);
        top10.forEach((p, index) => {
            const item = document.createElement("div");
            item.className = "leaderboard-item";
            const val = Math.floor(p.score || 0);
            item.innerHTML = `
                <span class="rank-num">#${index + 1}</span>
                <img class="rank-avatar" src="${p.avatar || 'https://www.tiktok.com/favicon.ico'}" />
                <span class="rank-name">${p.name}</span>
                <span class="rank-score">${formatScoreShort(val)}</span>
            `;
            leaderboardEl.appendChild(item);
        });
    }
}

socket.on("arena:currentRanking", (data) => {
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
    const leaderStanding = Math.floor(roundLeader?.score || 0);
    const runnerStanding = Math.floor(roundRunnerUp?.score || 0);
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
            now - lastRoundWinnerHypeAt > 40000;

        if (shouldHypeRoundWinner) {
            lastRoundWinnerHypeId = roundLeaderForVoice.id;
            lastRoundWinnerHypeAt = now;
            announceCurrentRoundLeader();
            screenShake = Math.max(screenShake, 5);
        }
    }

    const leader = currentTopArenaLeader;
    if (leader && leader.name) {
        const shouldHypeLeader =
            leader.id !== lastLeaderHypeId ||
            now - lastTopArenaHypeAt > 120000;

        if (shouldHypeLeader) {
            lastLeaderHypeId = leader.id;
            lastTopArenaHypeAt = now;
            if (leader.id === roundLeaderForVoice?.id) {
                announce(`Numero uno historico del arena y tambien lider de esta ronda: ${leader.name}.`, { gapMs: 650 });
            } else {
                announce(`Numero uno historico del arena ${leader.name}. Lleva ${Math.floor(leader.victories || 0)} rondas ganadas.`, { gapMs: 650 });
            }
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
        announceCurrentRoundLeader();
    }
    if (liveRoundLeader?.name && liveRoundRunnerUp?.name) {
        const gap = Math.max(
            0,
            Math.floor((liveRoundLeader.score || 0) - (liveRoundRunnerUp.score || 0))
        );
        if (gap <= 110) {
            announce(`Pelea intensa arriba. ${liveRoundLeader.name} y ${liveRoundRunnerUp.name} van muy cerca.`, { gapMs: 650 });
        }
    }
    if (currentTopArenaLeader?.name) {
        if (currentTopArenaLeader.id === liveRoundLeader?.id) {
            announce(`${currentTopArenaLeader.name} es numero uno historico del arena y tambien va primero en esta ronda.`, { gapMs: 650 });
        } else {
            announce(`Numero uno historico del arena ${currentTopArenaLeader.name}. Lleva ${Math.floor(currentTopArenaLeader.victories || 0)} rondas ganadas, pero puede no ir primero en esta ronda.`, { gapMs: 650 });
        }
    }
    announceGiftTip();
    announcePromoTip();
}, 105000);

let frameCount = 0;
let currentArenaKingId = null;
/** Burbujas: capa #arena-bubbles encima del canvas, position fixed + píxeles desde getBoundingClientRect. */
/** Las burbujas ahora se dibujan directamente en el Player.draw() dentro del canvas para que escalen con la cámara. 
    Esta función era redundante y causaba los círculos blancos que tapaban el avatar. */
function updateBubblesLayer() {
    // Eliminado: El dibujado ahora es autoritativo en Player.draw()
    const container = document.getElementById("arena-bubbles");
    if (container) container.innerHTML = ""; 
}

// Bucle principal a 60FPS
function loop() {
    if (!canvas || !ctx) { requestAnimationFrame(loop); return; }
    if (canvas.width < 100 || canvas.height < 100) { requestAnimationFrame(loop); return; }

    frameCount++;

    // En debug: SIEMPRE tener al menos 3 bots visibles (cada frame por si el sync los borra)
    if (DEBUG_MODE && typeof getArenaBounds === "function") {
        const b = getArenaBounds();
        const spread = Math.min(b.width, b.height) * 0.22;
        for (let i = 0; i < 3; i++) {
            const id = "debug_bot_" + (i + 1);
            if (players[id] && Number(players[id].hp ?? 1000) > 0) continue;
            const angle = (i / 3) * Math.PI * 2;
            players[id] = new Player({
                i: id, n: "BOT_" + (i + 1), s: 50 + i * 30, h: 1000, st: "ACTIVE",
                a: "https://p16-webcast.tiktokcdn.com/webcast-va/new_gifter_badge_v3.png~tplv-obj.image",
                x: b.cx + Math.cos(angle) * spread,
                y: b.cy + Math.sin(angle) * spread
            });
        }
    }

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
    
    // Phase 4: Distorsión Global (Universe Gift / Epic Events)
    if (globalGlitchIntensity > 0) {
        const gx = (Math.random() - 0.5) * globalGlitchIntensity;
        ctx.translate(gx, 0);
        globalGlitchIntensity *= 0.88; // Decaimiento más rápido para no agobiar
        if (globalGlitchIntensity < 0.1) globalGlitchIntensity = 0;
    }

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
    if (hitStopFrames > 0) {
        hitStopFrames--;
        const pListHit = Object.values(players);
        pListHit.forEach(p => {
            if (Number(p.hp ?? 1000) > 0) {
                try { p.draw(); } catch (e) {}
            }
        });
        ctx.restore();
        ctx.restore();
        updateBubblesLayer();
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
            
            const p1HasSaw = p1.sawLife > 0 || p1.getPassiveSawTier() > 0;
            const p2HasSaw = p2.sawLife > 0 || p2.getPassiveSawTier() > 0;
            
            // Distancia de colisión de cuerpos
            const bodyMinDist = p1.currentRadius + p2.currentRadius;
            // Distancia de colisión de sierras (clash)
            const saw1Radius = p1.currentRadius + 15 + (p1.getPassiveSawTier() * 12);
            const saw2Radius = p2.currentRadius + 15 + (p2.getPassiveSawTier() * 12);
            const sawMinDist = saw1Radius + saw2Radius;

            let collisionType = "none";
            let minDist = bodyMinDist;

            if (dist < bodyMinDist) {
                collisionType = "body";
                minDist = bodyMinDist;
            } else if (p1HasSaw && p2HasSaw && dist < sawMinDist) {
                collisionType = "saw-clash";
                minDist = sawMinDist;
            }

            if (collisionType !== "none") {
                let overlap = minDist - dist;
                if (dist === 0) { dx = 1; dy = 0; dist = 1; }

                let nx = dx / dist; let ny = dy / dist;
                
                // Intercambio de velocidades con rebote extra para sierras
                const bounceFactor = collisionType === "saw-clash" ? 1.5 : 1;
                let tx = p1.vx; let ty = p1.vy;
                p1.vx = p2.vx * bounceFactor; p1.vy = p2.vy * bounceFactor;
                p2.vx = tx * bounceFactor; p2.vy = ty * bounceFactor;

                let sep = (overlap / 2) + 1.5;
                p1.x -= nx * sep; p1.y -= ny * sep;
                p2.x += nx * sep; p2.y += ny * sep;

                const p1Clamped = clampToArena(p1.x, p1.y, p1.currentRadius + 8);
                const p2Clamped = clampToArena(p2.x, p2.y, p2.currentRadius + 8);
                p1.x = p1Clamped.x; p1.y = p1Clamped.y;
                p2.x = p2Clamped.x; p2.y = p2Clamped.y;

                if (collisionType === "saw-clash") {
                    spawnFloatingText("⚔️ CLASH", (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, "#ffd700");
                    playSound("buzzsaw", 1.5);
                    screenShake = Math.max(screenShake, 12);
                    createExplosion((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, "#fff", { count: 12, speed: 10 });
                } else {
                    const relativeSpeed = Math.sqrt((p1.vx - p2.vx) ** 2 + (p1.vy - p2.vy) ** 2);
                    const now = Date.now();
                    if (relativeSpeed > 2.6 && (now - (p1.lastBodyHitAt || 0) > 400)) {
                        p1.lastBodyHitAt = now; p2.lastBodyHitAt = now;
                        spawnFloatingText("CHOQUE", (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 16, "#fecaca");
                        screenShake = Math.max(screenShake, 6);
                        playSound("hit");
                    }
                }
            }
        }
    }

    // Actualizar y dibujar Jugadores
    let currentClosestToCenter = null;
    let minCenterDist = 120; // coreRadius

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // 1) Solo actualizar física y lógica; NO dibujar aquí (los efectos tapaban las bolas)
    pList.forEach(p => {
        if (p.opacity > 0.5) {
            const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
            if (dist < minCenterDist) {
                minCenterDist = dist;
                currentClosestToCenter = p;
            }
        }
        const hp = Number(p.hp ?? 1000);
        if (hp > 0) {
            try {
                p.update();
            } catch (e) {
                console.error("Error updating player", p.id, e);
            }
            if (p.id && (p.id === socket.id || p.id.startsWith("bot_"))) {
                positionBatch[p.id] = { x: Math.round(p.x), y: Math.round(p.y) };
            }
        }
    });

    // Lógica del Nuevo Rey
    if (currentClosestToCenter && currentClosestToCenter.id !== currentArenaKingId) {
        currentArenaKingId = currentClosestToCenter.id;
        // Coronación Pública
        spawnFloatingText(`${currentClosestToCenter.name.toUpperCase()} REY DEL CENTRO`, cx, cy - 150, "#ffd700");
        showAnnouncer(`${currentClosestToCenter.name.toUpperCase()} TOMA EL CENTRO`, "#ffd166");
        screenShake = Math.max(screenShake, 10);
        playSound("heal", 0.5); // Sonido triunfal pitch grave
        playSound("powerUp");

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
        p.life -= 0.035; // Vida un poco más larga
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        
        if (p.isHeart) {
            // Dibujar un corazón simple
            const s = p.size || 10;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y + s / 4);
            ctx.bezierCurveTo(p.x, p.y, p.x - s / 2, p.y, p.x - s / 2, p.y + s / 4);
            ctx.bezierCurveTo(p.x - s / 2, p.y + s / 2, p.x, p.y + s * 0.75, p.x, p.y + s);
            ctx.bezierCurveTo(p.x, p.y + s * 0.75, p.x + s / 2, p.y + s / 2, p.x + s / 2, p.y + s / 4);
            ctx.bezierCurveTo(p.x + s / 2, p.y, p.x, p.y, p.x, p.y + s / 4);
            ctx.fill();
        } else if (p.isCoin) {
            // Dibujar una moneda (círculo dorado con brillo)
            const s = p.size || 8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#fff7d6";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        } else {
            ctx.beginPath(); 
            ctx.arc(p.x, p.y, p.size || 3, 0, Math.PI * 2); 
            ctx.fill();
        }
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

    // Phase 4: Duel Beams (Líneas de conexión de impactos)
    for (let i = duelBeams.length - 1; i >= 0; i--) {
        let db = duelBeams[i];
        ctx.beginPath();
        ctx.moveTo(db.sx, db.sy);
        ctx.lineTo(db.tx, db.ty);
        ctx.strokeStyle = db.color;
        ctx.lineWidth = 3 + Math.random() * 4;
        ctx.globalAlpha = db.life / 30; // Suponiendo max life 30
        ctx.stroke();

        db.life -= 1;
        if (db.life <= 0) duelBeams.splice(i, 1);
    }
    ctx.globalAlpha = 1.0;

    // Detalle (avatar, nombre, etc.) dentro del transform de cámara
    pList.forEach(p => {
        if (!p || Number(p.hp || 0) <= 0) return;
        try {
            p.draw();
        } catch (e) {
            console.error("Error drawing player", p?.id, e);
        }
    });

    if (DEBUG_MODE) {
        ctx.fillStyle = "rgba(255, 0, 0, 0.8)";
        ctx.font = "bold 24px Rajdhani";
        ctx.fillText(`DEBUG MODE ON - PLAYERS: ${pList.length}`, 400, 300);
        ctx.fillText(`CAM SCALE: ${camera.scale.toFixed(2)}`, 400, 330);
    }

    ctx.restore(); // Restore Camera
    ctx.restore(); // Restore Shake

    // El dibujado de burbujas en pantalla (Screen Space) ha sido eliminado para evitar "deformaciones".
    // Ahora los avatares se dibujan en World Space (dentro del transform de cámara) en Player.draw().

    updateBubblesLayer();

    requestAnimationFrame(loop);
}

// Iniciar Motor
requestAnimationFrame(loop);

// ------------------------------------------
// --- ⚙️ LÓGICA DE DEBUG (OCULTA POR DEFECTO) ---
// ------------------------------------------
if (DEBUG_MODE) {
    const debugPanel = document.getElementById("debug-panel");
    if (debugPanel) debugPanel.style.display = "block";

    // Posiciones visibles dentro de la arena para bots de prueba
    function getDebugSpawnPosition(index, total) {
        const b = getArenaBounds();
        const spread = Math.min(b.width, b.height) * 0.22;
        const angle = (index / Math.max(1, total)) * Math.PI * 2;
        return {
            x: b.cx + Math.cos(angle) * spread,
            y: b.cy + Math.sin(angle) * spread
        };
    }

    function simulateLocalSync(id, name, score, x, y) {
        if (!players[id]) {
            const pos = (x != null && y != null) ? { x, y } : getDebugSpawnPosition(Object.keys(players).length, 4);
            players[id] = new Player({
                i: id, n: name, s: score ?? 100, h: 1000, st: "ACTIVE",
                x: pos.x, y: pos.y
            });
        } else {
            players[id].score += score ?? 0;
            players[id].hp = 1000;
        }
        players[id].opacity = 1;
    }

    document.getElementById("debug-spawn-bot")?.addEventListener("click", () => {
        const bid = "bot_" + Math.floor(Math.random() * 9999);
        const pos = getDebugSpawnPosition(Object.keys(players).length, 5);
        simulateLocalSync(bid, "BOT_" + bid.slice(-4), 500, pos.x, pos.y);
        spawnFloatingText("BOT", pos.x, pos.y - 40, "#fff");
        socket.emit("arena:debug:gift", { giftName: "Bot Spawn", diamondCount: 1, uniqueId: bid });
    });

    document.getElementById("debug-gift-rose")?.addEventListener("click", () => {
        socket.emit("arena:debug:gift", { giftName: "Rosa", diamondCount: 1 });
        const pids = Object.keys(players);
        if (pids.length > 0) {
            const targetId = pids[Math.floor(Math.random() * pids.length)];
            const p = players[targetId];
            if (p && typeof createExplosion === "function") createExplosion(p.x, p.y, "#ff4757");
        }
        spawnFloatingText("ROSE", canvas.width / 2, canvas.height / 2, "#ff4757");
    });

    document.getElementById("debug-gift-galaxy")?.addEventListener("click", () => {
        socket.emit("arena:debug:gift", { giftName: "Galaxia", diamondCount: 1000 });
        const pids = Object.keys(players);
        if (pids.length >= 2) {
            const attacker = players[pids[0]];
            const target = players[pids[1]];
            if (attacker && target && typeof spawnProjectileBurst === "function") {
                spawnProjectileBurst(attacker, target, 12, 500, "#a855f7", { label: "🌌", radius: 25 });
            }
        }
        if (typeof triggerOverlayFlash === "function") triggerOverlayFlash("168, 85, 247", 0.5);
    });

    document.getElementById("debug-gift-universe")?.addEventListener("click", () => {
        socket.emit("arena:debug:gift", { giftName: "Universo", diamondCount: 35000 });
        const pids = Object.keys(players);
        if (pids.length >= 2 && typeof spawnProjectile === "function") {
            const attacker = players[pids[0]];
            const target = players[pids[1 % pids.length]] || attacker;
            spawnProjectile(attacker, target, 2000, "#ffd166", { label: "🦁", radius: 50, speed: 5 });
        }
        if (typeof triggerOverlayFlash === "function") triggerOverlayFlash("255, 215, 100", 0.6);
    });

    document.getElementById("debug-toggle-sd")?.addEventListener("click", () => {
        socket.emit("arena:debug:toggleSD");
    });

    const btnUni = document.createElement("button");
    btnUni.textContent = "Spawn Universo (Test)";
    btnUni.style.cssText = "background:#333;color:#fff;border:1px solid #666;padding:5px 10px;cursor:pointer;margin-top:5px;width:100%;";
    btnUni.onclick = () => {
        const pids = Object.keys(players);
        if (pids.length >= 2 && typeof spawnProjectile === "function") {
            const attacker = players[pids[0]];
            const target = players[pids[1 % pids.length]] || attacker;
            spawnProjectile(attacker, target, 2000, "#ffd166", { label: "🦁", radius: 50, speed: 5 });
        }
        if (typeof triggerOverlayFlash === "function") triggerOverlayFlash("255, 215, 100", 0.6);
    };
    document.getElementById("debug-panel")?.appendChild(btnUni);
}

// Auto-despertar AudioContext si es necesario
document.addEventListener("mousedown", () => {
    if (audioCtx?.state === 'suspended') audioCtx.resume();
});
