const socket = io();

// Elementos DOM
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const leaderboardEl = document.getElementById("arena-leaderboard");
const floatingLayer = document.getElementById("floating-ui-layer");

// Ajustar Canvas
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// ==========================================
// MOTOR DE AUDIO (SYNTH)
// ==========================================
let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let soundEnabled = true; // Por defecto lo activamos

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
        if (!isBgmPlaying && typeof startBgm === 'function') {
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
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => checkAudioState());
    }
    soundEnabled = !soundEnabled;
    e.target.textContent = soundEnabled ? '🔊 Sonido ON' : '🔇 Sonido OFF';
    e.target.classList.toggle('active', soundEnabled);
    if (soundEnabled) {
        startBgm();
        playSound("heal");
    } else {
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

const sfx = {
    shoot: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
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
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
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
        gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
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
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.2);
    },
    heal: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(800, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.1);
        gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.3);
    },
    // Sonido de explosión pesada para regalos top
    heavyExplosion: () => {
        if (!soundEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(40, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1, audioCtx.currentTime + 1.2);
        gain.gain.setValueAtTime(0.8, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.2);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 1.2);
    }
};

function playSound(type) {
    if (sfx[type]) sfx[type]();
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
const projectiles = [];
const particles = [];
const lightningBolts = [];
const hazards = []; // Elementos peligrosos en el mapa como sierras y lasers

let screenShake = 0; // Intensidad de vibración de pantalla

// ==========================================
// CONFIGURACIONES FÍSICAS
// ==========================================
const MAX_HP = 500; // Sincronizado con el servidor
let PLAYER_RADIUS = 45; // Incrementado de 30 a 45 para mejor visibilidad inicial
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
    ctx.fillStyle = "rgba(5, 5, 16, 1)";
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

        // Spawn Random
        this.x = Math.random() * (canvas.width - 200) + 100;
        this.y = Math.random() * (canvas.height - 200) + 100;

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
        // AFK Shrinking & Fading (si pasaron más de 30 segundos)
        const idleTime = Date.now() - this.lastActive;
        const scoreScale = Math.sqrt(this.score) / 1.5; // Crecimiento más agresivo y visible
        const targetRadius = PLAYER_RADIUS + scoreScale;

        if (idleTime > 20000) {
            const decayFactor = Math.min((idleTime - 20000) / 40000, 1);
            this.currentRadius = targetRadius * (1 - decayFactor * 0.8);
            this.opacity = 1 - decayFactor;
        } else {
            // Suavizar el crecimiento
            this.currentRadius += (targetRadius - this.currentRadius) * 0.1;
            this.opacity = 1.0;
        }

        // Físicas
        this.x += this.vx;
        this.y += this.vy;

        // Rebote colisión de bordes
        if (this.x < this.currentRadius) { this.x = this.currentRadius; this.vx *= -1; }
        if (this.x > canvas.width - this.currentRadius) { this.x = canvas.width - this.currentRadius; this.vx *= -1; }
        if (this.y < this.currentRadius) { this.y = this.currentRadius; this.vy *= -1; }
        if (this.y > canvas.height - this.currentRadius) { this.y = canvas.height - this.currentRadius; this.vy *= -1; }

        if (this.flash > 0) this.flash -= 0.05;
    }

    draw() {
        if (this.opacity <= 0.05) return; // Ya casi invisible, no gastar GPU

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
            if (hpPercent > 0.6) ctx.strokeStyle = "#2ed573";
            else if (hpPercent > 0.3) ctx.strokeStyle = "#ffa502";
            else ctx.strokeStyle = "#ff4757";
        }
        ctx.stroke();

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
    }

    takeDamage(amount, attackerId) {
        if (this.hp <= 0) return; // ya muerto
        this.hp -= amount;
        this.flash = 1;

        spawnFloatingText(`-${amount}`, this.x, this.y, "#ff4757");

        // Recompensar al atacante
        if (attackerId && players[attackerId]) {
            players[attackerId].score += amount;
            syncStateToServer(players[attackerId]);
        }

        if (this.hp <= 0) {
            // Muerte explosiva masiva
            createExplosion(this.x, this.y, "#ff4757");
            screenShake = 20;
            spawnFloatingText(`💥 K.O.`, this.x, this.y, "#ffeb3b");
            playSound("explosion");

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
        this.hp = Math.min(this.hp + amount, MAX_HP);
        this.flash = 1;
        spawnFloatingText(`+${amount}`, this.x, this.y, "#2ed573");
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

        // Rebota furiosamente
        if (this.x < this.radius) { this.x = this.radius; this.vx *= -1; playSound("hit"); }
        if (this.x > canvas.width - this.radius) { this.x = canvas.width - this.radius; this.vx *= -1; playSound("hit"); }
        if (this.y < this.radius) { this.y = this.radius; this.vy *= -1; playSound("hit"); }
        if (this.y > canvas.height - this.radius) { this.y = canvas.height - this.radius; this.vy *= -1; playSound("hit"); }

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
    const ids = Object.keys(serverPlayers);
    if (ids.length > 0) {
        console.log(`📡 ARENA SYNC: ${ids.length} jugadores.`);
    }

    for (const id in serverPlayers) {
        const sPlayer = serverPlayers[id];
        if (!players[id]) {
            console.log("🆕 Jugador nuevo:", sPlayer.name);
            players[id] = new Player(sPlayer);
        } else {
            players[id].hp = sPlayer.hp;
            players[id].score = sPlayer.score;
            players[id].lastActive = sPlayer.lastActive;
        }
    }
    // No borrar bots de prueba locales
    for (const id in players) {
        if (!serverPlayers[id] && !id.startsWith("bot_tester_")) {
            delete players[id];
        }
    }
});

socket.on("arena:you", (data) => {
    myArenaId = data.uniqueId;
    console.log("👤 Identidad en Arena:", myArenaId);
});
});

// Forzar actualización del Ranking DOM cada vez que hay sync
socket.on("arena:sync", () => {
    updateRankingDOM();
});

// Log diagnóstico cada 5 segundos
setInterval(() => {
    const count = Object.keys(players).length;
    console.log(`📊 ARENA DEBUG: ${count} jugadores en memoria.`);
}, 5000);

socket.on("arena:join", (p) => {
    if (!players[p.id]) players[p.id] = new Player(p);
    updateRankingDOM();
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

// EVENTO DE CURACIÓN / APOYO (LIKES / TAP TAP)
socket.on("arena:like", (data) => {
    const p = players[data.userId];
    if (p) {
        p.heal(data.likeCount * 5); // Aumentado: 5 Vida por Like (antes 2)
        p.flash = 1;
        // Mostrar texto de apoyo más seguido (desde 5 likes en combo)
        if (data.likeCount >= 5) {
            spawnFloatingText("TAP TAP! ✨", p.x, p.y, "#2ed573");
        }
    }
});

// EVENTO DE ATAQUE (REGALOS)
socket.on("arena:gift", (data) => {
    const attacker = players[data.userId];
    if (!attacker) return;

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
    let damage = diamonds * 10;
    let atkType = "projectile";
    let color = "#00f0ff";

    // Efectos visuales según nombre del regalo (Detección bilingüe avanzada)
    const gName = data.giftName.toLowerCase();

    // 1. NIVEL DIOS (Universe, León, Interstellar)
    if (gName.includes("universe") || gName.includes("universo") || gName.includes("lion") || gName.includes("león") || diamonds >= 20000) {
        playSound("heavyExplosion"); // Sonido pesado
        screenShake = 100; // Sacudida extrema
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)"; // DESTELO BLANCO
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        spawnFloatingText("🌌 UNIVERSO !", target.x, target.y, "#ff00ff");
        createExplosion(target.x, target.y, "#fff"); // Explosión blanca cegadora

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
        createExplosion(target.x, target.y, color);
    } else if (atkType === "buzzsaw") {
        playSound("explosion");
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

function updateRankingDOM() {
    // Convertir a array, filtrar vivos/activos Y CON SCORE > 0 y ordenar por score/hp
    const sorted = Object.values(players)
        .filter(p => p.hp > 0 && p.opacity > 0.1 && p.score > 0)
        .sort((a, b) => b.score - a.score || b.hp - a.hp);

    // Solo mostramos el TOP 5 en el ranking horizontal
    const top5 = sorted.slice(0, 5);
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
                    <span class="stat-hp">❤️ ${Math.floor(p.hp)}</span>
                    <span class="stat-score">⚔️ ${Math.floor(p.score)}</span>
                </div>
            </div>
        `;
        leaderboardEl.appendChild(row);
    });
}

// Bucle principal a 60FPS
function loop() {
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
    pList.forEach(p => {
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

    // Enviar lote de posiciones cada 30 frames (~500ms)
    if (frameCount % 30 === 0 && Object.keys(positionBatch).length > 0) {
        socket.emit("arena:batchUpdate", positionBatch);
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

    // Partículas
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

    ctx.restore(); // Limpiar Screen Shake
    requestAnimationFrame(loop);
}

// Iniciar Motor
requestAnimationFrame(loop);
