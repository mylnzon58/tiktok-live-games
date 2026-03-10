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

// Attempt auto-unlock de AudioContext
function unlockAudio() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    if (!isBgmPlaying && typeof startBgm === 'function') {
        startBgm();
    }
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
}
document.addEventListener('click', unlockAudio);
document.addEventListener('touchstart', unlockAudio);
document.addEventListener('keydown', unlockAudio);

// Intentar arrancar BGM directamente para fuentes como OBS
setTimeout(() => {
    if (audioCtx.state !== 'suspended' && typeof startBgm === 'function') {
        startBgm();
    }
}, 500);

const soundBtn = document.getElementById('sound-btn');
soundBtn.textContent = '🔊 Sonido ON';
soundBtn.classList.add('active');

// Observador continuo de interacción para OBS/TikTok Studio
let ctxUnlocker = setInterval(() => {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            if (audioCtx.state === 'running') {
                clearInterval(ctxUnlocker);
                if (!isBgmPlaying && typeof startBgm === 'function') startBgm();
            }
        }).catch(e => { });
    } else {
        clearInterval(ctxUnlocker);
        if (!isBgmPlaying && typeof startBgm === 'function') startBgm();
    }
}, 1000);

soundBtn.addEventListener('click', (e) => {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    soundEnabled = !soundEnabled;
    e.target.textContent = soundEnabled ? '🔊 Sonido ON' : '🔇 Sonido OFF';
    e.target.classList.toggle('active', soundEnabled);
    if (soundEnabled) playSound("heal"); // sonido de test 
});

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
        gain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.1);
        gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.3);
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

// ==========================================
// CONFIGURACIONES FÍSICAS
// ==========================================
const MAX_HP = 1000;
const PLAYER_RADIUS = 30; // Tamaño de cada circulito guerreando
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
    for (let i = 0; i < 20; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 1.0,
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

        // Spawn Random
        this.x = Math.random() * (canvas.width - 200) + 100;
        this.y = Math.random() * (canvas.height - 200) + 100;

        // Vector de Movimiento Bouncingueno
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * BASE_SPEED;
        this.vy = Math.sin(angle) * BASE_SPEED;

        // Estado Flash visual por daño
        this.flash = 0;
    }

    update() {
        // Físicas
        this.x += this.vx;
        this.y += this.vy;

        // Rebote colisión de bordes
        if (this.x < PLAYER_RADIUS) { this.x = PLAYER_RADIUS; this.vx *= -1; }
        if (this.x > canvas.width - PLAYER_RADIUS) { this.x = canvas.width - PLAYER_RADIUS; this.vx *= -1; }
        if (this.y < PLAYER_RADIUS) { this.y = PLAYER_RADIUS; this.vy *= -1; }
        if (this.y > canvas.height - PLAYER_RADIUS) { this.y = canvas.height - PLAYER_RADIUS; this.vy *= -1; }

        if (this.flash > 0) this.flash -= 0.05;
    }

    draw() {
        ctx.save();

        // Si flash es mayor a 0, añadir sombra blanca brillante (recibió daño o cura)
        if (this.flash > 0) {
            ctx.shadowBlur = 20;
            ctx.shadowColor = "#fff";
        }

        // Dibujar clip circular (avatar)
        ctx.beginPath();
        ctx.arc(this.x, this.y, PLAYER_RADIUS, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip(); // Cortar a círculo

        const img = getAvatarImage(this.avatar);
        if (img && img.complete) {
            ctx.drawImage(img, this.x - PLAYER_RADIUS, this.y - PLAYER_RADIUS, PLAYER_RADIUS * 2, PLAYER_RADIUS * 2);
        } else {
            ctx.fillStyle = "#333";
            ctx.fill();
        }

        ctx.restore(); // limpiar clip

        // Dibujar Borde (Color depende de Vida)
        ctx.beginPath();
        ctx.arc(this.x, this.y, PLAYER_RADIUS, 0, Math.PI * 2);
        ctx.lineWidth = 4;

        if (this.flash > 0) {
            ctx.strokeStyle = "white"; // Impacto full blaco
        } else {
            const hpPercent = this.hp / MAX_HP;
            if (hpPercent > 0.6) ctx.strokeStyle = "#2ed573"; // Verde
            else if (hpPercent > 0.3) ctx.strokeStyle = "#ffa502"; // Naranja
            else ctx.strokeStyle = "#ff4757"; // Rojo
        }
        ctx.stroke();

        // Dibujar nombre y HP
        ctx.fillStyle = "white";
        ctx.font = "bold 12px Rajdhani";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${Math.floor(this.hp)} HP`, this.x, this.y + PLAYER_RADIUS + 12);

        // Nombre
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "10px sans-serif";
        ctx.fillText(this.name.substring(0, 10), this.x, this.y + PLAYER_RADIUS + 24);
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
            // Muerte explosiva
            createExplosion(this.x, this.y, "#ff4757");
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
        ctx.arc(this.x, this.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fill();
        ctx.shadowBlur = 0;
    }
}

// ==========================================
// MÉTODOS DE RED (SOCKETS)
// ==========================================
function syncStateToServer(p) {
    socket.emit("arena:updatePlayer", { id: p.id, hp: p.hp, score: p.score });
    updateRankingDOM();
}

socket.on("arena:sync", (serverPlayers) => {
    for (const id in serverPlayers) {
        if (!players[id]) players[id] = new Player(serverPlayers[id]);
        else {
            players[id].hp = serverPlayers[id].hp;
            players[id].score = serverPlayers[id].score;
        }
    }
    updateRankingDOM();
});

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

// EVENTO DE CURACIÓN (LIKES)
socket.on("arena:like", (data) => {
    const p = players[data.userId];
    if (p) p.heal(data.likeCount * 5); // 5 Vida por Like
});

// EVENTO DE ATAQUE (REGALOS)
socket.on("arena:gift", (data) => {
    const attacker = players[data.userId];
    if (!attacker) return;

    const diamonds = data.diamondCount * data.count;

    // Buscar enemigo más cercano
    let target = null;
    let minDist = Infinity;
    for (const id in players) {
        if (id === attacker.id || players[id].hp <= 0) continue;
        const enemy = players[id];
        const dist = Math.sqrt((attacker.x - enemy.x) ** 2 + (attacker.y - enemy.y) ** 2);
        if (dist < minDist) { minDist = dist; target = enemy; }
    }

    if (!target) return; // No hay a quien atacar

    // Logica por regalo (Daño base)
    let damage = diamonds * 10;
    let atkType = "projectile";
    let color = "#00f0ff";

    // Efectos visuales según nombre del regalo
    const gName = data.giftName.toLowerCase();
    if (gName.includes("rose") || gName.includes("rosa")) {
        atkType = "projectile"; color = "#ff4757"; // Rojo
    } else if (gName.includes("donut") || gName.includes("ray")) {
        atkType = "lightning"; color = "#fbbf24"; // Amarillo
        damage = diamonds * 15;
    } else if (gName.includes("perfume")) {
        atkType = "projectile"; color = "#a855f7"; // Morado
    } else {
        // Regalo genérico o muy caro
        atkType = diamonds > 50 ? "lightning" : "projectile";
        color = "#fff";
    }

    // Ejecutar ataque
    if (atkType === "projectile") {
        // Un misil por cada combo
        for (let i = 0; i < Math.min(data.count, 10); i++) {
            setTimeout(() => {
                playSound("shoot");
                projectiles.push(new Projectile(attacker.x, attacker.y, target.id, (damage / data.count), attacker.id, color));
            }, i * 150);
        }
    } else if (atkType === "lightning") {
        // Rayo instantaneo
        playSound("lightning");
        lightningBolts.push({ sx: attacker.x, sy: attacker.y, tx: target.x, ty: target.y, life: 1.0, color });
        target.takeDamage(damage, attacker.id);
        createExplosion(target.x, target.y, color);
    }
});

// ==========================================
// GAME LOOP Y DIBUJADO
// ==========================================

function updateRankingDOM() {
    const sorted = Object.values(players).sort((a, b) => b.score - a.score).slice(0, 10); // Top 10
    leaderboardEl.innerHTML = "";

    sorted.forEach((p, idx) => {
        if (p.score <= 0 && p.hp <= 0) return; // Omitir no combatientes

        let rankClass = "p" + (idx + 1);
        if (idx > 2) rankClass = "p-rest";

        const row = document.createElement("div");
        row.className = `arena-board-row ${rankClass}`;

        // Fallback Image
        const imgUrl = p.avatar || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23333'/></svg>";

        row.innerHTML = `
      <div class="board-pos">#${idx + 1}</div>
      <img class="board-avatar" src="${imgUrl}" />
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
    drawBackground();

    // Físicas entre jugadores (Opcional Colisiones Simples de rebote)
    const pList = Object.values(players);
    for (let i = 0; i < pList.length; i++) {
        for (let j = i + 1; j < pList.length; j++) {
            let p1 = pList[i]; let p2 = pList[j];
            if (p1.hp <= 0 || p2.hp <= 0) continue;

            let dx = p2.x - p1.x; let dy = p2.y - p1.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            // Chocan
            if (dist < PLAYER_RADIUS * 2) {
                // Evitar superposición excesiva 
                let overlap = PLAYER_RADIUS * 2 - dist;
                if (dist === 0) { dx = 1; dy = 0; dist = 1; }

                // Normalizar
                let nx = dx / dist; let ny = dy / dist;
                // Intercambiar velocidades sencillamente y separar un poco
                let tx = p1.vx; let ty = p1.vy;
                p1.vx = p2.vx; p1.vy = p2.vy;
                p2.vx = tx; p2.vy = ty;

                // Separar basándonos en overlap
                let sep = (overlap / 2) + 1;
                p1.x -= nx * sep; p1.y -= ny * sep;
                p2.x += nx * sep; p2.y += ny * sep;
            }
        }
    }

    // Actualizar y dibujar Jugadores
    pList.forEach(p => {
        if (p.hp > 0) {
            p.update();
            p.draw();
        }
    });

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

    requestAnimationFrame(loop);
}

// Iniciar Motor
requestAnimationFrame(loop);
